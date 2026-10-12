import Foundation

/// Thrown while reading a request; answered with `status` before the connection closes.
struct HttpError: Error {
  let status: Int
  let message: String
}

struct HttpUpload {
  let url: URL
  let name: String
  let size: Int64
}

struct HttpResponse {
  var status: Int
  var headers: [String: String] = [:]
  var body = Data()
  var file: URL?

  static func text(_ status: Int, _ text: String) -> HttpResponse {
    HttpResponse(status: status, headers: ["Content-Type": "text/plain; charset=utf-8"], body: Data(text.utf8))
  }
}

enum HttpRange: Equatable {
  case ignore
  case unsatisfiable
  case bytes(Int64, Int64)
}

enum Http {
  private static let reasons: [Int: String] = [
    200: "OK", 201: "Created", 204: "No Content", 206: "Partial Content",
    301: "Moved Permanently", 302: "Found", 304: "Not Modified", 307: "Temporary Redirect",
    400: "Bad Request", 401: "Unauthorized", 403: "Forbidden", 404: "Not Found",
    405: "Method Not Allowed", 411: "Length Required", 413: "Content Too Large",
    416: "Range Not Satisfiable", 431: "Request Header Fields Too Large",
    500: "Internal Server Error", 501: "Not Implemented", 503: "Service Unavailable",
    504: "Gateway Timeout",
  ]

  static func reason(_ status: Int) -> String {
    reasons[status] ?? "Status \(status)"
  }

  /// Lenient percent-decoding as UTF-8; malformed escapes are kept literally.
  static func decode(_ value: String, plusAsSpace: Bool) -> String {
    let input = Array(value.utf8)
    var output: [UInt8] = []
    output.reserveCapacity(input.count)
    var i = 0
    while i < input.count {
      let byte = input[i]
      if byte == UInt8(ascii: "%"), i + 2 < input.count, let hi = hexValue(input[i + 1]), let lo = hexValue(input[i + 2]) {
        output.append(hi << 4 | lo)
        i += 3
        continue
      }
      output.append(byte == UInt8(ascii: "+") && plusAsSpace ? UInt8(ascii: " ") : byte)
      i += 1
    }
    return String(decoding: output, as: UTF8.self)
  }

  private static func hexValue(_ byte: UInt8) -> UInt8? {
    switch byte {
    case UInt8(ascii: "0")...UInt8(ascii: "9"): return byte - UInt8(ascii: "0")
    case UInt8(ascii: "a")...UInt8(ascii: "f"): return byte - UInt8(ascii: "a") + 10
    case UInt8(ascii: "A")...UInt8(ascii: "F"): return byte - UInt8(ascii: "A") + 10
    default: return nil
    }
  }

  /// Parses `a=1&b=2` into `into`; the last value of a repeated name wins.
  static func parseQuery(_ query: String, into: inout [String: String]) {
    for pair in query.split(separator: "&", omittingEmptySubsequences: true) {
      if let eq = pair.firstIndex(of: "=") {
        into[decode(String(pair[..<eq]), plusAsSpace: true)] = decode(String(pair[pair.index(after: eq)...]), plusAsSpace: true)
      } else {
        into[decode(String(pair), plusAsSpace: true)] = ""
      }
    }
  }

  /// Splits `type; a=1; b="x;y"` into the lower-case type and its parameters (lower-case names).
  static func parseHeaderValue(_ value: String) -> (String, [String: String]) {
    var parts: [String] = []
    var current = ""
    var quoted = false
    var escaped = false
    for c in value {
      if escaped {
        current.append(c)
        escaped = false
      } else if c == "\\" && quoted {
        current.append(c)
        escaped = true
      } else if c == "\"" {
        quoted.toggle()
        current.append(c)
      } else if c == ";" && !quoted {
        parts.append(current)
        current = ""
      } else {
        current.append(c)
      }
    }
    parts.append(current)
    var params: [String: String] = [:]
    for part in parts.dropFirst() {
      guard let eq = part.firstIndex(of: "=") else { continue }
      var v = part[part.index(after: eq)...].trimmingCharacters(in: .whitespaces)
      if v.count >= 2 && v.hasPrefix("\"") && v.hasSuffix("\"") {
        v = String(v.dropFirst().dropLast()).replacingOccurrences(of: "\\\\(.)", with: "$1", options: .regularExpression)
      }
      params[part[..<eq].trimmingCharacters(in: .whitespaces).lowercased()] = v
    }
    return (parts[0].trimmingCharacters(in: .whitespaces).lowercased(), params)
  }

  /// Resolves a single `bytes=` range against `size`.
  static func parseRange(_ header: String, size: Int64) -> HttpRange {
    let spec = header.trimmingCharacters(in: .whitespaces)
    guard spec.lowercased().hasPrefix("bytes=") else { return .ignore }
    let range = spec.dropFirst(6).trimmingCharacters(in: .whitespaces)
    guard !range.contains(","), let dash = range.firstIndex(of: "-") else { return .ignore }
    let first = range[..<dash].trimmingCharacters(in: .whitespaces)
    let last = range[range.index(after: dash)...].trimmingCharacters(in: .whitespaces)
    if first.isEmpty {
      guard let suffix = Int64(last) else { return .ignore }
      if suffix <= 0 || size == 0 { return .unsatisfiable }
      return .bytes(max(0, size - suffix), size - 1)
    }
    guard let start = Int64(first) else { return .ignore }
    var end = size - 1
    if !last.isEmpty {
      guard let value = Int64(last) else { return .ignore }
      if start > value { return .ignore }
      end = value
    }
    if start >= size { return .unsatisfiable }
    return .bytes(start, min(end, size - 1))
  }
}
