# 配置格式

本文说明 `client/` 能读取的点播配置和直播配置。格式沿用 TVBox，但只实现了下文列出的部分；未列出或标为「不支持」的字段会被忽略。

实现位置：`client/src/core/config/`（加载、解码）、`client/src/core/types.ts`（字段规范化）。

## 加载

配置地址下载后按以下顺序处理：

1. **JSON**：内容是 JSON 对象时直接使用。
2. **图片内嵌**：内容中出现 `xxxxxxxx**`（8 位字母数字加 `**`）时，取其后的部分按 base64 解码。
3. **AES 加密**（以 `2423` 开头）：**不支持**，加载时报错。
4. **相对路径**：文本中的 `./`、`../` 按配置地址（跟随重定向后的地址）展开，`.js?` 引用的查询参数不受影响。

顶层带 `msg` 字段的 JSON 视为服务端返回的错误信息，直接显示。

### 多仓

顶层带 `urls` 数组时视为多仓配置：

```json
{ "urls": [ { "name": "仓库一", "url": "https://example.com/a.json" }, { "name": "仓库二", "url": "https://example.com/b.json" } ] }
```

目前只加载**第一个**仓库，界面上还不能切换到其他仓库。

### 远程数组

`headers`、`proxy`、`rules`、`doh` 可以写成 URL 字符串，或在数组里混入 URL 字符串；每个 URL 指向一个 JSON 数组，加载时展开合并。下载失败的 URL 忽略。

## 点播配置

### 顶层字段

| 字段 | 类型 | 状态 | 说明 |
| --- | --- | --- | --- |
| `spider` | string | 生效（仅 Android） | 默认 JAR 地址，`type: 3` 的 `csp_` 站点未写 `jar` 时使用 |
| `sites` | array | 生效 | 点播站点，见下文；`key` 重复时保留第一个 |
| `parses` | array | 生效 | 解析接口；`name` 重复时保留第一个。存在解析时自动在最前面加一个「超级解析」 |
| `flags` | string[] | 生效 | 需要走 VIP 解析的线路名（`playUrl` 为空且线路名在此列表中时使用当前解析） |
| `lives` | array | 生效 | 直播源，格式同直播配置的 `lives` |
| `rules` | array | 生效 | 网页嗅探规则，见下文 |
| `doh` | array | 部分 | 出现在设置的 DoH 选项里，但目前不会用于实际请求 |
| `ads`、`hosts`、`headers`、`proxy` | — | 解析但未使用 | 读取后不起作用 |
| `wallpaper`、`logo`、`notice` | string | 不支持 | |
| `danmaku`、`assrt` | string | 不支持 | 弹幕、在线字幕暂未实现 |

### sites

```json
{ "key": "ff", "name": "非凡", "type": 1, "api": "https://example.com/api.php/provide/vod/", "searchable": 1, "quickSearch": 1 }
```

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `key` | | 唯一标识 |
| `name` | | 显示名称 |
| `type` | `0` | `0` CMS XML、`1` CMS JSON、`3` 爬虫；`4` 及其他类型不支持 |
| `api` | | `type` 0/1 为采集接口地址；`type: 3` 为 `.js` 地址（JS 爬虫）或 `csp_类名`（JAR 爬虫，仅 Android）；`.py` 不支持 |
| `ext` | | 传给爬虫 `init` 的参数；JSON 对象会先解析成对象 |
| `jar` | 顶层 `spider` | JAR 地址，仅 Android |
| `searchable` | `1` | `0` 时不参与搜索 |
| `quickSearch` | `1` | `0` 时不参与快速搜索 |
| `changeable` | `1` | `0` 时播放失败不自动切换到其他站点 |
| `timeout` | `15` | 请求超时，秒 |
| `categories` | | 只显示并按此顺序排列这些分类名 |
| `header` | | 访问该站点及播放时附加的请求头 |
| `click` | | 网页嗅探时在页面里执行的点击脚本 |
| `hide`、`indexs`、`playUrl`、`style` | | 解析但未使用 |

App 不支持的站点仍会出现在站点列表里，但标为不可用。

### parses

```json
{ "name": "解析一", "type": 1, "url": "https://example.com/?url=", "ext": { "flag": ["qq", "iqiyi"], "header": { "User-Agent": "okhttp" } } }
```

| `type` | 处理方式 |
| --- | --- |
| `0` | 网页解析：在隐藏的 WebView 中打开 `url + 页面地址` 并嗅探视频地址 |
| `1` | JSON 解析：GET `url + 页面地址`，取返回中的 `url`（或 `data.url`），长度超过 40 个字符才算成功；返回中的 `User-Agent` / `Referer` / `Cookie` 作为播放请求头 |
| `2`、`3` | 扩展 / 聚合解析：Android 上交给 JAR；否则依次尝试所有 `type: 1` 解析 |
| `4` | 超级解析（自动添加）：同时请求所有匹配线路的 `type: 1` 解析，取最先成功的 |

`ext.flag` 限定解析适用的线路名；`ext.header` 为请求解析接口时使用的请求头。爬虫返回的 `playUrl` 可以写成 `json:<解析地址>` 或 `parse:<解析名称>` 来指定解析。

### rules

用于网页嗅探（`type: 0` 解析和需要嗅探的播放地址）：

```json
{ "name": "示例", "hosts": ["example.com"], "regex": ["\\.m3u8"], "script": [], "exclude": [] }
```

| 字段 | 说明 |
| --- | --- |
| `hosts` | 规则适用的页面域名 |
| `regex` | 命中即视为视频地址的请求 URL 正则 |
| `script` | 页面加载后执行的脚本 |
| `exclude` | 排除的请求 URL 正则 |

## 直播配置

直播配置可以是独立的地址，也可以写在点播配置的 `lives` 里。内容不是 JSON 对象时，整个地址被当作一个频道列表（M3U / TXT），名称取地址的文件名。

顶层字段：`lives`（生效）；`rules`、`ads`、`hosts`、`headers`、`proxy` 解析但未使用。支持多仓 `urls`（只加载第一个）。

### lives

```json
{ "name": "直播", "url": "https://example.com/live.m3u", "epg": "https://epg.example.com/?ch={name}&date={date}", "ua": "okhttp" }
```

| 字段 | 说明 |
| --- | --- |
| `name` | 显示名称；重复时保留第一个 |
| `url` | 频道列表地址，格式见 [LIVE.md](LIVE.md) |
| `groups` | 直接内嵌的频道分组（JSON 格式，见 LIVE.md），替代 `url` |
| `api` | 直播爬虫：**不支持**，加载时报错 |
| `epg` | 节目单地址；含 `{` 的为按频道查询的模板，否则为 XMLTV 文件，多个用逗号分隔 |
| `logo` | 台标模板，频道没有 `http` 台标时使用 |
| `timeZone` | 节目单时区 |
| `ua`、`origin`、`referer`、`header` | 播放请求头，频道未单独指定时继承 |
| `click` | 嗅探点击脚本，频道未单独指定时继承 |
| `catchup` | 默认回看设置，见 LIVE.md |
| `timeout` | 超时，秒 |
| `pass` | `true` 时忽略分组密码 |
| `ext`、`boot`、`keep` | 解析但未使用（开机直播由设置项控制） |
