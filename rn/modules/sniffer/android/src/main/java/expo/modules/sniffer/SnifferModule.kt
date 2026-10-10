package expo.modules.sniffer

import android.annotation.SuppressLint
import android.content.Context
import android.net.http.SslError
import android.os.Handler
import android.os.Looper
import android.webkit.CookieManager
import android.webkit.SslErrorHandler
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class SnifferModule : Module() {
  // Touched on the main thread only.
  private var session: Session? = null

  private val context: Context
    get() = appContext.reactContext ?: throw IllegalStateException("React context is not available")

  override fun definition() = ModuleDefinition {
    Name("Sniffer")

    Events("onRequest", "onPageFinished")

    Function("isSupported") {
      try {
        CookieManager.getInstance()
        true
      } catch (e: Throwable) {
        false
      }
    }

    AsyncFunction("start") { id: String, url: String, headers: Map<String, String>, scripts: List<String>, timeoutMs: Int ->
      session?.destroy()
      session = Session(context, id, scripts) { event, body -> sendEvent(event, body) }.also { it.start(url, headers, timeoutMs.toLong()) }
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("stop") { id: String ->
      if (session?.id != id) return@AsyncFunction
      session?.destroy()
      session = null
    }.runOnQueue(Queues.MAIN)

    OnDestroy {
      val current = session ?: return@OnDestroy
      session = null
      Handler(Looper.getMainLooper()).post { current.destroy() }
    }
  }
}

/** One hidden WebView load: CustomWebView without the dialog and ad filtering. */
private class Session(
  context: Context,
  val id: String,
  private val scripts: List<String>,
  private val emit: (String, Map<String, Any>) -> Unit,
) {
  private val handler = Handler(Looper.getMainLooper())
  private val timer = Runnable { destroy() }
  private val webView = WebView(context.applicationContext)

  @Volatile
  private var destroyed = false

  @SuppressLint("SetJavaScriptEnabled")
  fun start(url: String, headers: Map<String, String>, timeoutMs: Long) {
    val settings = webView.settings
    settings.useWideViewPort = true
    settings.databaseEnabled = true
    settings.domStorageEnabled = true
    settings.javaScriptEnabled = true
    settings.loadWithOverviewMode = true
    settings.mediaPlaybackRequiresUserGesture = false
    settings.javaScriptCanOpenWindowsAutomatically = false
    settings.mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
    CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true)
    for ((key, value) in headers) {
      if (key.equals("User-Agent", ignoreCase = true)) settings.userAgentString = value
      else if (key.equals("Cookie", ignoreCase = true)) CookieManager.getInstance().setCookie(url, value)
    }
    webView.webViewClient = client()
    handler.postDelayed(timer, timeoutMs)
    webView.loadUrl(url, headers)
  }

  private fun client() = object : WebViewClient() {
    override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
      if (!destroyed && !request.url.host.isNullOrEmpty()) {
        emit("onRequest", mapOf("id" to id, "url" to request.url.toString(), "headers" to request.requestHeaders))
      }
      return null
    }

    override fun onPageFinished(view: WebView, url: String) {
      super.onPageFinished(view, url)
      if (destroyed || url == BLANK) return
      emit("onPageFinished", mapOf("id" to id))
      evaluate(0)
    }

    @SuppressLint("WebViewClientOnReceivedSslError")
    override fun onReceivedSslError(view: WebView, handler: SslErrorHandler, error: SslError) {
      handler.proceed()
    }

    override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean = false
  }

  /** CustomWebView.evaluate: one script after the other. */
  private fun evaluate(index: Int) {
    if (destroyed || index >= scripts.size) return
    val js = scripts[index]
    if (js.isEmpty()) evaluate(index + 1)
    else webView.evaluateJavascript(js) { evaluate(index + 1) }
  }

  fun destroy() {
    if (destroyed) return
    destroyed = true
    handler.removeCallbacks(timer)
    webView.stopLoading()
    webView.loadUrl(BLANK)
    webView.destroy()
  }

  companion object {
    private const val BLANK = "about:blank"
  }
}
