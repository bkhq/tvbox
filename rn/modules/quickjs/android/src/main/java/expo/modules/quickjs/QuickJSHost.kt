package expo.modules.quickjs

import android.content.Context
import android.util.Base64
import android.util.Log
import okhttp3.FormBody
import okhttp3.Headers.Companion.toHeaders
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.nio.charset.Charset
import java.security.SecureRandom
import java.util.concurrent.TimeUnit

/**
 * Platform callbacks of the C bridge, called through JNI on a context
 * thread. Arguments and results are UTF-8 byte arrays. Methods never throw.
 */
internal class QuickJSHost(private val context: Context) {
  private val prefs = context.getSharedPreferences("quickjs_local", Context.MODE_PRIVATE)

  fun http(url: ByteArray, options: ByteArray): ByteArray =
    try {
      request(url.str(), JSONObject(options.str())).toString().toByteArray(Charsets.UTF_8)
    } catch (e: Throwable) {
      ERROR_JSON.toByteArray(Charsets.UTF_8)
    }

  fun localGet(key: ByteArray): ByteArray? = prefs.getString(key.str(), null)?.toByteArray(Charsets.UTF_8)

  fun localSet(key: ByteArray, value: ByteArray) {
    prefs.edit().putString(key.str(), value.str()).apply()
  }

  fun localDelete(key: ByteArray) {
    prefs.edit().remove(key.str()).apply()
  }

  fun log(level: ByteArray, message: ByteArray) {
    val text = message.str()
    when (level.str().lowercase()) {
      "e", "error" -> Log.e(TAG, text)
      "w", "warn" -> Log.w(TAG, text)
      "i", "info" -> Log.i(TAG, text)
      else -> Log.d(TAG, text)
    }
  }

  /** Bundled libraries are packaged as assets under quickjs/ (e.g. quickjs/lib/cat.js). */
  fun readAsset(path: ByteArray): ByteArray? =
    try {
      context.assets.open("quickjs/" + path.str()).use { it.readBytes() }
    } catch (e: IOException) {
      null
    }

  // Mirrors quickjs/.../utils/Connect.java and bean/Req.java of the Java app.
  private fun request(url: String, opts: JSONObject): JSONObject {
    val headers = stringMap(opts.optJSONObject("headers"))
    val timeout = if (opts.has("timeout") && !opts.isNull("timeout")) opts.optLong("timeout", DEFAULT_TIMEOUT) else DEFAULT_TIMEOUT
    val redirect = !opts.has("redirect") || opts.isNull("redirect") || opts.optInt("redirect", 1) != 0
    val buffer = opts.optInt("buffer", 0)
    val client = baseClient.newBuilder()
      .connectTimeout(timeout, TimeUnit.MILLISECONDS)
      .readTimeout(timeout, TimeUnit.MILLISECONDS)
      .writeTimeout(timeout, TimeUnit.MILLISECONDS)
      .followRedirects(redirect)
      .followSslRedirects(redirect)
      .build()

    val builder = Request.Builder().url(url).headers(headers.toHeaders())
    when (string(opts, "method").ifEmpty { "get" }.lowercase()) {
      "post" -> builder.post(postBody(opts, headers))
      "header" -> builder.head()
      else -> builder.get()
    }

    client.newCall(builder.build()).execute().use { res ->
      val resHeaders = JSONObject()
      for ((name, values) in res.headers.toMultimap()) {
        resHeaders.put(name, if (values.size == 1) values[0] else JSONArray(values))
      }
      val bytes = res.body?.bytes() ?: ByteArray(0)
      val content = if (buffer == 0) String(bytes, charset(headers)) else Base64.encodeToString(bytes, Base64.NO_WRAP)
      return JSONObject().put("code", res.code).put("headers", resHeaders).put("content", content)
    }
  }

  private fun postBody(opts: JSONObject, headers: Map<String, String>): RequestBody {
    val data = if (opts.has("data") && !opts.isNull("data")) opts.get("data") else null
    val postType = string(opts, "postType").ifEmpty { "json" }
    val body = if (opts.has("body") && !opts.isNull("body")) opts.optString("body") else null
    val contentType = headers["Content-Type"] ?: headers.entries.firstOrNull { it.key.equals("content-type", true) }?.value
    if (data != null && postType == "json") {
      val json = if (data is String) JSONObject.quote(data) else data.toString()
      return json.toRequestBody("application/json; charset=utf-8".toMediaType())
    }
    if (data != null && postType == "form") {
      val form = FormBody.Builder()
      for ((k, v) in stringMap(data as? JSONObject)) form.add(k, v)
      return form.build()
    }
    if (data != null && postType == "form-data") {
      val random = SecureRandom()
      val boundary = "--dio-boundary-" + random.nextInt(42949) + random.nextInt(67296)
      val multipart = MultipartBody.Builder(boundary).setType(MultipartBody.FORM)
      for ((k, v) in stringMap(data as? JSONObject)) multipart.addFormDataPart(k, v)
      return multipart.build()
    }
    if (body != null && contentType != null) return body.toRequestBody(contentType.toMediaTypeOrNull())
    return ByteArray(0).toRequestBody(null)
  }

  /** Req.getCharset(): charset of the request Content-Type header, else UTF-8. */
  private fun charset(headers: Map<String, String>): Charset {
    val type = headers["Content-Type"] ?: headers["content-type"] ?: return Charsets.UTF_8
    val name = type.split(";").firstOrNull { it.contains("charset=") }?.substringAfter("=")?.trim()
    return try {
      if (name.isNullOrEmpty()) Charsets.UTF_8 else Charset.forName(name)
    } catch (e: Exception) {
      Charsets.UTF_8
    }
  }

  private fun stringMap(obj: JSONObject?): Map<String, String> {
    if (obj == null) return emptyMap()
    val map = LinkedHashMap<String, String>()
    for (key in obj.keys()) {
      if (!obj.isNull(key)) map[key] = obj.get(key).toString()
    }
    return map
  }

  private fun string(obj: JSONObject, key: String): String = if (obj.isNull(key)) "" else obj.optString(key)

  private fun ByteArray.str() = String(this, Charsets.UTF_8)

  private companion object {
    const val TAG = "QuickJS"
    const val DEFAULT_TIMEOUT = 15000L
    const val ERROR_JSON = """{"code":"","headers":{},"content":""}"""
    val baseClient: OkHttpClient by lazy { OkHttpClient() }
  }
}
