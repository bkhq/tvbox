# Server link

A device can be linked to the worker (`worker/`) so that the worker delivers
its configuration. Linking is optional and manual; it is only available in
builds that carry a worker URL (`-PworkerUrl`, set by CI from `WORKER_URL`).

## On the device

**Settings → Server link** shows the device code and the link state
(not linked / waiting for approval / linked).

- **Request link** sends a request with the device code and keeps checking
  every 15 seconds.
- Once the code is approved in the worker's admin console, the device receives
  its subscription URL and loads it as the config. Later edits published in the
  console reach the device the next time it loads the config.
- **Unlink** stops syncing and generates a new device code, so an old approval
  cannot be reused. The loaded config is kept.

The device code (`XXXX-XXXX`) is random and only visible on the device, so a
copy of the APK alone cannot get a configuration: the admin only approves codes
read off their own screens.

## Worker API

```
POST {worker}/api/raw/tvbox/enroll        (no login; rate limited)
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

| Response | Meaning | Device |
| --- | --- | --- |
| `{"status":"pending"}` | Request recorded, code not approved yet | keeps polling |
| `{"status":"approved","subscription":"https://…/s/<token>/api.json"}` | Approved | loads the subscription |
| `{"status":"rejected"}` | Rejected or revoked | turns the link off |

The console lists pending requests (code, name, model, IP, time). Approving a
request creates the device's subscription token and its upstream selection;
`unlink` from the device or revoking in the console ends the link.

`deviceId` is the random persistent id also used by AirPlay
(`app/src/main/java/com/fongmi/android/tv/utils/DeviceId.java`); the app side
is `Enroll.java` and `ui/dialog/EnrollDialog.java`.

> Status: the app side is implemented. The worker endpoint and the approval
> view are not implemented yet.
