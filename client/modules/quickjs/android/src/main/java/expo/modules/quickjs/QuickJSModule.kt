package expo.modules.quickjs

import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger

class QuickJSModule : Module() {
  private val contexts = ConcurrentHashMap<Int, QuickJSContext>()
  private val nextId = AtomicInteger(0)
  private val host by lazy {
    QuickJSHost(appContext.reactContext?.applicationContext ?: throw IllegalStateException("React context is not available"))
  }

  override fun definition() = ModuleDefinition {
    Name("QuickJS")

    AsyncFunction("createContext") { promise: Promise ->
      val id = nextId.incrementAndGet()
      val context = try {
        QuickJSContext(id, host)
      } catch (e: Throwable) {
        promise.reject(ERR_EXCEPTION, e.message, e)
        return@AsyncFunction
      }
      contexts[id] = context
      context.post {
        try {
          context.open()
          promise.resolve(id)
        } catch (e: Throwable) {
          contexts.remove(id)
          context.shutdown()
          reject(promise, e)
        }
      }
    }

    AsyncFunction("registerModule") { ctx: Int, name: String, source: String, promise: Promise ->
      run(ctx, promise) { context ->
        context.registerModule(name, source)
        null
      }
    }

    AsyncFunction("evaluate") { ctx: Int, code: String, filename: String, asModule: Boolean, timeoutMs: Double, promise: Promise ->
      run(ctx, promise) { context ->
        context.evaluate(code, filename, asModule, timeoutMs.toLong())
        null
      }
    }

    AsyncFunction("call") { ctx: Int, objectName: String, method: String, argsJson: String, timeoutMs: Double, promise: Promise ->
      run(ctx, promise) { context -> context.call(objectName, method, argsJson, timeoutMs.toLong()) }
    }

    AsyncFunction("destroyContext") { ctx: Int, promise: Promise ->
      val context = contexts.remove(ctx) ?: return@AsyncFunction noContext(promise, ctx)
      val posted = context.post {
        try {
          context.close()
          promise.resolve(null)
        } catch (e: Throwable) {
          reject(promise, e)
        }
      }
      context.shutdown()
      if (!posted) noContext(promise, ctx)
    }

    OnDestroy {
      for (id in contexts.keys.toList()) {
        val context = contexts.remove(id) ?: continue
        context.post { context.close() }
        context.shutdown()
      }
    }
  }

  private fun run(ctx: Int, promise: Promise, block: (QuickJSContext) -> Any?) {
    val context = contexts[ctx] ?: return noContext(promise, ctx)
    val posted = context.post {
      // creation failed, or destroyContext ran before this task
      if (context.isClosed) return@post noContext(promise, ctx)
      try {
        promise.resolve(block(context))
      } catch (e: Throwable) {
        reject(promise, e)
      }
    }
    if (!posted) noContext(promise, ctx)
  }

  private fun noContext(promise: Promise, ctx: Int) =
    promise.reject(ERR_NO_CONTEXT, "Unknown QuickJS context $ctx", null)

  private fun reject(promise: Promise, e: Throwable) {
    if (e is QuickJSException) {
      promise.reject(e.errorCode, e.message, null)
    } else {
      promise.reject(ERR_EXCEPTION, e.message ?: e.toString(), e)
    }
  }

  private companion object {
    const val ERR_EXCEPTION = "ERR_QUICKJS_EXCEPTION"
    const val ERR_NO_CONTEXT = "ERR_QUICKJS_NO_CONTEXT"
  }
}
