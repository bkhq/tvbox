package cc.bkhq.tvbox.mpv

import android.os.Handler
import android.os.Looper
import `is`.xyz.mpv.MPVLib

/**
 * libplayer.so holds a single global mpv instance, so only one view owns it at a time. A new
 * owner releases the previous one; an initialized instance shuts down asynchronously
 * (MPV_EVENT_SHUTDOWN), and a view acquiring meanwhile is retried once it is gone.
 * Main thread only, except the event callbacks.
 */
internal object MpvSession : MPVLib.EventObserver {
  private const val SHUTDOWN_TIMEOUT_MS = 3000L

  private val main = Handler(Looper.getMainLooper())
  private var owner: MpvView? = null
  private var shuttingDown = false
  private var waiting: MpvView? = null
  private val shutdownTimeout = Runnable { onShutdown() }

  /** True when [view] may create the native instance now; otherwise it is retried later. */
  fun acquire(view: MpvView): Boolean {
    if (owner === view) return true
    owner?.let { release(it) }
    if (shuttingDown) {
      waiting = view
      return false
    }
    owner = view
    return true
  }

  fun release(view: MpvView) {
    if (waiting === view) waiting = null
    if (owner !== view) return
    owner = null
    val initialized = view.detachNative()
    if (initialized) {
      shuttingDown = true
      MPVLib.addObserver(this)
      main.postDelayed(shutdownTimeout, SHUTDOWN_TIMEOUT_MS)
    }
    val result = runCatching { MPVLib.destroy() }.getOrDefault(-1)
    if (initialized && result < 0) onShutdown()
  }

  private fun onShutdown() {
    main.removeCallbacks(shutdownTimeout)
    MPVLib.removeObserver(this)
    if (!shuttingDown) return
    shuttingDown = false
    val next = waiting ?: return
    waiting = null
    next.applyProps()
  }

  override fun event(eventId: Int) {
    if (eventId == MPVLib.MpvEvent.MPV_EVENT_SHUTDOWN) main.post { onShutdown() }
  }

  override fun eventProperty(property: String) {}

  override fun eventProperty(property: String, value: Long) {}

  override fun eventProperty(property: String, value: Boolean) {}

  override fun eventProperty(property: String, value: String?) {}

  override fun eventProperty(property: String, value: Double) {}

  override fun eventEndFile(reason: Int, error: Int, errorString: String?) {}
}
