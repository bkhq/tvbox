import Foundation
import Network

/// One-request-per-connection HTTP/1.1 server on Network.framework. Each parsed request is
/// handed to `onRequest`; its connection waits for `respond` (or answers 504 after 30 s).
final class HttpServer {
  static let responseTimeout: TimeInterval = 30

  let cacheDirectory: URL
  private let onRequest: ([String: Any?]) -> Void
  private let queue = DispatchQueue(label: "httpd.listener")
  private let lock = NSLock()
  private var listener: NWListener?
  private var pending: [String: (HttpResponse) -> Void] = [:]
  private var connections: [ObjectIdentifier: HttpConnection] = [:]
  private var stopped = false

  private(set) var port: UInt16 = 0

  init(cacheDirectory: URL, onRequest: @escaping ([String: Any?]) -> Void) {
    self.cacheDirectory = cacheDirectory
    self.onRequest = onRequest
  }

  /// Listens on all interfaces on `port`; returns false if the port cannot be bound.
  func start(port: UInt16, mdnsName: String?) -> Bool {
    guard let endpointPort = NWEndpoint.Port(rawValue: port),
          let listener = try? NWListener(using: .tcp, on: endpointPort) else { return false }
    if let mdnsName {
      listener.service = NWListener.Service(name: mdnsName, type: "_http._tcp", domain: nil, txtRecord: NWTXTRecord(["path": "/"]))
    }
    let settled = DispatchSemaphore(value: 0)
    var ready = false
    var waiting = true
    listener.stateUpdateHandler = { state in
      guard waiting else { return }
      switch state {
      case .ready:
        ready = true
        waiting = false
        settled.signal()
      case .failed, .waiting, .cancelled:
        waiting = false
        settled.signal()
      default:
        break
      }
    }
    listener.newConnectionHandler = { [weak self] connection in
      self?.accept(connection)
    }
    listener.start(queue: queue)
    if settled.wait(timeout: .now() + 5) == .timedOut {
      queue.sync { waiting = false }
    }
    if !queue.sync(execute: { ready }) {
      listener.cancel()
      return false
    }
    self.listener = listener
    self.port = port
    return true
  }

  func stop() {
    lock.lock()
    stopped = true
    let waiting = Array(pending.keys)
    let open = Array(connections.values)
    lock.unlock()
    listener?.cancel()
    listener = nil
    for id in waiting { respond(id, .text(503, "Server stopped")) }
    for connection in open { connection.cancel() }
  }

  func respond(_ id: String, _ response: HttpResponse) {
    lock.lock()
    let completion = pending.removeValue(forKey: id)
    lock.unlock()
    completion?(response)
  }

  func dispatch(_ id: String, _ request: [String: Any?], completion: @escaping (HttpResponse) -> Void) {
    lock.lock()
    if stopped {
      lock.unlock()
      completion(.text(503, "Server stopped"))
      return
    }
    pending[id] = completion
    lock.unlock()
    DispatchQueue.global().asyncAfter(deadline: .now() + Self.responseTimeout) { [weak self] in
      self?.respond(id, .text(504, "No response"))
    }
    onRequest(request)
  }

  func remove(_ connection: HttpConnection) {
    lock.lock()
    connections.removeValue(forKey: ObjectIdentifier(connection))
    lock.unlock()
  }

  private func accept(_ connection: NWConnection) {
    let handler = HttpConnection(connection: connection, server: self)
    lock.lock()
    if stopped {
      lock.unlock()
      connection.cancel()
      return
    }
    connections[ObjectIdentifier(handler)] = handler
    lock.unlock()
    handler.start()
  }
}

/// Reads one request from `connection`, dispatches it and writes the response.
final class HttpConnection {
  private enum Phase {
    case head, body, waiting, done
  }

  private struct Head {
    let method: String
    let path: String
    let query: [String: String]
    let headers: [String: String]
    let mime: String
  }

  private static let readTimeout: TimeInterval = 30
  private static let chunkSize = 64 * 1024
  private static let maxHead = 64 * 1024
  private static let maxBody = 1024 * 1024
  private static let maxUpload: Int64 = 512 * 1024 * 1024
  private static let hopHeaders: Set<String> = ["content-length", "connection", "transfer-encoding", "keep-alive"]

  private let connection: NWConnection
  private weak var server: HttpServer?
  private let queue = DispatchQueue(label: "httpd.connection")
  private var phase = Phase.head
  private var buffer = Data()
  private var head: Head?
  private var remaining: Int64 = 0
  private var parser: MultipartParser?
  private var tempFiles: [URL] = []
  private var idleTimer: DispatchWorkItem?

  init(connection: NWConnection, server: HttpServer) {
    self.connection = connection
    self.server = server
  }

  func start() {
    connection.stateUpdateHandler = { [weak self] state in
      switch state {
      case .failed, .cancelled:
        self?.finish()
      default:
        break
      }
    }
    connection.start(queue: queue)
    queue.async { self.resetIdleTimer() }
    receive()
  }

  func cancel() {
    queue.async { self.finish() }
  }

  private func receive() {
    connection.receive(minimumIncompleteLength: 1, maximumLength: Self.chunkSize) { [weak self] data, _, isComplete, error in
      guard let self, self.phase == .head || self.phase == .body else { return }
      if let data, !data.isEmpty {
        self.resetIdleTimer()
        do {
          try self.consume(data)
        } catch let error as HttpError {
          self.send(.text(error.status, error.message), method: self.head?.method ?? "GET", requestHeaders: [:])
          return
        } catch {
          self.send(.text(500, "Internal Server Error"), method: self.head?.method ?? "GET", requestHeaders: [:])
          return
        }
      }
      guard self.phase == .head || self.phase == .body else { return }
      if isComplete || error != nil {
        self.finish()
      } else {
        self.receive()
      }
    }
  }

  private func resetIdleTimer() {
    idleTimer?.cancel()
    let timer = DispatchWorkItem { [weak self] in
      guard let self, self.phase == .head || self.phase == .body else { return }
      self.finish()
    }
    idleTimer = timer
    queue.asyncAfter(deadline: .now() + Self.readTimeout, execute: timer)
  }

  private func consume(_ data: Data) throws {
    if phase == .body {
      try feedBody(data)
      return
    }
    buffer.append(data)
    // Tolerate blank lines before the request line.
    while buffer.starts(with: Data("\r\n".utf8)) { buffer = buffer.subdata(in: 2..<buffer.count) }
    guard let end = buffer.range(of: Data("\r\n\r\n".utf8)) else {
      if buffer.count > Self.maxHead { throw HttpError(status: 431, message: "Request head too large") }
      return
    }
    if end.lowerBound > Self.maxHead { throw HttpError(status: 431, message: "Request head too large") }
    let rest = buffer.subdata(in: end.upperBound..<buffer.count)
    try parseHead(String(decoding: buffer.subdata(in: 0..<end.lowerBound), as: UTF8.self))
    buffer = Data()
    phase = .body
    if remaining == 0 {
      try finishBody()
    } else if !rest.isEmpty {
      try feedBody(rest)
    }
  }

  private func parseHead(_ text: String) throws {
    let lines = text.components(separatedBy: "\r\n")
    let requestLine = lines[0].split(separator: " ", omittingEmptySubsequences: false)
    guard requestLine.count == 3, requestLine[2].hasPrefix("HTTP/") else {
      throw HttpError(status: 400, message: "Malformed request line")
    }
    let method = requestLine[0].uppercased()
    var target = String(requestLine[1])
    // Absolute-form targets (proxies) carry scheme and authority.
    if target.hasPrefix("http://") || target.hasPrefix("https://"), let authority = target.range(of: "//") {
      let pathStart = target[authority.upperBound...].firstIndex(of: "/") ?? target.endIndex
      target = String(target[pathStart...])
    }
    if let hash = target.firstIndex(of: "#") { target = String(target[..<hash]) }
    var query: [String: String] = [:]
    var rawPath = target
    if let mark = target.firstIndex(of: "?") {
      rawPath = String(target[..<mark])
      Http.parseQuery(String(target[target.index(after: mark)...]), into: &query)
    }
    let decodedPath = Http.decode(rawPath, plusAsSpace: false)
    let path = decodedPath.isEmpty ? "/" : decodedPath

    var headers: [String: String] = [:]
    for line in lines.dropFirst() {
      guard let colon = line.firstIndex(of: ":"), colon != line.startIndex else { continue }
      let name = line[..<colon].trimmingCharacters(in: .whitespaces).lowercased()
      let value = line[line.index(after: colon)...].trimmingCharacters(in: .whitespaces)
      headers[name] = headers[name].map { "\($0), \(value)" } ?? value
    }

    if let encoding = headers["transfer-encoding"], encoding.lowercased() != "identity" {
      throw HttpError(status: 411, message: "Chunked request bodies are not supported; send Content-Length")
    }
    var length: Int64 = 0
    if let value = headers["content-length"] {
      guard let parsed = Int64(value), parsed >= 0 else { throw HttpError(status: 400, message: "Invalid Content-Length") }
      length = parsed
    }
    let (mime, params) = Http.parseHeaderValue(headers["content-type"] ?? "")
    let multipart = mime == "multipart/form-data"
    if length > (multipart ? Self.maxUpload : Int64(Self.maxBody)) {
      throw HttpError(status: 413, message: "Request body too large")
    }
    if multipart {
      guard let boundary = params["boundary"], !boundary.isEmpty else {
        throw HttpError(status: 400, message: "Missing multipart boundary")
      }
      guard let directory = server?.cacheDirectory else { throw HttpError(status: 503, message: "Server stopped") }
      parser = MultipartParser(boundary: boundary, directory: directory, textLimit: Self.maxBody) { [weak self] url in
        self?.tempFiles.append(url)
      }
    }
    head = Head(method: method, path: path, query: query, headers: headers, mime: mime)
    remaining = length
    if length > 0 && headers["expect"]?.lowercased() == "100-continue" {
      connection.send(content: Data("HTTP/1.1 100 Continue\r\n\r\n".utf8), completion: .contentProcessed { _ in })
    }
  }

  private func feedBody(_ data: Data) throws {
    let chunk = Int64(data.count) > remaining ? data.prefix(Int(remaining)) : data
    remaining -= Int64(chunk.count)
    if let parser {
      try parser.feed(chunk)
    } else {
      buffer.append(chunk)
    }
    if remaining == 0 { try finishBody() }
  }

  private func finishBody() throws {
    guard let head else { return }
    var form: [String: String] = [:]
    var files: [String: Any] = [:]
    var body = ""
    if let parser {
      parser.close()
      guard parser.isComplete else { throw HttpError(status: 400, message: "Malformed multipart body") }
      form = parser.form
      for (name, upload) in parser.files {
        files[name] = ["path": upload.url.path, "name": upload.name, "size": Double(upload.size)]
      }
    } else if !buffer.isEmpty {
      let text = String(decoding: buffer, as: UTF8.self)
      if head.mime == "application/x-www-form-urlencoded" {
        Http.parseQuery(text, into: &form)
      } else {
        body = text
      }
    }
    buffer = Data()
    phase = .waiting
    idleTimer?.cancel()
    let id = UUID().uuidString
    let request: [String: Any?] = [
      "id": id,
      "method": head.method,
      "path": head.path,
      "query": head.query,
      "form": form,
      "files": files,
      "headers": head.headers,
      "body": body,
      "remoteAddress": remoteAddress(),
    ]
    guard let server else {
      send(.text(503, "Server stopped"), method: head.method, requestHeaders: head.headers)
      return
    }
    server.dispatch(id, request) { [weak self] response in
      guard let self else { return }
      self.queue.async { self.send(response, method: head.method, requestHeaders: head.headers) }
    }
  }

  private func send(_ response: HttpResponse, method: String, requestHeaders: [String: String]) {
    guard phase != .done else { return }
    phase = .waiting
    parser?.close()
    var status = response.status
    var headers: [String: String] = [:]
    for (name, value) in response.headers where !Self.hopHeaders.contains(name.lowercased()) {
      headers[clean(name)] = clean(value)
    }
    var length = Int64(response.body.count)
    var start: Int64 = 0
    var file: FileHandle?
    if let url = response.file {
      var isDirectory: ObjCBool = false
      guard FileManager.default.fileExists(atPath: url.path, isDirectory: &isDirectory), !isDirectory.boolValue,
            let handle = try? FileHandle(forReadingFrom: url),
            let size = try? handle.seekToEnd() else {
        send(.text(404, "Not Found"), method: method, requestHeaders: requestHeaders)
        return
      }
      file = handle
      length = Int64(size)
      headers["Accept-Ranges"] = "bytes"
      if status == 200, let rangeHeader = requestHeaders["range"] {
        switch Http.parseRange(rangeHeader, size: length) {
        case .ignore:
          break
        case .unsatisfiable:
          try? handle.close()
          send(HttpResponse(status: 416, headers: ["Content-Range": "bytes */\(length)"]), method: method, requestHeaders: [:])
          return
        case let .bytes(first, last):
          status = 206
          headers["Content-Range"] = "bytes \(first)-\(last)/\(length)"
          start = first
          length = last - first + 1
        }
      }
    }
    let noBody = status == 204 || status == 304
    var text = "HTTP/1.1 \(status) \(Http.reason(status))\r\n"
    for (name, value) in headers { text += "\(name): \(value)\r\n" }
    if !noBody { text += "Content-Length: \(length)\r\n" }
    text += "Connection: close\r\n\r\n"
    var data = Data(text.utf8)
    let streamFile = file != nil && !noBody && method != "HEAD"
    if file == nil && !noBody && method != "HEAD" { data.append(response.body) }
    connection.send(content: data, completion: .contentProcessed { [weak self] error in
      guard let self else { return }
      if let file, streamFile, error == nil {
        do {
          try file.seek(toOffset: UInt64(start))
          self.stream(file, remaining: length)
        } catch {
          try? file.close()
          self.finish()
        }
      } else {
        try? file?.close()
        self.finish()
      }
    })
  }

  private func stream(_ file: FileHandle, remaining: Int64) {
    guard remaining > 0, let chunk = try? file.read(upToCount: Int(min(Int64(Self.chunkSize), remaining))), !chunk.isEmpty else {
      try? file.close()
      finish()
      return
    }
    connection.send(content: chunk, completion: .contentProcessed { [weak self] error in
      guard let self else { return }
      if error != nil {
        try? file.close()
        self.finish()
      } else {
        self.stream(file, remaining: remaining - Int64(chunk.count))
      }
    })
  }

  /// Closes the connection gracefully and deletes the request's upload files.
  private func finish() {
    guard phase != .done else { return }
    phase = .done
    idleTimer?.cancel()
    parser?.close()
    connection.cancel()
    for url in tempFiles { try? FileManager.default.removeItem(at: url) }
    tempFiles = []
    server?.remove(self)
  }

  private func clean(_ value: String) -> String {
    value.replacingOccurrences(of: "\r", with: "").replacingOccurrences(of: "\n", with: "")
  }

  private func remoteAddress() -> String {
    guard case let .hostPort(host, _) = connection.endpoint else { return "" }
    switch host {
    case let .ipv4(address):
      return Self.format(address.rawValue, family: AF_INET)
    case let .ipv6(address):
      if address.isLoopback { return "::1" }
      if let mapped = address.asIPv4 { return Self.format(mapped.rawValue, family: AF_INET) }
      return Self.format(address.rawValue, family: AF_INET6)
    case let .name(name, _):
      return name
    @unknown default:
      return ""
    }
  }

  private static func format(_ raw: Data, family: Int32) -> String {
    var output = [CChar](repeating: 0, count: Int(INET6_ADDRSTRLEN))
    let ok = raw.withUnsafeBytes { bytes in
      inet_ntop(family, bytes.baseAddress, &output, socklen_t(output.count)) != nil
    }
    return ok ? String(cString: output) : ""
  }
}
