package expo.modules.httpd

import java.io.ByteArrayOutputStream
import java.io.File

/** Thrown while reading a request; answered with [status] before the connection closes. */
internal class HttpError(val status: Int, message: String) : Exception(message)

internal class Upload(val file: File, val name: String) {
  fun toMap(): Map<String, Any> = mapOf("path" to file.path, "name" to name, "size" to file.length().toDouble())
}

internal class Request(
  val id: String,
  val method: String,
  val path: String,
  val query: Map<String, String>,
  val form: Map<String, String>,
  val files: Map<String, Upload>,
  val headers: Map<String, String>,
  val body: String,
  val remoteAddress: String,
) {
  fun toMap(): Map<String, Any?> = mapOf(
    "id" to id,
    "method" to method,
    "path" to path,
    "query" to query,
    "form" to form,
    "files" to files.mapValues { it.value.toMap() },
    "headers" to headers,
    "body" to body,
    "remoteAddress" to remoteAddress,
  )
}

internal class Response(
  val status: Int,
  val headers: Map<String, String> = emptyMap(),
  val body: ByteArray = ByteArray(0),
  val file: File? = null,
) {
  companion object {
    fun text(status: Int, text: String) =
      Response(status, mapOf("Content-Type" to "text/plain; charset=utf-8"), text.toByteArray())
  }
}

internal object Http {
  private val REASONS = mapOf(
    200 to "OK", 201 to "Created", 204 to "No Content", 206 to "Partial Content",
    301 to "Moved Permanently", 302 to "Found", 304 to "Not Modified", 307 to "Temporary Redirect",
    400 to "Bad Request", 401 to "Unauthorized", 403 to "Forbidden", 404 to "Not Found",
    405 to "Method Not Allowed", 411 to "Length Required", 413 to "Content Too Large",
    416 to "Range Not Satisfiable", 431 to "Request Header Fields Too Large",
    500 to "Internal Server Error", 501 to "Not Implemented", 503 to "Service Unavailable",
    504 to "Gateway Timeout",
  )

  fun reason(status: Int): String = REASONS[status] ?: "Status $status"

  /** Lenient percent-decoding as UTF-8; malformed escapes are kept literally. */
  fun decode(value: String, plusAsSpace: Boolean): String {
    if (value.indexOf('%') < 0 && !(plusAsSpace && value.indexOf('+') >= 0)) return value
    val out = ByteArrayOutputStream(value.length)
    var plain = 0
    var i = 0
    while (i < value.length) {
      val c = value[i]
      val hi = if (c == '%' && i + 2 < value.length) Character.digit(value[i + 1], 16) else -1
      val lo = if (hi >= 0) Character.digit(value[i + 2], 16) else -1
      if (lo >= 0 || (c == '+' && plusAsSpace)) {
        out.write(value.substring(plain, i).toByteArray())
        out.write(if (lo >= 0) hi * 16 + lo else ' '.code)
        i += if (lo >= 0) 3 else 1
        plain = i
      } else {
        i++
      }
    }
    out.write(value.substring(plain).toByteArray())
    return out.toString("UTF-8")
  }

  /** Parses `a=1&b=2`; the last value of a repeated name wins. */
  fun parseQuery(query: String, into: MutableMap<String, String>) {
    for (pair in query.split('&')) {
      if (pair.isEmpty()) continue
      val eq = pair.indexOf('=')
      val name = decode(if (eq < 0) pair else pair.substring(0, eq), true)
      into[name] = if (eq < 0) "" else decode(pair.substring(eq + 1), true)
    }
  }

  /** Splits `type; a=1; b="x;y"` into the lower-case type and its parameters (lower-case names). */
  fun parseHeaderValue(value: String): Pair<String, Map<String, String>> {
    val parts = mutableListOf<String>()
    val current = StringBuilder()
    var quoted = false
    var i = 0
    while (i < value.length) {
      val c = value[i]
      when {
        c == '"' -> { quoted = !quoted; current.append(c) }
        c == '\\' && quoted && i + 1 < value.length -> { current.append(c).append(value[i + 1]); i++ }
        c == ';' && !quoted -> { parts.add(current.toString()); current.setLength(0) }
        else -> current.append(c)
      }
      i++
    }
    parts.add(current.toString())
    val params = mutableMapOf<String, String>()
    for (part in parts.drop(1)) {
      val eq = part.indexOf('=')
      if (eq < 0) continue
      var v = part.substring(eq + 1).trim()
      if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) {
        v = v.substring(1, v.length - 1).replace(Regex("\\\\(.)"), "$1")
      }
      params[part.substring(0, eq).trim().lowercase()] = v
    }
    return parts[0].trim().lowercase() to params
  }

  /**
   * Resolves a single `bytes=` range against [size]: null to ignore the header (malformed or
   * multiple ranges), an empty range when unsatisfiable.
   */
  fun parseRange(header: String, size: Long): LongRange? {
    val spec = header.trim()
    if (!spec.startsWith("bytes=", ignoreCase = true)) return null
    val range = spec.substring(6).trim()
    if (range.contains(',')) return null
    val dash = range.indexOf('-')
    if (dash < 0) return null
    val first = range.substring(0, dash).trim()
    val last = range.substring(dash + 1).trim()
    if (first.isEmpty()) {
      val suffix = last.toLongOrNull() ?: return null
      if (suffix <= 0 || size == 0L) return LongRange.EMPTY
      return maxOf(0L, size - suffix) until size
    }
    val start = first.toLongOrNull() ?: return null
    val end = if (last.isEmpty()) size - 1 else (last.toLongOrNull() ?: return null)
    if (start > end && last.isNotEmpty()) return null
    if (start >= size) return LongRange.EMPTY
    return start..minOf(end, size - 1)
  }
}
