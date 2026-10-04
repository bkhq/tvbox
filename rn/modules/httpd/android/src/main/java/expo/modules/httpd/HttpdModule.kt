package expo.modules.httpd

import android.content.Context
import android.media.AudioManager
import android.os.SystemClock
import android.util.Base64
import android.view.KeyEvent
import android.widget.EditText
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import java.io.File
import java.io.IOException
import java.net.Inet4Address
import java.net.NetworkInterface
import java.util.concurrent.Executors

class HttpdResponse : Record {
  @Field
  val status: Int = 200

  @Field
  val headers: Map<String, String>? = null

  @Field
  val body: String? = null

  @Field
  val bodyEncoding: String? = null

  @Field
  val filePath: String? = null
}

private class NoFreePortException(from: Int, to: Int) : CodedException("No free port in $from..$to")

class HttpdModule : Module() {
  private val lock = Any()
  private var server: HttpServer? = null
  private var mdns: Mdns? = null

  // Serialises slow JmDNS start/stop so a stop always follows the start it cancels.
  private val mdnsExecutor = Executors.newSingleThreadExecutor { runnable ->
    Thread(runnable, "httpd-mdns").apply { isDaemon = true }
  }

  private val context: Context
    get() = appContext.reactContext ?: throw IllegalStateException("React context is not available")

  override fun definition() = ModuleDefinition {
    Name("Httpd")

    Events("onRequest")

    AsyncFunction("startServer") { portFrom: Int, portTo: Int, mdnsName: String? ->
      synchronized(lock) {
        server?.let { return@AsyncFunction it.port }
        val cacheDir = File(context.cacheDir, "httpd").apply { mkdirs() }
        for (port in portFrom..portTo) {
          val candidate = HttpServer(cacheDir) { request -> sendEvent("onRequest", request.toMap()) }
          try {
            candidate.start(port)
          } catch (e: IOException) {
            candidate.stop()
            continue
          }
          server = candidate
          if (mdnsName != null) {
            val announcer = Mdns(context).also { mdns = it }
            mdnsExecutor.execute { announcer.start(mdnsName, port) }
          }
          return@AsyncFunction port
        }
        throw NoFreePortException(portFrom, portTo)
      }
    }

    AsyncFunction("stopServer") {
      stop()
    }

    Function("respond") { id: String, response: HttpdResponse ->
      server?.respond(id, toResponse(response))
    }

    Function("getLocalIpAddress") {
      localIpAddress()
    }

    AsyncFunction("sendKey") { key: String ->
      val code = KEYS[key] ?: return@AsyncFunction false
      val activity = appContext.currentActivity?.takeIf { it.hasWindowFocus() } ?: return@AsyncFunction false
      val now = SystemClock.uptimeMillis()
      activity.dispatchKeyEvent(KeyEvent(now, now, KeyEvent.ACTION_DOWN, code, 0))
      activity.dispatchKeyEvent(KeyEvent(now, SystemClock.uptimeMillis(), KeyEvent.ACTION_UP, code, 0))
      true
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("sendText") { text: String ->
      val activity = appContext.currentActivity?.takeIf { it.hasWindowFocus() } ?: return@AsyncFunction false
      val edit = activity.currentFocus as? EditText ?: return@AsyncFunction false
      edit.setText(text)
      edit.setSelection(edit.text.length)
      true
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("adjustVolume") { direction: String ->
      val adjust = when (direction) {
        "up" -> AudioManager.ADJUST_RAISE
        "down" -> AudioManager.ADJUST_LOWER
        "mute" -> AudioManager.ADJUST_TOGGLE_MUTE
        else -> return@AsyncFunction false
      }
      val audio = context.getSystemService(Context.AUDIO_SERVICE) as? AudioManager ?: return@AsyncFunction false
      audio.adjustStreamVolume(AudioManager.STREAM_MUSIC, adjust, AudioManager.FLAG_SHOW_UI)
      true
    }

    OnDestroy {
      stop()
      mdnsExecutor.shutdown()
    }
  }

  private fun stop() {
    val announcer: Mdns?
    synchronized(lock) {
      server?.stop()
      server = null
      announcer = mdns
      mdns = null
    }
    if (announcer != null) mdnsExecutor.submit { announcer.stop() }.get()
  }

  private fun toResponse(response: HttpdResponse): Response {
    val headers = response.headers.orEmpty()
    val path = response.filePath
    if (path != null) return Response(response.status, headers, file = File(path.removePrefix("file://")))
    val text = response.body.orEmpty()
    val body = if (response.bodyEncoding == "base64") {
      try {
        Base64.decode(text, Base64.DEFAULT)
      } catch (e: IllegalArgumentException) {
        return Response.text(500, "Invalid base64 body")
      }
    } else {
      text.toByteArray()
    }
    return Response(response.status, headers, body)
  }

  /** First IPv4 address of an up Wi-Fi / Ethernet interface, else any private IPv4 address. */
  private fun localIpAddress(): String? {
    val candidates = try {
      NetworkInterface.getNetworkInterfaces()?.toList().orEmpty()
        .filter { it.isUp && !it.isLoopback && !it.isPointToPoint }
        .flatMap { face -> face.inetAddresses.toList().filterIsInstance<Inet4Address>().map { face.name to it } }
    } catch (e: Exception) {
      emptyList()
    }
    val preferred = candidates.firstOrNull { (name, _) -> name.startsWith("wlan") || name.startsWith("eth") }
    return (preferred ?: candidates.firstOrNull { it.second.isSiteLocalAddress })?.second?.hostAddress
  }

  private companion object {
    val KEYS = mapOf(
      "up" to KeyEvent.KEYCODE_DPAD_UP,
      "down" to KeyEvent.KEYCODE_DPAD_DOWN,
      "left" to KeyEvent.KEYCODE_DPAD_LEFT,
      "right" to KeyEvent.KEYCODE_DPAD_RIGHT,
      "ok" to KeyEvent.KEYCODE_DPAD_CENTER,
      "back" to KeyEvent.KEYCODE_BACK,
      "menu" to KeyEvent.KEYCODE_MENU,
    )
  }
}
