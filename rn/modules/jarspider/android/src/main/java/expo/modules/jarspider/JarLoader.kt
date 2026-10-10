package expo.modules.jarspider

import android.content.Context
import android.util.Log
import com.github.catvod.Init
import com.github.catvod.crawler.Spider
import com.github.catvod.net.OkHttp
import com.github.catvod.utils.Path
import com.github.catvod.utils.Util
import dalvik.system.DexClassLoader
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.lang.reflect.Method
import java.util.concurrent.ConcurrentHashMap

/**
 * Port of the Java app's JarLoader plus the JAR part of BaseLoader
 * (app/src/main/java/com/fongmi/android/tv/api/loader/). Process-wide, like
 * BaseLoader.get(), so the httpd proxy can reach it through [JarProxy].
 */
object JarLoader {
  private const val TAG = "JarSpider"

  private val loaders = ConcurrentHashMap<String, DexClassLoader>()
  private val methods = ConcurrentHashMap<String, Method>()
  private val spiders = ConcurrentHashMap<String, Spider>()
  private val locks = ConcurrentHashMap<String, Any>()

  // siteKey -> spider of the last initSpider call for that key (BaseLoader.getSpider(key)).
  private val sites = ConcurrentHashMap<String, Spider>()

  @Volatile
  private var recent: String? = null

  private val context: Context
    get() = Init.context() ?: throw IllegalStateException("Context is not available")

  fun clear() {
    spiders.values.forEach(::destroy)
    loaders.clear()
    methods.clear()
    spiders.clear()
    sites.clear()
    locks.clear()
    recent = null
  }

  fun destroySpider(key: String) {
    val spider = sites.remove(key) ?: return
    spiders.entries.removeIf { it.value === spider }
    destroy(spider)
  }

  private fun destroy(spider: Spider) {
    try {
      spider.destroy()
    } catch (e: Throwable) {
      Log.w(TAG, "destroy failed", e)
    }
  }

  fun setRecent(jar: String) {
    recent = Util.md5(jar)
  }

  /** BaseLoader.parseJar: true when a loader exists for the jar afterwards. */
  fun loadJar(jar: String, recent: Boolean): Boolean {
    if (jar.isEmpty()) return false
    val key = Util.md5(jar)
    try {
      parseJar(key, jar)
    } catch (e: Throwable) {
      Log.w(TAG, "parseJar failed: $jar", e)
    }
    if (recent) this.recent = key
    return loaders.containsKey(key)
  }

  private fun load(key: String, file: File) {
    if (Thread.interrupted()) return
    if (!Path.exists(file) || !file.setReadOnly()) return
    val cachePath = Path.jar().absolutePath
    val loader = DexClassLoader(file.absolutePath, cachePath, cachePath, context.classLoader)
    invokeInit(loader)
    invokeProxy(key, loader)
    loaders[key] = loader
  }

  private fun invokeInit(loader: DexClassLoader) {
    try {
      val clz = loader.loadClass("com.github.catvod.spider.Init")
      clz.getMethod("init", Context::class.java).invoke(clz, context)
    } catch (e: Throwable) {
      Log.w(TAG, "Init.init failed", e)
    }
  }

  private fun invokeProxy(key: String, loader: DexClassLoader) {
    try {
      val clz = loader.loadClass("com.github.catvod.spider.Proxy")
      methods[key] = clz.getMethod("proxy", Map::class.java)
    } catch (e: Throwable) {
      Log.w(TAG, "Proxy.proxy not found", e)
    }
  }

  private fun parseJar(key: String, jar: String) {
    if (loaders.containsKey(key)) return
    // "assets" jars (UrlUtil.convert in the Java app) are not supported.
    if (jar.startsWith("assets")) return
    val lock = locks.computeIfAbsent(key) { Any() }
    synchronized(lock) {
      if (loaders.containsKey(key)) return
      val texts = jar.split(";md5;")
      var md5 = if (texts.size > 1) texts[1].trim() else ""
      if (md5.startsWith("http")) md5 = OkHttp.string(md5).trim()
      val url = texts[0]
      if (md5.isNotEmpty() && Util.equals(url, md5)) {
        load(key, Path.jar(url))
      } else if (url.startsWith("http")) {
        load(key, download(url, Path.jar(url)))
      } else if (url.startsWith("file")) {
        load(key, Path.local(url))
      }
    }
  }

  // Download.create(url, file).get() of the Java app.
  private fun download(url: String, file: File): File {
    try {
      OkHttp.newCall(url, url).execute().use { res ->
        res.body.byteStream().use { input ->
          FileOutputStream(Path.create(file)).use { output ->
            val buffer = ByteArray(16384)
            while (true) {
              val read = input.read(buffer)
              if (read == -1) break
              if (Thread.interrupted()) break
              output.write(buffer, 0, read)
            }
          }
        }
      }
      return file
    } catch (e: Exception) {
      Path.clear(file)
      throw RuntimeException(e.message, e)
    }
  }

  /**
   * JarLoader.getSpider. Returns null where the Java app would return
   * SpiderNull; unlike the Java app the failure is not cached, so a later call
   * retries.
   */
  fun getSpider(key: String, api: String, ext: String, jar: String): Spider? {
    val jaKey = Util.md5(jar)
    val spKey = jaKey + key
    val spider = spiders[spKey] ?: synchronized(locks.computeIfAbsent(spKey) { Any() }) {
      spiders[spKey] ?: createSpider(key, api, ext, jar, jaKey)?.also { spiders[spKey] = it }
    }
    if (spider != null) sites[key] = spider
    return spider
  }

  private fun createSpider(key: String, api: String, ext: String, jar: String, jaKey: String): Spider? {
    return try {
      parseJar(jaKey, jar)
      val loader = loaders[jaKey] ?: return null
      val spider = loader.loadClass("com.github.catvod.spider." + api.split("csp_")[1]).getDeclaredConstructor().newInstance() as Spider
      spider.siteKey = key
      spider.init(context, ext)
      spider
    } catch (e: Throwable) {
      Log.w(TAG, "getSpider failed: $key", e)
      null
    }
  }

  fun site(key: String): Spider? = sites[key]

  private fun requireRecentLoader(): DexClassLoader =
    recent?.let { loaders[it] } ?: throw IllegalStateException("No jar loaded for recent key: $recent")

  fun jsonExt(key: String, jxs: LinkedHashMap<String, String>, url: String): JSONObject {
    val clz = requireRecentLoader().loadClass("com.github.catvod.parser.Json$key")
    val method = clz.getMethod("parse", LinkedHashMap::class.java, String::class.java)
    return method.invoke(null, jxs, url) as JSONObject
  }

  fun jsonExtMix(flag: String, key: String, name: String, jxs: LinkedHashMap<String, HashMap<String, String>>, url: String): JSONObject {
    val clz = requireRecentLoader().loadClass("com.github.catvod.parser.Mix$key")
    val method = clz.getMethod("parse", LinkedHashMap::class.java, String::class.java, String::class.java, String::class.java)
    return method.invoke(null, jxs, name, flag, url) as JSONObject
  }

  /** BaseLoader.proxy restricted to JAR spiders; see [JarProxy.handle]. */
  fun proxy(params: Map<String, String>): Array<Any?>? {
    val siteKey = params["siteKey"]
    if (siteKey != null) {
      @Suppress("UNCHECKED_CAST")
      return sites[siteKey]?.proxy(params) as Array<Any?>?
    }
    if (params["do"] == "js") return null
    val current = recent
    val method = if (current != null) methods[current] else null
    proxyInvoke(method, params)?.let { return it }
    return methods.entries.asSequence()
      .filter { it.key != current }
      .mapNotNull { proxyInvoke(it.value, params) }
      .firstOrNull()
  }

  private fun proxyInvoke(method: Method?, params: Map<String, String>): Array<Any?>? {
    return try {
      @Suppress("UNCHECKED_CAST")
      method?.invoke(null, params) as Array<Any?>?
    } catch (e: Throwable) {
      Log.w(TAG, "proxy failed", e)
      null
    }
  }
}
