import Foundation

/// Push parser for multipart/form-data. Text fields are decoded as UTF-8 into `form` (at most
/// `textLimit` bytes in total); file fields are streamed to temp files in `directory`, each
/// reported through `onTempFile` so the caller can delete them.
final class MultipartParser {
  private enum State {
    case preamble, delimiter, headers, body, end
  }

  private final class Part {
    let name: String?
    let filename: String?
    let url: URL?
    let handle: FileHandle?
    var text = Data()

    init(name: String?, filename: String?, url: URL?, handle: FileHandle?) {
      self.name = name
      self.filename = filename
      self.url = url
      self.handle = handle
    }
  }

  private static let crlf = Data("\r\n".utf8)
  private static let crlfCrlf = Data("\r\n\r\n".utf8)
  private static let maxPartHeaders = 16 * 1024

  private(set) var form: [String: String] = [:]
  private(set) var files: [String: HttpUpload] = [:]

  private let directory: URL
  private let textLimit: Int
  private let onTempFile: (URL) -> Void
  // The leading CRLF lets the first boundary match the same delimiter as the others.
  private let delimiter: Data
  private var buffer = Data("\r\n".utf8)
  private var state = State.preamble
  private var part: Part?
  private var textBytes = 0

  var isComplete: Bool { state == .end }

  init(boundary: String, directory: URL, textLimit: Int, onTempFile: @escaping (URL) -> Void) {
    delimiter = Data("\r\n--\(boundary)".utf8)
    self.directory = directory
    self.textLimit = textLimit
    self.onTempFile = onTempFile
  }

  func feed(_ data: Data) throws {
    if state == .end { return }
    buffer.append(data)
    while try step() {}
  }

  /// Closes an unfinished part's file; called when the body ends early or fails.
  func close() {
    try? part?.handle?.close()
    part = nil
  }

  private func step() throws -> Bool {
    switch state {
    case .preamble:
      guard let range = buffer.range(of: delimiter) else {
        consume(max(0, buffer.count - delimiter.count + 1))
        return false
      }
      consume(range.upperBound)
      state = .delimiter
      return true
    case .delimiter:
      if buffer.count >= 2 && buffer[0] == UInt8(ascii: "-") && buffer[1] == UInt8(ascii: "-") {
        state = .end
        buffer = Data()
        return false
      }
      // Skip optional transport padding up to the CRLF that ends the boundary line.
      guard let range = buffer.range(of: Self.crlf) else {
        if buffer.count > 256 { throw HttpError(status: 400, message: "Malformed multipart boundary") }
        return false
      }
      consume(range.upperBound)
      state = .headers
      return true
    case .headers:
      let headerEnd: Int
      let skip: Int
      if buffer.starts(with: Self.crlf) {
        headerEnd = 0
        skip = 2
      } else if let range = buffer.range(of: Self.crlfCrlf) {
        headerEnd = range.lowerBound
        skip = range.upperBound
      } else {
        if buffer.count > Self.maxPartHeaders { throw HttpError(status: 431, message: "Multipart headers too large") }
        return false
      }
      let headers = String(decoding: buffer.subdata(in: 0..<headerEnd), as: UTF8.self)
      consume(skip)
      part = try openPart(headers)
      state = .body
      return true
    case .body:
      guard let range = buffer.range(of: delimiter) else {
        let safe = buffer.count - delimiter.count + 1
        if safe > 0 {
          try write(safe)
          consume(safe)
        }
        return false
      }
      try write(range.lowerBound)
      consume(range.upperBound)
      try closePart()
      state = .delimiter
      return true
    case .end:
      return false
    }
  }

  private func openPart(_ headers: String) throws -> Part {
    var name: String?
    var filename: String?
    for line in headers.components(separatedBy: "\r\n") {
      guard let colon = line.firstIndex(of: ":"),
            line[..<colon].trimmingCharacters(in: .whitespaces).lowercased() == "content-disposition" else { continue }
      let params = Http.parseHeaderValue(String(line[line.index(after: colon)...])).1
      name = params["name"]
      filename = params["filename"]
    }
    guard let name, let filename else {
      return Part(name: name, filename: nil, url: nil, handle: nil)
    }
    let url = directory.appendingPathComponent("httpd-\(UUID().uuidString).upload")
    guard FileManager.default.createFile(atPath: url.path, contents: nil) else {
      throw HttpError(status: 500, message: "Cannot create upload file")
    }
    onTempFile(url)
    return Part(name: name, filename: filename, url: url, handle: try FileHandle(forWritingTo: url))
  }

  private func write(_ length: Int) throws {
    guard let part, length > 0 else { return }
    let chunk = buffer.subdata(in: 0..<length)
    if let handle = part.handle {
      try handle.write(contentsOf: chunk)
    } else if part.name != nil {
      textBytes += length
      if textBytes > textLimit { throw HttpError(status: 413, message: "Form fields too large") }
      part.text.append(chunk)
    }
  }

  private func closePart() throws {
    guard let current = part else { return }
    part = nil
    try current.handle?.close()
    guard let name = current.name else { return }
    guard let url = current.url, let filename = current.filename else {
      form[name] = String(decoding: current.text, as: UTF8.self)
      return
    }
    let size = (try? FileManager.default.attributesOfItem(atPath: url.path)[.size] as? NSNumber)?.int64Value ?? 0
    // Browsers send an empty part with filename="" for a file input left blank.
    if !filename.isEmpty || size > 0 {
      files[name] = HttpUpload(url: url, name: filename, size: size)
    }
  }

  private func consume(_ count: Int) {
    buffer = count >= buffer.count ? Data() : buffer.subdata(in: count..<buffer.count)
  }
}
