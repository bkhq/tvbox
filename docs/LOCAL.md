# 本地 HTTP 服务

App 启动后在局域网提供一个 HTTP 服务：从 9978 开始取第一个可用端口（最多到 9998），并通过 mDNS 宣告为 `tvbox.local`。手机控制网页和它的 `/api/*` 接口见 [REMOTE.md](REMOTE.md)；本文列出其余路径。

实现位置：`client/src/lan/`（路由在 `server.ts`）、`client/modules/httpd/`（原生 HTTP 服务）。

## 路径

| 路径 | 需要配对 | 说明 |
| --- | --- | --- |
| `/proxy` | 否 | 爬虫本地代理，见 [SPIDER.md](SPIDER.md#本地代理) |
| `/media` | 否 | 当前播放状态 |
| `/file/<路径>` | 是 | 浏览或下载文件 |
| `/upload` | 是 | 上传文件 |
| `/newFolder` | 是 | 新建文件夹 |
| `/delFolder`、`/delFile` | 是 | 删除 |
| 其他 | 否 | 手机控制网页 |

「需要配对」的路径必须带配对得到的令牌（`X-Token` 请求头或 `token` 参数），否则返回 `401`；来自本机（`127.0.0.1`）的请求不受限制。

### /media

```json
{ "state": 3, "speed": 1, "duration": 2700000, "position": 61000, "url": "https://…", "title": "…", "artist": "", "artwork": "https://…" }
```

`state`：`3` 播放中、`2` 暂停或就绪、`1` 空闲。没有播放器时返回 `{}`。时间单位为毫秒。

### 文件

文件操作限制在 App 自己的文档目录内（不能访问设备的公共存储），路径中的 `..` 会被拒绝。

| 请求 | 参数 | 返回 |
| --- | --- | --- |
| `GET /file/<路径>` | | 文件内容；目录返回 `{"parent": "…", "files": [{"name", "path", "time", "dir"}]}` |
| `POST /upload` | `path`（目标目录），multipart 文件 | `OK` |
| `/newFolder` | `path`、`name` | `OK` |
| `/delFolder`、`/delFile` | `path` | `OK` |

## 不再提供的接口

旧版 Java App 的 `/action`（`do=control`、`push`、`search`、`setting` 等）、`/cache`、`/parse` 已移除。播放控制、推送、搜索、加载配置请改用 [REMOTE.md](REMOTE.md) 中的 `/api/control`、`/api/push`、`/api/search`、`/api/config`；爬虫需要持久化数据时使用 JS 运行环境的 `local`。
