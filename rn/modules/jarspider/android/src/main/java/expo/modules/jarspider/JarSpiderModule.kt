package expo.modules.jarspider

import android.util.Base64
import com.github.catvod.Init
import com.github.catvod.crawler.Spider
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONArray
import org.json.JSONObject
import java.io.InputStream
import java.lang.reflect.InvocationTargetException
import java.util.concurrent.Executors

private class NoSpiderException(key: String) : IllegalStateException("No JAR spider for site $key")

class JarSpiderModule : Module() {
  // Spider calls block on network I/O: keep them off the JS thread and off the
  // shared Expo modules queue.
  private val executor = Executors.newCachedThreadPool { runnable ->
    Thread(runnable, "jarspider").apply { isDaemon = true }
  }

  override fun definition() = ModuleDefinition {
    Name("JarSpider")

    OnCreate {
      appContext.reactContext?.applicationContext?.let { Init.set(it) }
    }

    Function("setProxyPort") { port: Int ->
      com.github.catvod.Proxy.set(port)
    }

    Function("setRecent") { jar: String ->
      JarLoader.setRecent(jar)
    }

    AsyncFunction("loadJar") { jar: String, recent: Boolean, promise: Promise ->
      run(promise, LOAD) { JarLoader.loadJar(jar, recent) }
    }

    AsyncFunction("initSpider") { key: String, api: String, ext: String, jar: String, promise: Promise ->
      run(promise, LOAD) {
        JarLoader.getSpider(key, api, ext, jar) ?: throw IllegalStateException("Spider $key ($api) is not loadable")
        null
      }
    }

    AsyncFunction("homeContent") { key: String, filter: Boolean, promise: Promise ->
      call(promise, key) { it.homeContent(filter) }
    }

    AsyncFunction("homeVideoContent") { key: String, promise: Promise ->
      call(promise, key) { it.homeVideoContent() }
    }

    AsyncFunction("categoryContent") { key: String, tid: String, pg: String, filter: Boolean, extendJson: String, promise: Promise ->
      call(promise, key) { it.categoryContent(tid, pg, filter, HashMap(stringMap(JSONObject(extendJson)))) }
    }

    AsyncFunction("detailContent") { key: String, idsJson: String, promise: Promise ->
      call(promise, key) { it.detailContent(stringList(idsJson)) }
    }

    AsyncFunction("searchContent") { key: String, keyword: String, quick: Boolean, pg: String, promise: Promise ->
      call(promise, key) { it.searchContent(keyword, quick, pg) }
    }

    AsyncFunction("playerContent") { key: String, flag: String, id: String, vipFlagsJson: String, promise: Promise ->
      call(promise, key) { it.playerContent(flag, id, stringList(vipFlagsJson)) }
    }

    AsyncFunction("proxy") { paramsJson: String, promise: Promise ->
      run(promise, CALL) {
        JarProxy.handle(stringMap(JSONObject(paramsJson)))?.let(::toResult)
      }
    }

    AsyncFunction("jsonExt") { key: String, jxsJson: String, url: String, promise: Promise ->
      run(promise, CALL) {
        JarLoader.jsonExt(key, stringMap(JSONObject(jxsJson)), url).toString()
      }
    }

    AsyncFunction("jsonExtMix") { flag: String, key: String, name: String, jxsJson: String, url: String, promise: Promise ->
      run(promise, CALL) {
        val json = JSONObject(jxsJson)
        val jxs = LinkedHashMap<String, HashMap<String, String>>()
        json.keys().forEach { jxs[it] = HashMap(stringMap(json.getJSONObject(it))) }
        JarLoader.jsonExtMix(flag, key, name, jxs, url).toString()
      }
    }

    AsyncFunction("destroySpider") { key: String, promise: Promise ->
      run(promise, CALL) {
        JarLoader.destroySpider(key)
        null
      }
    }

    AsyncFunction("clear") { promise: Promise ->
      run(promise, CALL) {
        JarLoader.clear()
        null
      }
    }

    OnDestroy {
      executor.shutdown()
    }
  }

  private fun run(promise: Promise, code: String, block: () -> Any?) {
    executor.execute {
      appContext.reactContext?.applicationContext?.let { Init.set(it) }
      val result = try {
        block()
      } catch (e: Throwable) {
        val cause = if (e is InvocationTargetException) e.targetException ?: e else e
        promise.reject(if (cause is NoSpiderException) NO_SPIDER else code, cause.message ?: cause.toString(), cause)
        return@execute
      }
      promise.resolve(result)
    }
  }

  private fun call(promise: Promise, key: String, block: (Spider) -> String?) =
    run(promise, CALL) {
      val spider = JarLoader.site(key) ?: throw NoSpiderException(key)
      block(spider) ?: ""
    }

  private fun toResult(rs: Array<Any?>): Map<String, Any> {
    if (rs.size < 3 || rs[0] !is Number) throw IllegalStateException("Invalid proxy response")
    val headers = (rs.getOrNull(3) as? Map<*, *>)
      ?.entries
      ?.filter { it.key != null && it.value != null }
      ?.associate { it.key.toString() to it.value.toString() }
      .orEmpty()
    val body = (rs[2] as? InputStream)?.use { it.readBytes() } ?: ByteArray(0)
    return mapOf(
      "status" to (rs[0] as Number).toInt(),
      "mime" to (rs[1]?.toString() ?: ""),
      "headers" to headers,
      "body" to Base64.encodeToString(body, Base64.NO_WRAP),
    )
  }

  private fun stringMap(json: JSONObject): LinkedHashMap<String, String> {
    val map = LinkedHashMap<String, String>()
    json.keys().forEach { map[it] = json.optString(it) }
    return map
  }

  private fun stringList(json: String): List<String> {
    val array = JSONArray(json)
    return (0 until array.length()).map { array.optString(it) }
  }

  private companion object {
    const val LOAD = "ERR_JARSPIDER_LOAD"
    const val NO_SPIDER = "ERR_JARSPIDER_NO_SPIDER"
    const val CALL = "ERR_JARSPIDER_CALL"
  }
}
