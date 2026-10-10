#if os(iOS)
import UIKit
import WebKit

/// One offscreen WKWebView load. WKWebView exposes no subresource requests, so a
/// document-start script reports the URLs pages fetch or hand to media elements;
/// navigations are reported from the navigation delegate.
final class SniffSession: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
  let id: String
  private let scripts: [String]
  private let emit: (String, [String: Any]) -> Void
  private var webView: WKWebView?
  private var destroyed = false

  private static let handlerName = "tvboxSniffer"

  private static let hookScript = """
  (function () {
    if (window.__tvboxSniffer) return;
    window.__tvboxSniffer = true;
    var seen = {};
    function report(value) {
      try {
        if (!value) return;
        var url = new URL(String(value), location.href).href;
        if (seen[url]) return;
        seen[url] = true;
        window.webkit.messageHandlers.\(handlerName).postMessage(url);
      } catch (e) {}
    }
    var originalFetch = window.fetch;
    if (originalFetch) {
      window.fetch = function (input) {
        report(typeof input === 'string' ? input : input && input.url);
        return originalFetch.apply(this, arguments);
      };
    }
    var originalOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url) {
      report(url);
      return originalOpen.apply(this, arguments);
    };
    function hookSrc(proto) {
      var descriptor = Object.getOwnPropertyDescriptor(proto, 'src');
      if (!descriptor || !descriptor.set) return;
      Object.defineProperty(proto, 'src', {
        configurable: true,
        enumerable: descriptor.enumerable,
        get: descriptor.get,
        set: function (value) {
          report(value);
          descriptor.set.call(this, value);
        }
      });
    }
    hookSrc(HTMLMediaElement.prototype);
    hookSrc(HTMLSourceElement.prototype);
    var originalSetAttribute = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function (name, value) {
      if (String(name).toLowerCase() === 'src' && (this instanceof HTMLMediaElement || this instanceof HTMLSourceElement)) report(value);
      return originalSetAttribute.apply(this, arguments);
    };
    try {
      new PerformanceObserver(function (list) {
        list.getEntries().forEach(function (entry) { report(entry.name); });
      }).observe({ type: 'resource', buffered: true });
    } catch (e) {}
    document.addEventListener('DOMContentLoaded', function () {
      document.querySelectorAll('video, audio, source').forEach(function (element) {
        report(element.getAttribute('src'));
      });
    });
  })();
  """

  init(id: String, scripts: [String], emit: @escaping (String, [String: Any]) -> Void) {
    self.id = id
    self.scripts = scripts
    self.emit = emit
  }

  func start(url: String, headers: [String: String], timeoutMs: Int) {
    guard let target = URL(string: url) else {
      destroy()
      return
    }
    let configuration = WKWebViewConfiguration()
    configuration.allowsInlineMediaPlayback = true
    configuration.mediaTypesRequiringUserActionForPlayback = []
    let controller = configuration.userContentController
    controller.addUserScript(WKUserScript(source: Self.hookScript, injectionTime: .atDocumentStart, forMainFrameOnly: false))
    controller.add(WeakMessageHandler(self), name: Self.handlerName)

    let webView = WKWebView(frame: CGRect(x: 0, y: 0, width: 1280, height: 720), configuration: configuration)
    webView.navigationDelegate = self
    webView.isUserInteractionEnabled = false
    webView.alpha = 0
    // Detached web views get their timers throttled; keep it in the window, invisible.
    Self.keyWindow()?.insertSubview(webView, at: 0)
    self.webView = webView

    var request = URLRequest(url: target)
    for (key, value) in headers {
      if key.caseInsensitiveCompare("User-Agent") == .orderedSame {
        webView.customUserAgent = value
      } else {
        request.setValue(value, forHTTPHeaderField: key)
      }
    }
    webView.load(request)
    DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(timeoutMs)) { [weak self] in
      self?.destroy()
    }
  }

  func destroy() {
    guard !destroyed else { return }
    destroyed = true
    guard let webView else { return }
    webView.stopLoading()
    webView.navigationDelegate = nil
    webView.configuration.userContentController.removeScriptMessageHandler(forName: Self.handlerName)
    webView.removeFromSuperview()
    self.webView = nil
  }

  private func report(_ url: String, headers: [String: String] = [:]) {
    guard !destroyed, url.hasPrefix("http") || url.hasPrefix("rtmp") else { return }
    emit("onRequest", ["id": id, "url": url, "headers": headers])
  }

  /// CustomWebView.evaluate: one script after the other.
  private func evaluate(_ index: Int) {
    guard !destroyed, let webView, index < scripts.count else { return }
    let script = scripts[index]
    if script.isEmpty {
      evaluate(index + 1)
      return
    }
    webView.evaluateJavaScript(script) { [weak self] _, _ in
      self?.evaluate(index + 1)
    }
  }

  func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
    guard let url = message.body as? String else { return }
    report(url)
  }

  func webView(
    _ webView: WKWebView,
    decidePolicyFor navigationAction: WKNavigationAction,
    decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
  ) {
    if let url = navigationAction.request.url?.absoluteString {
      report(url, headers: navigationAction.request.allHTTPHeaderFields ?? [:])
    }
    decisionHandler(.allow)
  }

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    guard !destroyed else { return }
    emit("onPageFinished", ["id": id])
    evaluate(0)
  }

  func webView(
    _ webView: WKWebView,
    didReceive challenge: URLAuthenticationChallenge,
    completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void
  ) {
    // Mirrors the Android sniffer, which proceeds on SSL errors.
    if challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust,
       let trust = challenge.protectionSpace.serverTrust {
      completionHandler(.useCredential, URLCredential(trust: trust))
    } else {
      completionHandler(.performDefaultHandling, nil)
    }
  }

  private static func keyWindow() -> UIWindow? {
    UIApplication.shared.connectedScenes
      .compactMap { $0 as? UIWindowScene }
      .flatMap { $0.windows }
      .first { $0.isKeyWindow }
  }
}

/// WKUserContentController retains its handlers; this breaks the cycle.
private final class WeakMessageHandler: NSObject, WKScriptMessageHandler {
  private weak var target: WKScriptMessageHandler?

  init(_ target: WKScriptMessageHandler) {
    self.target = target
  }

  func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
    target?.userContentController(userContentController, didReceive: message)
  }
}
#endif
