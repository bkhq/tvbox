package cc.bkhq.tvbox.dlna

import android.content.Context
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class DlnaModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("Dlna")

    Events(EVENT)

    OnCreate { Dlna.get().setListener { event -> sendEvent(EVENT, event) } }

    OnDestroy {
      Dlna.get().setListener(null)
      appContext.reactContext?.let { Dlna.get().stop(it) }
    }

    Function("isSupported") { Dlna.isTv(context) }

    AsyncFunction("start") { name: String -> Dlna.get().start(context, name) }

    AsyncFunction("stop") { Dlna.get().stop(context) }

    Function("updatePlayback") { position: Double, duration: Double, playing: Boolean, ended: Boolean ->
      Dlna.get().updatePlayback(position, duration, playing, ended)
    }
  }

  companion object {
    private const val EVENT = "onCast"
  }
}
