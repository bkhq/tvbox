# tvbox (React Native)

React Native rewrite of the Android TV app in this repository, targeting iOS,
Android phone, Android TV and tvOS from one codebase. The Java app under
`app/` is the reference implementation for behaviour; nothing outside `rn/`
belongs to this project.

## Versions

| Package                        | Version                                          |
| ------------------------------ | ------------------------------------------------ |
| Expo SDK                       | 57 (`expo@~57.0.26`)                             |
| React Native                   | `react-native-tvos@0.86.3-0` (as `react-native`) |
| React                          | 19.2.3                                           |
| `@react-native-tvos/config-tv` | 0.1.7                                            |
| TypeScript                     | ~6.0.3                                           |
| Jest / `jest-expo`             | ~29.7.0 / ~57.0.5                                |

Expo SDK 57 is the newest SDK with a matching react-native-tvos release
(SDK 57 pins React Native 0.86.3). `react-native` is excluded from
`expo install` validation because it is the TV fork.

`.npmrc` sets `legacy-peer-deps=true`: the fork's prerelease version
(`0.86.3-0`) does not satisfy the `>=0.x` peer ranges of community packages,
so npm would otherwise refuse to install.

## Prerequisites

- Node 24, npm 11
- Android: JDK 21 and the Android SDK (builds run in a container)
- iOS/tvOS: Xcode on macOS

## Commands

```sh
npm ci                    # install from package-lock.json
npm run lint              # ESLint (flat config, eslint-config-expo)
npm run typecheck         # tsc --noEmit
npm test                  # Jest (jest-expo preset)
npm start                 # Metro dev server for a development build
npm run prebuild:android  # generate android/ (one APK for phone + TV)
npm run prebuild:tv-ios   # generate ios/ for tvOS (EXPO_TV=1)
npm run android:debug     # gradle assembleDebug in android/ (needs a local SDK)
npm run android:debug:docker  # full debug APK build in a container, see below
```

Without `EXPO_TV=1`, `expo prebuild --platform ios` generates the iPhone/iPad
project. `WORKER_URL` is read at config time and exposed as
`extra.workerUrl` (trailing slashes stripped, empty when unset); read it at
runtime via `getAppConfig()` in `src/core/appConfig.ts`.

## App id

The app id is `cc.bkhq.tvbox` on both platforms (Android `package`, iOS
`bundleIdentifier`), distinct from the Java app's `com.fongmi.android.tv` so
both can be installed side by side.

A single Android build serves phones and TV: `plugins/withAndroidLeanback.js`
adds the `LEANBACK_LAUNCHER` category and declares leanback and touchscreen as
optional features, independent of `EXPO_TV`.

## Generated code

`ios/` and `android/` are produced by `expo prebuild`, gitignored and never
committed. Change native configuration through `app.config.ts` and config
plugins in `plugins/` instead.

## Layout

```
rn/
  App.tsx              NavigationContainer + RootNavigator; starts getBootstrap()
  app.config.ts        Expo config (app id, WORKER_URL -> extra.workerUrl)
  plugins/             local config plugins (withAndroidLeanback)
  modules/<name>/      local Expo native modules (Expo Modules API)
  docker/              Dockerfile of the Android build image
  scripts/             build helpers (android-debug.sh)
  src/core/            app logic, no UI except React hooks
  src/spider/          JS spider runtime: prelude, JsSpiderProvider, QuickJS adapter
  src/navigation/      root stack, route table, param types
  src/ui/              shared TV/phone primitives
  src/screens/<feature>/index.tsx   one screen per route
```

### `src/core/*`

| Module            | Exports                                                                                                                                                                                         |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `types.ts`        | Bean types mirroring the Java beans (`Site`, `Parse`, `Live`, `Vod`, `Result`, `History`, `Keep`, ...), `normalize*` helpers and loose JSON readers (`str`, `num`, `bool`, ...)                  |
| `http.ts`         | `request`, `fetchText`, `getText`, `getJson`, `HttpError`, `mergeHeaders`, `addRequestInterceptor`, `FetchLike`                                                                                  |
| `appConfig.ts`    | `getAppConfig()` -> `{ workerUrl, versionName, versionCode }` from the Expo config                                                                                                              |
| `config/`         | `loadVodConfig(url, prefs?)` / `parseVodConfig`, `supportedSites`, `selectHome`, `classifySite`, `loadLiveConfig` / `parseLiveConfig`, `decodeConfigText`                                         |
| `provider/`       | `SiteProvider` / `ProviderFactory` types, `registerProvider`, `getProvider(site)`, `clearProviders`, `UnsupportedSiteError`, the built-in CMS provider (`CmsProvider`, `cmsProviderFactory`)      |
| `storage/`        | `KeyValueStore` (`asyncStorageStore`, `MemoryStore` for tests), `createConfigRepository(store, 'vod' \| 'live')`, `createHistoryRepository`, `createKeepRepository`, `jsonCell`, `storageKey` |
| `settings/`       | Typed settings: `loadSettings`, `get`, `set`, `subscribe`, `subscribeKey`, `useSetting(key)`, `createSettingsStore`, `settingsSchema`                                                             |
| `serverLink/`     | Optional device link to the worker: `getServerLink()`, `setServerLink`, `createServerLink`, `useServerLink()`, `isServerLinkEnabled()`                                                           |
| `bootstrap.ts`    | Startup wiring: `getBootstrap()` (`start`, `reload`, `addConfig`), `useVodConfig()`, `createBootstrap(deps)`, `BootstrapProvider` for tests                                                     |

`getBootstrap().start()` (called once from `App.tsx`) loads the settings,
initialises the server link when the build has a worker URL, then loads the
active VOD config with `prefs.home = homeSiteKey`. `useVodConfig()` returns
`{ status: 'loading' | 'ready' | 'empty' | 'error', config, entry, error, reload, addConfig }`;
`entry` is the saved config (name, url). Every successful load clears the
cached providers.

### `src/navigation`

`routes.ts` maps each route to its screen and title; `types.ts` holds the
param types. Navigate with `useAppNavigation()` (screens rendered by the
route table import it from `navigation/useAppNavigation`, not the barrel,
to avoid an import cycle).

| Route      | Params                                                                   | Owner workstream    |
| ---------- | ------------------------------------------------------------------------ | ------------------- |
| `Home`     | none                                                                     | core                |
| `Category` | `{ siteKey, typeId, typeName }`                                          | VOD UI              |
| `Search`   | `{ keyword? } \| undefined`                                              | VOD UI              |
| `Detail`   | `{ siteKey, vodId, vodName?, vodPic? }`                                  | VOD UI              |
| `History`  | none                                                                     | VOD UI              |
| `Collect`  | none                                                                     | VOD UI              |
| `Settings` | none                                                                     | VOD UI              |
| `Player`   | `{ siteKey, vodId, flag?, episodeUrl?, position? } \| { url, title?, headers?, position? }` | playback / live    |
| `Live`     | `{ groupIndex?, channelIndex? } \| undefined`                            | playback / live    |
| `Control`  | none                                                                     | LAN services        |

Each workstream replaces the stub in `src/screens/<feature>/index.tsx`
(default export) and keeps feature-only components and tests in that
directory. The JS spider runtime has no route: it registers a provider (see
below) and, if it needs native code, adds a module under `modules/`.

### `src/ui`

`FocusableButton`, `FocusableCard` (poster card), `FocusGrid` (FlatList grid
with layout-derived columns), `HorizontalRow`, `PlaceholderScreen`,
`useLayout()` (`isTV`, columns), and theme tokens (`colors`, `spacing`,
`fontSize`, `radius`, `focusScale`). Focusable components accept
`hasTVPreferredFocus` and `nextFocus*` props for D-pad navigation.

### `modules/<name>/`

Local native code is an Expo module built with the Expo Modules API
(`npx create-expo-module@latest --local <name>`), autolinked from `modules/`.
Never edit generated `android/` or `ios/` directly.

## JS spiders

Type 3 sites whose `api` ends in `.js` run in QuickJS, one context per site
(`JsSpiderProvider`, provider id `js-spider`). `getBootstrap()` calls
`installJsSpiders()` (`src/spider/nativeRuntime.ts`) once on every platform:
it installs the native runtime with `setSpiderRuntime` and registers the
provider. JAR spiders (type 3 non-`.js`), Python spiders and type 4 sites stay
unsupported (`supported: false`).

| Path                                 | Contents                                                                                                    |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `src/spider/runtime.ts`              | `SpiderRuntime` seam, `setSpiderRuntime` / `getSpiderRuntime`, `SpiderError`, `SpiderTimeoutError`           |
| `src/spider/prelude.ts`              | sources evaluated in each context: `PRELUDE` script, crypto and parser modules, `spiderEntry(api)`           |
| `src/spider/provider.ts`             | `JsSpiderProvider` (bootstrap per `Spider.java`, results per `SiteApi.java`)                                 |
| `src/spider/nativeRuntime.ts`        | `nativeSpiderRuntime` (pass-through to the native module, error mapping), `installJsSpiders()`               |
| `modules/quickjs/`                   | Expo module `QuickJS`: quickjs-ng + `cpp/qjs_bridge.c`, Android JNI and iOS/tvOS Swift wrappers              |
| `modules/quickjs/assets/lib/`        | bundled libs (`cat.js`, `cheerio.min.js`, `crypto-js.js`, `gbk.js`, `similarity.js`), copies of `quickjs/`   |

**Native contract** (`modules/quickjs/index.ts`): `createContext()`,
`registerModule(ctx, name, source)`, `evaluate(ctx, code, filename, asModule, timeoutMs)`,
`call(ctx, objectName, method, argsJson, timeoutMs)` (resolves the JSON of the
result, awaiting promises and driving `__drainTimers`), `destroyContext(ctx)`.
Each context has its own runtime and serial thread. Rejections carry
`ERR_QUICKJS_EXCEPTION | TIMEOUT | STALLED | NO_OBJECT | NO_CONTEXT`; the
adapter turns them into `SpiderError` (`SpiderTimeoutError` for timeouts). The
module loader resolves registered sources first, then `lib/X` /
`assets://js/lib/X` from the bundled libs, then http(s) URLs.

**Host APIs available to spiders**: `req` / `http` / `_http` (get, post with
json / form / form-data / body, HEAD via `header`, headers, timeout, redirect,
`buffer` 0-3), `local.get/set/delete` (persisted per app in
`quickjs_local`), `console.*`, `setTimeout` / `clearTimeout`, `joinUrl`,
`md5X`, `aesX`, `pd` / `pdfh` / `pdfa` / `pdfl`, the `global` / `window` /
`self` aliases, and ES module imports of the bundled libs. Spider methods
called: `init`, `home`, `homeVod`, `category`, `detail`, `search`, `play`,
`destroy`.

**Not implemented (deferred)**: `proxy` / `getProxy` / `js2Proxy` / `getPort`
(no local proxy server), `s2t` / `t2s`, `rsaX`, and the spider methods
`liveContent`, `action`, `sniffer`, `isVideo` and `proxy`.

**Tests.** Jest runs spiders in a node `vm` runtime
(`src/spider/__testutils__/nodeRuntime.ts`); `jest.setup.ts` mocks the native
module. `bash modules/quickjs/cpp/test/run.sh` (gcc + node, no device) runs
the C bridge test and a smoke test that evaluates the real prelude, crypto and
parser modules and two fixture spiders (FongMi default export and cat-style
`__jsEvalReturn`) on quickjs-ng with the bundled libs.

**iOS/tvOS risk.** The Swift wrapper and the podspec are only checked here by
typecheck and `expo prebuild` autolinking; they are first compiled by the
macOS CI build, so iOS/tvOS compile errors surface there.

## Extension seams

**Site providers.** Register a factory; later registrations win, so no core
file has to change:

```ts
import { registerProvider, type SiteProvider } from './src/core/provider';

registerProvider({
  id: 'js-spider',
  match: (site) => site.type === 3 && site.api.toLowerCase().endsWith('.js'),
  create: (site, ctx): SiteProvider => new JsSpiderProvider(site, ctx),
});
```

Screens call `getProvider(site)`; it throws `UnsupportedSiteError` when no
factory matches. Sites the app cannot run stay in `config.sites` with
`supported: false` and `unsupportedReason` (`'jar' | 'py' | 'type'`).

**Settings.** Keys and validation live in `settings/schema.ts`; add a key
there. Read with `get(key)` or `useSetting(key)`, write with `set(key, value)`
(throws `InvalidSettingError` on invalid values), and react to changes with
`subscribe(listener)` / `subscribeKey(key, listener)`. `homeSiteKey` holds the
selected home site.

**Storage.** Repositories take a `KeyValueStore`: `asyncStorageStore` in the
app, `MemoryStore` in tests. Use `createConfigRepository(asyncStorageStore, 'vod')`
for saved configs (`add`, `list`, `setActive`, `getActive`), and the history
and keep repositories for user data. New persisted data uses `jsonCell` with
a versioned `storageKey(name, version)`.

**HTTP.** All requests go through `src/core/http.ts`.
`addRequestInterceptor((url, init) => init)` adds headers for specific hosts
and returns an unregister function.

**Server link** (`docs/SERVER-LINK.md`). Present only when `WORKER_URL` was
set at build time. The bootstrap creates the app-wide link with its own
config loader (`setServerLink`), so a subscription the link applies becomes
the active config and appears through `useVodConfig()`; load failures are
reported to `onConfigError`, which re-queries the worker on a 404. UI uses
`useServerLink()`.

**Routes.** Add a route by extending `RootStackParamList` in
`navigation/types.ts` and the table in `navigation/routes.ts`.

## Playback

`src/player/` holds the player core: engine contract and registry, the
playback state machine (`machine.ts`), the VOD resolve flow (`resolve.ts`),
history (`history.ts`), the app-wide control API (`controller.ts`) and the
`usePlayback(params)` hook the Player screen is built on. Engine
implementations live in sibling workstreams and register themselves.

### Engines

```ts
type EngineKind = 'video' | 'mpv';

interface EngineSource {
  url: string;
  headers: Record<string, string>;
  title?: string;
  startPosition?: number; // ms
  format?: string; // MIME hint
  subtitles: ExternalSubtitle[]; // { url, name, lang?, format? }
  drm?: { type: string; licenseUrl?: string; headers?: Record<string, string> };
}

interface EngineViewProps {
  source: EngineSource;
  paused: boolean;
  rate: number;
  resizeMode: 'contain' | 'cover' | 'stretch' | 'fill'; // resizeModeFromScale(scale setting)
  selectedAudioTrack?: TrackId;
  selectedTextTrack?: TrackId | null; // null = subtitles off
  style?: StyleProp<ViewStyle>;
  onEvent(event: EngineEvent): void;
}

interface EngineHandle { seek(ms: number): void; release?(): void } // the component's ref

type EngineEvent =
  | { type: 'load'; duration: number; tracks: EngineTracks }
  | { type: 'progress'; position: number; duration: number; buffered: number }
  | { type: 'buffering'; value: boolean }
  | { type: 'playing' } | { type: 'paused' } | { type: 'ended' }
  | { type: 'tracks'; audio: Track[]; text: Track[]; video: Track[] }
  | { type: 'error'; code: string | number; message: string; fatal: boolean;
      phase: 'init' | 'playback';
      reason: 'init' | 'open' | 'format' | 'decoder' | 'drm' | 'network' | 'other' };

interface EngineFactory {
  kind: EngineKind;
  label: string; // Chinese UI name: "系统播放器", "MPV"
  isAvailable(): boolean;
  Component: React.ComponentType<EngineViewProps & React.RefAttributes<EngineHandle>>;
}
```

Register at startup; times are milliseconds everywhere:

```ts
import { registerEngine } from './src/player';

registerEngine({ kind: 'mpv', label: 'MPV', isAvailable: () => MpvModule.isAvailable(), Component: MpvView });
```

`registerBuiltinEngines()` (`src/player/engines/`, called once in `App.tsx`)
registers the bundled engines. Engine views take an optional
`background?: boolean` prop, the `background` setting (keep playing while the
app is in the background).

**Video engine** (`src/player/engines/video/`, kind `video`, "系统播放器"):
`react-native-video` 6.19.3 (Media3 on Android with HLS / DASH /
SmoothStreaming, AVPlayer on iOS / tvOS), enabled through its config plugin
with `enableBackgroundAudio` (iOS `UIBackgroundModes` audio). External
subtitles: SRT, VTT and TTML (by MIME hint, else file extension); ASS / SSA
are skipped. Errors before the first `load` are phase `init`; Media3 codes map
`IO_*` / timeout -> `network`, `PARSING_*` / `DECODING_FORMAT_*` -> `format`,
`DECODER_*` / `DECODING_*` / `AUDIO_TRACK_*` -> `decoder`, `DRM_*` -> `drm`;
AVPlayer `NSURLErrorDomain` -> `network`, AVFoundation unsupported / decode
errors -> `format` / `decoder` (table in `errors.ts`).

`getEngine(kind)`, `listEngines()`, `resolveEngine(preferred)` (preferred if
registered and available, else the other one) and `fallbackEngine(failed)`
complete the registry. Engine adapters map native errors to `reason`; the
player keys the engine view on `sourceKey`, so a new source remounts it.

**Default engine.** The `playerEngine` setting is `'auto' | 'video' | 'mpv'`
(default `'auto'`). `'auto'` is the platform default: `mpv` on iOS / tvOS,
`video` (Media3) on Android phone and TV. `'video'` / `'mpv'` are explicit
user choices. `setPreferredEngine(kind | 'auto')` persists the choice;
`chooseEngine(preference, Platform.OS, source?)` resolves it, sending DRM
sources to `video` up front.

**Fallback** (`fallbackDecision(platform, active, error, context)`), at most
once per item, never written back to the setting, keeping the position:

| Platform / active engine | Falls back to the other engine on                                         |
| ------------------------ | ------------------------------------------------------------------------ |
| iOS, `mpv`               | `reason` `init`, `open`, `format`, `decoder` or `drm`                     |
| Android, `video`         | `reason` `init`, `format` or `decoder`                                    |
| anything else            | `reason` `init` only                                                      |

The decision uses `reason` only, not `phase` (adapters report every error
before the first `load` as phase `init`): `network` and `other` errors never
switch engines. A second failure, or an error with no fallback, ends in the
`error` state with a Chinese message.

### mpv engine (`modules/mpv`, `src/player/engines/mpv`)

`mpvEngineFactory` (kind `mpv`, label `MPV`) renders the local Expo module's
native `MpvView` and maps `EngineViewProps` to native props (seconds, mpv
`aid` / `sid` values `auto` / `no` / id, the `decode` setting as hardware or
software decoding) and native `onMpvEvent` payloads to engine events.
`isAvailable()` is `isMpvAvailable()`: false in Jest and on web, on Android
ABIs without libmpv (x86 / x86_64) and on iOS builds without MPVKit; it never
throws. A missing native view or a failed library load / `mpv_create` /
`mpv_initialize` is an `error` with `phase: 'init'`, `reason: 'init'`.
End-file errors are classified by `classifyMpvError`: unrecognized format /
nothing to play -> `format`, audio / video output init -> `decoder`,
network / HTTP failures in mpv's last warning -> `network`, other failures
before the first `load` -> `open`, later failures on a network URL ->
`network`, else `other`.

**Android.** `modules/mpv/android/src/main/jniLibs/{arm64-v8a,armeabi-v7a}`
carries the Java app's prebuilt `libmpv.so`, `libplayer.so` (mpv-android JNI
bridge for `is.xyz.mpv.MPVLib`, ported unchanged in package `is.xyz.mpv`) and
the FFmpeg libraries libmpv links against (`libav*`, `libsw*`, from
`media/libraries/decoder_ffmpeg`), copied because the build container mounts
only `rn/`. They need the bundled `libc++_shared.so` (NDK r29); React
Native's NDK 27 copy lacks `std::__from_chars_floating_point`.
`app.config.ts` sets `pickFirst` for `**/libc++_shared.so` (that keeps the
app's NDK 27 copy) and `modules/mpv/android/build.gradle` then overwrites it
in the app's merged native libs for arm64-v8a / armeabi-v7a; the r29 copy
exports every libc++ symbol the React Native libraries use. libplayer holds one global mpv instance, so a new view releases
the previous one first. Options follow the Java app (`vo=gpu`,
`hwdec=mediacodec,mediacodec-copy` or `no`, `profile=fast`, `config-dir`
`files/mpv` for a user `mpv.conf`).

**iOS / tvOS.** MPVKit is SwiftPM-only, so `modules/mpv/ios/fetch-mpvkit.sh`
downloads the LGPL xcframeworks listed in MPVKit's `Package.swift`
(`MPVKIT_VERSION`, default `1.0.0`, checksum-verified, see Release > MPVKit) into `modules/mpv/ios/Frameworks/`
(gitignored); `TvboxMpv.podspec` vendors whatever is there. Run it before
`pod install`. Without the frameworks the module still compiles
(`#if canImport(Libmpv)`) and reports unavailable. Rendering uses
`vo=gpu-next` with MoltenVK on a `CAMetalLayer` (`wid`), `hwdec=videotoolbox`.

### Player route

`Player` params are either a VOD episode
`{ siteKey, vodId, flag?, episodeUrl?, position? }` or a direct URL
`{ url, title?, headers?, position? }`; tell them apart with
`isVodPlayerParams` / `isUrlPlayerParams`. VOD playback resumes and updates
the history record Detail wrote for `(cid, historyKey(siteKey, vodId))`
through `getHistoryRepository()` (none while `incognito`); direct URLs write
no history.

### Player screen (`src/screens/player`)

Renders the active engine full screen (keyed on `sourceKey`, `background`
setting passed through) and is the playback host while focused
(`usePlayback(params, { attach: focused })`). An engine fallback shows a
toast ("已切换到 MPV 播放"); resolve / parse / load show a spinner text and
errors a Chinese message with 重试 (re-opens the item).

- TV remote (`useRemoteKeys`): left / right seek 10 s per press, accumulating
  while the key repeats and applied 500 ms after the last press; OK
  pauses / resumes while the controls are hidden; up (and the Android menu
  key) shows the controls, down the episode panel; play / pause / next /
  previous media keys and channel up / down work directly. Back closes the
  panel, then the controls, then leaves.
- Touch (`useTouchGestures`): tap toggles the controls, double tap pauses,
  a horizontal drag seeks (a full-width drag is 3 min) with a target-time
  preview. Phones get a 返回 button; the header is hidden.
- Controls auto-hide after 5 s; panels: 选集 (with line switch), 倍速
  (`SPEED_PRESETS`), 音轨, 字幕 (关闭, engine text tracks, `Result.subs`,
  add by URL), 播放器 (writes `playerEngine`, restarts at the position).
- With `background` off the screen pauses on AppState `background` /
  `inactive` for every engine and does not resume.
- `App.tsx` registers the player opener on `NavigationContainer` ready:
  `navigate('Player', request)`.
- Not done: no orientation lock (`expo-screen-orientation` is not a
  dependency); no long-press speed boost (`speedLongPress`).

### Live screen (`src/screens/live`)

Live sources come from `loadLiveSources()` (`src/player/live/source.ts`): the
active saved live config (`createConfigRepository(store, 'live')`, loaded
with `loadLiveConfig`), else the `lives` of the loaded VOD config. The
selected source and the last channel per source (`keepValue`, Live.keep) live
in the `tvbox.live.state.v1` cell (`readLiveState`, `saveLiveHome`,
`saveLiveKeep`). `loadLiveGroups(live)` runs `loadLive` with the live
favourites and splits off password-protected groups.

- Start channel: the route `{ groupIndex, channelIndex }` when valid, else
  the saved keep (`findKeepPosition`), else the first channel after 收藏.
- The engine host is the Player screen's pattern on `usePlayback(request,
  { attach: false })` with the channel's current source URL, name and
  `channelHeaders` (ua / referer / origin / header, inherited from the live);
  `scaleLive` sets the resize mode. On a fatal error the next source is tried
  while `change` is on (`lineAfterError`), then the engine fallback applies.
- TV remote: up / down (and channel up / down) change channel through
  `invert` / `across`, media next / previous step channel, left / right
  switch source, OK opens the channel list, menu (Android) / info opens the
  live panel (sources, `invert` / `across` / `change`). react-native-tvos
  reports no digit keys, so channel numbers cannot be typed.
- Phone: tap toggles the channel list (with 返回 and 直播源 buttons), a
  vertical swipe changes channel (up = next).
- Channel list: group column, channels with number, logo and current
  programme, and on TV the focused channel's guide. EPG comes from the
  source's XMLTV files (`loadXmltv`, once per source) or the channel's
  `{date}` URL (`fetchChannelEpg`, on demand). The info bar shows name,
  number, logo, "线路 n/m" and the current / next programme for 5 s after a
  channel or source change.
- Password groups: five presses on 收藏 open the password prompt
  (PassDialog); matching groups are appended to the list.
- While focused the screen is the playback host (prev / next = channel,
  seek / speed reach the engine, title = channel name) and the live select
  target below.
- Not done: channel `click` / `parse` resolution, favourites editing (long
  press), catch-up playback, the boot-to-live (`bootLive`) start.

### Control API

For LAN services (phone control page, DLNA, AirPlay casts):

```ts
getPlaybackController(): {
  getState(): PlaybackSnapshot;
  play(): void; pause(): void; stop(): void;
  prev(): void; next(): void;          // VOD: episode, Live: channel
  repeat(): void;                      // toggle repeat-one, see snapshot.repeat
  replay(): void;                      // restart the current item from 0
  seekTo(ms: number): void;
  setSpeed(n: number): void;           // clamped to 0.1..5 (speedPlayback range)
  playUrl(url: string, opts?: { title?: string; position?: number; headers?: Record<string, string> }): void;
  subscribe(listener: (s: PlaybackSnapshot) => void): () => void;
}

interface PlaybackSnapshot {
  active: boolean; playing: boolean; title: string;
  position: number; duration: number; // ms
  speed: number; repeat: boolean;
  url?: string; engine?: EngineKind;
  status: 'idle' | 'resolving' | 'parsing' | 'loading' | 'buffering' | 'playing' | 'paused' | 'ended' | 'error';
}
```

The screen that owns playback attaches as the host with
`attachPlaybackHost(host)` (returns the detach function). A host implements
the same commands plus `getState()`, `subscribe(push)` to push snapshots, and
optionally `playUrl(request)`; the Player screen does all of this through
`usePlayback`. Without a host `getState().active` is false and the commands
are no-ops. `playUrl` goes to the attached host when it accepts URLs;
otherwise it calls the opener registered with `setPlayerOpener(fn)` (wired to
navigate to `Player` with the direct-URL params) and the request is queued
for the next host that accepts URLs.

```ts
const player = getPlaybackController();
const off = player.subscribe((s) => send({ playing: s.playing, position: s.position }));
player.playUrl('https://example.com/a.m3u8', { title: '投屏', position: 30_000 });
player.seekTo(60_000);
player.setSpeed(1.5);
off();
```

Live select surface (`src/player/live/controller.ts`):

```ts
getLiveController(): {
  // Active live source; password-protected groups are excluded.
  listGroups(): Promise<Array<{ index: number; name: string;
    channels: Array<{ index: number; name: string; number: string; logo: string }> }>>;
  // Switches in place when the Live screen is focused, else opens the Live
  // route with { groupIndex, channelIndex } through setLiveOpener(fn).
  selectChannel(groupIndex: number, channelIndex: number): void;
}
```

`App.tsx` registers `setLiveOpener` next to `setPlayerOpener`:
`navigate('Live', params)`.

## Android debug build

The APK is built in a sibling container; the host needs only Docker:

```sh
bash rn/scripts/android-debug.sh   # or: cd rn && npm run android:debug:docker
```

The script builds the image `ai-agent/tvbox-rn-build` from `docker/Dockerfile`
(the shared `ai-agent/tvbox-build` JDK 21 image plus Node 24) if it is
missing, then runs one `docker run --rm --label ai-agent=true` container that
mounts only `rn/` (same path inside and outside) and the shared Android SDK
`/srv/zzci/tvbox/.tmp/android-sdk` read-only, and runs:

1. `npm ci`
2. `npx expo prebuild --platform android --no-install`
3. `./gradlew assembleDebug` in `android/`, with
   `GRADLE_USER_HOME=rn/.tmp/gradle-home` and `ANDROID_HOME=rn/.tmp/android-sdk`.

The output is `android/app/build/outputs/apk/debug/app-debug.apk`.
`WORKER_URL` is passed through to the container.

The shared SDK is never written to. `rn/.tmp/android-sdk` is a per-checkout
overlay: every package of the shared SDK is symlinked into it, and packages
React Native needs but the shared SDK lacks (compile platform, build-tools
and NDK versions from `node_modules/react-native/gradle/libs.versions.toml`;
currently `ndk;27.1.12297006`) are installed there with `sdkmanager`.
Everything under `rn/.tmp/` is gitignored and can be deleted to start over.

## Release

The RN app has its own release channel, separate from the Java app's.

### Versioning

Release tags are `rn-vX.Y.Z` (the Java app keeps `vX.Y.Z`). The version job
derives `versionName = X.Y.Z` and `versionCode = X*10000 + Y*100 + Z`
(minor and patch below 100; any other `rn-v*` tag fails the run). CI passes
them as `VERSION_NAME` / `VERSION_CODE` to `app.config.ts`, which sets
`version`, `android.versionCode` and `ios.buildNumber` (the same code on
both platforms). Unset or blank values fall back to `1.0.0` / `1`; a
`VERSION_CODE` that is not a positive integer fails at config time.

### Workflows

- `.github/workflows/rn-ci.yml`: on pull requests and pushes to `main` that
  touch `rn/`: `npm ci`, lint, typecheck and tests on Node 24.
- `.github/workflows/rn-release.yml`: on pushes to `main` that touch `rn/`,
  on `rn-v*` tags and on manual dispatch.
  - `android`: prebuild and `gradlew assembleRelease` -> `android-universal.apk`
    (one APK for phones and Android TV).
  - `apple` (matrix `ios`, `tvos`; `EXPO_TV=1` for tvOS): fetch MPVKit
    (see below), prebuild, `pod install`, then `xcodebuild archive` + `-exportArchive` (ad-hoc /
    `release-testing`, manual signing of `cc.bkhq.tvbox`) ->
    `ios-universal.ipa` / `tvos-universal.ipa`.
  - `publish` (tags only): creates the GitHub release with the binaries and
    the annotated tag message as notes, uploads them to R2 at
    `tvbox/rn/releases/<versionCode>/<flavor>.apk|.ipa`, and registers them
    with `POST <WORKER_URL>/mg/api/raw/releases` (`app: "rn"`, ipa assets
    carry `bundleId`). The worker then rewrites the rn update manifests.

Branch and manual runs only build; they never publish.

### MPVKit

Before prebuild the `apple` job runs `bash modules/mpv/ios/fetch-mpvkit.sh`,
which downloads the MPVKit LGPL xcframeworks into
`modules/mpv/ios/Frameworks/` for `pod install` to vendor. The script pins
MPVKit `1.0.0` (`pinned_version`) and the SHA-256 of that tag's
`Package.swift` (`pinned_package_sha256`), and checks every archive against
the SwiftPM `checksum:` (SHA-256) listed for it in `Package.swift`. Any
mismatch or download failure fails the job, so a build never ships without
mpv silently. `MPVKIT_VERSION` / `MPVKIT_PACKAGE_SHA256` override the pins
locally; another version without `MPVKIT_PACKAGE_SHA256` only warns that
`Package.swift` itself is unverified.

To bump MPVKit, set both pins in the script to the new tag and
`curl -fsSL https://raw.githubusercontent.com/mpvkit/MPVKit/<tag>/Package.swift | shasum -a 256`
(archive checksums come from that `Package.swift`), check the skipped
targets (GPL variants, `Libsmbclient`, `Libluajit`) and the podspec's system
frameworks still match, then run the script once.

### Update endpoints

`WORKER_URL` is baked into the build. The app checks
`<WORKER_URL>/u/rn/stable/<flavor>.json` (`android-universal`,
`ios-universal`, `tvos-universal`). Android downloads the APK the manifest
points at; iOS installs through
`itms-services://?action=download-manifest&url=<WORKER_URL>/u/rn/stable/<flavor>.plist`
(URL-encoded), a plist the worker generates from the JSON manifest.

### Secrets and variables

| Name                                     | Kind     | Purpose                                                             |
| ---------------------------------------- | -------- | ------------------------------------------------------------------- |
| `WORKER_URL`                             | variable | Worker base URL baked into the app and used to register releases   |
| `APPLE_CERTIFICATE_P12_BASE64`           | secret   | Base64 of the Apple Distribution certificate and key (`.p12`)       |
| `APPLE_CERTIFICATE_PASSWORD`             | secret   | Password of the `.p12`                                              |
| `APPLE_TEAM_ID`                          | secret   | Apple Developer team id                                             |
| `APPLE_PROVISIONING_PROFILE_IOS_BASE64`  | secret   | Base64 of the iOS ad-hoc profile for `cc.bkhq.tvbox`                |
| `APPLE_PROVISIONING_PROFILE_TVOS_BASE64` | secret   | Base64 of the tvOS ad-hoc profile for `cc.bkhq.tvbox`               |
| `CLOUDFLARE_API_TOKEN`                   | secret   | Wrangler token with R2 write access to the worker bucket            |
| `CLOUDFLARE_ACCOUNT_ID`                  | secret   | Cloudflare account of the bucket                                    |
| `SERVICE_TOKEN_RELEASE`                  | secret   | Worker `release` service token for the register call                |

The Android APK needs no secrets: it is signed with the committed
`keystore/release.jks`, using the alias and password from
`keystore/release.properties` (the same key as the Java app, which keeps
in-place updates possible). A missing keystore or property fails the build;
there is no debug-keystore fallback.

The bucket name is read from `worker/apps/api/wrangler.toml`. The temporary
keychain password is generated in the job, and the keychain is deleted at
the end of the job even when it fails.

### Unsigned fallback

- iOS/tvOS without the `APPLE_*` secrets for that target: the job builds
  for the simulator with `CODE_SIGNING_ALLOWED=NO` as a compile check, logs a
  warning and produces no ipa. The run does not fail; `publish` releases and
  registers only the binaries that exist (at least the APK).

### Adding an ad-hoc device

Ad-hoc ipas install only on devices listed in the profile:

1. Add the device UDID in the Apple Developer portal (Devices).
2. Regenerate the iOS and/or tvOS ad-hoc profiles for `cc.bkhq.tvbox` so
   they include the device, and download them.
3. Update `APPLE_PROVISIONING_PROFILE_IOS_BASE64` /
   `APPLE_PROVISIONING_PROFILE_TVOS_BASE64` (`base64 -i profile.mobileprovision`).
4. Push a new `rn-vX.Y.Z` tag so a re-signed ipa is built and published.

iPhones then install or update over the air from the plist link. tvOS has no
OTA install: install the tvOS ipa on the Apple TV with Xcode (Devices and
Simulators) or Apple Configurator.
