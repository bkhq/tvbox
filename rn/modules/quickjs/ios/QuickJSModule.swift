import ExpoModulesCore

public class QuickJSModule: Module {
  private let lock = NSLock()
  private var contexts: [Int: QuickJSContext] = [:]
  private var nextId = 0
  private let host = QuickJSHost()

  public func definition() -> ModuleDefinition {
    Name("QuickJS")

    AsyncFunction("createContext") { (promise: Promise) in
      let id = self.withLock { () -> Int in
        self.nextId += 1
        return self.nextId
      }
      let context = QuickJSContext(id: id, host: self.host)
      self.withLock { self.contexts[id] = context }
      _ = context.post {
        do {
          try context.open()
          promise.resolve(id)
        } catch {
          _ = self.withLock { self.contexts.removeValue(forKey: id) }
          context.shutdown()
          self.reject(promise, error)
        }
      }
    }

    AsyncFunction("registerModule") { (ctx: Int, name: String, source: String, promise: Promise) in
      self.run(ctx, promise) { context in
        try context.registerModule(name: name, source: source)
        return nil
      }
    }

    AsyncFunction("evaluate") { (ctx: Int, code: String, filename: String, asModule: Bool, timeoutMs: Double, promise: Promise) in
      self.run(ctx, promise) { context in
        try context.evaluate(code: code, filename: filename, asModule: asModule, timeoutMs: Int64(timeoutMs))
        return nil
      }
    }

    AsyncFunction("call") { (ctx: Int, objectName: String, method: String, argsJson: String, timeoutMs: Double, promise: Promise) in
      self.run(ctx, promise) { context in
        try context.call(objectName: objectName, method: method, argsJson: argsJson, timeoutMs: Int64(timeoutMs))
      }
    }

    AsyncFunction("destroyContext") { (ctx: Int, promise: Promise) in
      guard let context = self.withLock({ self.contexts.removeValue(forKey: ctx) }) else {
        return self.noContext(promise, ctx)
      }
      let posted = context.post {
        context.close()
        promise.resolve(nil)
      }
      context.shutdown()
      if !posted {
        self.noContext(promise, ctx)
      }
    }

    OnDestroy {
      let all = self.withLock { () -> [QuickJSContext] in
        let values = Array(self.contexts.values)
        self.contexts.removeAll()
        return values
      }
      for context in all {
        _ = context.post { context.close() }
        context.shutdown()
      }
    }
  }

  private func withLock<T>(_ body: () -> T) -> T {
    lock.lock()
    defer { lock.unlock() }
    return body()
  }

  private func run(_ ctx: Int, _ promise: Promise, _ block: @escaping (QuickJSContext) throws -> String?) {
    guard let context = withLock({ contexts[ctx] }) else {
      return noContext(promise, ctx)
    }
    let posted = context.post {
      // creation failed, or destroyContext ran before this task
      if context.isClosed {
        return self.noContext(promise, ctx)
      }
      do {
        let value: Any? = try block(context)
        promise.resolve(value)
      } catch {
        self.reject(promise, error)
      }
    }
    if !posted {
      noContext(promise, ctx)
    }
  }

  private func noContext(_ promise: Promise, _ ctx: Int) {
    promise.reject("ERR_QUICKJS_NO_CONTEXT", "Unknown QuickJS context \(ctx)")
  }

  private func reject(_ promise: Promise, _ error: Error) {
    if let error = error as? QuickJSError {
      promise.reject(error.errorCode, error.message)
    } else {
      promise.reject("ERR_QUICKJS_EXCEPTION", error.localizedDescription)
    }
  }
}
