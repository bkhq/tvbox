import Foundation
import os.log

/// Platform callbacks of the C bridge, invoked synchronously on a context
/// thread (never the main thread). Mirrors quickjs/.../utils/Connect.java and
/// bean/Req.java of the Java app for HTTP.
final class QuickJSHost {
  private static let errorJSON = "{\"code\":\"\",\"headers\":{},\"content\":\"\"}"
  private static let defaultTimeoutMs = 15000.0

  private let defaults = UserDefaults(suiteName: "quickjs_local") ?? .standard
  private let logger = OSLog(subsystem: Bundle.main.bundleIdentifier ?? "QuickJS", category: "QuickJS")
  private let followSession: URLSession
  private let noFollowSession: URLSession
  private let libBundle: Bundle?

  init() {
    // Shared by all context threads, so resolved once up front.
    libBundle = Bundle(for: QuickJSHost.self).url(forResource: "QuickJSLib", withExtension: "bundle").flatMap { Bundle(url: $0) }
    followSession = URLSession(configuration: .ephemeral)
    noFollowSession = URLSession(configuration: .ephemeral, delegate: NoRedirectDelegate(), delegateQueue: nil)
  }

  // MARK: - local store

  func localGet(_ key: String) -> String? {
    return defaults.string(forKey: key)
  }

  func localSet(_ key: String, _ value: String) {
    defaults.set(value, forKey: key)
  }

  func localDelete(_ key: String) {
    defaults.removeObject(forKey: key)
  }

  // MARK: - log

  func log(_ level: String, _ message: String) {
    let type: OSLogType
    switch level.lowercased() {
    case "e", "error": type = .error
    case "w", "warn": type = .default
    case "i", "info": type = .info
    default: type = .debug
    }
    os_log("%{public}@", log: logger, type: type, message)
  }

  // MARK: - bundled libraries

  /// `path` is "lib/<file>"; the files of assets/lib live in QuickJSLib.bundle.
  func readAsset(_ path: String) -> Data? {
    guard path.hasPrefix("lib/"), !path.contains(".."), let base = libBundle?.resourceURL else {
      return nil
    }
    return try? Data(contentsOf: base.appendingPathComponent(String(path.dropFirst(4))))
  }

  // MARK: - HTTP

  func http(url: String, options: String) -> String {
    guard
      let opts = (try? JSONSerialization.jsonObject(with: Data(options.utf8))) as? [String: Any],
      let target = URL(string: url)
    else {
      return Self.errorJSON
    }
    let headers = Self.stringMap(opts["headers"])
    let timeoutMs = Self.number(opts["timeout"]) ?? Self.defaultTimeoutMs
    let follow = (Self.number(opts["redirect"]) ?? 1) != 0
    let buffer = Int(Self.number(opts["buffer"]) ?? 0)

    var request = URLRequest(url: target, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: timeoutMs / 1000)
    for (name, value) in headers {
      request.setValue(value, forHTTPHeaderField: name)
    }
    switch ((opts["method"] as? String) ?? "get").lowercased() {
    case "post":
      request.httpMethod = "POST"
      setPostBody(&request, opts: opts, headers: headers)
    case "header":
      request.httpMethod = "HEAD"
    default:
      request.httpMethod = "GET"
    }

    let semaphore = DispatchSemaphore(value: 0)
    var result: (Data?, URLResponse?)
    let session = follow ? followSession : noFollowSession
    let task = session.dataTask(with: request) { data, response, _ in
      result = (data, response)
      semaphore.signal()
    }
    task.resume()
    // URLRequest's timeout is an idle timeout; bound the whole request too.
    if semaphore.wait(timeout: .now() + .milliseconds(Int(timeoutMs) + 5000)) == .timedOut {
      task.cancel()
      return Self.errorJSON
    }
    guard let response = result.1 as? HTTPURLResponse else {
      return Self.errorJSON
    }
    let data = result.0 ?? Data()

    var resHeaders: [String: String] = [:]
    for (name, value) in response.allHeaderFields {
      resHeaders[String(describing: name).lowercased()] = String(describing: value)
    }
    let content: String
    if buffer == 0 {
      content = String(data: data, encoding: Self.charset(headers)) ?? String(decoding: data, as: UTF8.self)
    } else {
      content = data.base64EncodedString()
    }
    let body: [String: Any] = ["code": response.statusCode, "headers": resHeaders, "content": content]
    guard let json = try? JSONSerialization.data(withJSONObject: body) else {
      return Self.errorJSON
    }
    return String(decoding: json, as: UTF8.self)
  }

  private func setPostBody(_ request: inout URLRequest, opts: [String: Any], headers: [String: String]) {
    let data = opts["data"].flatMap { $0 is NSNull ? nil : $0 }
    let postType = (opts["postType"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? "json"
    let contentType = headers.first { $0.key.lowercased() == "content-type" }?.value

    if let data, postType == "json" {
      request.httpBody = try? JSONSerialization.data(withJSONObject: data, options: [.fragmentsAllowed])
      request.setValue("application/json; charset=utf-8", forHTTPHeaderField: "Content-Type")
    } else if let data, postType == "form" {
      let pairs = Self.stringMap(data).map { "\(Self.formEncode($0.key))=\(Self.formEncode($0.value))" }
      request.httpBody = Data(pairs.joined(separator: "&").utf8)
      request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
    } else if let data, postType == "form-data" {
      let boundary = "--dio-boundary-\(Int.random(in: 0..<42949))\(Int.random(in: 0..<67296))"
      var body = Data()
      for (name, value) in Self.stringMap(data) {
        body.append(Data("--\(boundary)\r\nContent-Disposition: form-data; name=\"\(name)\"\r\n\r\n\(value)\r\n".utf8))
      }
      body.append(Data("--\(boundary)--\r\n".utf8))
      request.httpBody = body
      request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
    } else if let text = opts["body"] as? String, contentType != nil {
      request.httpBody = Data(text.utf8)
    } else {
      request.httpBody = Data()
    }
  }

  /// Req.getCharset(): charset of the request Content-Type header, else UTF-8.
  private static func charset(_ headers: [String: String]) -> String.Encoding {
    guard let type = headers["Content-Type"] ?? headers["content-type"],
          let part = type.split(separator: ";").first(where: { $0.contains("charset=") }),
          let name = part.split(separator: "=").dropFirst().first?.trimmingCharacters(in: .whitespaces)
    else {
      return .utf8
    }
    let cf = CFStringConvertIANACharSetNameToEncoding(name as CFString)
    if cf == kCFStringEncodingInvalidId {
      return .utf8
    }
    return String.Encoding(rawValue: CFStringConvertEncodingToNSStringEncoding(cf))
  }

  private static func number(_ value: Any?) -> Double? {
    return (value as? NSNumber)?.doubleValue
  }

  private static func stringMap(_ value: Any?) -> [String: String] {
    guard let dict = value as? [String: Any] else {
      return [:]
    }
    var map: [String: String] = [:]
    for (key, item) in dict where !(item is NSNull) {
      map[key] = (item as? String) ?? "\(item)"
    }
    return map
  }

  private static func formEncode(_ text: String) -> String {
    var allowed = CharacterSet.alphanumerics
    allowed.insert(charactersIn: "-._*")
    return (text.addingPercentEncoding(withAllowedCharacters: allowed) ?? text).replacingOccurrences(of: "%20", with: "+")
  }
}

/// Returns the 3xx response itself instead of following it (redirect: 0).
private final class NoRedirectDelegate: NSObject, URLSessionTaskDelegate {
  func urlSession(
    _ session: URLSession,
    task: URLSessionTask,
    willPerformHTTPRedirection response: HTTPURLResponse,
    newRequest request: URLRequest,
    completionHandler: @escaping (URLRequest?) -> Void
  ) {
    completionHandler(nil)
  }
}

// MARK: - C callbacks (QJSHost in qjs_bridge.h); opaque is the QuickJSHost.

private func host(_ opaque: UnsafeMutableRawPointer?) -> QuickJSHost {
  return Unmanaged<QuickJSHost>.fromOpaque(opaque!).takeUnretainedValue()
}

private func string(_ s: UnsafePointer<CChar>?) -> String {
  return s.map { String(cString: $0) } ?? ""
}

let quickjsHostHttp: @convention(c) (UnsafeMutableRawPointer?, UnsafePointer<CChar>?, UnsafePointer<CChar>?) -> UnsafeMutablePointer<CChar>? = {
  opaque, url, options in
  strdup(host(opaque).http(url: string(url), options: string(options)))
}

let quickjsHostLocalGet: @convention(c) (UnsafeMutableRawPointer?, UnsafePointer<CChar>?) -> UnsafeMutablePointer<CChar>? = {
  opaque, key in
  host(opaque).localGet(string(key)).flatMap { strdup($0) }
}

let quickjsHostLocalSet: @convention(c) (UnsafeMutableRawPointer?, UnsafePointer<CChar>?, UnsafePointer<CChar>?) -> Void = {
  opaque, key, value in
  host(opaque).localSet(string(key), string(value))
}

let quickjsHostLocalDelete: @convention(c) (UnsafeMutableRawPointer?, UnsafePointer<CChar>?) -> Void = {
  opaque, key in
  host(opaque).localDelete(string(key))
}

let quickjsHostLog: @convention(c) (UnsafeMutableRawPointer?, UnsafePointer<CChar>?, UnsafePointer<CChar>?) -> Void = {
  opaque, level, message in
  host(opaque).log(string(level), string(message))
}

let quickjsHostReadAsset: @convention(c) (UnsafeMutableRawPointer?, UnsafePointer<CChar>?, UnsafeMutablePointer<Int>?) -> UnsafeMutablePointer<CChar>? = {
  opaque, path, len in
  guard let data = host(opaque).readAsset(string(path)) else {
    return nil
  }
  let buffer = malloc(max(data.count, 1))!.assumingMemoryBound(to: CChar.self)
  data.withUnsafeBytes { raw in
    if let base = raw.baseAddress {
      memcpy(buffer, base, data.count)
    }
  }
  len?.pointee = data.count
  return buffer
}
