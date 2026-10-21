# 20261017-0111-redesign-phone-control-web Redesign the phone control web page

- **status**: completed
- **createdAt**: 2026-10-17 01:11
- **approvedAt**: 2026-10-21 01:56
- **relatedTask**: 20261017-0110-redesign-phone-control-web

## Context

**Page today** (`assets/web/index.html`, `css/ui.css`, `js/script.js`, `js/jquery.min.js`; bundled into `src/lan/web/assets.generated.ts` by `npm run gen:lan-web`, served by `src/lan/web/index.ts`):

- Four tabs: 配置 (default, `?tab=1` encoded in the TV's QR code at `src/screens/control/index.tsx` `TAB = 1`), 播放, 设置, 文件.
- 播放 mixes five things in one scroll: now playing + transport, D-pad/volume/text, push URL, search. Search only calls `/api/search`, which opens the Search screen on the TV (`src/lan/api/action.ts` `searchApi` -> `LanNavigator.search` -> `container.navigate('Search', { keyword })` in `src/lan/navigation.ts`). Nothing comes back to the phone.
- 配置 is the landing page although it is a setup task, not an everyday one.
- jQuery 3 + global `onclick` handlers; strings built by hand with `escHtml`/`escPath`.

**Server today** (`src/lan/server.ts`): `/api/*` endpoints keyed by name, all behind pairing (`src/lan/pairing.ts`); ports in `src/lan/ports.ts` (`player`, `remote`, `navigator`, `sources`, `env`) are wired in `src/lan/runtime.ts`. Tests build the server on `MemoryStore` with fake ports (`src/lan/__fixtures__/fakes.ts`); `web.test.ts` checks the generated assets are in sync and lists `js/jquery.min.js` explicitly.

**App pieces the new page needs**:

- Site search: `getProvider(site).search(keyword, quick)` (`src/core/provider`) fanned out by `searchSites(targets, search, onUpdate)` in `src/screens/search/searchSites.ts` (5 concurrent, 30 s per site, batched updates, cancel handle). `searchTargets(sites, quick)` picks searchable supported sites from `getBootstrap().getSnapshot().config.sites`.
- Detail: `getProvider(site).detail([vodId])` -> `Result.list[0]`; lines/episodes via `parseFlags(vod)` (`src/core/types.ts`). The Detail screen plays with `navigation.navigate('Player', buildPlayerParams(siteKey, vodId, flag, episode, position))` (`src/screens/detail/detailState.ts`); the Player route accepts `{ siteKey, vodId, flag, episodeUrl, position }` (`src/navigation/types.ts`).
- History/favourites: `getHistoryRepository().list(cid)` and `getKeepRepository()` (`src/core/userData.ts`, `src/core/storage/history.ts`, `keep.ts`), keyed by the active config id `getBootstrap().getSnapshot().entry?.id` (`useActiveCid`). `History` carries `vodName`, `vodPic`, `vodFlag`, `vodRemarks` (episode name), `episodeUrl`, `position`, `duration`, `createTime`; key is `siteKey@@@vodId` (`splitHistoryKey`).
- Search words: hot words in setting `hot`, search history in `src/screens/search/history.ts`.
- Playback state for the now-playing card: `playerJson` in `src/lan/api/state.ts` (`/api/state?only=player`), polled every 2 s by the page.

**Reference products** (for the information architecture): Apple TV Remote (touch pad + transport, now-playing scrubber appears only while playing), Google TV app (D-pad, keyboard entry, now-playing strip), Plex / Jellyfin / Emby remotes (now-playing card with poster, browse library on the phone, "play on TV"), Kore/Yatse for Kodi (remote default, library and search as peers, settings tucked away).

## Proposal

### 1. Information architecture (web page)

Bottom navigation, left to right, Remote is the default and the QR code opens it:

| Tab | Contents |
| --- | --- |
| 遥控 (Remote) | Now-playing card: title, progress scrubber, position/duration, play/pause, prev/next, -15 s/+15 s, speed chip. Collapses to a one-line "未在播放" strip when idle. Below: D-pad with OK, 返回/菜单, 音量 -/静音/+, and a text field that sends to the focused TV input. |
| 搜索 (Search) | One input: a keyword searches; an `http(s)://` link offers 推送播放. Empty state shows the TV's search history and hot words as chips. Results stream in grouped by site (filter chips 全部 / per site, as on the TV), poster + name + year/remarks rows. "在电视上搜索" keeps today's behaviour. Tapping a result opens a bottom sheet: poster, name, tags, line picker, episode grid; tapping an episode plays it on the TV; "继续播放" resumes the saved episode. |
| 媒体库 (Library) | 继续观看: history of the active config, newest first, poster, name, episode, progress bar, tap resumes on the TV. 收藏: favourites of the active config, tap opens the detail sheet. |
| 更多 (More) | Sections as today, in this order: 配置 (点播/直播 lists, add, 首页站点/直播源/解析 pickers; 壁纸 removed since the API rejects it), 设置 (grouped), 服务器关联, 已配对设备, 文件 (opens the browser as a sub-page), version line. |

Implementation: rewrite `index.html`, `css/ui.css`, `js/script.js` as vanilla ES2017 (fetch, template literals through one `h()` escaping helper, event delegation), delete `js/jquery.min.js`. Keep the Material 3 colour tokens and the existing dialog/snackbar/loading patterns; add a bottom-sheet component for detail and a sticky mini now-playing bar on non-Remote tabs. Keep `?tab=` as an optional deep link (`remote|search|library|more`), drop the numeric `?tab=1` from the QR code in `src/screens/control/index.tsx`.

### 2. Catalog port and adapter

`src/lan/ports.ts`: add

```ts
export interface LanVodSummary { id: string; name: string; pic: string; remarks: string; year: string; type: string }
export interface LanSearchSnapshot {
  groups: { site: LanSourceItem; list: LanVodSummary[] }[];
  completed: number; total: number; done: boolean;
}
export interface LanSearchSession { snapshot(): LanSearchSnapshot; cancel(): void }
export interface LanDetail {
  site: LanSourceItem; vod: LanVodSummary & { area: string; director: string; actor: string; content: string };
  flags: { flag: string; episodes: { name: string; url: string }[] }[];
  resume?: { flag: string; episodeUrl: string; position: number; duration: number };
}
export interface LanLibraryItem extends LanVodSummary { siteKey: string; siteName: string; flag?: string; episodeUrl?: string; position?: number; duration?: number; time: number }
export interface LanCatalog {
  search(keyword: string, quick: boolean): LanSearchSession;
  detail(siteKey: string, vodId: string): Promise<LanDetail>;      // rejects when site/vod unknown
  history(): Promise<LanLibraryItem[]>;
  keeps(): Promise<LanLibraryItem[]>;
  words(): Promise<{ history: string[]; hot: string[] }>;
}
```

`LanNavigator` gains `play(params: RootStackParamList['Player'])`; `openPlayer?` (unused) is removed.

`src/lan/catalogAdapter.ts` (new) implements `LanCatalog` on `getBootstrap()`, `getProvider`, `searchSites`/`searchTargets`, `parseFlags`, `getHistoryRepository`/`getKeepRepository`, and the search-history/hot-word helpers. `src/lan/runtime.ts` wires it into `setLanPorts({ catalog })`; `src/lan/navigation.ts` adds `play`.

### 3. Endpoints (`src/lan/api/catalog.ts`, registered in `server.ts`)

| Endpoint | Params | Behaviour |
| --- | --- | --- |
| `/api/search` | `word`, `quick` (optional) | Starts a search (cancels the previous one), returns `{ id, keyword, ...snapshot }` with whatever answered already. |
| `/api/search` | `id` | Returns the snapshot of that search; `404` when it is not the current one. |
| `/api/search` | `word`, `do=open` | Today's behaviour: opens the Search screen on the TV. |
| `/api/search` | (none) | `{ history, hot }` words for the empty state. |
| `/api/detail` | `site`, `id` | `LanDetail` JSON; `404` when unknown, `400` when the site is unsupported. |
| `/api/play` | `site`, `id`, `flag`, `url`, `position` (optional) | Navigates the TV to the Player route; without `flag`/`url` resumes from history or starts the first episode of the first line. |
| `/api/library` | (none) | `{ history: LanLibraryItem[], keeps: LanLibraryItem[] }` of the active config; empty lists when no config is loaded. |

`searchApi` moves from `action.ts` into `catalog.ts` (`pushApi` and `mediaProcess` stay). The page polls `/api/search?id=` every 500 ms until `done`.

### 4. Tests (RED first)

- `src/lan/__tests__/catalog.test.ts`: search start/poll/cancel-on-new/404 on stale id, `do=open`, words; detail happy path, 404, unsupported; play with explicit episode, resume from history, first episode fallback, missing params; library with and without an active config. Uses a `fakeCatalog()` added to `__fixtures__/fakes.ts`.
- `src/lan/__tests__/catalogAdapter.test.ts`: adapter on a fake provider registry and `MemoryStore` (search targets, detail flags, history mapping, keeps).
- `src/lan/__tests__/navigation.test.ts`: `play` navigates to `Player`.
- `src/lan/__tests__/web.test.ts`: asset list without jQuery, page contains the four tabs.
- `src/screens/control/__tests__`: QR value without `?tab=`.

### 5. Docs

`docs/REMOTE.md` (repo root): new tab table and the four endpoints.

## Risks

- `searchSites` lives under `src/screens/search/`; importing it from `src/lan/` crosses a layer. Mitigation: it is pure logic with no React import; moving it to `src/core/search/` is left for a follow-up task rather than widening this change.
- A search keeps up to 5 provider calls in flight for up to 30 s after the phone stops polling. Mitigation: a new search cancels the previous one, and the session is dropped 60 s after its last poll.
- Spider sites (`type 3`) run in the JS/JAR runtime; searching from the phone exercises the same code path as the TV's Search screen, so no new sandbox concerns, but errors are per site and reported as empty groups (same as the TV).
- `/api/play` navigates the TV like the Detail screen does; if the TV is on a modal or the Player is already open, React Navigation replaces the route params (same as `/api/search` today).
- Dropping jQuery and the `?tab=1` deep link: any bookmark with `?tab=1` lands on Remote, which is the intended default.

## Scope

- Web page: 3 rewritten files, 1 deleted, generated asset file regenerated (~1,200 lines of HTML/CSS/JS, replacing ~1,460).
- LAN server: `ports.ts`, `navigation.ts`, `runtime.ts`, `server.ts`, `api/action.ts` edited; `api/catalog.ts`, `catalogAdapter.ts` added (~350 lines).
- Tests: 2 new files, 3 edited; fixtures extended.
- `src/screens/control/index.tsx` and its test; `docs/REMOTE.md`.
- No new dependencies.

## Alternatives

- **Keep search on the TV only** (today's model) and only re-arrange tabs: cheapest, but does not give the requested phone-side results and play-from-phone.
- **Server-sent events / long polling for search progress** instead of the id-based poll: fewer requests, but the native httpd module answers one response per request and has no streaming API; polling matches the existing `/api/state?only=player` pattern.
- **Build the page with a framework (Preact/Vue) and a bundler**: better structure for the sheet and lists, but adds a build step and dependencies to a page that is embedded as base64; vanilla JS with small helpers is enough at this size.
- **Library actions (delete history, unfavourite) and category browsing on the phone**: natural next steps once the catalog port exists; left out to keep this change to what was asked.

## Annotations

(none yet)
