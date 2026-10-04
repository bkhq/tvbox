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
  - `apple` (matrix `ios`, `tvos`; `EXPO_TV=1` for tvOS): prebuild,
    `pod install`, then `xcodebuild archive` + `-exportArchive` (ad-hoc /
    `release-testing`, manual signing of `cc.bkhq.tvbox`) ->
    `ios-universal.ipa` / `tvos-universal.ipa`.
  - `publish` (tags only): creates the GitHub release with the binaries and
    the annotated tag message as notes, uploads them to R2 at
    `tvbox/rn/releases/<versionCode>/<flavor>.apk|.ipa`, and registers them
    with `POST <WORKER_URL>/mg/api/raw/releases` (`app: "rn"`, ipa assets
    carry `bundleId`). The worker then rewrites the rn update manifests.

Branch and manual runs only build; they never publish.

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
