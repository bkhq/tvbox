# AirPlay 接收

**仅 Android TV。** App 运行期间（配置加载完成后）会作为 AirPlay 接收器出现在局域网中，iPhone、iPad、Mac 的「屏幕镜像」和视频 App 的 AirPlay 菜单里都能看到它。手机、iOS、tvOS 版本没有此功能。

## 支持的功能

- **屏幕镜像**：H.264 视频经 FairPlay 解密后，用 MediaCodec 直接解码到全屏画面（`MirrorActivity`）。开始镜像时自动打开，发送端停止时自动关闭；横竖屏切换或分辨率变化时会重建解码器。
- **镜像声音**：AAC-ELD（以及 AAC-LC）用 MediaCodec 解码，经 AudioTrack 播放；发送端的音量调节会同步过来。
- **视频投放（HLS）**：YouTube、Safari 等 App 投来的播放列表交给 App 的播放器播放。暂停、继续、拖动进度和播放位置会与发送端同步（每秒回报一次）。

## 限制

- 「音乐」App 的纯音频隔空播放使用 ALAC 编码，无法解码，会没有声音。
- 带 DRM 的视频（Netflix、Disney+、Apple TV+ 等）任何第三方接收端都无法播放。
- Android 10 及以上，App 在后台时镜像画面可能弹不出来（系统限制后台启动界面）。
- 未实现 PIN / HomeKit 配对，发送端无需密码即可连接。
- 发送端和电视必须在同一网络；路由器开启 AP 隔离或屏蔽组播时会搜不到。

## 设置

接收器默认开启，名称默认为 `tvbox`。可以在电视的「设置 → AirPlay」里开关或改名，也可以在手机控制网页的「设置」页签中修改；改完立即重启接收器。接收器使用一个随机生成并持久保存的设备 ID（形如 MAC 地址）标识自己，这个 ID 也用于[服务器关联](SERVER-LINK.md)。

## 代码

- `client/modules/airplay/`：原生模块。协议（配对、FairPlay、RTSP 建流）和基于 Netty 的服务端、mDNS 宣告来自 [serezhka/java-airplay](https://github.com/serezhka/java-airplay)（MIT），以及 `VideoSink`、`AudioSink`、`MirrorActivity`。
- `client/src/lan/cast/airplay.ts`：按设置启动 / 停止接收器，把 HLS 投放交给播放器。
