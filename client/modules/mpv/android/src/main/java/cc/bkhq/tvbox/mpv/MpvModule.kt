package cc.bkhq.tvbox.mpv

import android.util.Log
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

class MpvModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("Mpv")

    Function("isAvailable") { MpvLibrary.load() }

    View(MpvView::class) {
      Events("onMpvEvent")

      Prop("source") { view: MpvView, source: MpvSource? -> view.source = source }
      Prop("paused") { view: MpvView, paused: Boolean -> view.paused = paused }
      Prop("speed") { view: MpvView, speed: Double -> view.speed = speed }
      Prop("audioTrack") { view: MpvView, track: String -> view.audioTrack = track }
      Prop("subtitleTrack") { view: MpvView, track: String -> view.subtitleTrack = track }
      Prop("resizeMode") { view: MpvView, mode: String -> view.resizeMode = mode }
      Prop("decode") { view: MpvView, decode: String -> view.decode = decode }

      OnViewDidUpdateProps { view: MpvView -> view.applyProps() }
      OnViewDestroys { view: MpvView -> view.release() }

      AsyncFunction("seek") { view: MpvView, ms: Double -> view.seek(ms) }
    }
  }
}

/** libmpv + the libplayer JNI bridge; only shipped for arm64-v8a and armeabi-v7a. */
internal object MpvLibrary {
  private val loaded: Boolean by lazy {
    try {
      System.loadLibrary("mpv")
      System.loadLibrary("player")
      true
    } catch (e: Throwable) {
      Log.w("Mpv", "mpv native libraries are not available", e)
      false
    }
  }

  fun load(): Boolean = loaded
}

class MpvSubtitle : Record {
  @Field var url: String = ""
  @Field var name: String = ""
  @Field var lang: String? = null
}

class MpvSource : Record {
  @Field var url: String = ""
  @Field var headers: Map<String, String> = emptyMap()
  @Field var title: String? = null
  /** Seconds. */
  @Field var startPosition: Double = 0.0
  @Field var format: String? = null
  @Field var subtitles: List<MpvSubtitle> = emptyList()
}
