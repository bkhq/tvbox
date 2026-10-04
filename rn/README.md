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
| `Player`   | `{ siteKey, vodId, flag?, episodeUrl?, position? }`                      | playback / live    |
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
| iOS, `mpv`               | init or open failure (`reason` `init` / `open`, or any error before the first `load`), DRM |
| Android, `video`         | init failure, `format` or `decoder` errors; network / source errors fail |
| anything else            | init failure only                                                        |

A second failure, or an error with no fallback, ends in the `error` state
with a Chinese message.

### Player route

`Player` params are either a VOD episode
`{ siteKey, vodId, flag?, episodeUrl?, position? }` or a direct URL
`{ url, title?, headers?, position? }`; tell them apart with
`isVodPlayerParams` / `isUrlPlayerParams`. VOD playback resumes and updates
the history record Detail wrote for `(cid, historyKey(siteKey, vodId))`
through `getHistoryRepository()` (none while `incognito`); direct URLs write
no history.

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
