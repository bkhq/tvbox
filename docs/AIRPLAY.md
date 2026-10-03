# AirPlay receiver

The TV app advertises itself as an AirPlay receiver while its home screen is
running. On an iPhone, iPad or Mac it shows up under **Screen Mirroring** and
in the AirPlay menu of video apps.

## What works

- **Screen mirroring.** H.264 video is decrypted (FairPlay) and decoded with
  MediaCodec straight to a full-screen surface (`MirrorActivity`), which opens
  when mirroring starts and closes when the sender stops. Rotation and
  resolution changes restart the decoder.
- **Mirroring audio.** AAC-ELD (and AAC-LC) decoded with MediaCodec and played
  through an AudioTrack; the sender's volume control applies.
- **Video casts (HLS).** Apps such as YouTube or Safari send a playlist; it is
  handed to the regular player through the push flow. Pause, resume, seek and
  the playback position are synced with the sender.

## Limitations

- Audio-only AirPlay from the Music app uses ALAC, which Android cannot decode;
  it plays silently.
- DRM video (Netflix, Disney+, Apple TV+, …) cannot be received by any
  third-party receiver.
- On Android 10+ the mirror screen may not open while the app is in the
  background (system limit on background activity starts).
- PIN / HomeKit pairing is not implemented; senders connect without a code.
- The sender and the TV must be on the same network; AP isolation or blocked
  multicast on the router hides the receiver.

## Settings

The receiver is on by default and uses the app name. Both can be changed from
the phone control page (Settings → AirPlay). The receiver identifies itself
with a random, persistent device id instead of the MAC address, which Android
hides.

## Code

- `airplay/` — protocol (pairing, FairPlay, RTSP setup) and Netty server with
  mDNS, vendored from [serezhka/java-airplay](https://github.com/serezhka/java-airplay)
  at `00e6e3c` (MIT). Android changes are listed in `airplay/README.md`.
- `app/src/main/java/com/fongmi/android/tv/airplay/` — `AirPlay` (the
  `Playback` implementation, start/stop, multicast lock), `VideoSink`,
  `AudioSink`, `MirrorActivity`.
