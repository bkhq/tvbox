import Foundation

/// Error raised by the C bridge; `code` is one of the QJS_ERR_* values of qjs_bridge.h.
struct QuickJSError: Error {
  let code: Int32
  let message: String

  var errorCode: String {
    switch code {
    case 2: return "ERR_QUICKJS_TIMEOUT"
    case 3: return "ERR_QUICKJS_NO_OBJECT"
    case 4: return "ERR_QUICKJS_STALLED"
    default: return "ERR_QUICKJS_EXCEPTION"
    }
  }
}

/// Serial worker thread with a large stack; QuickJS never runs on the JS or main thread.
final class QuickJSThread: Thread {
  private let condition = NSCondition()
  private var tasks: [() -> Void] = []
  private var stopping = false

  init(name: String) {
    super.init()
    self.name = name
    // Deep recursion (e.g. HTML parsing in cheerio) needs more than the
    // default stack; the JS limit in qjs_bridge.c is 4 MB.
    stackSize = 16 << 20
    qualityOfService = .userInitiated
  }

  /// Queues `task`; false when the thread is stopping.
  func post(_ task: @escaping () -> Void) -> Bool {
    condition.lock()
    defer { condition.unlock() }
    if stopping {
      return false
    }
    tasks.append(task)
    condition.signal()
    return true
  }

  /// Lets queued tasks finish, then exits the thread.
  func shutdown() {
    condition.lock()
    stopping = true
    condition.signal()
    condition.unlock()
  }

  override func main() {
    while true {
      condition.lock()
      while tasks.isEmpty && !stopping {
        condition.wait()
      }
      if tasks.isEmpty {
        condition.unlock()
        return
      }
      let task = tasks.removeFirst()
      condition.unlock()
      autoreleasepool {
        task()
      }
    }
  }
}

/// One QuickJS runtime + context bound to its own thread. Everything except
/// `post` and `shutdown` must run on that thread (inside `post`).
final class QuickJSContext {
  private let thread: QuickJSThread
  private let host: QuickJSHost
  private var bridge: OpaquePointer?

  var isClosed: Bool {
    return bridge == nil
  }

  init(id: Int, host: QuickJSHost) {
    self.host = host
    thread = QuickJSThread(name: "QuickJS-\(id)")
    thread.start()
  }

  func post(_ task: @escaping () -> Void) -> Bool {
    return thread.post(task)
  }

  func shutdown() {
    thread.shutdown()
  }

  func open() throws {
    var callbacks = QJSHost(
      http: quickjsHostHttp,
      local_get: quickjsHostLocalGet,
      local_set: quickjsHostLocalSet,
      local_delete: quickjsHostLocalDelete,
      log: quickjsHostLog,
      read_asset: quickjsHostReadAsset
    )
    bridge = qjs_bridge_new(&callbacks, Unmanaged.passUnretained(host).toOpaque())
    if bridge == nil {
      throw QuickJSError(code: 1, message: "failed to create the QuickJS runtime")
    }
  }

  func close() {
    if let bridge {
      qjs_bridge_free(bridge)
    }
    bridge = nil
  }

  func registerModule(name: String, source: String) throws {
    let utf8 = source.utf8CString
    let r = utf8.withUnsafeBufferPointer { buf in
      qjs_bridge_register_module(bridge, name, buf.baseAddress, buf.count - 1)
    }
    if r != 0 {
      throw QuickJSError(code: 1, message: "out of memory")
    }
  }

  func evaluate(code: String, filename: String, asModule: Bool, timeoutMs: Int64) throws {
    var error: UnsafeMutablePointer<CChar>?
    defer { qjs_bridge_free_string(error) }
    let utf8 = code.utf8CString
    let r = utf8.withUnsafeBufferPointer { buf in
      qjs_bridge_evaluate(bridge, buf.baseAddress, buf.count - 1, filename, asModule ? 1 : 0, timeoutMs, &error)
    }
    if r != 0 {
      throw QuickJSError(code: r, message: error.map { String(cString: $0) } ?? "")
    }
  }

  func call(objectName: String, method: String, argsJson: String, timeoutMs: Int64) throws -> String {
    var out: UnsafeMutablePointer<CChar>?
    defer { qjs_bridge_free_string(out) }
    let r = qjs_bridge_call(bridge, objectName, method, argsJson, timeoutMs, &out)
    let text = out.map { String(cString: $0) }
    if r != 0 {
      throw QuickJSError(code: r, message: text ?? "")
    }
    return text ?? "null"
  }
}
