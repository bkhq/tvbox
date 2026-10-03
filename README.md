# tvbox

私有的 Android 电视 / 手机影音播放器。基于 [FongMi/TV](https://github.com/FongMi/TV) 5.6.1（GPL-3.0）改造，保留 CatVod 爬虫体系（JAR、JavaScript、远程 HTTP 站点）、Media3/ExoPlayer 与 mpv 播放、直播和 DLNA。不保留上游的提交历史。

## 与上游的区别

- **已删除**：迅雷 / TVBus / ForceTech / 剑片 P2P 解析及其闭源 AAR、Python 爬虫（Chaquopy）、上游自动更新、TVBus 签名伪装、设备间同步、扫码、手机投屏。
- **防闪退**：后台线程的异常不再导致整个 App 崩溃；WebView 线程上的爬虫错误、被系统拒绝的后台服务启动都已兜底。
- **手机控制**：电视在局域网内提供控制网页，可管理配置、控制播放、修改设置和管理文件，需配对后使用，见 [docs/REMOTE.md](docs/REMOTE.md)。
- **AirPlay 接收**：支持 iPhone / iPad / Mac 屏幕镜像和视频投放，见 [docs/AIRPLAY.md](docs/AIRPLAY.md)。
- **自有更新服务与可选的服务器关联**：App 从 `worker/` 中的 worker 检查更新；设备可以关联到 worker，由 worker 下发配置，见 [docs/SERVER-LINK.md](docs/SERVER-LINK.md)。

## 目录结构

```text
app/        App 本体；src/main 为共用代码，src/leanback（电视）和 src/mobile（手机）为各自界面
catvod/     爬虫接口、网络和与爬虫共用的工具类
quickjs/    JavaScript 爬虫运行时
airplay/    AirPlay 协议与服务端，来自 serezhka/java-airplay（MIT）
media/      Media3 fork 源码（FongMi/media），用于构建 app/libs 中的 AAR
keystore/   CI 与本地构建共用的签名密钥
worker/     Cloudflare Worker：订阅、App 更新、管理后台（见 worker/README.md）
docs/       配置、直播、爬虫、本地接口等参考文档
```

## 编译

需要 JDK 21 和带 platform 36/37 的 Android SDK。在仓库根目录创建 `local.properties`：

```properties
sdk.dir=/path/to/android-sdk
storeFile=../keystore/release.jks
keyAlias=tvbox
storePassword=<见 keystore/release.properties>
```

```bash
bash ./gradlew :app:assembleRelease        # 全部版本，输出到 Release/apk/
```

APK 按设备（`leanback` 电视、`mobile` 手机）和 ABI（`arm64_v8a`、`armeabi_v7a`）分包；最低 Android 7.0，targetSdk 37。

可选的构建参数：

| 参数 | 作用 |
| --- | --- |
| `-PversionCode=… -PversionName=…` | 版本号；CI 从 `vX.Y.Z` 标签推算（`X*10000 + Y*100 + Z`） |
| `-PupdateUrl=<worker>/u` | 启用 App 内检查更新 |
| `-PworkerUrl=<worker>` | 启用可选的服务器关联 |

`app/libs` 中的媒体 AAR 已预先编好并提交。如需从 `media/` 重新构建（需要 NDK 29.0.14206865 和 CMake 3.22.1）：

```bash
cd media && echo "sdk.dir=/path/to/android-sdk" > local.properties && ./build-aars.sh
```

`media/` 里的 FFmpeg、mpv、libplacebo、MPEG-H 原生库是上游预编译的二进制，来源记录在 `media/libraries/decoder_ffmpeg/src/main/resources/META-INF/androidx.media3.decoder.ffmpeg/native-dependencies.properties`。

## 发布

`.github/workflows/android.yml` 在每次推送 `main` 时构建。推送 `vX.Y.Z` 标签时还会发布带 4 个 APK 的 GitHub Release；如果配置了仓库变量 `WORKER_URL` 和密钥 `CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`、`SERVICE_TOKEN_RELEASE`，还会把 APK 上传到 worker 并登记版本，供 App 内更新使用。

签名密钥放在 `keystore/`。能读取本仓库的人都能用它签名；更换密钥会导致已安装的 App 无法覆盖升级。

## 文档

| 文件 | 内容 |
| --- | --- |
| [docs/CONFIG.md](docs/CONFIG.md) | 配置格式（站点、解析、直播、规则等） |
| [docs/SPIDER.md](docs/SPIDER.md) | 编写 JAR / JavaScript 爬虫 |
| [docs/LIVE.md](docs/LIVE.md) | 直播源格式 |
| [docs/LOCAL.md](docs/LOCAL.md) | 爬虫和工具使用的本地 HTTP 接口 |
| [docs/REMOTE.md](docs/REMOTE.md) | 手机控制网页、配对和 `/api` |
| [docs/AIRPLAY.md](docs/AIRPLAY.md) | AirPlay 接收 |
| [docs/SERVER-LINK.md](docs/SERVER-LINK.md) | 设备关联 worker |

## 许可证

GPL-3.0，见 [LICENSE.md](LICENSE.md)。`airplay/` 为 MIT（见 `airplay/LICENSE`），`media/` 为 Apache-2.0。
