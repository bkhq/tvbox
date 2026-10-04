package expo.modules.httpd

import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.io.RandomAccessFile
import java.net.Inet6Address
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CountDownLatch
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * One-request-per-connection HTTP/1.1 server. Each parsed request is handed to [onRequest] and
 * its connection thread waits for [respond] (or answers 504 after [RESPONSE_TIMEOUT_MS]).
 */
internal class HttpServer(private val cacheDir: File, private val onRequest: (Request) -> Unit) {

  private class Pending {
    val latch = CountDownLatch(1)

    @Volatile
    var response: Response? = null
  }

  private val pending = ConcurrentHashMap<String, Pending>()
  private val clients: MutableSet<Socket> = ConcurrentHashMap.newKeySet()
  private val executor: ExecutorService = Executors.newCachedThreadPool { runnable ->
    Thread(runnable, "httpd").apply { isDaemon = true }
  }
  private val serverSocket = ServerSocket()

  @Volatile
  private var stopped = false

  val port: Int get() = serverSocket.localPort

  /** Binds all interfaces on [port]; throws if the port is taken. */
  fun start(port: Int) {
    serverSocket.reuseAddress = true
    serverSocket.bind(InetSocketAddress(port), 64)
    Thread({ acceptLoop() }, "httpd-accept").apply { isDaemon = true }.start()
  }

  fun stop() {
    stopped = true
    runCatching { serverSocket.close() }
    for (id in pending.keys.toList()) respond(id, Response.text(503, "Server stopped"))
    for (client in clients) runCatching { client.close() }
    executor.shutdown()
  }

  fun respond(id: String, response: Response) {
    val waiting = pending.remove(id) ?: return
    waiting.response = response
    waiting.latch.countDown()
  }

  private fun acceptLoop() {
    while (!stopped) {
      val client = try {
        serverSocket.accept()
      } catch (e: IOException) {
        break
      }
      try {
        executor.execute { handle(client) }
      } catch (e: Exception) {
        runCatching { client.close() }
      }
    }
  }

  private fun handle(client: Socket) {
    clients.add(client)
    val tempFiles = mutableListOf<File>()
    try {
      client.soTimeout = READ_TIMEOUT_MS
      val input = BufferedInputStream(client.getInputStream(), BUFFER_SIZE)
      val output = BufferedOutputStream(client.getOutputStream(), BUFFER_SIZE)
      var method = "GET"
      var headers: Map<String, String> = emptyMap()
      val response = try {
        val request = read(client, input, output, tempFiles)
        method = request.method
        headers = request.headers
        dispatch(request)
      } catch (e: HttpError) {
        Response.text(e.status, e.message ?: Http.reason(e.status))
      }
      write(output, method, headers, response)
      output.flush()
    } catch (e: IOException) {
      // Client went away; nothing to answer.
    } finally {
      runCatching { client.close() }
      clients.remove(client)
      for (file in tempFiles) file.delete()
    }
  }

  private fun dispatch(request: Request): Response {
    if (stopped) return Response.text(503, "Server stopped")
    val waiting = Pending()
    pending[request.id] = waiting
    onRequest(request)
    if (!waiting.latch.await(RESPONSE_TIMEOUT_MS, TimeUnit.MILLISECONDS)) {
      pending.remove(request.id)
      return waiting.response ?: Response.text(504, "No response")
    }
    return waiting.response ?: Response.text(504, "No response")
  }

  private fun read(client: Socket, input: InputStream, output: OutputStream, tempFiles: MutableList<File>): Request {
    val lines = readHead(input).split("\r\n")
    val requestLine = lines[0].split(' ')
    if (requestLine.size != 3 || !requestLine[2].startsWith("HTTP/")) throw HttpError(400, "Malformed request line")
    val method = requestLine[0].uppercase()
    var target = requestLine[1]
    // Absolute-form targets (proxies) carry scheme and authority.
    if (target.startsWith("http://") || target.startsWith("https://")) {
      target = target.substring(target.indexOf('/', target.indexOf("//") + 2).let { if (it < 0) target.length else it })
    }
    val queryStart = target.indexOf('?')
    val rawPath = if (queryStart < 0) target else target.substring(0, queryStart)
    val path = Http.decode(rawPath.substringBefore('#'), false).ifEmpty { "/" }
    val query = LinkedHashMap<String, String>()
    if (queryStart >= 0) Http.parseQuery(target.substring(queryStart + 1).substringBefore('#'), query)

    val headers = LinkedHashMap<String, String>()
    for (line in lines.drop(1)) {
      val colon = line.indexOf(':')
      if (colon <= 0) continue
      val name = line.substring(0, colon).trim().lowercase()
      val value = line.substring(colon + 1).trim()
      headers[name] = headers[name]?.let { "$it, $value" } ?: value
    }

    val transferEncoding = headers["transfer-encoding"]
    if (transferEncoding != null && !transferEncoding.equals("identity", ignoreCase = true)) {
      throw HttpError(411, "Chunked request bodies are not supported; send Content-Length")
    }
    val length = headers["content-length"]?.let { it.toLongOrNull() ?: throw HttpError(400, "Invalid Content-Length") } ?: 0L
    if (length < 0) throw HttpError(400, "Invalid Content-Length")
    val (mime, params) = Http.parseHeaderValue(headers["content-type"] ?: "")
    val multipart = mime == "multipart/form-data"
    if (length > (if (multipart) MAX_UPLOAD else MAX_BODY)) throw HttpError(413, "Request body too large")
    if (length > 0 && headers["expect"].equals("100-continue", ignoreCase = true)) {
      output.write("HTTP/1.1 100 Continue\r\n\r\n".toByteArray())
      output.flush()
    }

    val form = LinkedHashMap<String, String>()
    var files: Map<String, Upload> = emptyMap()
    var body = ""
    if (multipart) {
      val boundary = params["boundary"]?.takeIf { it.isNotEmpty() } ?: throw HttpError(400, "Missing multipart boundary")
      val parser = MultipartParser(boundary, cacheDir, tempFiles, MAX_BODY.toInt())
      try {
        readBody(input, length) { chunk, count -> parser.feed(chunk, count) }
      } finally {
        parser.close()
      }
      if (!parser.isComplete) throw HttpError(400, "Malformed multipart body")
      form.putAll(parser.form)
      files = parser.files
    } else if (length > 0) {
      val bytes = ByteArrayOutputStream(length.toInt())
      readBody(input, length) { chunk, count -> bytes.write(chunk, 0, count) }
      val text = bytes.toString("UTF-8")
      if (mime == "application/x-www-form-urlencoded") Http.parseQuery(text, form) else body = text
    }

    return Request(
      id = UUID.randomUUID().toString(),
      method = method,
      path = path,
      query = query,
      form = form,
      files = files,
      headers = headers,
      body = body,
      remoteAddress = remoteAddress(client),
    )
  }

  private fun readHead(input: InputStream): String {
    val head = ByteArrayOutputStream(1024)
    var matched = 0
    while (matched < 4) {
      val b = input.read()
      if (b < 0) throw IOException("Connection closed before the request head")
      head.write(b)
      if (head.size() > MAX_HEAD) throw HttpError(431, "Request head too large")
      matched = when {
        b == '\r'.code && (matched == 0 || matched == 2) -> matched + 1
        b == '\n'.code && (matched == 1 || matched == 3) -> matched + 1
        b == '\r'.code -> 1
        else -> 0
      }
      // Tolerate blank lines before the request line.
      if (matched == 2 && head.size() == 2) {
        head.reset()
        matched = 0
      }
    }
    return head.toString("UTF-8").removeSuffix("\r\n\r\n")
  }

  private inline fun readBody(input: InputStream, length: Long, sink: (ByteArray, Int) -> Unit) {
    val chunk = ByteArray(BUFFER_SIZE)
    var remaining = length
    while (remaining > 0) {
      val count = input.read(chunk, 0, minOf(chunk.size.toLong(), remaining).toInt())
      if (count < 0) throw IOException("Connection closed before the request body ended")
      sink(chunk, count)
      remaining -= count
    }
  }

  private fun write(output: OutputStream, method: String, requestHeaders: Map<String, String>, response: Response) {
    var status = response.status
    val headers = LinkedHashMap<String, String>()
    for ((name, value) in response.headers) {
      if (name.lowercase() in HOP_HEADERS) continue
      headers[clean(name)] = clean(value)
    }
    var file: RandomAccessFile? = null
    var start = 0L
    var length = response.body.size.toLong()
    try {
      if (response.file != null) {
        file = try {
          RandomAccessFile(response.file, "r")
        } catch (e: IOException) {
          null
        }
        if (file == null || !response.file.isFile) {
          return write(output, method, requestHeaders, Response.text(404, "Not Found"))
        }
        val size = file.length()
        length = size
        headers["Accept-Ranges"] = "bytes"
        val range = requestHeaders["range"]?.takeIf { status == 200 }?.let { Http.parseRange(it, size) }
        if (range != null && range.isEmpty()) {
          return write(output, method, requestHeaders, Response(416, mapOf("Content-Range" to "bytes */$size")))
        }
        if (range != null) {
          status = 206
          start = range.first
          length = range.last - range.first + 1
          headers["Content-Range"] = "bytes ${range.first}-${range.last}/$size"
        }
      }
      val noBody = status == 204 || status == 304
      val head = StringBuilder("HTTP/1.1 $status ${Http.reason(status)}\r\n")
      for ((name, value) in headers) head.append(name).append(": ").append(value).append("\r\n")
      if (!noBody) head.append("Content-Length: ").append(length).append("\r\n")
      head.append("Connection: close\r\n\r\n")
      output.write(head.toString().toByteArray())
      if (noBody || method == "HEAD") return
      if (file == null) {
        output.write(response.body)
        return
      }
      file.seek(start)
      val chunk = ByteArray(BUFFER_SIZE)
      var remaining = length
      while (remaining > 0) {
        val count = file.read(chunk, 0, minOf(chunk.size.toLong(), remaining).toInt())
        if (count < 0) break
        output.write(chunk, 0, count)
        remaining -= count
      }
    } finally {
      file?.close()
    }
  }

  private fun clean(value: String) = value.replace("\r", "").replace("\n", "")

  private fun remoteAddress(client: Socket): String {
    val address = client.inetAddress ?: return ""
    if (address is Inet6Address && address.isLoopbackAddress) return "::1"
    return (address.hostAddress ?: "").substringBefore('%')
  }

  companion object {
    const val RESPONSE_TIMEOUT_MS = 30_000L
    private const val READ_TIMEOUT_MS = 30_000
    private const val BUFFER_SIZE = 64 * 1024
    private const val MAX_HEAD = 64 * 1024
    private const val MAX_BODY = 1024L * 1024
    private const val MAX_UPLOAD = 512L * 1024 * 1024
    private val HOP_HEADERS = setOf("content-length", "connection", "transfer-encoding", "keep-alive")
  }
}
