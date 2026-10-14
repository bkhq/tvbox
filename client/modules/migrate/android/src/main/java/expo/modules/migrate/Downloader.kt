package expo.modules.migrate

import java.io.File
import java.io.IOException
import java.io.InputStream
import java.io.RandomAccessFile
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong

/**
 * Downloads a URL to a file with several parallel byte-range connections when the server
 * supports ranges (a single connection otherwise). Data goes to `<target>.part`, which is
 * renamed to the target once complete. Each part retries from where it stopped.
 */
internal class Downloader(
  private val id: String,
  private val url: String,
  private val target: File,
  private val threads: Int,
  private val onProgress: (bytes: Long, total: Long) -> Unit,
) {
  private val cancelled = AtomicBoolean(false)
  private val written = AtomicLong(0)
  @Volatile private var lastReport = 0L

  fun cancel() = cancelled.set(true)

  /** Returns the size of the finished file. */
  fun run(): Long {
    val part = File(target.path + ".part")
    target.parentFile?.mkdirs()
    part.delete()
    try {
      val probe = probe()
      if (probe.ranges && probe.total >= MIN_SPLIT_BYTES && threads > 1) parallel(part, probe.total) else single(part)
      if (cancelled.get()) throw IOException("cancelled")
      if (target.exists()) target.delete()
      if (!part.renameTo(target)) throw IOException("cannot move ${part.name}")
      onProgress(target.length(), target.length())
      return target.length()
    } finally {
      part.delete()
    }
  }

  private data class Probe(val total: Long, val ranges: Boolean)

  /** One-byte range request: 206 with a Content-Range total means ranges work. */
  private fun probe(): Probe {
    val conn = open("bytes=0-0")
    try {
      val code = conn.responseCode
      val total = conn.getHeaderField("Content-Range")?.substringAfterLast('/')?.toLongOrNull()
      return if (code == 206 && total != null) Probe(total, true) else Probe(conn.contentLengthLong, false)
    } finally {
      conn.disconnect()
    }
  }

  private fun single(part: File) {
    val conn = open(null)
    try {
      if (conn.responseCode !in 200..299) throw IOException("HTTP ${conn.responseCode}")
      val total = conn.contentLengthLong
      RandomAccessFile(part, "rw").use { out ->
        conn.inputStream.use { input -> copy(input, out, total) {} }
      }
    } finally {
      conn.disconnect()
    }
  }

  private fun parallel(part: File, total: Long) {
    RandomAccessFile(part, "rw").use { it.setLength(total) }
    val count = threads.coerceAtMost((total / MIN_PART_BYTES).toInt().coerceAtLeast(1))
    val size = total / count
    val pool = Executors.newFixedThreadPool(count)
    try {
      val tasks = (0 until count).map { i ->
        val start = i * size
        val end = if (i == count - 1) total - 1 else start + size - 1
        pool.submit<Unit> { range(part, start, end, total) }
      }
      // get() rethrows the first part failure; the others stop on the cancelled flag.
      tasks.forEach { task ->
        try {
          task.get()
        } catch (e: Exception) {
          cancelled.set(true)
          throw (e.cause as? IOException) ?: IOException(e.cause ?: e)
        }
      }
    } finally {
      pool.shutdownNow()
    }
  }

  private fun range(part: File, start: Long, end: Long, total: Long) {
    var offset = start
    var attempt = 0
    while (offset <= end && !cancelled.get()) {
      try {
        val conn = open("bytes=$offset-$end")
        try {
          if (conn.responseCode != 206) throw IOException("HTTP ${conn.responseCode} for a range")
          RandomAccessFile(part, "rw").use { out ->
            out.seek(offset)
            conn.inputStream.use { input -> copy(input, out, total) { offset += it } }
          }
        } finally {
          conn.disconnect()
        }
      } catch (e: IOException) {
        if (cancelled.get() || ++attempt > RETRIES) throw e
      }
    }
  }

  /** Copies until EOF or cancel, telling [advance] about every chunk written. */
  private fun copy(input: InputStream, out: RandomAccessFile, total: Long, advance: (Int) -> Unit) {
    val buffer = ByteArray(BUFFER_BYTES)
    while (!cancelled.get()) {
      val read = input.read(buffer)
      if (read < 0) break
      out.write(buffer, 0, read)
      advance(read)
      report(written.addAndGet(read.toLong()), total)
    }
  }

  private fun report(bytes: Long, total: Long) {
    val now = System.currentTimeMillis()
    if (now - lastReport < REPORT_INTERVAL_MS) return
    lastReport = now
    onProgress(bytes, total)
  }

  private fun open(range: String?): HttpURLConnection {
    if (cancelled.get()) throw IOException("cancelled")
    return (URL(url).openConnection() as HttpURLConnection).apply {
      connectTimeout = TIMEOUT_MS
      readTimeout = TIMEOUT_MS
      instanceFollowRedirects = true
      range?.let { setRequestProperty("Range", it) }
      setRequestProperty("Accept-Encoding", "identity")
    }
  }

  companion object {
    private const val MIN_SPLIT_BYTES = 4L * 1024 * 1024
    private const val MIN_PART_BYTES = 2L * 1024 * 1024
    private const val BUFFER_BYTES = 64 * 1024
    private const val REPORT_INTERVAL_MS = 200L
    private const val TIMEOUT_MS = 15_000
    private const val RETRIES = 3

    private val running = ConcurrentHashMap<String, Downloader>()

    fun start(downloader: Downloader): Long {
      running[downloader.id] = downloader
      try {
        return downloader.run()
      } finally {
        running.remove(downloader.id)
      }
    }

    fun cancel(id: String) {
      running[id]?.cancel()
    }
  }
}
