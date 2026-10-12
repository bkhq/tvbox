# 爬虫

站点 `type: 3` 由爬虫提供数据。`client/` 支持两种爬虫：

| `api` | 引擎 | 平台 |
| --- | --- | --- |
| `xxx.js`（地址） | JavaScript，运行在 QuickJS 中，每个站点一个独立上下文 | 全部平台 |
| `csp_类名` | JAR（`com.github.catvod.spider.类名`），从站点的 `jar` 或配置顶层的 `spider` 加载 | 仅 Android |

Python 爬虫（`.py`）和 `type: 4` 站点不支持。仓库里自己的 JAR 源码在 `spider/`，构建产物为 `tvbox.jar`。

实现位置：`client/src/spider/`（JS 爬虫）、`client/src/spider/jar/` 和 `client/modules/jarspider/`（JAR 爬虫）、`client/modules/quickjs/`（QuickJS 原生模块）。

## JavaScript 爬虫

### 模块格式

爬虫是一个 ES 模块，兼容 FongMi 的两种写法：

```js
// 写法一：default 导出对象（或返回对象的函数）
export default {
  async init(ext) {},
  async home(filter) { return JSON.stringify({ class: [] }) },
  async homeVod() { return JSON.stringify({ list: [] }) },
  async category(tid, pg, filter, extend) { return JSON.stringify({ list: [], page: 1, pagecount: 1 }) },
  async detail(id) { return JSON.stringify({ list: [] }) },
  async search(wd, quick, pg) { return JSON.stringify({ list: [] }) },
  async play(flag, id, flags) { return JSON.stringify({ parse: 0, url: id }) },
  async proxy(params) { return [200, 'text/plain', 'ok'] },
  async destroy() {},
}
```

```js
// 写法二：CatVod 风格，导出 __jsEvalReturn
export function __jsEvalReturn() {
  return { init, home, homeVod, category, detail, search, play, proxy, destroy }
}
```

用写法二时，`init` 收到的是 `{ stype: 3, skey: 站点 key, ext }`，并且全局的 `req` 改为异步的 `http`。

方法可以是同步或异步，返回 JSON 字符串或对象。`ext` 为站点配置的 `ext`；它是 JSON 对象时会先解析成对象。

| 方法 | 调用时机 |
| --- | --- |
| `init(ext)` | 第一次使用站点时 |
| `home(filter)` | 首页分类和筛选条件 |
| `homeVod()` | 首页推荐 |
| `category(tid, pg, filter, extend)` | 分类列表；`extend` 为选中的筛选条件 `{key: value}` |
| `detail(id)` | 详情，只传一个 id |
| `search(wd, quick, pg)` | 搜索；第一页不传 `pg` |
| `play(flag, id, flags)` | 播放地址；`flags` 为配置的 `flags` |
| `proxy(params)` | 本地代理请求，见下文 |
| `destroy()` | 配置切换或站点卸载时 |

### 运行环境

模块可以 `import` 相对路径（相对于爬虫地址）、HTTP 地址，以及内置库 `cat.js`、`cheerio.min.js`、`crypto-js.js`、`gbk.js`、`similarity.js`（写成 `lib/cat.js` 或 `assets://js/lib/cat.js`）。全局可用：

| 名称 | 说明 |
| --- | --- |
| `req(url, options)` | 同步 HTTP 请求，返回 `{ code, headers, content }`。`options`：`method`、`headers`、`data` + `postType`（`json` / `form` / `form-data`）、`body`、`timeout`（毫秒）、`redirect`（`0` 不跟随重定向）、`buffer`（`0` 文本，`1` 有符号字节数组，`2` base64，`3` `Uint8Array`） |
| `http(url, options)` | 同上，返回 Promise |
| `local.get/set/delete(rule, key[, value])` | 持久化键值存储 |
| `joinUrl(base, ref)` | 解析相对地址 |
| `getProxy(local)`、`getPort()` | 本地代理地址（`http://<ip>:<端口>/proxy?do=js`）和端口 |
| `md5X(text)`、`aesX(mode, encrypt, input, inBase64, key, iv, outBase64)` | 摘要和 AES；源码中用到时自动加载 CryptoJS |
| `pd`、`pdfh`、`pdfa`、`pdfl` | HTML 解析（基于 cheerio）；源码中用到时自动加载 |
| `console`、`setTimeout`、`clearTimeout` | |

## JAR 爬虫（Android）

JAR 由原生模块用 `DexClassLoader` 加载，调用 CatVod `Spider` 的 `init`、`homeContent`、`homeVideoContent`、`categoryContent`、`detailContent`、`searchContent`、`playerContent`、`proxy`、`destroy`。`liveContent`、`action`、`manualVideoCheck` / `isVideoFormat` 不会被调用。

解析接口 `type: 2` / `3`（`jsonExt`、`jsonExtMix`）也由 JAR 处理。

## 返回数据

### Result

| 字段 | 用于 | 说明 |
| --- | --- | --- |
| `class` | `home` | 分类数组：`type_id`、`type_name`（也接受 `id`、`name`） |
| `filters` | `home` | 筛选条件：`{type_id: [{key, name, init, value: [{n, v}]}]}` |
| `list` | 列表、详情、搜索 | 影片数组，见下文 |
| `page`、`pagecount`、`limit`、`total` | 分类、搜索 | 分页 |
| `parse` | `play` | `1` 表示 `url` 是网页，需要嗅探或解析 |
| `jx` | `play` | `1` 表示需要走 VIP 解析 |
| `url` | `play` | 播放地址；也可以是 `[名称, 地址, 名称, 地址…]` 形式的多个地址 |
| `playUrl` | `play` | 解析前缀；`json:<地址>` 指定 JSON 解析，`parse:<名称>` 指定配置中的解析 |
| `header` | `play` | 播放请求头 |
| `format` | `play` | 流格式（MIME） |
| `subs` | `play` | 外挂字幕：`url`、`name`、`lang`、`format` |
| `click` | `play` | 嗅探时执行的点击脚本 |
| `flag` | `play` | 线路名 |
| `position` | `play` | 起播位置（毫秒） |
| `msg` | 任意 | 错误信息，显示给用户 |

`danmaku`、`drm` 等字段不支持，会被忽略。

### 影片

`vod_id`、`vod_name`、`vod_pic`、`vod_remarks`、`type_name`、`vod_year`、`vod_area`、`vod_director`、`vod_actor`、`vod_content`、`vod_play_from`、`vod_play_url`。

### 播放列表

`vod_play_from` 为线路名，用 `$$$` 分隔；`vod_play_url` 与之一一对应，每条线路内用 `#` 分隔剧集，剧集写成 `名称$地址`（省略名称时按序号命名）：

```json
{
  "vod_play_from": "线路一$$$线路二",
  "vod_play_url": "第1集$https://a/1.m3u8#第2集$https://a/2.m3u8$$$第1集$https://b/1.m3u8"
}
```

## 本地代理

爬虫可以把播放地址或图片地址指向本地服务的 `/proxy`，请求会转给爬虫的 `proxy` 方法：

| 请求 | 交给 |
| --- | --- |
| `/proxy?siteKey=<key>&…` | 该站点的 JS 爬虫 |
| `/proxy?do=js&…` | 最近使用的 JS 爬虫（`getProxy()` 返回的就是这种地址） |
| 其他 `/proxy?…` | JAR 爬虫（Android；原生层直接处理，不经过 JS） |

`proxy` 收到的参数合并了查询字符串、表单和请求头（请求头名小写），返回 `[状态码, Content-Type, 内容]` 或 `[状态码, Content-Type, 内容, 响应头]`。本地服务的端口见 [REMOTE.md](REMOTE.md)。
