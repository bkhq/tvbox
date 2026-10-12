package expo.modules.quickjs

import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException

/**
 * One QuickJS runtime + context bound to its own serial thread. Every method
 * except [post] and [shutdown] must run on that thread (inside [post]).
 */
internal class QuickJSContext(id: Int, private val host: QuickJSHost) {
  private val executor: ExecutorService = Executors.newSingleThreadExecutor { runnable ->
    Thread(null, runnable, "QuickJS-$id", THREAD_STACK_SIZE).apply { isDaemon = true }
  }
  private var handle = 0L

  val isClosed: Boolean
    get() = handle == 0L

  /** Queues [task] on the context thread; false when the thread is stopped. */
  fun post(task: () -> Unit): Boolean =
    try {
      executor.execute(task)
      true
    } catch (e: RejectedExecutionException) {
      false
    }

  /** Lets queued tasks finish, then stops the thread. */
  fun shutdown() = executor.shutdown()

  fun open() {
    handle = QuickJSNative.create(host)
    if (handle == 0L) throw QuickJSException(1, "failed to create the QuickJS runtime".toByteArray())
  }

  fun close() {
    val h = handle
    handle = 0L
    if (h != 0L) QuickJSNative.destroy(h)
  }

  fun registerModule(name: String, source: String) =
    QuickJSNative.registerModule(handle, name.utf8(), source.utf8())

  fun evaluate(code: String, filename: String, asModule: Boolean, timeoutMs: Long) =
    QuickJSNative.evaluate(handle, code.utf8(), filename.utf8(), asModule, timeoutMs)

  fun call(objectName: String, method: String, argsJson: String, timeoutMs: Long): String =
    String(QuickJSNative.call(handle, objectName.utf8(), method.utf8(), argsJson.utf8(), timeoutMs), Charsets.UTF_8)

  private fun String.utf8() = toByteArray(Charsets.UTF_8)

  companion object {
    // Deep recursion (e.g. HTML parsing in cheerio) needs more than the
    // default thread stack; the JS limit in qjs_bridge.c is 4 MB.
    private const val THREAD_STACK_SIZE = 16L shl 20
  }
}
