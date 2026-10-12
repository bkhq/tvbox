import ExpoModulesCore

public class SnifferModule: Module {
  #if os(iOS)
  // Touched on the main queue only.
  private var session: SniffSession?
  #endif

  public func definition() -> ModuleDefinition {
    Name("Sniffer")

    Events("onRequest", "onPageFinished")

    Function("isSupported") { () -> Bool in
      #if os(iOS)
      return true
      #else
      return false
      #endif
    }

    AsyncFunction("start") { (id: String, url: String, headers: [String: String], scripts: [String], timeoutMs: Int) in
      #if os(iOS)
      self.session?.destroy()
      let session = SniffSession(id: id, scripts: scripts) { [weak self] event, body in
        self?.sendEvent(event, body)
      }
      self.session = session
      session.start(url: url, headers: headers, timeoutMs: timeoutMs)
      #endif
    }.runOnQueue(.main)

    AsyncFunction("stop") { (id: String) in
      #if os(iOS)
      guard let session = self.session, session.id == id else { return }
      session.destroy()
      self.session = nil
      #endif
    }.runOnQueue(.main)

    OnDestroy {
      #if os(iOS)
      let session = self.session
      self.session = nil
      DispatchQueue.main.async { session?.destroy() }
      #endif
    }
  }
}
