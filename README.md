# tvbox

私有的 Android 电视影音播放器，配套一个 Cloudflare Worker 负责订阅下发、设备关联和 App 更新。

基于 [FongMi/TV](https://github.com/FongMi/TV) 5.6.1（GPL-3.0）改造，保留 CatVod 爬虫体系（JAR、JavaScript、远程 HTTP 站点）、Media3/ExoPlayer 与 mpv 双播放引擎、直播和 DLNA 接收。不保留上游的提交历史。

## 功能

| 功能 | 说明 |
| --- | --- |
| 点播 / 直播 | 兼容 TVBox 配置格式；JAR、JavaScript 爬虫和 CMS 采集站；M3U / TXT 直播源 |
| 播放 | ExoPlayer（硬解 + FFmpeg 软解）与 mpv，可切换；字幕、弹幕、倍速、YouTube 解析 |
| 手机控制 | 电视在局域网提供控制网页：切换配置、遥控播放、修改设置、管理文件；需配对，见 [docs/REMOTE.md](docs/REMOTE.md) |
| AirPlay 接收 | iPhone / iPad / Mac 屏幕镜像，以及 YouTube、Safari 等 App 的视频投放，见 [docs/AIRPLAY.md](docs/AIRPLAY.md) |
| 服务器关联 | 设备显示随机编码，管理员在 worker 后台批准后自动获取配置，见 [docs/SERVER-LINK.md](docs/SERVER-LINK.md) |
| 自动更新 | 从 worker 检查新版本 |
| DLNA | 电视可作为 DLNA 接收端 |

与上游相比，**删除了**：迅雷 / TVBus / ForceTech / 剑片 P2P 解析及其闭源 AAR、Python 爬虫、上游自动更新、TVBus 签名伪装、设备间同步、扫码、手机端投屏、Android Auto、手机版界面（手机通过控制网页操作电视）；并修复了多处后台线程异常导致的闪退。

## 使用

1. 从 [Releases](https://github.com/bkhq/tvbox/releases) 下载对应的 APK：`arm64_v8a` 适用于大多数设备，老旧 32 位盒子用 `armeabi_v7a`。最低 Android 7.0。
2. 配置来源，任选一种：
   - **服务器关联**：设置 → 服务器关联 → 申请关联，记下屏幕上的设备编码，在 worker 后台批准后自动加载。
   - **手机控制**：电视首页 → 手机控制，用手机扫码（或在 iPhone / Mac 上打开 `http://tvbox.local:9978`），输入配对码，在「配置」页签添加地址。
   - **手动**：设置里直接填写配置地址。
3. 之后的新版本 App 会自动提示更新。

## 目录结构

```text
app/        App 本体（只有电视版，src/main）
catvod/     爬虫接口、网络层和与爬虫共用的工具类
quickjs/    JavaScript 爬虫运行时
airplay/    AirPlay 协议与服务端，来自 serezhka/java-airplay（MIT）
media/      Media3 fork 源码（FongMi/media，仅保留 App 用到的 20 个模块），用于构建 app/libs 的 AAR
keystore/   CI 与本地构建共用的签名密钥
worker/     Cloudflare Worker：订阅、设备、App 更新、管理后台，见 worker/README.md
docs/       配置、爬虫、直播、本地接口等文档
```

## 编译

需要 JDK 21，以及带 platform 36/37、NDK 29.0.14206865、CMake 3.22.1 的 Android SDK。

1. 在仓库根目录创建 `local.properties`：

   ```properties
   sdk.dir=/path/to/android-sdk
   storeFile=../keystore/release.jks
   keyAlias=tvbox
   storePassword=<见 keystore/release.properties>
   ```

2. 第一次编译前，先从 `media/` 构建 Media3 AAR（输出到 `app/libs/`，不提交到仓库）：

   ```bash
   cd media && echo "sdk.dir=/path/to/android-sdk" > local.properties && ./build-aars.sh && cd ..
   ```

3. 编译 App，APK 输出到 `Release/apk/`：

   ```bash
   bash ./gradlew :app:assembleRelease
   ```

4. 单元测试（Robolectric，CI 每次构建都会跑）：

   ```bash
   bash ./gradlew :app:testArm64_v8aDebugUnitTest
   ```

可选的构建参数：

| 参数 | 作用 |
| --- | --- |
| `-PversionCode=… -PversionName=…` | 版本号；CI 从 `vX.Y.Z` 标签推算（`X*10000 + Y*100 + Z`） |
| `-PupdateUrl=<worker>/u` | 启用 App 内检查更新 |
| `-PworkerUrl=<worker>` | 启用服务器关联和设备绑定 |

`media/` 中的 FFmpeg、mpv、libplacebo、MPEG-H 原生库是上游预编译的二进制，来源和校验值记录在 `media/libraries/decoder_ffmpeg/src/main/resources/META-INF/androidx.media3.decoder.ffmpeg/native-dependencies.properties`。

## 发布

- 推送 `main`：`.github/workflows/android.yml` 自动构建 APK，产物在 Actions 中。
- 推送 `vX.Y.Z` 标签：额外发布 GitHub Release；标签说明即更新说明。配置了仓库变量 `WORKER_URL` 和密钥 `CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`、`SERVICE_TOKEN_RELEASE` 时，还会把 APK 上传到 worker 并登记版本，已安装的 App 随即可以收到更新。

```bash
git tag -a v1.2.3 -m "更新说明" && git push origin v1.2.3
```

Media3 AAR 在 CI 中从 `media/` 构建，并按 `media/` 的内容缓存，只有修改 fork 时才重新构建。

签名密钥在 `keystore/` 中：能读取本仓库的人都能用它签名；更换密钥会导致已安装的 App 无法覆盖升级。

worker 的开发、部署和上游管理见 [worker/README.md](worker/README.md)。

## 文档

| 文件 | 内容 |
| --- | --- |
| [docs/CONFIG.md](docs/CONFIG.md) | 配置格式（站点、解析、直播、规则等） |
| [docs/SPIDER.md](docs/SPIDER.md) | 编写 JAR / JavaScript 爬虫 |
| [docs/LIVE.md](docs/LIVE.md) | 直播源格式 |
| [docs/LOCAL.md](docs/LOCAL.md) | 爬虫和工具使用的本地 HTTP 接口 |
| [docs/REMOTE.md](docs/REMOTE.md) | 手机控制网页、配对和 `/api` 接口 |
| [docs/AIRPLAY.md](docs/AIRPLAY.md) | AirPlay 接收 |
| [docs/SERVER-LINK.md](docs/SERVER-LINK.md) | 服务器关联与设备绑定 |

## 许可证

GPL-3.0，见 [LICENSE.md](LICENSE.md)。`airplay/` 为 MIT（见 `airplay/LICENSE`），`media/` 为 Apache-2.0。
