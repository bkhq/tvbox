import ExpoModulesCore
import Foundation

struct HttpdResponseRecord: Record {
  @Field var status: Int = 200
  @Field var headers: [String: String]?
  @Field var body: String?
  @Field var bodyEncoding: String?
  @Field var filePath: String?
}

final class NoFreePortException: GenericException<(Int, Int)> {
  override var reason: String {
    "No free port in \(param.0)..\(param.1)"
  }
}

public class HttpdModule: Module {
  private let lock = NSLock()
  private var server: HttpServer?

  public func definition() -> ModuleDefinition {
    Name("Httpd")

    Events("onRequest")

    AsyncFunction("startServer") { (portFrom: Int, portTo: Int, mdnsName: String?) throws -> Int in
      self.lock.lock()
      defer { self.lock.unlock() }
      if let server = self.server {
        return Int(server.port)
      }
      guard portFrom >= 1, portTo <= 65535, portFrom <= portTo else {
        throw NoFreePortException((portFrom, portTo))
      }
      let cacheDirectory = FileManager.default.temporaryDirectory.appendingPathComponent("httpd", isDirectory: true)
      try? FileManager.default.createDirectory(at: cacheDirectory, withIntermediateDirectories: true)
      for port in portFrom...portTo {
        let candidate = HttpServer(cacheDirectory: cacheDirectory) { [weak self] request in
          self?.sendEvent("onRequest", request)
        }
        if candidate.start(port: UInt16(port), mdnsName: mdnsName) {
          self.server = candidate
          return port
        }
      }
      throw NoFreePortException((portFrom, portTo))
    }

    AsyncFunction("stopServer") {
      self.stop()
    }

    Function("respond") { (id: String, response: HttpdResponseRecord) in
      self.lock.lock()
      let server = self.server
      self.lock.unlock()
      server?.respond(id, Self.toResponse(response))
    }

    Function("getLocalIpAddress") { () -> String? in
      Self.localIpAddress()
    }

    // The phone-as-remote helpers need Android key injection; unsupported on iOS/tvOS.
    AsyncFunction("sendKey") { (_: String) -> Bool in
      false
    }

    AsyncFunction("sendText") { (_: String) -> Bool in
      false
    }

    AsyncFunction("adjustVolume") { (_: String) -> Bool in
      false
    }

    OnDestroy {
      self.stop()
    }
  }

  private func stop() {
    lock.lock()
    let current = server
    server = nil
    lock.unlock()
    current?.stop()
  }

  private static func toResponse(_ record: HttpdResponseRecord) -> HttpResponse {
    let headers = record.headers ?? [:]
    if let path = record.filePath {
      let url = path.hasPrefix("file://") ? URL(string: path) ?? URL(fileURLWithPath: path) : URL(fileURLWithPath: path)
      return HttpResponse(status: record.status, headers: headers, file: url)
    }
    let text = record.body ?? ""
    if record.bodyEncoding == "base64" {
      guard let data = Data(base64Encoded: text, options: .ignoreUnknownCharacters) else {
        return .text(500, "Invalid base64 body")
      }
      return HttpResponse(status: record.status, headers: headers, body: data)
    }
    return HttpResponse(status: record.status, headers: headers, body: Data(text.utf8))
  }

  /// IPv4 address of an up Wi-Fi / Ethernet interface (`en*`), preferring `en0`.
  private static func localIpAddress() -> String? {
    var list: UnsafeMutablePointer<ifaddrs>?
    guard getifaddrs(&list) == 0, let first = list else { return nil }
    defer { freeifaddrs(list) }
    var found: [(String, String)] = []
    for entry in sequence(first: first, next: { $0.pointee.ifa_next }) {
      let flags = Int32(entry.pointee.ifa_flags)
      guard let address = entry.pointee.ifa_addr, address.pointee.sa_family == UInt8(AF_INET),
            flags & IFF_UP != 0, flags & IFF_LOOPBACK == 0 else { continue }
      let name = String(cString: entry.pointee.ifa_name)
      guard name.hasPrefix("en") else { continue }
      var host = [CChar](repeating: 0, count: Int(NI_MAXHOST))
      if getnameinfo(address, socklen_t(address.pointee.sa_len), &host, socklen_t(host.count), nil, 0, NI_NUMERICHOST) == 0 {
        found.append((name, String(cString: host)))
      }
    }
    return (found.first { $0.0 == "en0" } ?? found.first)?.1
  }
}
