# 计划：worker 内置自有媒体库（点播 + 直播）

状态：v4，已确认（2026-10-12，待确认问题全部按推荐处理；CI token 已有 D1 权限）。

进度：第 1 到 5 阶段和管理后台已完成（2026-10-13）；第 6 阶段（R2 托管）按计划暂缓。

实施时与本文的出入（以代码为准）：

- 契约放在 `apps/api/src/modules/media/contract.ts`，没有单独建 `packages/media-api`；OpenAPI 文档由 Worker 在 `/v1/openapi.json` 现场生成。
- 源数据表都在 `modules/media/schema.ts` 一个文件里；直播设置并入通用的 `media_settings` 键值表（键 `live_epg_urls`），首页主推位也存在这里（键 `hero_title_ids`）。
- D1 的 migration 在 `apps/api/d1/media/`；`rm_rows` 多一列 `name`，`rm_search` 多一列 `hash`，`rm_cms_items` 多 `genres` 和 `hash` 两列。
- 去掉了 `GET /titles/:id/credits`：详情里的演职员已够用（演员最多 50 人）。搜索去掉了 `type` 参数。
- 播出日期的判断在投影时完成（以 UTC 日期为准）：未到播出日的集在发布后不会自动变为可播放，需要再发布一次。
- 缓存键是去掉 token 的 URL 加 `generation`；isolate 内对 `generation` 最多缓存 10 秒。ETag 就是 `generation`。
- 媒体接口和文件一样不校验设备绑定（`X-Device-Id` / `X-Device-Key`），只认 token。
- 后台“重建只读模型”是 `POST /api/media/readmodel/rebuild`；没有 D1 绑定的部署（Bun）发布时跳过投影。
- CI 部署时按名字查找或创建 `tvbox-media`，把 `database_id` 临时写进 `wrangler.toml`，再执行 `wrangler d1 migrations apply MEDIA --remote`；仓库里的 `wrangler.toml` 不带 `database_id`。
- CMS 的 `vod` 列表和详情 JSON 在投影时预先算好，存进 `rm_cms_items.list_json` / `detail_json`；筛选用表里的 `type_id`、`year`、`country`（国家代码）和 `genres` 列。CMS 不能按线路下发请求头。
- `live.m3u` 由 Worker 根据 D1 里的直播数据现场生成，不写入 R2。
- 后台“发布”页提供“添加订阅条目”按钮，一键在公共站点和直播源里加上 `@media/cms` / `@media/live.m3u` 条目。
- 后台没有做“预览”页；排序用上移、下移按钮，不支持拖拽。
- 第 4 阶段没有在模拟器上验证，改为用 RN 客户端的 CMS 解析代码直接解析我们的输出。
- 线路和播放地址的改动只在让某集（或电影）从不可播变为可播时才更新作品的 `updatedAt`；换地址、加备用线路、删线路只重新发布 `rm_playback` 和对应的 CMS 条目，元数据不变。

## 目标

在 worker 里建立我们自己的媒体库。内容在管理后台维护，通过现有的设备订阅下发到每台设备。

- **元信息库**：参照 TMDB 和 Netflix 的结构，"季"作为一等实体，元信息和可播放资源分层存放。
- **原生 Media API（主接口）**：按我们自己的数据模型设计，以资源为中心（作品、季、集、播放、人物、首页推荐行、筛选项），不受 Apple CMS 的限制。由无状态 Worker 查询 **D1** 后返回。我们自己的客户端（RN）以后直接对接这套接口。
- **Apple CMS v10 兼容层**：基于同一个 D1 只读模型做适配，供 RN 当前版本以及其他 TVBox 客户端使用。功能是原生接口的子集。
- **直播**：分组、频道、线路三层。原生接口提供结构化的频道数据，兼容层提供 M3U 加 EPG 地址。

上线顺序：原生 API 和兼容层同时上线，订阅里只放**一条**站点条目，同时满足新旧客户端（见"注入订阅配置"）。RN 对接原生 API 另立计划，本计划只负责把接口契约定稳。

思路借鉴 LibreTV。它的代码是 AGPL-3.0，这里只参考思路，代码全部自己写。

## 不在本期范围

- 采集：从其他 CMS 站拉片源，或者爬取网页。数据模型留了 `origin` 字段和外部 ID 表，现在只做预留。
- TMDB 元数据刮削：字段和 TMDB 一一对应，以后接入时可以直接填充。
- 转码、HLS 切片，以及对自有流做去广告。
- 按设备单独选择媒体库。
- 服务端同步观看进度、多用户档案：原生 API 的结构给它留了位置，本期不做。
- 字幕、片头片尾标记、带签名的短期播放地址：原生 API 预留了这几个字段，本期返回空值。
- RN 客户端对接原生 API：另立计划。
- 在 R2 上托管视频文件放在第 6 阶段，属于可选项。

## 总体架构：DO 写，D1 读，一个只读模型对应两种接口

```text
管理后台 ──► Durable Object（SQLite，源数据，事务）
                 │ 发布：按资源增量投影（D1 batch，原子）
                 ▼
             D1「tvbox-media」（只读模型：资源文档 + 浏览/筛选/搜索索引）
                 ▲                                   ▲
                 │                                   │
   /s/<token>/media/v1/*  原生 API          /s/<token>/media/cms  CMS 兼容层
   （我们的客户端）                          （RN 当前版本 / TVBox 生态）
                 └──────── Cache API（按"去掉 token 的 URL"共享缓存）────────┘
   /s/<token>/media/live.m3u ──► R2（发布时生成）
```

**为什么源数据仍放在 DO，不全部迁到 D1**：`workers/db.ts` 里写明了，后台 API 依赖 DO SQLite 的本地查询和真正的交互式事务（权限遍历、20 多处先读后写）。D1 是远程服务，自动提交，没有 `BEGIN` / `COMMIT`。所以：

- **DO SQLite** 存规范化的元信息（源数据）。后台的增删改、审计、备份都在这里完成，和现有模块一致。
- **D1** 只存"已发布"的只读模型。客户端的请求全部由 Worker 查 D1 返回，不唤醒 DO。
- **只读模型以资源为中心**：存原生 API 的资源文档（作品、季、播放信息、人物……），而不是拍平成 CMS 格式。CMS 兼容层在请求时，用这些文档加一张轻量的 CMS 索引表拼装出响应。

**为什么不继续用 R2 快照**：用快照的话，每次请求都要把整个媒体库加载进 isolate 内存。D1 能按需分页、走索引筛选、做全文检索，数据量上到几万条也没问题。

**直播 M3U 仍用 R2**：M3U 每次都是整份下发，发布时直接生成文件即可。

## 模块拆分

```text
apps/api/src/modules/media/
  index.ts                 模块注册（routes、backup、audit 事件）
  schema.ts                汇总导出下面各子模块的 DO 表
  shared/
    enums.ts               kind / status / role 等枚举
    external-ids.ts        外部 ID 的增删改查与唯一性校验
  catalog/                 作品、季、集、合集（service + routes）
  people/                  人物、演职员
  taxonomy/                分类、题材、首页推荐行
  artwork/                 图片（外链，或 R2 按内容寻址上传）
  playable/                播放源与流；"集名$地址"批量粘贴并对齐到集
  live/                    直播分组 / 频道 / 线路；m3u.ts（解析与生成）
  readmodel/               只读模型
    d1-schema.ts           D1 表定义（独立的 drizzle schema）
    documents.ts           DO 数据 -> 原生 API 资源文档（纯函数）
    projector.service.ts   计算变更集（按文档哈希），分批写入 D1；全量重建
  media.backup.ts
apps/api/d1/media/                 D1 的 migration 目录（wrangler d1 migrations）
packages/media-api/                原生 API 契约：zod schema + 由它生成的 OpenAPI 文档
apps/api/src/workers/media/
  app.ts                   挂在 /s/<token>/media 下的 Hono 应用：token 校验、缓存、路由
  v1/                      原生 API 的各个 handler（只读 D1）
  cms/                     CMS 兼容层：参数解析、查询、格式化
  live.ts                  /live.m3u，从 R2 读取
apps/web/src/app/routes/_app/admin/media*.tsx   后台页面（写法同 tvbox.tsx / -tvbox-*.tsx）
```

`packages/media-api` 是 Worker 和后台之间唯一的契约来源；RN 以后由生成出来的 OpenAPI 文档生成类型，不直接引用 worker 的代码。

## 一、源数据模型（DO SQLite，migration `0011_media.sql`）

约定：

- 主键：凡是会作为对外 ID 出现的，用自增整数（作品、季），保证 App 的播放记录、收藏不失效；其余沿用代码库现有的 ULID。
- 时间字段统一为 `created_at` / `updated_at`，类型是 ISO 文本，与现有表一致。
- 下表中 `?` 表示可空；JSON 表示用 SQLite 文本存储的 JSON。

### 1.1 作品 `media_titles`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | integer PK 自增 | 电影导出为 `m<id>` |
| `kind` | `movie` / `series` | |
| `category_id` | text FK | 浏览分类 |
| `title` | text | 中文主标题 |
| `original_title` | text? | 原名 |
| `original_language` | text? | ISO 639-1 |
| `origin_countries` | JSON | ISO 3166-1 数组，第一个是主产地 |
| `overview` / `tagline` | text? | 简介 / 宣传语 |
| `release_date` | text? | 电影上映日期 |
| `runtime` | integer? | 电影片长（分钟） |
| `status` | `upcoming` / `released` / `returning` / `ended` / `canceled` | 剧集状态在保存季时自动推导，也可以手动覆盖 |
| `content_rating` | text? | 如 `PG-13`、`TV-MA` |
| `is_adult` | boolean | |
| `vote_average` / `vote_count` / `popularity` | real / integer / real | 自填，或以后刮削 TMDB 填入 |
| `collection_id` | text? FK | 系列电影 |
| `publish_state` | `draft` / `published` / `hidden` | `hidden` 表示曾经发布过、现在下架 |
| `origin` | text? | null 表示手工录入；以后采集或刮削时写入来源 |
| `sort` | integer | 同分类内的手动排序权重 |

索引：`(category_id, publish_state)`、`(collection_id)`。

### 1.2 季 `media_seasons`（一等实体）

剧集一律通过季来组织，**没有"不属于任何季的集"**。只有一季的剧集也建一个第 1 季。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | integer PK 自增 | 导出为 `s<id>` |
| `title_id` | integer FK，级联删除 | 只能挂在 `kind = series` 的作品下 |
| `season_number` | integer | 0 表示特别篇；`(title_id, season_number)` 唯一 |
| `name` | text? | 自定义季名，如"第一部""上半季"；为空时显示"第 N 季" |
| `overview` | text? | 季简介；为空时回退到作品简介 |
| `air_date` / `end_date` | text? | 首播日期 / 完结日期 |
| `status` | `upcoming` / `airing` / `ended` | |
| `episode_total` | integer? | 计划集数，用于显示"更新至 8 / 共 12 集" |
| `update_schedule` | text? | 如"每周五 20:00 更新"，导出到简介末尾 |
| `content_rating` | text? | 季级分级，可覆盖作品级 |
| `publish_state` | `draft` / `published` / `hidden` | 可以只发布部分季 |
| `sort` | integer | 默认等于 `season_number` |

季可以有自己的海报、横幅（`media_images` 中 `owner_type = season`）、自己的演职员（`media_credits.season_id`）和自己的播放源（`media_sources.season_id`）。没填的部分回退到作品级。

### 1.3 集 `media_episodes`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | text PK（ULID） | |
| `season_id` | integer FK，级联删除 | |
| `episode_number` | integer | `(season_id, episode_number)` 唯一 |
| `episode_type` | `standard` / `premiere` / `finale` / `special` | 参照 TMDB 的 `episode_type` |
| `name` | text? | 为空时显示"第 N 集" |
| `overview` | text? | |
| `air_date` | text? | 未到播出日期的集在发布时会被跳过 |
| `runtime` | integer? | 分钟 |
| `publish_state` | `draft` / `published` | 默认 `published` |

后台提供批量操作：按计划集数一次生成第 1 到第 N 集、整体平移集号、批量设置播出日期（比如每周一集）。

### 1.4 合集 `media_collections`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | text PK | |
| `name` / `overview` | text | 如"哈利·波特（系列）" |

### 1.5 分类、题材、首页推荐行

| 表 | 字段 | 说明 |
| --- | --- | --- |
| `media_categories` | `id`、`name`、`kinds`（JSON，允许的作品类型）、`sort`、`filters`（JSON，在该分类下启用哪些筛选项及其顺序） | 浏览的主维度（电影、剧集、动漫、综艺、纪录片），对应原生 API 的 `category`，以及 CMS 的 `type_id` |
| `media_genres` | `id`、`name`、`tmdb_id?` | 预置 TMDB 的电影和剧集题材，允许自己添加 |
| `media_title_genres` | `title_id`、`genre_id`；联合主键 | |
| `media_rows` | `id`、`name`、`kind`（`manual` / `rule`）、`rule?`（JSON，如 `{"category":"…","sort":"updated"}`）、`on_home`、`sort` | 首页推荐行，参照 Netflix；手动片单，或者按规则生成 |
| `media_row_items` | `row_id`、`title_id`、`sort` | 手动行的成员 |
| `media_home` | 键值表：`hero_title_ids` | 首页 hero 主推位 |

### 1.6 人物与演职员

| 表 | 字段 | 说明 |
| --- | --- | --- |
| `media_people` | `id`、`name`、`original_name?`、`gender?`、`biography?`、`birthday?`、`place_of_birth?` | |
| `media_credits` | `id`、`person_id`、`title_id`、`season_id?`、`role`（`cast` / `crew`）、`character?`、`department?`、`job?`、`sort` | `season_id` 为空表示作品级（各季通用）；季级演职员会覆盖作品级 |

### 1.7 图片 `media_images`

| 字段 | 说明 |
| --- | --- |
| `owner_type` / `owner_id` | `title` / `season` / `episode` / `person` / `collection` |
| `kind` | `poster` / `backdrop` / `logo` / `still` / `profile` |
| `url?` / `asset_sha256?` | 二选一，填外链或者上传到 R2（R2 按内容寻址） |
| `locale?`、`width?`、`height?` | |
| `is_primary`、`sort` | 每个 `(owner, kind)` 最多一张主图 |

图片的回退顺序：季的图片 → 作品的图片 → 空。

### 1.8 外部 ID `media_external_ids`

`owner_type`（`title` / `season` / `episode` / `person`）、`owner_id`、`source`（`tmdb` / `imdb` / `tvdb` / `douban`）、`external_id`；`(owner_type, source, external_id)` 唯一。

### 1.9 可播放资源

| 表 | 字段 | 说明 |
| --- | --- | --- |
| `media_sources` | `id`、`title_id?`（电影用）、`season_id?`（剧集用；两者恰好填一个）、`name`（线路名，如"自建""4K"）、`quality?`、`enabled`、`sort` | 剧集的源挂在季上；在 CMS 中对应一组 `vod_play_from` |
| `media_streams` | `id`、`source_id`、`episode_id?`（电影为空）、`url`、`format`（`hls` / `mp4` / `dash`）、`resolution?`、`audio_locale?`、`user_agent?`、`referer?`、`sort` | 原生 API `/playback` 中的一条流；在 CMS 中对应 `vod_play_url` 的一项 |

地址最好以 `.m3u8` 或 `.mp4` 结尾，App 会判定为直链（`parse = 0`），不走网页嗅探。

### 1.10 直播

| 表 | 字段 | M3U 映射 |
| --- | --- | --- |
| `media_live_groups` | `id`、`name`、`sort` | `group-title` |
| `media_live_channels` | `id`、`group_id`、`number?`、`name`、`tvg_id?`、`logo?`、`enabled`、`sort` | `tvg-chno`、`tvg-id`、`tvg-logo` |
| `media_live_streams` | `id`、`channel_id`、`url`、`label?`、`user_agent?`、`referer?`、`sort` | 每条线路一行，同名频道在 App 里合并成多条线路 |
| `media_live_settings` | 键值表：`epg_urls`、`catchup` | 直播条目的 `epg` 字段，以及 M3U 头部的 `x-tvg-url` |

## 二、原生 Media API v1

### 2.1 设计原则

1. **以资源为中心，与源数据模型对齐**：作品、季、集、播放、人物、合集、推荐行都是独立资源，用 ID 互相引用。不再把季硬塞成"一部片"，也不再用 `$$$` / `#` / `$` 把播放列表拼成字符串。
2. **元信息和播放分开取**（参照 Netflix 的 metadata / playback 分离）：
   - 元信息可以长时间缓存（`max-age=60`，带 ETag）；
   - 播放信息单独接口、`no-store`，以后可以改成带签名的短期地址，也可以按设备做限制，不影响元信息的缓存。
3. **卡片和详情分开**：列表只返回统一的卡片结构（`Card`），需要时再取详情，列表响应保持很小。
4. **游标分页**：用 `cursor` 加 `limit` 做 keyset 分页，替代 CMS 的页码。数据中途更新时不会重复或漏掉条目，也不需要 `COUNT(*)`。
5. **有类型前缀的稳定 ID**：`t123`（作品）、`s45`（季）、`e01J…`（集）、`p7`（人物）、`c…`（合集）。ID 永远不会复用，调整季号或集号都不会改变 ID。
6. **TV 友好的图片**：每个资源带一个 `images` 对象，包含海报（竖版）、横幅背景、Logo（透明底标题图）、剧照，并给出宽高，客户端可以按焦点状态和屏幕选图。
7. **向后兼容的演进方式**：v1 内只做增量修改（只加字段、不改语义）；`/v1/manifest` 返回 `schemaVersion`，客户端遇到未知字段直接忽略。
8. **统一的错误格式**：`{"error": {"code": "NOT_FOUND", "message": "…"}}`，配合标准 HTTP 状态码。

### 2.2 端点

所有路径都挂在 `/s/<token>/media/v1` 下。token 的校验方式与订阅一致。

| 端点 | 说明 | 缓存 |
| --- | --- | --- |
| `GET /manifest` | `schemaVersion`、`generation`（发布代号）、分类、题材、国家和语言的字典、首页推荐行的 ID 列表、客户端能力开关 | 60s |
| `GET /home` | 首页：主推位（hero，带横幅背景和 Logo）、若干推荐行（`rows[]`，每行带前 N 张卡片和"查看更多"的游标） | 60s |
| `GET /rows/:id?cursor=` | 某一行的后续卡片 | 60s |
| `GET /browse?category=&genre=&year=&country=&sort=&cursor=&limit=` | 浏览和筛选，返回卡片；`sort` 可选 `updated` / `popular` / `release` / `rating` / `manual` | 60s |
| `GET /facets?category=&genre=…` | 在当前筛选条件下，各筛选项还有哪些可选值，以及对应数量（选完之后不会出现空结果） | 60s |
| `GET /search?q=&type=&cursor=` | 搜索结果**按作品合并**（不再按季拆分），同时返回匹配到的人物 | 60s |
| `GET /titles/:id` | 作品详情：元信息、题材、主创摘要、图片、合集、季列表（摘要）；电影直接带 `playable` 摘要 | 60s |
| `GET /titles/:id/credits` | 完整的演职员表 | 60s |
| `GET /seasons/:id` | 季详情和该季的所有集（集号、类型、名称、简介、剧照、时长、播出日期、`available`） | 60s |
| `GET /people/:id` | 人物信息和参演作品（卡片） | 60s |
| `GET /collections/:id` | 合集，作品按上映时间排序 | 60s |
| `GET /playback/:id` | `:id` 是电影的作品 ID 或者集 ID。返回可用的播放源和流（地址、格式、清晰度、音轨语言、请求头），以及下一集的 ID；预留 `subtitles` / `markers` / `expiresAt` | no-store |
| `GET /live/channels` | 直播分组、频道和线路（频道号、Logo、`tvg_id`），以及 EPG 来源 | 60s |
| `GET /openapi.json` | 由 `packages/media-api` 生成的 OpenAPI 文档 | 1 天 |

### 2.3 主要结构（节选，完整定义以 `packages/media-api` 为准）

```jsonc
// Card：列表、推荐行、搜索结果统一使用
{
  "id": "t123",
  "type": "series",                 // movie | series
  "title": "某剧",
  "year": 2025,
  "images": { "poster": { "url": "…", "w": 600, "h": 900 }, "backdrop": { … } },
  "badge": "更新至第 8 集",           // 服务端算好，客户端直接显示
  "rating": 8.6,
  "genres": ["g18", "g80"]          // 用 manifest 里的字典翻译成名称
}

// GET /titles/t123（剧集）
{
  "id": "t123", "type": "series", "title": "某剧", "originalTitle": "…",
  "overview": "…", "status": "returning", "contentRating": "TV-14",
  "countries": ["CN"], "language": "zh", "genres": ["g18"],
  "images": { "poster": …, "backdrop": …, "logo": … },
  "credits": { "directors": [{ "id": "p7", "name": "…" }], "cast": [{ "id": "p9", "name": "…", "character": "…" }] },
  "collection": null,
  "seasons": [
    { "id": "s45", "number": 1, "name": "第 1 季", "episodeCount": 12, "availableCount": 12, "status": "ended", "images": { … } },
    { "id": "s46", "number": 2, "name": "第 2 季", "episodeCount": 12, "availableCount": 8, "status": "airing",
      "schedule": "每周五 20:00 更新", "nextAirDate": "2026-10-17" }
  ],
  "defaultSeason": "s46"            // 默认打开的季：最新的、有可播集的那一季
}

// GET /playback/e01J…
{
  "id": "e01J…",
  "sources": [
    { "id": "src1", "name": "自建", "quality": "1080p",
      "streams": [{ "url": "https://…/index.m3u8", "format": "hls", "resolution": "1920x1080",
                    "audio": "zh", "headers": { "Referer": "…" } }] }
  ],
  "next": { "id": "e01K…", "seasonId": "s46", "number": 9 },
  "subtitles": [], "markers": null, "expiresAt": null
}
```

### 2.4 CMS 做不到、原生 API 能做到的

| 能力 | CMS v10 | 原生 API |
| --- | --- | --- |
| 季 | 只能拆成多部"片" | 作品下的季列表，可以切换季，有默认季 |
| 单集信息 | 只有集名 | 简介、剧照、时长、播出日期、类型（首播 / 季终 / 特别篇），以及未播出的集 |
| 多线路、多清晰度 | 只有线路名，地址拼成字符串 | 结构化的源和流（清晰度、音轨、请求头） |
| 自动连播 | 客户端自己猜下一集 | 服务端返回 `next`，跨季也能接上 |
| 首页 | 一个列表 | hero 主推位加多个推荐行，参照 Netflix |
| 筛选 | 筛选项固定，可能选出空结果 | 按当前条件动态给出可选值和数量 |
| 搜索 | 每季一条结果 | 按作品合并，同时能搜人物 |
| 图片 | 一张封面 | 海报、横幅背景、Logo、剧照，带尺寸 |
| 人物、合集 | 无 | 有独立页面 |
| 分页 | 页码加总数 | 游标 |
| 缓存 | 整体一起缓存 | 元信息缓存，播放信息不缓存 |

## 三、只读模型（D1，数据库名 `tvbox-media`）

### 3.1 表

```sql
-- 资源文档：原生 API 的响应几乎可以直接从这里取出
CREATE TABLE rm_titles (
  id          INTEGER PRIMARY KEY,   -- 作品 id，对外为 t<id>
  type        TEXT NOT NULL,         -- movie | series
  category_id TEXT NOT NULL,
  year        INTEGER,
  country     TEXT,                  -- 主产地，ISO 3166-1
  language    TEXT,
  rating      REAL,
  popularity  REAL NOT NULL DEFAULT 0,
  release_key TEXT,                  -- 上映 / 首播日期，用于按时间排序
  updated_at  TEXT NOT NULL,         -- 内容最后变更时间（新增集也算）
  manual_sort INTEGER NOT NULL DEFAULT 0,
  card_json   TEXT NOT NULL,
  detail_json TEXT NOT NULL,
  hash        TEXT NOT NULL
);
CREATE INDEX idx_rm_titles_cat_updated ON rm_titles(category_id, updated_at DESC, id DESC);
CREATE INDEX idx_rm_titles_cat_pop     ON rm_titles(category_id, popularity DESC, id DESC);
CREATE INDEX idx_rm_titles_cat_release ON rm_titles(category_id, release_key DESC, id DESC);
CREATE INDEX idx_rm_titles_cat_year    ON rm_titles(category_id, year, updated_at DESC, id DESC);
CREATE INDEX idx_rm_titles_cat_country ON rm_titles(category_id, country, updated_at DESC, id DESC);

CREATE TABLE rm_title_genres (genre_id TEXT, title_id INTEGER, PRIMARY KEY (genre_id, title_id)) WITHOUT ROWID;

CREATE TABLE rm_seasons (            -- 季详情，包含该季的所有集
  id INTEGER PRIMARY KEY, title_id INTEGER NOT NULL, number INTEGER NOT NULL,
  detail_json TEXT NOT NULL, hash TEXT NOT NULL
);
CREATE INDEX idx_rm_seasons_title ON rm_seasons(title_id, number);

CREATE TABLE rm_playback (           -- 每部电影或每一集一行
  id TEXT PRIMARY KEY,               -- t<id> 或 e<ulid>
  season_id INTEGER,                 -- 集所属的季；CMS 兼容层按季批量读取时用
  episode_number INTEGER,
  json TEXT NOT NULL, hash TEXT NOT NULL
);
CREATE INDEX idx_rm_playback_season ON rm_playback(season_id, episode_number);

CREATE TABLE rm_people (id INTEGER PRIMARY KEY, json TEXT NOT NULL, hash TEXT NOT NULL);
CREATE TABLE rm_person_titles (person_id INTEGER, title_id INTEGER, sort INTEGER, PRIMARY KEY (person_id, title_id)) WITHOUT ROWID;
CREATE TABLE rm_collections (id TEXT PRIMARY KEY, json TEXT NOT NULL, hash TEXT NOT NULL);

CREATE TABLE rm_rows (               -- 首页推荐行
  id TEXT PRIMARY KEY, sort INTEGER NOT NULL, json TEXT NOT NULL, hash TEXT NOT NULL
);
CREATE TABLE rm_row_items (row_id TEXT, sort INTEGER, title_id INTEGER, PRIMARY KEY (row_id, sort)) WITHOUT ROWID;  -- 规则行在投影时展开成具体作品

CREATE TABLE rm_live (id TEXT PRIMARY KEY, json TEXT NOT NULL, hash TEXT NOT NULL);  -- 直播只有一份文档

CREATE VIRTUAL TABLE rm_search USING fts5(ref UNINDEXED, text, tokenize = 'trigram');  -- ref 为 t… 或 p…

-- CMS 兼容层专用：每个 CMS 条目一行（电影一条，剧集每季一条）
CREATE TABLE rm_cms_items (
  vod_id      TEXT PRIMARY KEY,      -- m<id> / s<id>
  title_id    INTEGER NOT NULL,
  season_id   INTEGER,
  type_id     TEXT NOT NULL,
  year INTEGER, area TEXT,
  updated_at  TEXT NOT NULL,
  group_order INTEGER NOT NULL
);
CREATE INDEX idx_rm_cms_type_updated ON rm_cms_items(type_id, updated_at DESC, vod_id);

CREATE TABLE rm_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);  -- generation、schemaVersion、projected_at、筛选字典
```

- `card_json` 和 `detail_json` 就是原生 API 的结构，Worker 读出来直接拼进响应，不需要再做转换。
- 浏览用 keyset 分页：游标里编码的是"排序值 + id"，例如 `WHERE category_id = ? AND (updated_at, id) < (?, ?) ORDER BY updated_at DESC, id DESC LIMIT ?`，每次只读 `limit` 行。
- **筛选项计数**（facets）：在发布时预先算好"每个分类下各取值的数量"，存进 `rm_meta`。组合筛选下的计数在请求时用带索引的 `GROUP BY` 计算，限定在该分类内。
- **搜索**：trigram 至少需要 3 个字符。1 到 2 个字的关键词（中文很常见）回退为对卡片标题做 `LIKE`。D1 是否支持 FTS5 的 trigram 分词器，要在第 3 阶段开头先验证；不支持就全部用 `LIKE`。

### 3.2 投影（DO → D1）

- **触发**：后台点"发布"时执行，CI 的同步流程也会调用。并入现有的 `publish()`，配置和媒体库一起发布。
- **增量**：`documents.ts` 从 DO 的数据生成每个资源文档并计算哈希，与 D1 中已有的哈希对比，只对变化的资源做 upsert；不再应该发布的资源做 delete。所有写入放进 `D1.batch()`，数量多时分批写入，`rm_meta.generation` 放在最后一批更新。
- **级联**：某个对象变化时，引用它的文档也要重算。例如人物改名会影响相关作品的 `detail_json`；新增一集会影响该季、作品卡片上的标记、作品详情里的季摘要，以及上一集的 `next`。为了避免漏算，第一版直接对受影响的整部作品重新生成全部文档，然后靠哈希过滤掉没变的部分。
- **全量重建**：后台提供"重建只读模型"按钮，用于修复，以及 D1 schema 变更之后的重建。
- **回滚**：源数据在 DO 里，改回去重新发布即可；D1 自带的 Time Travel（30 天内按时间点恢复）作为灾难恢复手段。

### 3.3 Worker 端的请求链路

1. 校验 token：沿用 `devices.json`（R2，isolate 内缓存 30 秒）。
2. 查缓存：用 Cache API，以去掉 token 后的规范化 URL 加 `generation` 作为键。发布后 `generation` 变化，旧缓存自然失效。`/playback` 不缓存。
3. 查询 D1：通过 D1 Sessions API 走就近的只读副本。每个端点最多 2 到 3 条走索引的 SQL。
4. 返回时带上 `ETag: "<generation>"`；客户端带 `If-None-Match` 时直接返回 304。

**费用**：D1 按读取的行数计费，免费额度每天 500 万行。keyset 分页单次读取几十行，再加上共享缓存，家用规模远远用不完。

## 四、CMS v10 兼容层

路径：`/s/<token>/media/cms`。复用同一个只读模型，功能是原生 API 的子集。

| 请求 | 实现 |
| --- | --- |
| 不带 `ac` | `class` 和 `filters` 取自 `rm_meta`；首页 `list` 取首页第一个推荐行，每部剧展开为其最新的一季 |
| `ac=videolist` / `list` / `detail`，带 `t`、`pg`，可带 `f` | 在 `rm_cms_items` 上用页码分页（CMS 只能用页码），总数取自 `rm_meta` 中预先算好的计数 |
| `ac=detail`，带 `ids=` | 按 `vod_id` 读取 `rm_titles.detail_json`、`rm_seasons.detail_json`，以及该季的 `rm_playback`，拼成 `vod_*` 字段 |
| `wd`、`pg` | 复用原生搜索，再把每部剧展开为它的各个季 |

映射规则：

- 一个 CMS 条目：电影为 `m<作品 id>`；剧集的每个已发布季为 `s<季 id>`。名称为"标题"或"标题 第 N 季"，只有一季的剧不加后缀。
- `vod_play_from`：播放源名称；`vod_play_url`：已播出的集，格式为 `第 N 集 集名$地址`。源之间用 `$$$` 分隔，集之间用 `#`。
- 其余 `vod_*` 字段从文档中取：季级优先，没有再用作品级。
- 外层固定为 `{code: 1, msg, page, pagecount, limit, total, list, class}`，每页 20 条；列表项直接带上 `vod_pic`。

兼容层的 handler 只依赖 D1 只读模型，不依赖原生 API 的 handler；但两者共用同一批"文档 → 字段"的转换函数，保证两边显示的数据一致。

## 五、注入订阅配置

订阅里只放**一条**站点条目，同时满足新旧客户端（参照 `OWN_JAR` 的占位符做法，作为 `tvbox_entries` 中的本地条目）：

```json
{"key": "own_media", "name": "媒体库", "type": 1, "api": "@media/cms",
 "searchable": 1, "quickSearch": 1, "filterable": 1, "mediaApi": "@media/v1"}
```

- 旧客户端（RN 当前版本、其他 TVBox 客户端）只认识 `type: 1` 和 `api`，按 CMS 处理，解析 JSON 时会忽略未知字段（FongMi 系客户端用 Gson，同样忽略）。
- 新版 RN 看到 `mediaApi` 后改用原生 provider；`mediaApi` 不可用时退回 CMS。
- 直播：`{"name": "自有直播", "url": "@media/live.m3u", "mediaApi": "@media/v1"}`，规则相同。

`handleSubscription` 下发配置时，把 `@media/…` 占位符替换成"请求的 origin + 设备 token"拼成的绝对地址。

## 六、管理后台

- **作品列表**：按分类、类型、状态、题材、发布状态筛选，也可以搜索。
- **作品编辑页**，分以下标签页：
  - 基本信息；
  - **季**：季列表卡片，显示海报、状态、已发布 / 计划集数和发布开关；点进去是季详情，可以编辑季信息、季海报、季演职员，以及集列表和批量工具；
  - 演职员；
  - 图片：分别管理海报、横幅背景、Logo、剧照，并提示 TV 端推荐的尺寸；
  - 外部 ID；
  - 播放源：电影挂在作品上，剧集按季切换；批量粘贴 `集名$地址` 后自动对齐到集，对不上的会标红。
- **人物、分类、题材、合集**：各自的列表页和编辑页，支持拖拽排序。
- **首页编排**：选择 hero 主推位的作品，编排推荐行（手动片单，或者"某分类最新""某题材热门"这类规则行），并预览首页效果。
- **直播**：分组、频道、线路；支持导入 M3U（一次性复制进数据表，不是订阅）和导出 M3U；设置 EPG 地址。
- **发布**：显示本次投影将新增、更新、删除多少个文档，以及上次投影的时间和 `generation`；提供"重建只读模型"按钮。
- **预览**：按设备视角分别调用原生 API 和 CMS 兼容层，对照查看结果。
- 界面文案放在 `apps/web/src/locales/{zh,en}`。

## 七、部署与基础设施

- `wrangler.toml` 增加 `[[d1_databases]]`（`binding = "MEDIA"`，`database_name = "tvbox-media"`，`migrations_dir = "d1/media"`）。`database_id` 不是密钥，D1 库创建好之后写进配置文件即可。
- `worker.yml` 部署前增加两步：确保库存在（参照现在创建 R2 bucket 的做法），然后执行 `wrangler d1 migrations apply tvbox-media --remote`。需要确认现有的 `CLOUDFLARE_API_TOKEN` 有 D1 编辑权限，没有的话要由你补上。
- **D1 schema 变更的顺序**：先执行 migration，再部署新代码；只做增量修改（加列、加表）。有破坏性的变更走"新表 + 全量重建 + 切换"的方式。
- `check:api-docs` 增加一项：校验 `packages/media-api` 生成的 OpenAPI 文档和仓库中提交的版本一致，防止契约被悄悄改掉。
- 本地开发：`wrangler dev` 自带本地 D1；Bun 单元测试里，D1 的 schema 用 libsql 建库来测（两者都是 SQLite）。
- 开启 D1 read replication，降低海外各地访问的延迟。

## 八、备份与审计

DO 中的媒体相关表纳入 `backup`，格式同 `tvbox.backup.ts`。D1 不需要备份，它可以随时从 DO 全量重建。增、删、改、导入、发布操作都写审计日志。

## 分阶段实施

每个阶段结束时，`bun run check` 和 `bun run test:workers` 都必须通过。

1. **源数据：作品、季、集**：migration；实现 catalog、taxonomy、artwork、external-ids 的 service 和 routes；写测试。
   → 验证：增删改查和约束测试（季号唯一、只能给剧集建季、级联删除、季的发布状态）；`check:api-docs` 通过。
2. **人物、可播放资源和首页编排**：实现 people、credits、sources、streams、首页推荐行；批量粘贴并对齐到集。
   → 验证：对齐算法的单元测试（集数不一致、包含特别篇、重复集名等情况）；回退规则的测试（季级没有就取作品级）。
3. **契约、只读模型和原生 API**：
   - `packages/media-api`（zod schema 和 OpenAPI）；
   - D1 migration；
   - `documents.ts` 和 projector（增量、级联、全量）；
   - `workers/media/app.ts` 和 `v1/*`，包括缓存、ETag、Sessions；
   - CI 增加 D1 相关步骤。

   → 验证：
   - 先确认 D1 是否支持 FTS5 trigram；
   - 文档生成的单元测试，用快照比对；
   - 增量投影测试：改一集只更新该季、作品卡片和相邻集的 `next`；
   - keyset 分页测试：翻页过程中插入新数据，不会重复也不会漏；
   - 每个端点的响应都通过 zod schema 校验；
   - workerd 冒烟测试：用本地 D1 走一遍发布，再依次请求 manifest、home、browse、facets、search、titles、seasons、playback。
4. **CMS 兼容层和订阅注入**：实现 `workers/media/cms/*`，以及 `@media/cms` / `@media/v1` 占位符的注入。
   → 验证：用 RN 端的 `CmsProvider` 解析器反向验证兼容层的输出；与原生 API 对照，确认同一部剧显示的数据一致；在模拟器上用 RN App 当前版本走 CMS 浏览一部多季剧，切换季并播放测试流。
5. **直播**：建表、增删改查、M3U 导入导出、`/v1/live/channels`、发布时生成 R2 中的 `live.m3u`、直播占位符注入、后台页面。
   → 验证：M3U 往返转换测试；冒烟测试请求两个端点；在模拟器上检查频道列表、切换线路，以及外部 XMLTV 的节目单显示。
6. **可选：在 R2 上托管媒体文件**：视频文件通过 `/s/<token>/media/f/…` 提供，支持 Range 请求；超过 100 MB 的文件用 R2 分片上传。
   → 验证：在模拟器上播放托管的 mp4，并能正常拖动进度。

后续单独立计划：RN 端实现原生 provider（读取 `mediaApi`），包括季切换、详情页、首页推荐行、跨季自动连播和人物页。

## 待确认问题

1. 原生 API 的形态：用本文的 REST 资源加游标分页（推荐）；还是改成单个"聚合查询"端点（类似 GraphQL，客户端自己挑字段）？REST 更容易做 CDN 缓存，也更好调试。
2. 原生 API 和 CMS 兼容层同时上线，订阅里只放一条兼容两者的站点条目（推荐）；还是先只做原生 API？
3. 源数据放 DO，D1 只放已发布的只读模型？建议是。
4. 媒体库并入现有的"发布"按钮？建议是。
5. 第一版只存播放地址，R2 托管以后再做？建议是。
6. 要不要在第 3 阶段之后加 TMDB 刮削？需要你申请一个 TMDB API key。
7. 现有 `CLOUDFLARE_API_TOKEN` 是否有 D1 编辑权限？需要你在 Cloudflare 后台确认一下。
