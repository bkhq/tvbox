# tvbox

Private Android TV / phone video player. It started from
[FongMi/TV](https://github.com/FongMi/TV) 5.6.1 (GPL-3.0) and keeps its
CatVod spider model (JAR, JavaScript and remote HTTP sites), Media3/ExoPlayer
and mpv playback, live TV and DLNA. Upstream history is not carried over.

## What differs from upstream

- **Removed:** Thunder / TVBus / ForceTech / JianPian P2P extractors and their
  closed-source AARs, Python spiders (Chaquopy), the upstream updater, the
  TVBus signature hook, device-to-device sync, QR scanning and phone casting.
- **Crash hardening:** background-thread failures no longer kill the app;
  spider errors on WebView threads and rejected background service starts are
  contained.
- **Phone control:** the TV serves a control page on the LAN for configs,
  playback, settings and files, protected by pairing — see
  [docs/REMOTE.md](docs/REMOTE.md).
- **AirPlay receiver:** screen mirroring and video casts from iPhone / iPad /
  Mac — see [docs/AIRPLAY.md](docs/AIRPLAY.md).
- **Own update server and optional server link:** the app updates from the
  worker in `worker/`, and a device can be linked to it so the worker delivers
  its configuration — see [docs/SERVER-LINK.md](docs/SERVER-LINK.md).

## Layout

```text
app/        the app; src/main is shared, src/leanback (TV) and src/mobile (phone) hold each UI
catvod/     spider API, networking and utilities shared with spiders
quickjs/    JavaScript spider runtime
airplay/    AirPlay protocol and server, vendored from serezhka/java-airplay (MIT)
media/      Media3 fork sources (FongMi/media) that build the AARs in app/libs
keystore/   release signing key used by CI and local builds
worker/     Cloudflare Worker: subscription, app updates, admin console (see worker/README.md)
docs/       config, live, spider and local API references
```

## Build

Requirements: JDK 21 and an Android SDK with platform 36/37. Create
`local.properties` in the repository root:

```properties
sdk.dir=/path/to/android-sdk
storeFile=../keystore/release.jks
keyAlias=tvbox
storePassword=<from keystore/release.properties>
```

```bash
bash ./gradlew :app:assembleRelease        # all flavors → Release/apk/
```

APKs are split by device (`leanback`, `mobile`) and ABI (`arm64_v8a`,
`armeabi_v7a`); minimum Android 7.0, target SDK 37.

Optional build properties:

| Property | Effect |
| --- | --- |
| `-PversionCode=… -PversionName=…` | Version; CI derives them from `vX.Y.Z` tags (`X*10000 + Y*100 + Z`) |
| `-PupdateUrl=<worker>/u` | Enables the in-app update check |
| `-PworkerUrl=<worker>` | Enables the optional server link |

The media AARs in `app/libs` are prebuilt and committed. To rebuild them from
`media/` (needs NDK 29.0.14206865 and CMake 3.22.1):

```bash
cd media && echo "sdk.dir=/path/to/android-sdk" > local.properties && ./build-aars.sh
```

The FFmpeg, mpv, libplacebo and MPEG-H native libraries inside `media/` are
upstream prebuilt binaries; their provenance is recorded in
`media/libraries/decoder_ffmpeg/src/main/resources/META-INF/androidx.media3.decoder.ffmpeg/native-dependencies.properties`.

## Release

`.github/workflows/android.yml` builds on every push to `main`. Pushing a tag
`vX.Y.Z` also publishes a GitHub release with the four APKs and, when the
repository variable `WORKER_URL` and the secrets `CLOUDFLARE_API_TOKEN`,
`CLOUDFLARE_ACCOUNT_ID` and `SERVICE_TOKEN_RELEASE` are set, uploads the APKs
to the worker and registers the release for in-app updates.

The signing key lives in `keystore/`. Anyone who can read this repository can
sign builds with it; replacing it breaks upgrades of installed apps.

## Docs

| File | Content |
| --- | --- |
| [docs/CONFIG.md](docs/CONFIG.md) | Config format (sites, parses, lives, rules, …) |
| [docs/SPIDER.md](docs/SPIDER.md) | Writing JAR / JavaScript spiders |
| [docs/LIVE.md](docs/LIVE.md) | Live source formats |
| [docs/LOCAL.md](docs/LOCAL.md) | Local HTTP endpoints used by spiders and tools |
| [docs/REMOTE.md](docs/REMOTE.md) | Phone control page, pairing and `/api` |
| [docs/AIRPLAY.md](docs/AIRPLAY.md) | AirPlay receiver |
| [docs/SERVER-LINK.md](docs/SERVER-LINK.md) | Linking a device to the worker |

## License

GPL-3.0, see [LICENSE.md](LICENSE.md). `airplay/` is MIT (see
`airplay/LICENSE`); `media/` is Apache-2.0.
