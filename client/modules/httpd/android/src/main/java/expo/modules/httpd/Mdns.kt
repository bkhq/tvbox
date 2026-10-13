package expo.modules.httpd

import android.content.Context
import android.net.wifi.WifiManager
import android.util.Log
import java.io.IOException
import java.net.Inet4Address
import java.net.InetAddress
import java.net.NetworkInterface
import javax.jmdns.JmDNS
import javax.jmdns.ServiceInfo

/**
 * Announces `<name>.local` with an `_http._tcp` service named `<name>` on every up, non-loopback,
 * multicast IPv4 interface. JmDNS renames on conflicts (`tvbox-2`, ...).
 */
internal class Mdns(private val context: Context) {

  private val instances = mutableListOf<JmDNS>()
  private var lock: WifiManager.MulticastLock? = null

  @Synchronized
  fun start(name: String, port: Int) {
    stop()
    acquireLock()
    for (address in addresses()) {
      try {
        val jmdns = JmDNS.create(address, name)
        jmdns.registerService(ServiceInfo.create(SERVICE_TYPE, name, port, "path=/"))
        instances.add(jmdns)
      } catch (e: IOException) {
        Log.w(TAG, "mDNS on $address failed", e)
      }
    }
    if (instances.isEmpty()) releaseLock()
  }

  @Synchronized
  fun stop() {
    for (jmdns in instances) {
      try {
        jmdns.unregisterAllServices()
        jmdns.close()
      } catch (e: IOException) {
        Log.w(TAG, "mDNS close failed", e)
      }
    }
    instances.clear()
    releaseLock()
  }

  private fun addresses(): List<InetAddress> = try {
    NetworkInterface.getNetworkInterfaces()?.toList().orEmpty()
      .filter { it.isUp && !it.isLoopback && !it.isPointToPoint && it.supportsMulticast() }
      .flatMap { face -> face.inetAddresses.toList().filterIsInstance<Inet4Address>() }
  } catch (e: Exception) {
    Log.w(TAG, "Listing interfaces failed", e)
    emptyList()
  }

  private fun acquireLock() {
    val wifi = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager ?: return
    // Best effort: mDNS still works on most devices without the lock.
    lock = try {
      wifi.createMulticastLock("mdns").apply {
        setReferenceCounted(false)
        acquire()
      }
    } catch (e: SecurityException) {
      e.printStackTrace()
      null
    }
  }

  private fun releaseLock() {
    lock?.takeIf { it.isHeld }?.release()
    lock = null
  }

  private companion object {
    const val TAG = "Httpd"
    const val SERVICE_TYPE = "_http._tcp.local."
  }
}
