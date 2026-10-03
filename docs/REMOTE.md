# 手机控制

App 会启动一个本地 HTTP 服务（从 9978 开始取第一个可用端口）。在电视上打开 **首页 → 手机控制**，会显示访问地址的二维码和一个 6 位配对码。用同一网络下任意手机或电脑的浏览器打开这个地址即可，不需要安装 App。

电视还会在局域网用 mDNS 宣告主机名 `tvbox.local`，iPhone、iPad、Mac 的浏览器可以直接打开 `http://tvbox.local:9978`（端口以电视上显示的为准），不用记 IP。Android 手机的浏览器大多不解析 `.local`，请继续扫码或输入 IP。同一网络里有多台电视时，后启动的会自动改名为 `tvbox-2.local` 之类。

## 页面

| 页签 | 功能 |
| --- | --- |
| 配置 | 已保存的点播、直播、壁纸配置：点击切换，长按删除，输入地址添加新配置，电视会立即加载；首页站点、解析、直播源的切换。 |
| 播放 | 当前播放的标题和进度；上一集 / 播放暂停 / 下一集、±15 秒和 ±60 秒、倍速、停止；推送地址播放；搜索。 |
| 设置 | 电视设置页的全部选项，按通用、播放器、倍速、解码、预加载、弹幕、直播分组，只显示当前适用的项（例如切到 mpv 后才出现 mpv 选项）；清除缓存、立即备份；服务器关联（设备编码，申请关联、刷新、取消关联）；已配对设备列表及删除。 |
| 文件 | 浏览设备存储、上传、新建文件夹、删除；把文件用作配置。 |

设置修改后在下一次播放时生效，与在电视上修改一致。

## 配对

浏览器第一次打开页面时，会要求输入电视「手机控制」页面上显示的配对码。配对码正确时返回一个随机令牌，浏览器保存后在之后的每个请求中携带（`X-Token` 请求头，或 `token` 参数）。每次配对成功、每次打开「手机控制」页面，配对码都会更换。

已配对的设备（名称、IP、配对时间、最近访问时间）保存在电视上，在「设置」页签中列出，可以删除；删除后该设备需要重新配对。

没有有效令牌的请求访问 `/api/*`（`/api/pair` 除外）、`/action`、`/file`、`/upload`、`/newFolder`、`/delFolder`、`/delFile` 时返回 `401`。来自本机（`127.0.0.1`）的请求始终允许，爬虫、解析和播放器不受影响。

## 接口

所有接口支持 GET 或 POST，参数可放在表单或查询字符串中。JSON 响应为 `application/json`；其他接口返回 `OK`，出错时返回错误信息和 `400` / `403` / `404` / `500` 状态码。

| 接口 | 参数 | 返回 |
| --- | --- | --- |
| `/api/pair` | `code`、`name` | `{token, name}`；配对码错误返回 `403` |
| `/api/unpair` | `target`（要删除设备的令牌） | `OK` |
| `/api/state` | `only=player`（可选，只返回播放状态，供轮询） | 版本、地址、本机令牌、已配对设备、各类已保存配置及当前项、`settings`（设置项分组：`key`、`label`、`type` = `bool` / `enum` / `number` / `text`、`value`，以及 `options` 或 `min` / `max` / `step`）、`sources`（站点、直播源、解析及当前项）、`cache`（缓存大小）、服务器关联（`available`、`state`、`code`）、播放状态（`active`、`playing`、`title`、`position`、`duration`、`speed`） |
| `/api/config` | `do` = `use` \| `delete`，`type`（0 点播、1 直播、2 壁纸），`url`，`name` | `OK`；拒绝删除正在使用的配置 |
| `/api/setting` | `key`、`value` | `OK`；`key` 为 `/api/state` 中 `settings` 里的任一项，`enum` 传选项序号，`bool` 传 `true` / `false` |
| `/api/source` | `do` = `site` \| `live` \| `parse`（`value` 为站点 key、直播源名称、解析名称），或 `do` = `cache`（清除缓存）\| `backup`（立即备份） | `OK`；找不到时返回 `404` |
| `/api/control` | `do` = `play` \| `pause` \| `toggle` \| `stop` \| `prev` \| `next` \| `seek` \| `speed`，`value`（`seek` 为毫秒偏移，`speed` 为倍速） | `OK`；没有在播放时返回 `400` |
| `/api/enroll` | `do` = `request` \| `refresh` \| `unlink` | `OK`；与电视「服务器关联」弹窗的操作相同，状态见 `/api/state` 的 `enroll` |
| `/api/push` | `url` | 播放该地址 |
| `/api/search` | `word` | 打开搜索 |
| `/api/file` | `path`（`file:/…`） | 打开 APK、加载字幕，或把文件用作点播配置 |

旧的 `/action` 接口保留给爬虫使用，见 [LOCAL.md](LOCAL.md)。

代码位置：`app/src/main/java/com/fongmi/android/tv/server/`（`api/` 下每个接口一个类；`SettingRegistry.java` 集中描述全部设置项，新增设置只需在这里加一行；`Pairing.java` 保存配对设备）和 `app/src/main/assets/`（网页）。
