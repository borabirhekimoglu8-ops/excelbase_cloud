import Foundation

public actor PhotoVault {
    private let database: AppDatabase
    private let directory: URL
    private let transcoder: PhotoTranscoder
    private let matcher: PhotoMatcher
    private let bridge: any RustImportBridge
    private let stager: StagedFileManager

    public init(
        database: AppDatabase,
        transcoder: PhotoTranscoder = PhotoTranscoder(),
        matcher: PhotoMatcher = PhotoMatcher(),
        bridge: any RustImportBridge = DelimitedTextBridge()
    ) {
        self.database = database
        self.directory = database.containerURL.appendingPathComponent("Photos", isDirectory: true)
        self.transcoder = transcoder
        self.matcher = matcher
        self.bridge = bridge
        self.stager = StagedFileManager(containerURL: database.containerURL)
    }

    /// Imports serially to keep peak memory bounded; the input array has no artificial count cap.
    public func importPhotos(urls: [URL]) async throws {
        try ProtectedContainer.prepareDirectory(at: directory)
        let passengers = try database.fetchPassengers(search: nil, limit: Int.max, offset: 0)
        var successes = 0
        var failures: [String] = []
        for source in urls {
            try Task.checkCancellation()
            do {
                if source.pathExtension.lowercased() == "zip" {
                    successes += try await importArchive(source, passengers: passengers)
                } else {
                    let didAccess = source.startAccessingSecurityScopedResource()
                    defer { if didAccess { source.stopAccessingSecurityScopedResource() } }
                    _ = try importSingle(source, originalName: source.lastPathComponent, passengers: passengers)
                    successes += 1
                }
            } catch {
                failures.append("\(source.lastPathComponent): \(error.localizedDescription)")
            }
            await Task.yield()
        }
        if successes == 0, !failures.isEmpty { throw PhotoImportAggregateError(messages: failures) }
    }

    private func importArchive(_ source: URL, passengers: [Passenger]) async throws -> Int {
        let staged = try await stager.stage(url: source)
        defer { try? FileManager.default.removeItem(at: staged.url) }
        let extractionBase = database.containerURL.appendingPathComponent("Staging/PhotoZIP", isDirectory: true)
        try ProtectedContainer.prepareDirectory(at: extractionBase)
        let summary = try await bridge.extractPhotoZIP(input: staged.url, extractionDirectory: extractionBase)
        let base = extractionBase.resolvingSymlinksInPath().standardizedFileURL
        let root = summary.extractionDirectory.resolvingSymlinksInPath().standardizedFileURL
        guard root.path.hasPrefix(base.path + "/") else { throw PhotoArchiveError.pathEscapedRoot }
        defer { try? FileManager.default.removeItem(at: root) }
        let manifestURL = summary.manifestURL.resolvingSymlinksInPath().standardizedFileURL
        guard manifestURL.path.hasPrefix(root.path + "/") else { throw PhotoArchiveError.pathEscapedRoot }
        let data = try Data(contentsOf: manifestURL, options: .mappedIfSafe)
        let records = data.split(separator: 0x0A, omittingEmptySubsequences: true)
        guard records.count == summary.fileCount else { throw PhotoArchiveError.manifestCountMismatch }
        var successes = 0
        var failures: [String] = []
        for recordData in records {
            try Task.checkCancellation()
            let record = try JSONDecoder().decode(PhotoManifestRow.self, from: Data(recordData))
            let photoURL = URL(fileURLWithPath: record.path).resolvingSymlinksInPath().standardizedFileURL
            guard photoURL.path.hasPrefix(root.path + "/") else { throw PhotoArchiveError.pathEscapedRoot }
            do {
                _ = try importSingle(photoURL, originalName: record.originalName, passengers: passengers)
                successes += 1
            } catch {
                failures.append("\(record.originalName): \(error.localizedDescription)")
            }
            await Task.yield()
        }
        if successes == 0, !failures.isEmpty { throw PhotoImportAggregateError(messages: failures) }
        return successes
    }

    @discardableResult
    private func importSingle(_ source: URL, originalName: String, passengers: [Passenger]) throws -> Bool {
        let id = UUID()
        let relativePath = "Photos/\(id.uuidString).jpg"
        let destination = database.containerURL.appendingPathComponent(relativePath)
        do {
            let converted = try transcoder.transcode(source: source, destination: destination)
            if try database.hasPhoto(sha256: converted.sha256) {
                try? FileManager.default.removeItem(at: destination)
                return false
            }
            let match = matcher.bestMatch(fileName: originalName, passengers: passengers)
            let photo = PassengerPhoto(
                id: id,
                passengerID: match?.passengerID,
                originalFileName: originalName,
                fileURL: destination,
                sha256: converted.sha256,
                matchConfidence: match?.confidence
            )
            try database.savePhoto(photo, relativePath: relativePath)
            return true
        } catch {
            try? FileManager.default.removeItem(at: destination)
            throw error
        }
    }
}

private struct PhotoManifestRow: Decodable {
    let path: String
    let originalName: String
    let bytes: UInt64

    enum CodingKeys: String, CodingKey {
        case path
        case originalName = "original_name"
        case bytes
    }
}

public enum PhotoArchiveError: LocalizedError, Sendable {
    case manifestCountMismatch
    case pathEscapedRoot

    public var errorDescription: String? {
        switch self {
        case .manifestCountMismatch: "Fotoğraf ZIP manifesti eksik veya tutarsız."
        case .pathEscapedRoot: "Fotoğraf ZIP dosyası güvenli çalışma alanının dışına çıkmaya çalıştı."
        }
    }
}

public struct PhotoImportAggregateError: LocalizedError, Sendable {
    public let messages: [String]

    public var errorDescription: String? {
        "Seçilen fotoğraflar işlenemedi:\n" + messages.prefix(8).joined(separator: "\n")
    }
}
