# Phone control

The app runs a local HTTP server (first free port from 9978). On the TV,
**Home → Phone Control** shows its address as a QR code together with a
six-digit pairing code. Open the address in any phone or computer browser on
the same network — no app needed.

## Page

| Tab | What it does |
| --- | --- |
| Config | Saved VOD, live and wallpaper configs: tap to switch, long-press to delete, add a new one by URL. The TV loads it immediately. |
| Playback | Title and progress of what is playing; previous / play-pause / next, ±15 s and ±60 s, speed, stop; push a URL to play; search. |
| Settings | Player engine, render, scale, background playback, buffer, default speed, incognito, ad block, AirPlay on/off and name, User-Agent; list and removal of paired devices. |
| Files | Browse, upload, create folders and delete in device storage; use a file as a config. |

Setting changes take effect on the next playback, as they do on the TV.

## Pairing

The first time a browser opens the page it asks for the pairing code shown on
the TV's Phone Control screen. A correct code returns a random token that the
browser stores and sends with every request (`X-Token` header, or `token`
parameter). The code changes after each successful pairing and every time the
Phone Control screen is opened.

Paired devices (name, IP, paired time, last seen) are stored on the TV and
listed on the Settings tab, where they can be removed; a removed device has to
pair again.

Requests without a valid token get `401` on `/api/*` (except `/api/pair`),
`/action`, `/file`, `/upload`, `/newFolder`, `/delFolder` and `/delFile`.
Requests from the device itself (`127.0.0.1`) are always allowed, so spiders,
the parser and the player keep working.

## API

All endpoints accept GET or POST with form or query parameters. JSON
responses use `application/json`; others return `OK` or an error message with
status `400` / `403` / `404` / `500`.

| Endpoint | Parameters | Result |
| --- | --- | --- |
| `/api/pair` | `code`, `name` | `{token, name}`, or `403` on a wrong code |
| `/api/unpair` | `target` (token of the device to remove) | `OK` |
| `/api/state` | — | Version, address, own token, paired devices, saved configs per type with the current one, settings with option labels, and player state (`active`, `playing`, `title`, `position`, `duration`, `speed`) |
| `/api/config` | `do` = `use` \| `delete`, `type` (0 VOD, 1 live, 2 wallpaper), `url`, `name` | `OK`; deleting the config in use is refused |
| `/api/setting` | `key`, `value` | `OK`; keys: `engine`, `render`, `scale`, `background`, `buffer`, `speed`, `ua`, `incognito`, `adblock`, `airplay`, `airplay_name` |
| `/api/control` | `do` = `play` \| `pause` \| `toggle` \| `stop` \| `prev` \| `next` \| `seek` \| `speed`, `value` (ms offset for `seek`, rate for `speed`) | `OK`, or `400` when nothing is playing |
| `/api/push` | `url` | Plays the URL |
| `/api/search` | `word` | Opens search |
| `/api/file` | `path` (`file:/…`) | Opens an APK, loads a subtitle, or uses the file as the VOD config |

The legacy `/action` endpoint stays for spiders; see [LOCAL.md](LOCAL.md).

Code: `app/src/main/java/com/fongmi/android/tv/server/` (`api/` holds one class
per endpoint, `Pairing.java` the pairing store) and `app/src/main/assets/`
(the page).
