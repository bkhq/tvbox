# 服务器关联

设备可以关联到 worker（`worker/`），由 worker 下发配置。关联是可选的、需要手动操作；只有构建时带了 worker 地址（`-PworkerUrl`，CI 从 `WORKER_URL` 读取）的版本才有这个功能。

## 设备端

**设置 → 服务器关联** 显示设备编码和当前状态（未关联 / 等待批准 / 已关联）。

- **申请关联**：带上设备编码发送申请，之后每 15 秒检查一次。
- 在 worker 管理后台批准该编码后，设备收到自己的订阅地址并自动加载为配置。之后在后台发布的修改，设备下次加载配置时生效。
- **刷新**：已关联或等待批准时可用，立即向 worker 重新查询。订阅地址变了（比如后台更换了令牌）就换成新地址；没变就重新加载配置，取到上游的最新修改。
- 关联的订阅加载失败时（比如令牌已更换、旧地址返回 404），App 会自动查询一次新地址，每分钟最多一次，不用重启。
- **取消关联**：停止同步并生成新的设备编码，旧的批准记录不能再用。已加载的配置会保留。

设备编码（`XXXX-XXXX`）随机生成，只显示在设备屏幕上。别人只拿到 APK 无法获取配置：管理员只会批准自己在电视上看到的编码。

## worker 接口

```
POST {worker}/api/raw/tvbox/enroll        （无需登录，需限流）
Content-Type: application/json

{
  "action": "request" | "unlink",
  "code": "K7Q2-9XMB",
  "deviceId": "02:AB:CD:EF:01:23",
  "name": "影视",
  "model": "Xiaomi MiBOX4",
  "mode": "leanback",
  "abi": "arm64_v8a",
  "versionCode": 10100,
  "versionName": "1.1.0"
}
```

| 响应 | 含义 | 设备行为 |
| --- | --- | --- |
| `{"status":"pending"}` | 已登记，编码尚未批准 | 继续轮询 |
| `{"status":"approved","subscription":"https://…/s/<令牌>/api.json","deviceKey":"…"}` | 已批准 | 加载订阅地址；`deviceKey` 可选，见下文「设备绑定」 |
| `{"status":"rejected"}` | 已拒绝或已吊销 | 关闭关联 |

后台列出待批准的申请（编码、名称、型号、IP、时间）。批准时生成该设备的订阅令牌和上游选择；设备端发起 `unlink` 或在后台吊销都会结束关联。

`deviceId` 与 AirPlay 共用同一个随机持久 ID（`app/src/main/java/com/fongmi/android/tv/utils/DeviceId.java`）；设备端代码在 `Enroll.java` 和 `ui/dialog/EnrollDialog.java`。

> 状态：两端均已实现。worker 在站点根路径应答该接口，内部再转给后台 API，设备端不会接触到后台路径；申请在后台「设备」页审批，可新建设备或关联到已有设备。
