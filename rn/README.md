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
npm run android:debug     # gradle assembleDebug in android/
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

TODO

## Extension seams

TODO
