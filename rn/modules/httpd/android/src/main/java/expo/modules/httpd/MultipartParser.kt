package expo.modules.httpd

import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileOutputStream
import java.io.OutputStream

/**
 * Push parser for multipart/form-data. Text fields are decoded as UTF-8 into [form] (at most
 * [textLimit] bytes in total); file fields are streamed to temp files in [dir], each added to
 * [tempFiles] so the caller can delete them.
 */
internal class MultipartParser(
  boundary: String,
  private val dir: File,
  private val tempFiles: MutableList<File>,
  private val textLimit: Int,
) {
  private enum class State { PREAMBLE, DELIMITER, HEADERS, BODY, END }

  private class Part(val name: String?, val filename: String?, val file: File?, val sink: OutputStream)

  val form = LinkedHashMap<String, String>()
  val files = LinkedHashMap<String, Upload>()

  // The leading CRLF lets the first boundary match the same delimiter as the others.
  private val delimiter = "\r\n--$boundary".toByteArray()
  private var buffer = byteArrayOf('\r'.code.toByte(), '\n'.code.toByte())
  private var state = State.PREAMBLE
  private var part: Part? = null
  private var textBytes = 0

  val isComplete: Boolean get() = state == State.END

  fun feed(data: ByteArray, length: Int) {
    if (state == State.END) return
    buffer += data.copyOf(length)
    while (step()) Unit
  }

  /** Closes an unfinished part's file; called when the body ends early or fails. */
  fun close() {
    part?.sink?.close()
    part = null
  }

  private fun step(): Boolean = when (state) {
    State.PREAMBLE -> {
      val i = indexOf(delimiter)
      if (i < 0) {
        consume(maxOf(0, buffer.size - delimiter.size + 1))
        false
      } else {
        consume(i + delimiter.size)
        state = State.DELIMITER
        true
      }
    }
    State.DELIMITER -> {
      if (buffer.size >= 2 && buffer[0] == DASH && buffer[1] == DASH) {
        state = State.END
        buffer = ByteArray(0)
        false
      } else {
        // Skip optional transport padding up to the CRLF that ends the boundary line.
        val i = indexOf(CRLF)
        if (i < 0) {
          if (buffer.size > 256) throw HttpError(400, "Malformed multipart boundary")
          false
        } else {
          consume(i + 2)
          state = State.HEADERS
          true
        }
      }
    }
    State.HEADERS -> {
      val i = if (startsWith(CRLF)) 0 else indexOf(CRLF_CRLF)
      if (i < 0) {
        if (buffer.size > MAX_PART_HEADERS) throw HttpError(431, "Multipart headers too large")
        false
      } else {
        val headers = String(buffer, 0, i, Charsets.UTF_8)
        consume(if (i == 0) 2 else i + 4)
        part = openPart(headers)
        state = State.BODY
        true
      }
    }
    State.BODY -> {
      val i = indexOf(delimiter)
      if (i < 0) {
        val safe = buffer.size - delimiter.size + 1
        if (safe > 0) {
          write(safe)
          consume(safe)
        }
        false
      } else {
        write(i)
        consume(i + delimiter.size)
        closePart()
        state = State.DELIMITER
        true
      }
    }
    State.END -> false
  }

  private fun openPart(headers: String): Part {
    var name: String? = null
    var filename: String? = null
    for (line in headers.split("\r\n")) {
      val colon = line.indexOf(':')
      if (colon < 0 || !line.substring(0, colon).trim().equals("content-disposition", ignoreCase = true)) continue
      val params = Http.parseHeaderValue(line.substring(colon + 1)).second
      name = params["name"]
      filename = params["filename"]
    }
    if (name == null) return Part(null, null, null, Discard)
    if (filename == null) return Part(name, null, null, ByteArrayOutputStream())
    val file = File.createTempFile("httpd-", ".upload", dir)
    tempFiles.add(file)
    return Part(name, filename, file, FileOutputStream(file))
  }

  private fun write(length: Int) {
    val current = part ?: return
    if (current.file == null) {
      textBytes += length
      if (textBytes > textLimit) throw HttpError(413, "Form fields too large")
    }
    current.sink.write(buffer, 0, length)
  }

  private fun closePart() {
    val current = part ?: return
    part = null
    current.sink.close()
    val name = current.name ?: return
    if (current.file == null) {
      form[name] = (current.sink as ByteArrayOutputStream).toString("UTF-8")
    } else if (current.filename!!.isNotEmpty() || current.file.length() > 0) {
      // Browsers send an empty part with filename="" for a file input left blank.
      files[name] = Upload(current.file, current.filename)
    }
  }

  private fun consume(count: Int) {
    buffer = buffer.copyOfRange(count, buffer.size)
  }

  private fun startsWith(pattern: ByteArray): Boolean =
    buffer.size >= pattern.size && pattern.indices.all { buffer[it] == pattern[it] }

  private fun indexOf(pattern: ByteArray): Int {
    val first = pattern[0]
    outer@ for (i in 0..buffer.size - pattern.size) {
      if (buffer[i] != first) continue
      for (j in 1 until pattern.size) if (buffer[i + j] != pattern[j]) continue@outer
      return i
    }
    return -1
  }

  private object Discard : OutputStream() {
    override fun write(b: Int) = Unit

    override fun write(b: ByteArray, off: Int, len: Int) = Unit
  }

  private companion object {
    const val DASH = '-'.code.toByte()
    val CRLF = "\r\n".toByteArray()
    val CRLF_CRLF = "\r\n\r\n".toByteArray()
    const val MAX_PART_HEADERS = 16 * 1024
  }
}
