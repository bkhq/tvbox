# airplay

AirPlay receiver protocol and server (pairing, FairPlay, screen mirroring, audio, HLS).

Vendored from [serezhka/java-airplay](https://github.com/serezhka/java-airplay) at commit
`00e6e3c` (MIT, see `LICENSE`), `protocol` and `server` modules merged into one Android library.

Changes for Android:

- Netty uses NIO transports only (no epoll).
- APIs missing on Android 7 (`InputStream.readAllBytes`, `String.isBlank`,
  `NetworkInterface.networkInterfaces`) are replaced.
- The `/tmp/airplay-hls-signal` debug watcher is removed.
- mDNS skips loopback interfaces.
