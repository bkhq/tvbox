package cc.bkhq.tvbox.airplay

import android.content.Context
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class AirPlayModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  private val listener = object : AirPlay.CastListener {
    override fun onPlay(url: String, positionMs: Long) =
      sendEvent(EVENT, mapOf("type" to "play", "url" to url, "position" to positionMs.toDouble()))

    override fun onPause() = sendEvent(EVENT, mapOf("type" to "pause"))

    override fun onResume() = sendEvent(EVENT, mapOf("type" to "resume"))

    override fun onStop() = sendEvent(EVENT, mapOf("type" to "stop"))

    override fun onSeek(positionMs: Long) =
      sendEvent(EVENT, mapOf("type" to "seek", "position" to positionMs.toDouble()))
  }

  override fun definition() = ModuleDefinition {
    Name("AirPlay")

    Events(EVENT)

    OnCreate { AirPlay.get().setListener(listener) }

    OnDestroy {
      AirPlay.get().setListener(null)
      AirPlay.get().stop()
    }

    Function("isSupported") { AirPlay.isTv(context) }

    AsyncFunction("start") { name: String -> AirPlay.get().start(context, name) }

    AsyncFunction("stop") { AirPlay.get().stop() }

    Function("updatePlayback") { position: Double, duration: Double, playing: Boolean, rate: Double ->
      AirPlay.get().updatePlayback(position, duration, playing, rate)
    }
  }

  companion object {
    private const val EVENT = "onCast"
  }
}
