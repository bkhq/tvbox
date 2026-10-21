# 手机控制

App 会启动一个本地 HTTP 服务（从 9978 开始取第一个可用端口）。在电视上打开 **首页 → 手机控制**，会显示访问地址的二维码和一个 6 位配对码。用同一网络下任意手机或电脑的浏览器打开这个地址即可，不需要安装 App。

电视还会在局域网用 mDNS 宣告主机名 `tvbox.local`，iPhone、iPad、Mac 的浏览器可以直接打开 `http://tvbox.local:9978`（端口以电视上显示的为准）。Android 手机的浏览器大多不解析 `.local`，请扫码或输入 IP。同一网络里有多台设备时，名称可能被自动加上后缀。

实现位置：`client/src/lan/`（`api/` 下每个接口一个文件；`catalogAdapter.ts` 把站点搜索、详情、历史和收藏接给网页；`settingRegistry.ts` 描述全部设置项；`pairing.ts` 保存配对设备）和 `client/assets/web/`（网页，修改后运行 `npm run gen:lan-web`）。

## 页面

打开后默认停在「遥控」。地址后可加 `?tab=remote|search|library|more` 直接打开某个页签。

| 页签 | 功能 |
| --- | --- |
| 遥控 | 顶部是正在播放的标题和进度，可拖动进度条跳转；上一集 / 播放暂停 / 下一集、前后 15 秒、倍速、停止，没有播放时收成一行。下方是方向键、确定、返回、菜单，音量加减和静音，以及把文字发送到电视当前输入框。在其他页签上，播放中会在底部显示迷你播放条。 |
| 搜索 | 输入片名后由电视的各个站点搜索，结果按站点分组显示在手机上，可按站点筛选；空白时显示电视上的搜索历史和热门搜索。点一条结果打开详情面板：海报、简介、线路和剧集，点剧集就在电视上播放，有观看记录时提供「继续播放」。粘贴 `http(s)://` 链接则变成推送播放；「在电视上搜索」仍会打开电视的搜索页。 |
| 媒体库 | 继续观看：当前配置的观看记录，带集数和进度，点击在电视上续播。收藏：当前配置的收藏，点击打开详情面板。 |
| 更多 | 已保存的点播、直播配置：点击切换，长按删除，输入地址添加新配置，电视会立即加载；切换首页站点、解析、直播源。电视设置页的选项，按通用、播放器、倍速、解码、预载、直播分组，只显示当前适用的项；服务器关联（设备编码，申请关联、刷新、取消关联）；已配对设备列表，点击删除；文件管理（浏览 App 文档目录、上传、新建文件夹、长按删除，把文件用作点播配置）；缓存大小和版本。壁纸配置、「清除缓存」「立即备份」不支持。 |

设置修改后在下一次播放时生效，与在电视上修改一致。

## 配对

浏览器第一次打开页面时，会要求输入电视「手机控制」页面上显示的配对码。配对码正确时返回一个随机令牌，浏览器保存后在之后的每个请求中携带（`X-Token` 请求头，或 `token` 参数）。每次配对成功、每次打开「手机控制」页面，配对码都会更换。

已配对的设备（名称、IP、配对时间、最近访问时间）保存在电视上，在「设置」页签中列出，可以删除；删除后该设备需要重新配对。

没有有效令牌的请求访问 `/api/*`（`/api/pair` 除外）、`/file`、`/upload`、`/newFolder`、`/delFolder`、`/delFile` 时返回 `401`。来自本机（`127.0.0.1`）的请求始终允许，爬虫和播放器不受影响。

## 接口

所有接口支持 GET 或 POST，参数可放在表单或查询字符串中。JSON 响应为 `application/json`；其他接口返回 `OK`，出错时返回错误信息和 `400` / `403` / `404` / `500` 状态码。

| 接口 | 参数 | 返回 |
| --- | --- | --- |
| `/api/pair` | `code`、`name` | `{token, name}`；配对码错误返回 `403` |
| `/api/unpair` | `target`（要删除设备的令牌） | `OK` |
| `/api/state` | `only=player`（可选，只返回播放状态，供轮询） | 版本、地址、本机令牌、已配对设备、已保存的点播 / 直播配置及当前项、`settings`（设置项分组：`key`、`label`、`type` = `bool` / `enum` / `number` / `text`、`value`，以及 `options` 或 `min` / `max` / `step`）、`sources`（站点、直播源、解析及当前项）、`cache`、服务器关联（`available`、`state`、`code`）、播放状态（`active`、`playing`、`title`、`position`、`duration`、`speed`） |
| `/api/config` | `do` = `use` \| `delete`，`type`（0 点播、1 直播），`url`，`name` | `OK`；拒绝删除正在使用的配置；`type=2`（壁纸）返回 `400` |
| `/api/setting` | `key`、`value` | `OK`；`key` 为 `/api/state` 中 `settings` 里的任一项，`enum` 传选项序号，`bool` 传 `true` / `false`，`number` 须在 `min`–`max` 内；取值无效时返回 `400` |
| `/api/source` | `do` = `site` \| `live` \| `parse`（`value` 为站点 key、直播源名称、解析名称） | `OK`；找不到时返回 `404`。`do` = `cache` \| `backup` 返回 `400`（不支持） |
| `/api/control` | `do` = `play` \| `pause` \| `toggle` \| `stop` \| `prev` \| `next` \| `repeat` \| `replay` \| `seek` \| `seekto` \| `speed`，`value`（`seek` 为毫秒偏移，`seekto` 为毫秒位置，`speed` 为 0.1–5 倍速） | `OK`；没有在播放或 `value` 无效时返回 `400` |
| `/api/enroll` | `do` = `request` \| `refresh` \| `unlink` | `OK`；与电视「服务器关联」的操作相同，状态见 `/api/state` 的 `enroll` |
| `/api/remote` | `do` = `key`（`value` = `up` / `down` / `left` / `right` / `ok` / `back` / `menu`）\| `text`（`value` 为文字）\| `volume`（`value` = `up` / `down` / `mute`） | `OK`；按键和文字只作用于本 App 在前台的界面，App 不在前台或没有聚焦的输入框时返回 `400` |
| `/api/push` | `url` | 播放该地址 |
| `/api/search` | `word`、`quick`（可选） | 在当前配置的可搜索站点上开始搜索（会取消上一次搜索），返回 `{id, keyword, quick, groups, completed, total, done}`；`groups` 按站点分组（`site` 和 `list`，每项 `id`、`name`、`pic`、`remarks`、`year`、`type`） |
| `/api/search` | `id` | 返回该次搜索的最新进度，网页每 0.5 秒轮询直到 `done`；不是当前搜索时返回 `404`，一分钟无人轮询会被取消 |
| `/api/search` | `do=open`、`word` | 在电视上打开搜索页 |
| `/api/search` | （无参数） | `{history, hot}`：电视上的搜索历史和热门搜索 |
| `/api/detail` | `site`、`id` | 详情：`site`、`vod`（含 `area`、`director`、`actor`、`content`）、`flags`（线路及其 `episodes`，每集 `name`、`url`）、`resume`（有观看记录时：`flag`、`episodeUrl`、`position`、`duration`）；站点不存在或影片不存在返回 `404`，站点不支持返回 `400` |
| `/api/play` | `site`、`id`、`flag`、`url`、`position`（毫秒，可选） | 在电视上播放该集；不传 `flag` 和 `url` 时按观看记录续播，没有记录则播第一条线路的第一集，没有剧集返回 `404` |
| `/api/library` | （无参数） | `{history, keeps}`：当前配置的观看记录（含 `flag`、`episodeUrl`、`position`、`duration`）和收藏，每项带 `siteKey`、`siteName`、`id`、`name`、`pic`、`time`；没有加载配置时都是空数组 |
| `/api/file` | `path` | 把文档目录中的文件用作点播配置；APK 和字幕文件返回 `400`（不支持） |

其他本地路径（`/proxy`、`/media`、文件管理）见 [LOCAL.md](LOCAL.md)。
