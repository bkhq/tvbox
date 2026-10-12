# 直播源格式

直播源（配置里 `lives[].url` 指向的内容，或直接填写的直播地址）支持 JSON、M3U、TXT 三种格式，按此顺序识别。

实现位置：`client/src/player/live/`（`parser.ts` 解析、`epg.ts` 节目单、`load.ts` 加载）。

## TXT

```text
央视,#genre#
CCTV-1,http://example.com/cctv1.m3u8
CCTV-1,http://backup.example.com/cctv1.m3u8#http://another.example.com/cctv1.m3u8
CCTV-2,http://example.com/cctv2.m3u8|User-Agent=okhttp&Referer=http://example.com/

卫视_1234,#genre#
湖南卫视,http://example.com/hunan.m3u8
```

- `分组名,#genre#` 开始一个分组；第一个分组之前的频道归入默认分组。
- `频道名,地址`：同名频道合并为多条线路；一行里可以用 `#` 分隔多个地址。
- 地址后的 `|k=v&k=v` 为该地址的请求头。
- 分组名写成 `名称_密码` 时，该分组需要输入密码才显示（直播源设置了 `pass: true` 时忽略）。

## M3U

```text
#EXTM3U x-tvg-url="https://epg.example.com/epg.xml"
#EXTINF:-1 tvg-id="cctv1" tvg-name="CCTV1" tvg-logo="https://example.com/cctv1.png" tvg-chno="1" group-title="央视",CCTV-1
#EXTVLCOPT:http-user-agent=okhttp
http://example.com/cctv1.m3u8
```

文件中出现 `#EXTM3U`（且不含 `#genre#`）即按 M3U 解析。

| 位置 | 支持的属性 |
| --- | --- |
| `#EXTM3U` | `tvg-url` / `url-tvg`（节目单地址，直播源未设置 `epg` 时使用） |
| `#EXTINF` | `group-title`、`tvg-id`、`tvg-name`、`tvg-logo`、`tvg-chno`、`http-user-agent`，逗号后为频道名 |
| 地址行 | 包含 `://` 的非注释行；`地址|k=v&k=v` 同 TXT |

同一分组内同名频道合并为多条线路。

## JSON

内容为 JSON 数组时，按分组列表读取：

```json
[
  {
    "name": "央视",
    "channel": [
      { "name": "CCTV-1", "urls": ["http://example.com/cctv1.m3u8"], "number": "1", "logo": "https://example.com/cctv1.png", "epg": "cctv1", "ua": "okhttp" }
    ]
  }
]
```

也可以把同样的数组直接写在配置的 `lives[].groups` 里。频道字段：`name`、`urls`、`number`、`logo`、`epg`、`tvgId`、`tvgName`、`ua`、`origin`、`referer`、`header`、`format`。

## 播放参数行

TXT 和 M3U 中，以下行设置**下一个**地址的播放参数（在 TXT 中遇到新分组时清空）：

| 行 | 作用 |
| --- | --- |
| `ua=…`、`#EXTVLCOPT:http-user-agent=…` | User-Agent |
| `referer=…`、`#EXTVLCOPT:http-referrer=…` | Referer |
| `origin=…`、`#EXTVLCOPT:http-origin=…` | Origin |
| `#EXTVLCOPT:http-cookie=…` | Cookie |
| `header={"k":"v"}`、`#EXTHTTP:{"k":"v"}` | 请求头（JSON） |
| `#KODIPROP:inputstream.adaptive.stream_headers=k=v&k=v`、`…common_headers=…` | 请求头 |
| `format=hls\|dash\|mpd`、`#KODIPROP:inputstream.adaptive.manifest_type=…` | 指定流格式 |

`parse=`、`click=` 能识别但目前不起作用。DRM（`drmScheme`、`drmLicense`、`#KODIPROP:inputstream.adaptive.license_*`）**不支持**，相关行会被忽略。

直播源本身的 `ua`、`origin`、`referer`、`header` 作为所有频道的默认值；频道没有编号时按顺序自动编号。

## 节目单

直播源的 `epg`（未设置时取 M3U 头部的 `tvg-url`）可以写多个地址，用逗号分隔：

- **XMLTV**：不含 `{`、且地址中含 `xml` 或 `gz` 的作为 XMLTV 文件下载（支持 gzip），按 `tvg-id`、`tvg-name`、频道名匹配频道。
- **按频道查询**：含 `{` 的地址作为模板，例如 `https://epg.example.com/?ch={name}&date={date}`。`{id}` 替换为频道的 tvg-id，`{name}` 替换为 tvg-name，`{date}` 替换为 `yyyy-MM-dd`。频道自己的 `epg` 以 `http` 开头时直接使用。返回 JSON（`{"date":"2026-10-12","epg_data":[{"start":"08:00","end":"09:00","title":"…"}]}`）或 XMLTV。
- `timeZone` 指定节目时间所在时区，默认为设备时区。

## 其他

- **收藏**：直播界面可以收藏频道，收藏的频道显示在最前面的收藏分组里。
- **回看 / 时移**：`catchup` 相关字段（`catchup`、`catchup-source`、`catchup-replace` 及华为 `/PLTV/` 地址）会被解析，但界面上还没有回看功能。
- **直播爬虫**（`lives[].api`）：不支持。
