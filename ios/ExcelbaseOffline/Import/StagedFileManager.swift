import CryptoKit
import Foundation

public struct StagedFile: Hashable, Sendable {
    public let id: UUID
    public let originalName: String
    public let url: URL
    public let sha256: String
    public let byteCount: Int64
}

public actor StagedFileManager {
    private let directory: URL

    public init(containerURL: URL) {
        directory = containerURL.appendingPathComponent("Staging", isDirectory: true)
    }

    /// Stages every selected file serially. There is intentionally no file-count ceiling.
    public func stage(urls: [URL]) async throws -> [StagedFile] {
        try ProtectedContainer.prepareDirectory(at: directory)
        var result: [StagedFile] = []
        result.reserveCapacity(urls.count)
        for url in urls {
            try Task.checkCancellation()
            result.append(try stage(url: url))
            await Task.yield()
        }
        return result
    }

    public func stage(url: URL) throws -> StagedFile {
        try ProtectedContainer.prepareDirectory(at: directory)
        let didAccess = url.startAccessingSecurityScopedResource()
        defer { if didAccess { url.stopAccessingSecurityScopedResource() } }

        let id = UUID()
        let ext = url.pathExtension.lowercased().filter { $0.isLetter || $0.isNumber }
        let finalName = ext.isEmpty ? id.uuidString : "\(id.uuidString).\(ext)"
        let temporary = directory.appendingPathComponent(".\(id.uuidString).partial")
        let destination = directory.appendingPathComponent(finalName)
        FileManager.default.createFile(atPath: temporary.path, contents: nil)

        do {
            let input = try FileHandle(forReadingFrom: url)
            let output = try FileHandle(forWritingTo: temporary)
            defer {
                try? input.close()
                try? output.close()
            }
            var hasher = SHA256()
            var byteCount: Int64 = 0
            while true {
                let data = try input.read(upToCount: 1_048_576) ?? Data()
                if data.isEmpty { break }
                hasher.update(data: data)
                try output.write(contentsOf: data)
                byteCount += Int64(data.count)
            }
            try output.synchronize()
            try ProtectedContainer.protectFile(at: temporary)
            try FileManager.default.moveItem(at: temporary, to: destination)
            return StagedFile(
                id: id,
                originalName: url.lastPathComponent,
                url: destination,
                sha256: hasher.finalize().map { String(format: "%02x", $0) }.joined(),
                byteCount: byteCount
            )
        } catch {
            try? FileManager.default.removeItem(at: temporary)
            throw error
        }
    }
}
