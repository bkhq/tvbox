# tvbox

私有的电视影音播放器，配套一个 Cloudflare Worker 负责订阅下发、设备关联和 App 更新。

主产品是 `client/` 中的 React Native App（Android TV、Android 手机、iOS、tvOS），开发、构建和发布细节见 [client/README.md](client/README.md)。原来的 Java App 及其依赖模块已移到 `backup/`，不再构建和发布，仅作行为参考。

最初基于 [FongMi/TV](https://github.com/FongMi/TV) 5.6.1（GPL-3.0）改造，保留 TVBox 配置格式与 CatVod 爬虫体系（JAR、JavaScript、CMS 采集站）。不保留上游的提交历史。

## 功能

| 功能 | 说明 |
| --- | --- |
| 点播 / 直播 | 兼容 TVBox 配置格式；CMS 采集站、JavaScript 爬虫，Android 上另支持 JAR 爬虫；M3U / TXT 直播源 |
| 播放 | ExoPlayer 与 mpv，可切换；网页嗅探、线路自动切换 |
| 手机控制 | 电视在局域网提供控制网页：切换配置、遥控播放、修改设置；需配对，见 [docs/REMOTE.md](docs/REMOTE.md) |
| AirPlay 接收 | 仅 Android TV，见 [docs/AIRPLAY.md](docs/AIRPLAY.md) |
| DLNA | 仅 Android TV，电视可作为 DLNA 接收端 |
| 服务器关联 | 设备显示随机编码，管理员在 worker 后台批准后自动获取配置，见 [docs/SERVER-LINK.md](docs/SERVER-LINK.md) |
| 自动更新 | 从 worker 检查新版本 |

## 使用

1. 从 [Releases](https://github.com/bkhq/tvbox/releases) 下载对应的 APK：`arm64_v8a` 适用于大多数设备，老旧 32 位盒子用 `armeabi_v7a`。最低 Android 7.0。
2. 配置来源，任选一种：
   - **服务器关联**：设置 → 服务器关联 → 申请关联，记下屏幕上的设备编码，在 worker 后台批准后自动加载。
   - **手机控制**：电视首页 → 手机控制，用手机扫码，输入配对码，在「配置」页签添加地址。
   - **手动**：首页或设置里直接填写配置地址。
3. 之后的新版本 App 会自动提示更新。

## 目录结构

```text
client/     React Native App（主产品），见 client/README.md
worker/     Cloudflare Worker：订阅、设备、App 更新、管理后台，见 worker/README.md
spider/     自有爬虫 JAR（tvbox.jar）
docs/       配置、爬虫、直播、本地接口等文档
backup/     旧版 Java App 及其模块（app、media、airplay、catvod、quickjs），不再构建
```

## 编译与测试

```bash
cd client
npm ci
npm run lint && npm run typecheck && npm test
npm run android:debug:docker   # 在 Docker 中构建 Android debug APK
```

iOS / tvOS 和 release 构建见 [client/README.md](client/README.md)。

## 发布

发布即推送 `vX.Y.Z` 标签（`.github/workflows/client-release.yml`）：

- GitHub Release 包含 `leanback-arm64_v8a.apk`、`leanback-armeabi_v7a.apk`，以及已签名的 iOS / tvOS ipa；标签说明即更新说明。
- Android APK 与旧版 Java App 包名、签名相同，登记在原有的更新通道（`/u/stable/leanback-<abi>.json`）；iOS / tvOS 走 rn 通道（`/u/rn/`）。
- 上传和登记需要仓库变量 `WORKER_URL` 和密钥 `CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`、`SERVICE_TOKEN_RELEASE`，以及下文的签名密钥；详见 [client/README.md](client/README.md) 的 Release 一节。

推送 `main` 只构建，不发布。

```bash
git tag -a v1.2.3 -m "更新说明" && git push origin v1.2.3
```

Android 签名密钥保存在仓库密钥 `ANDROID_KEYSTORE_BASE64`、`ANDROID_KEY_ALIAS`、`ANDROID_KEYSTORE_PASSWORD` 中，不在仓库里；更换密钥会导致已安装的 App 无法覆盖升级。

worker 的开发、部署和上游管理见 [worker/README.md](worker/README.md)。

## 文档

| 文件 | 内容 |
| --- | --- |
| [docs/CONFIG.md](docs/CONFIG.md) | 配置格式（站点、解析、直播、规则等） |
| [docs/SPIDER.md](docs/SPIDER.md) | 编写 JAR / JavaScript 爬虫 |
| [docs/LIVE.md](docs/LIVE.md) | 直播源格式 |
| [docs/LOCAL.md](docs/LOCAL.md) | 本地 HTTP 服务：爬虫代理、播放状态、文件管理 |
| [docs/REMOTE.md](docs/REMOTE.md) | 手机控制网页、配对和 `/api` 接口 |
| [docs/AIRPLAY.md](docs/AIRPLAY.md) | AirPlay 接收 |
| [docs/SERVER-LINK.md](docs/SERVER-LINK.md) | 服务器关联与设备绑定 |

## 许可证

GPL-3.0，见 [LICENSE.md](LICENSE.md)。`backup/airplay/` 为 MIT（见 `backup/airplay/LICENSE`），`backup/media/` 为 Apache-2.0。
