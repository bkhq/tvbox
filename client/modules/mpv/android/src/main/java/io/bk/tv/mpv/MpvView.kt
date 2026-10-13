package io.bk.tv.mpv

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.SurfaceHolder
import android.view.SurfaceView
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import `is`.xyz.mpv.MPVLib
import `is`.xyz.mpv.MPVLib.MpvEndFileReason
import `is`.xyz.mpv.MPVLib.MpvEvent
import `is`.xyz.mpv.MPVLib.MpvFormat
import java.io.File

/**
 * mpv on a SurfaceView. Options follow the Java app (MpvUtil / MpvPlayerOptionDefaults); raw
 * mpv state goes to JS through `onMpvEvent` (times in seconds), the TS adapter maps it to engine
 * events. Native callbacks arrive on mpv's event thread and are handled on the main thread.
 */
class MpvView(context: Context, appContext: AppContext) :
  ExpoView(context, appContext), SurfaceHolder.Callback, MPVLib.EventObserver, MPVLib.LogObserver {

  override val shouldUseAndroidLayout = true

  private val onMpvEvent by EventDispatcher<Map<String, Any?>>()
  private val main = Handler(Looper.getMainLooper())
  private val surfaceView = SurfaceView(context)

  var source: MpvSource? = null
  var paused = false
  var speed = 1.0
  var audioTrack = "auto"
  var subtitleTrack = "auto"
  var resizeMode = "contain"
  var decode = "hard"

  private var initialized = false
  private var initFailed = false
  private var released = false
  private var surfaceAttached = false
  private var loadedUrl: String? = null
  private var fileLoaded = false

  @Volatile private var duration = 0.0
  @Volatile private var buffered = 0.0
  @Volatile private var lastProgressAt = 0L
  @Volatile private var lastLog: String? = null

  init {
    surfaceView.holder.addCallback(this)
    addView(surfaceView, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
  }

  fun applyProps() {
    val src = source ?: return
    if (released || initFailed) return
    if (!initialized && !initialize()) return
    setProperty("pause", yesNo(paused))
    setProperty("speed", speed.toString())
    setProperty("hwdec", hwdec())
    applyResizeMode()
    if (src.url != loadedUrl) load(src)
    if (fileLoaded) applyTracks()
  }

  fun seek(ms: Double) {
    if (!initialized) return
    val seconds = (ms / 1000.0).coerceAtLeast(0.0).toString()
    if (fileLoaded) command("seek", seconds, "absolute") else setProperty("start", seconds)
  }

  fun release() {
    if (released) return
    released = true
    surfaceView.holder.removeCallback(this)
    MpvSession.release(this)
  }

  /** Called by [MpvSession] before destroying the native instance; returns whether mpv was initialized. */
  internal fun detachNative(): Boolean {
    val wasInitialized = initialized
    MPVLib.removeObserver(this)
    MPVLib.removeLogObserver(this)
    if (surfaceAttached) runCatching { MPVLib.detachSurface() }
    surfaceAttached = false
    initialized = false
    fileLoaded = false
    loadedUrl = null
    return wasInitialized
  }

  private fun initialize(): Boolean {
    if (!MpvLibrary.load()) {
      failInit("load-library", "mpv native libraries are not available on this device")
      return false
    }
    if (!MpvSession.acquire(this)) return false
    try {
      MPVLib.create(context.applicationContext)
      MPVLib.addLogObserver(this)
      setPreInitOptions()
      MPVLib.init()
      initialized = true
      MPVLib.addObserver(this)
      observeProperties()
      attachSurface()
      return true
    } catch (e: Throwable) {
      MpvSession.release(this)
      failInit("initialize", e.message ?: e.toString())
      return false
    }
  }

  private fun setPreInitOptions() {
    val configDir = File(context.filesDir, "mpv").apply { mkdirs() }
    option("config", "yes")
    option("config-dir", configDir.absolutePath)
    option("vo", "gpu")
    option("gpu-context", "android")
    option("opengl-es", "yes")
    option("ao", "audiotrack,opensles")
    option("hwdec", hwdec())
    option("hwdec-codecs", "h264,hevc,mpeg4,mpeg2video,vp8,vp9,av1,vc1")
    option("force-window", "no")
    option("keepaspect", "yes")
    option("ytdl", "no")
    option("profile", "fast")
    option("cache", "yes")
    option("demuxer-max-bytes", "64MiB")
    option("demuxer-max-back-bytes", "32MiB")
  }

  private fun observeProperties() {
    MPVLib.observeProperty("time-pos", MpvFormat.MPV_FORMAT_DOUBLE)
    MPVLib.observeProperty("duration", MpvFormat.MPV_FORMAT_DOUBLE)
    MPVLib.observeProperty("demuxer-cache-time", MpvFormat.MPV_FORMAT_DOUBLE)
    MPVLib.observeProperty("pause", MpvFormat.MPV_FORMAT_FLAG)
    MPVLib.observeProperty("paused-for-cache", MpvFormat.MPV_FORMAT_FLAG)
    MPVLib.observeProperty("track-list", MpvFormat.MPV_FORMAT_NONE)
  }

  private fun load(src: MpvSource) {
    loadedUrl = src.url
    fileLoaded = false
    lastLog = null
    setProperty("start", if (src.startPosition > 0) src.startPosition.toString() else "none")
    setProperty("force-media-title", src.title ?: "")
    applyHeaders(src.headers)
    setProperty("demuxer-lavf-format", if (isHlsHint(src)) "hls" else "")
    command("loadfile", src.url, "replace")
  }

  private fun applyHeaders(headers: Map<String, String>) {
    command("change-list", "http-header-fields", "clr", "")
    for ((name, value) in headers) {
      when (name.lowercase()) {
        "user-agent" -> setProperty("user-agent", value)
        "referer", "referrer" -> setProperty("referrer", value)
        else -> command("change-list", "http-header-fields", "append", "$name: $value")
      }
    }
  }

  private fun isHlsHint(src: MpvSource): Boolean {
    val format = src.format?.lowercase() ?: return false
    val path = src.url.substringBefore('?').lowercase()
    return (format.contains("mpegurl") || format.contains("m3u8")) && !path.endsWith(".m3u8")
  }

  private fun applyTracks() {
    setProperty("aid", audioTrack)
    setProperty("sid", subtitleTrack)
  }

  private fun applyResizeMode() {
    when (resizeMode) {
      "cover" -> {
        setProperty("keepaspect", "yes")
        setProperty("panscan", "1.0")
      }
      "stretch", "fill" -> {
        setProperty("keepaspect", "no")
        setProperty("panscan", "0.0")
      }
      else -> {
        setProperty("keepaspect", "yes")
        setProperty("panscan", "0.0")
      }
    }
  }

  private fun onFileLoaded() {
    fileLoaded = true
    source?.subtitles?.forEach { sub ->
      command("sub-add", sub.url, "auto", sub.name, sub.lang ?: "")
    }
    applyTracks()
    duration = MPVLib.getPropertyDouble("duration") ?: 0.0
    emit(mapOf("type" to "loaded", "duration" to duration, "tracks" to readTracks()))
  }

  private fun readTracks(): List<Map<String, Any?>> {
    val count = MPVLib.getPropertyInt("track-list/count") ?: 0
    return (0 until count).mapNotNull { i ->
      val type = MPVLib.getPropertyString("track-list/$i/type") ?: return@mapNotNull null
      mapOf(
        "id" to (MPVLib.getPropertyInt("track-list/$i/id") ?: return@mapNotNull null),
        "type" to type,
        "title" to MPVLib.getPropertyString("track-list/$i/title"),
        "lang" to MPVLib.getPropertyString("track-list/$i/lang"),
        "codec" to MPVLib.getPropertyString("track-list/$i/codec"),
        "selected" to (MPVLib.getPropertyBoolean("track-list/$i/selected") ?: false),
        "external" to (MPVLib.getPropertyBoolean("track-list/$i/external") ?: false),
      )
    }
  }

  private fun attachSurface() {
    if (!initialized || surfaceAttached) return
    val surface = surfaceView.holder.surface ?: return
    if (!surface.isValid) return
    MPVLib.attachSurface(surface)
    surfaceAttached = true
    val frame = surfaceView.holder.surfaceFrame
    if (frame.width() > 0 && frame.height() > 0) setProperty("android-surface-size", "${frame.width()}x${frame.height()}")
    setProperty("force-window", "yes")
  }

  override fun surfaceCreated(holder: SurfaceHolder) {
    attachSurface()
  }

  override fun surfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) {
    if (surfaceAttached) setProperty("android-surface-size", "${width}x$height")
  }

  override fun surfaceDestroyed(holder: SurfaceHolder) {
    if (!surfaceAttached) return
    surfaceAttached = false
    runCatching { MPVLib.detachSurface() }
  }

  // MPVLib.EventObserver (mpv event thread)

  override fun eventProperty(property: String) {
    if (property == "track-list") post { if (fileLoaded) emit(mapOf("type" to "tracks", "tracks" to readTracks())) }
  }

  override fun eventProperty(property: String, value: Long) {}

  override fun eventProperty(property: String, value: Boolean) {
    when (property) {
      "pause" -> post { emit(mapOf("type" to "pause", "value" to value)) }
      "paused-for-cache" -> post { emit(mapOf("type" to "buffering", "value" to value)) }
    }
  }

  override fun eventProperty(property: String, value: String?) {}

  override fun eventProperty(property: String, value: Double) {
    when (property) {
      "duration" -> duration = value
      "demuxer-cache-time" -> buffered = value
      "time-pos" -> {
        val now = SystemClock.elapsedRealtime()
        if (now - lastProgressAt < PROGRESS_INTERVAL_MS) return
        lastProgressAt = now
        val event = mapOf("type" to "progress", "position" to value, "duration" to duration, "buffered" to buffered)
        post { emit(event) }
      }
    }
  }

  override fun event(eventId: Int) {
    when (eventId) {
      MpvEvent.MPV_EVENT_FILE_LOADED -> post { onFileLoaded() }
      MpvEvent.MPV_EVENT_SEEK -> post { emit(mapOf("type" to "buffering", "value" to true)) }
      MpvEvent.MPV_EVENT_PLAYBACK_RESTART -> post { emit(mapOf("type" to "buffering", "value" to false)) }
    }
  }

  override fun eventEndFile(reason: Int, error: Int, errorString: String?) {
    if (reason != MpvEndFileReason.MPV_END_FILE_REASON_EOF && reason != MpvEndFileReason.MPV_END_FILE_REASON_ERROR) return
    val event = mapOf(
      "type" to "endFile",
      "reason" to reason,
      "code" to error,
      "message" to (errorString ?: ""),
      "log" to lastLog,
    )
    post { emit(event) }
  }

  // MPVLib.LogObserver

  override fun logMessage(prefix: String?, level: Int, text: String?) {
    if (level <= LOG_LEVEL_WARN && !text.isNullOrBlank()) lastLog = "$prefix: ${text.trim()}"
  }

  private fun failInit(code: String, message: String) {
    initFailed = true
    emit(mapOf("type" to "error", "phase" to "init", "code" to code, "message" to message))
  }

  private fun post(block: () -> Unit) {
    main.post { if (initialized && !released) block() }
  }

  private fun emit(event: Map<String, Any?>) {
    onMpvEvent(event)
  }

  private fun hwdec() = if (decode == "soft") "no" else "mediacodec,mediacodec-copy"

  private fun option(name: String, value: String) {
    MPVLib.setOptionString(name, value)
  }

  private fun setProperty(name: String, value: String) {
    command("set", name, value)
  }

  private fun command(vararg args: String) {
    MPVLib.enqueueCommand(0, arrayOf(*args))
  }

  private companion object {
    const val PROGRESS_INTERVAL_MS = 250L
    const val LOG_LEVEL_WARN = 30

    fun yesNo(value: Boolean) = if (value) "yes" else "no"
  }
}
