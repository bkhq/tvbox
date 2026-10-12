package expo.modules.quickjs

/** JNI entry points of libquickjs-bridge (android/src/main/cpp/quickjs_jni.c). */
internal object QuickJSNative {
  init {
    System.loadLibrary("quickjs-bridge")
  }

  @JvmStatic external fun create(host: QuickJSHost): Long

  @JvmStatic external fun destroy(handle: Long)

  @JvmStatic external fun registerModule(handle: Long, name: ByteArray, source: ByteArray)

  @JvmStatic external fun evaluate(handle: Long, code: ByteArray, filename: ByteArray, asModule: Boolean, timeoutMs: Long)

  @JvmStatic external fun call(handle: Long, objectName: ByteArray, method: ByteArray, args: ByteArray, timeoutMs: Long): ByteArray
}

/** Thrown by the JNI layer; [code] is one of the QJS_ERR_* values of qjs_bridge.h. */
internal class QuickJSException(val code: Int, message: ByteArray) : Exception(String(message, Charsets.UTF_8)) {
  val errorCode: String
    get() = when (code) {
      2 -> "ERR_QUICKJS_TIMEOUT"
      3 -> "ERR_QUICKJS_NO_OBJECT"
      4 -> "ERR_QUICKJS_STALLED"
      -1 -> "ERR_QUICKJS_NO_CONTEXT"
      else -> "ERR_QUICKJS_EXCEPTION"
    }
}
