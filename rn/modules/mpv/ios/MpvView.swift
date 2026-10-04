import AVFoundation
import ExpoModulesCore
import QuartzCore
import UIKit
#if canImport(Libmpv)
import Libmpv
#endif

/// mpv rendering into a CAMetalLayer through MoltenVK (vo=gpu-next), with the same
/// `onMpvEvent` contract as the Android view (times in seconds). Without the MPVKit
/// frameworks the view only reports an init error so the app falls back to the video engine.
final class MpvView: ExpoView {
  static var isAvailable: Bool {
    #if canImport(Libmpv)
    return true
    #else
    return false
    #endif
  }

  let onMpvEvent = EventDispatcher()

  var source: MpvSource?
  var paused = false
  var speed = 1.0
  var audioTrack = "auto"
  var subtitleTrack = "auto"
  var resizeMode = "contain"
  var decode = "hard"

  private var initFailed = false

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    clipsToBounds = true
    backgroundColor = .black
    #if canImport(Libmpv)
    metalLayer.framebufferOnly = true
    metalLayer.backgroundColor = UIColor.black.cgColor
    layer.addSublayer(metalLayer)
    #endif
  }

  private func failInit(_ code: String, _ message: String) {
    initFailed = true
    onMpvEvent(["type": "error", "phase": "init", "code": code, "message": message])
  }

  #if canImport(Libmpv)
  private let metalLayer = CAMetalLayer()
  private var player: MpvPlayer?
  private var loadedUrl: String?
  private var fileLoaded = false

  deinit {
    player?.destroy()
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    metalLayer.frame = bounds
    metalLayer.contentsScale = window?.screen.nativeScale ?? UIScreen.main.nativeScale
    CATransaction.commit()
  }

  func applyProps() {
    guard let source, !initFailed else { return }
    if player == nil && !initialize() { return }
    guard let player else { return }
    player.set("pause", paused ? "yes" : "no")
    player.set("speed", String(speed))
    player.set("hwdec", hwdec)
    switch resizeMode {
    case "cover":
      player.set("keepaspect", "yes")
      player.set("panscan", "1.0")
    case "stretch", "fill":
      player.set("keepaspect", "no")
      player.set("panscan", "0.0")
    default:
      player.set("keepaspect", "yes")
      player.set("panscan", "0.0")
    }
    if source.url != loadedUrl { load(source, player) }
    if fileLoaded { applyTracks(player) }
  }

  func seek(_ ms: Double) {
    guard let player else { return }
    let seconds = String(max(ms, 0) / 1000)
    if fileLoaded {
      player.command(["seek", seconds, "absolute"])
    } else {
      player.set("start", seconds)
    }
  }

  private var hwdec: String {
    decode == "soft" ? "no" : "videotoolbox"
  }

  private func initialize() -> Bool {
    let options = [
      ("vo", "gpu-next"),
      ("gpu-api", "vulkan"),
      ("gpu-context", "moltenvk"),
      ("hwdec", hwdec),
      ("keepaspect", "yes"),
      ("ytdl", "no"),
      ("cache", "yes"),
      ("demuxer-max-bytes", "64MiB"),
      ("demuxer-max-back-bytes", "32MiB"),
    ]
    switch MpvPlayer.create(layer: metalLayer, options: options) {
    case .failure(let error):
      failInit(error.code, error.message)
      return false
    case .success(let player):
      player.onEvent = { [weak self] event in self?.handle(event) }
      self.player = player
      try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .moviePlayback)
      return true
    }
  }

  private func load(_ source: MpvSource, _ player: MpvPlayer) {
    loadedUrl = source.url
    fileLoaded = false
    player.set("start", source.startPosition > 0 ? String(source.startPosition) : "none")
    player.set("force-media-title", source.title ?? "")
    player.command(["change-list", "http-header-fields", "clr", ""])
    for (name, value) in source.headers {
      switch name.lowercased() {
      case "user-agent": player.set("user-agent", value)
      case "referer", "referrer": player.set("referrer", value)
      default: player.command(["change-list", "http-header-fields", "append", "\(name): \(value)"])
      }
    }
    player.set("demuxer-lavf-format", isHlsHint(source) ? "hls" : "")
    player.command(["loadfile", source.url, "replace"])
  }

  private func isHlsHint(_ source: MpvSource) -> Bool {
    guard let format = source.format?.lowercased() else { return false }
    let path = (source.url.split(separator: "?", maxSplits: 1).first.map(String.init) ?? source.url).lowercased()
    return (format.contains("mpegurl") || format.contains("m3u8")) && !path.hasSuffix(".m3u8")
  }

  private func applyTracks(_ player: MpvPlayer) {
    player.set("aid", audioTrack)
    player.set("sid", subtitleTrack)
  }

  private func handle(_ event: [String: Any]) {
    guard let player else { return }
    if event["type"] as? String == "fileLoaded" {
      fileLoaded = true
      for sub in source?.subtitles ?? [] {
        player.command(["sub-add", sub.url, "auto", sub.name, sub.lang ?? ""])
      }
      applyTracks(player)
      onMpvEvent(["type": "loaded", "duration": player.getDouble("duration") ?? 0, "tracks": player.readTracks()])
      return
    }
    if event["type"] as? String == "tracks" && !fileLoaded { return }
    onMpvEvent(event)
  }
  #else
  func applyProps() {
    guard source != nil, !initFailed else { return }
    failInit("load-library", "MPVKit frameworks are not linked")
  }

  func seek(_ ms: Double) {}
  #endif
}

#if canImport(Libmpv)
struct MpvInitError: Error {
  let code: String
  let message: String
}

/// Owns the mpv handle and drains its events on a serial queue; events reach `onEvent` on
/// the main thread. Retained by its own wakeup callback until `destroy()`.
private final class MpvPlayer {
  private static let progressInterval = 0.25

  let handle: OpaquePointer
  var onEvent: (([String: Any]) -> Void)?

  private let queue = DispatchQueue(label: "cc.bkhq.tvbox.mpv", qos: .userInitiated)
  // Touched on `queue` only.
  private var destroyed = false
  private var duration = 0.0
  private var buffered = 0.0
  private var lastProgress = 0.0
  private var lastLog: String?

  static func create(layer: CAMetalLayer, options: [(String, String)]) -> Result<MpvPlayer, MpvInitError> {
    guard let handle = mpv_create() else {
      return .failure(MpvInitError(code: "create", message: "mpv_create failed"))
    }
    var wid = Int64(Int(bitPattern: Unmanaged.passUnretained(layer).toOpaque()))
    mpv_set_option(handle, "wid", MPV_FORMAT_INT64, &wid)
    for (name, value) in options {
      mpv_set_option_string(handle, name, value)
    }
    mpv_request_log_messages(handle, "warn")
    let result = mpv_initialize(handle)
    guard result >= 0 else {
      mpv_terminate_destroy(handle)
      return .failure(MpvInitError(code: "initialize", message: String(cString: mpv_error_string(result))))
    }
    return .success(MpvPlayer(handle: handle))
  }

  private init(handle: OpaquePointer) {
    self.handle = handle
    mpv_observe_property(handle, 0, "time-pos", MPV_FORMAT_DOUBLE)
    mpv_observe_property(handle, 0, "duration", MPV_FORMAT_DOUBLE)
    mpv_observe_property(handle, 0, "demuxer-cache-time", MPV_FORMAT_DOUBLE)
    mpv_observe_property(handle, 0, "pause", MPV_FORMAT_FLAG)
    mpv_observe_property(handle, 0, "paused-for-cache", MPV_FORMAT_FLAG)
    mpv_observe_property(handle, 0, "track-list", MPV_FORMAT_NONE)
    mpv_set_wakeup_callback(handle, { context in
      guard let context else { return }
      Unmanaged<MpvPlayer>.fromOpaque(context).takeUnretainedValue().wakeup()
    }, Unmanaged.passRetained(self).toOpaque())
  }

  func destroy() {
    queue.async {
      guard !self.destroyed else { return }
      self.destroyed = true
      mpv_set_wakeup_callback(self.handle, nil, nil)
      mpv_terminate_destroy(self.handle)
      Unmanaged.passUnretained(self).release()
    }
  }

  func command(_ args: [String]) {
    var cargs: [UnsafeMutablePointer<CChar>?] = args.map { strdup($0) } + [nil]
    defer { cargs.forEach { free($0) } }
    cargs.withUnsafeMutableBufferPointer { buffer in
      buffer.baseAddress!.withMemoryRebound(to: UnsafePointer<CChar>?.self, capacity: buffer.count) { pointer in
        _ = mpv_command_async(handle, 0, pointer)
      }
    }
  }

  func set(_ name: String, _ value: String) {
    command(["set", name, value])
  }

  func getDouble(_ name: String) -> Double? {
    var value = 0.0
    return mpv_get_property(handle, name, MPV_FORMAT_DOUBLE, &value) >= 0 ? value : nil
  }

  func getInt(_ name: String) -> Int? {
    var value: Int64 = 0
    return mpv_get_property(handle, name, MPV_FORMAT_INT64, &value) >= 0 ? Int(value) : nil
  }

  func getFlag(_ name: String) -> Bool {
    var value: Int32 = 0
    return mpv_get_property(handle, name, MPV_FORMAT_FLAG, &value) >= 0 && value != 0
  }

  func getString(_ name: String) -> String? {
    guard let pointer = mpv_get_property_string(handle, name) else { return nil }
    defer { mpv_free(pointer) }
    return String(cString: pointer)
  }

  func readTracks() -> [[String: Any]] {
    let count = getInt("track-list/count") ?? 0
    return (0..<count).compactMap { i in
      guard let type = getString("track-list/\(i)/type"), let id = getInt("track-list/\(i)/id") else { return nil }
      var track: [String: Any] = [
        "id": id,
        "type": type,
        "selected": getFlag("track-list/\(i)/selected"),
        "external": getFlag("track-list/\(i)/external"),
      ]
      track["title"] = getString("track-list/\(i)/title")
      track["lang"] = getString("track-list/\(i)/lang")
      track["codec"] = getString("track-list/\(i)/codec")
      return track
    }
  }

  private func wakeup() {
    queue.async { self.readEvents() }
  }

  private func readEvents() {
    while !destroyed {
      guard let event = mpv_wait_event(handle, 0), event.pointee.event_id != MPV_EVENT_NONE else { return }
      process(event.pointee)
    }
  }

  private func process(_ event: mpv_event) {
    switch event.event_id {
    case MPV_EVENT_PROPERTY_CHANGE:
      guard let data = event.data else { return }
      let property = data.assumingMemoryBound(to: mpv_event_property.self).pointee
      onProperty(String(cString: property.name), property)
    case MPV_EVENT_FILE_LOADED:
      emit(["type": "fileLoaded"])
    case MPV_EVENT_SEEK:
      emit(["type": "buffering", "value": true])
    case MPV_EVENT_PLAYBACK_RESTART:
      emit(["type": "buffering", "value": false])
    case MPV_EVENT_END_FILE:
      guard let data = event.data else { return }
      let end = data.assumingMemoryBound(to: mpv_event_end_file.self).pointee
      guard end.reason == MPV_END_FILE_REASON_EOF || end.reason == MPV_END_FILE_REASON_ERROR else { return }
      var payload: [String: Any] = [
        "type": "endFile",
        "reason": Int(end.reason.rawValue),
        "code": Int(end.error),
        "message": String(cString: mpv_error_string(end.error)),
      ]
      payload["log"] = lastLog
      emit(payload)
    case MPV_EVENT_LOG_MESSAGE:
      guard let data = event.data else { return }
      let log = data.assumingMemoryBound(to: mpv_event_log_message.self).pointee
      let text = String(cString: log.text).trimmingCharacters(in: .whitespacesAndNewlines)
      if !text.isEmpty { lastLog = "\(String(cString: log.prefix)): \(text)" }
    default:
      break
    }
  }

  private func onProperty(_ name: String, _ property: mpv_event_property) {
    switch property.format {
    case MPV_FORMAT_DOUBLE:
      guard let value = property.data?.assumingMemoryBound(to: Double.self).pointee else { return }
      switch name {
      case "duration": duration = value
      case "demuxer-cache-time": buffered = value
      case "time-pos":
        let now = CACurrentMediaTime()
        guard now - lastProgress >= Self.progressInterval else { return }
        lastProgress = now
        emit(["type": "progress", "position": value, "duration": duration, "buffered": buffered])
      default: break
      }
    case MPV_FORMAT_FLAG:
      guard let value = property.data?.assumingMemoryBound(to: Int32.self).pointee else { return }
      if name == "pause" { emit(["type": "pause", "value": value != 0]) }
      if name == "paused-for-cache" { emit(["type": "buffering", "value": value != 0]) }
    case MPV_FORMAT_NONE:
      if name == "track-list" {
        let tracks = readTracks()
        emit(["type": "tracks", "tracks": tracks])
      }
    default:
      break
    }
  }

  private func emit(_ event: [String: Any]) {
    DispatchQueue.main.async { self.onEvent?(event) }
  }
}
#endif
