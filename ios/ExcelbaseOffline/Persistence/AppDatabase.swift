import CryptoKit
import Foundation
import GRDB

public final class AppDatabase: @unchecked Sendable {
    private let pool: DatabasePool
    private let cipher: any RecordCiphering
    public let databaseURL: URL
    public let containerURL: URL

    public init(
        databaseURL: URL,
        cipher: (any RecordCiphering)? = nil
    ) throws {
        self.databaseURL = databaseURL
        self.containerURL = databaseURL.deletingLastPathComponent()
        self.cipher = try cipher ?? AESGCMRecordCipher()

        try ProtectedContainer.prepareDirectory(at: containerURL)
        var configuration = Configuration()
        configuration.label = "ExcelbaseOffline"
        configuration.foreignKeysEnabled = true
        configuration.busyMode = .timeout(5)
        configuration.prepareDatabase { db in
            try db.execute(sql: "PRAGMA synchronous = FULL")
        }
        pool = try DatabasePool(path: databaseURL.path, configuration: configuration)
        try Self.migrator.migrate(pool)
        try ProtectedContainer.protectFile(at: databaseURL)
        try recoverInterruptedJobs()
    }

    public func fetchPassengers(search: String? = nil, limit: Int = 500, offset: Int = 0) throws -> [Passenger] {
        let safeLimit = max(0, limit)
        let safeOffset = max(0, offset)
        return try pool.read { db in
            let photoRows = try Row.fetchAll(db, sql: """
                SELECT passengerID, relativePath
                FROM passenger_photos
                WHERE passengerID IS NOT NULL
                ORDER BY createdAt DESC
                """)
            var photoPaths: [UUID: String] = [:]
            for row in photoRows {
                guard
                    let idString: String = row["passengerID"],
                    let id = UUID(uuidString: idString),
                    photoPaths[id] == nil
                else { continue }
                photoPaths[id] = row["relativePath"]
            }

            let rows = try Row.fetchAll(db, sql: """
                SELECT id, ciphertext
                FROM passenger_records
                ORDER BY sortOrder ASC, createdAt ASC, id ASC
                """)
            let needle = search?
                .trimmingCharacters(in: .whitespacesAndNewlines)
                .folding(options: [.caseInsensitive, .diacriticInsensitive], locale: .current)
            var skipped = 0
            var decoded: [Passenger] = []
            decoded.reserveCapacity(rows.count)

            for row in rows {
                guard
                    let id = UUID(uuidString: row["id"]),
                    let payload: Data = row["ciphertext"]
                else { throw OfflineDataError.corruptRecord }
                var passenger = try cipher.decrypt(Passenger.self, from: payload, recordID: id)
                if let relativePath = photoPaths[id] {
                    passenger.photoRef = relativePath
                }
                decoded.append(passenger)
            }
            let duplicateCounts = Dictionary(grouping: decoded.filter { !$0.duplicateIdentityKey.isEmpty }, by: \.duplicateIdentityKey)
                .mapValues(\.count)
            var result: [Passenger] = []
            for var passenger in decoded {
                passenger.duplicate = duplicateCounts[passenger.duplicateIdentityKey, default: 0] > 1
                if let needle, !needle.isEmpty {
                    let haystack = "\(passenger.fullName) \(passenger.passportNumber) \(passenger.voucher) \(passenger.departureDate)"
                        .folding(options: [.caseInsensitive, .diacriticInsensitive], locale: .current)
                    guard haystack.contains(needle) else { continue }
                }
                if skipped < safeOffset { skipped += 1; continue }
                guard result.count < safeLimit else { break }
                result.append(passenger)
            }
            return result
        }
    }

    public func passengerCount() throws -> Int {
        try pool.read { db in try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM passenger_records") ?? 0 }
    }

    public func fetchImportJobs() throws -> [ImportJob] {
        try pool.read { db in
            try Row.fetchAll(db, sql: "SELECT * FROM import_jobs ORDER BY createdAt DESC")
                .map(Self.decodeJob)
        }
    }

    public func fetchPhotos(limit: Int = 500) throws -> [PassengerPhoto] {
        try pool.read { db in
            try Row.fetchAll(
                db,
                sql: "SELECT * FROM passenger_photos ORDER BY createdAt DESC LIMIT ?",
                arguments: [max(0, limit)]
            ).map { row in
                guard let id = UUID(uuidString: row["id"]) else { throw OfflineDataError.corruptRecord }
                let passengerString: String? = row["passengerID"]
                return PassengerPhoto(
                    id: id,
                    passengerID: passengerString.flatMap(UUID.init(uuidString:)),
                    originalFileName: row["originalFileName"],
                    fileURL: containerURL.appendingPathComponent(row["relativePath"] as String),
                    sha256: row["sha256"],
                    matchConfidence: row["matchConfidence"],
                    createdAt: Date(timeIntervalSince1970: row["createdAt"])
                )
            }
        }
    }

    public func fetchArchives() throws -> [ArchiveRecord] {
        let stored: [ArchiveRecord] = try pool.read { db in
            try Row.fetchAll(db, sql: "SELECT * FROM archives ORDER BY createdAt DESC").map { row in
                guard let id = UUID(uuidString: row["id"]) else { throw OfflineDataError.corruptRecord }
                return ArchiveRecord(
                    id: id,
                    name: row["name"],
                    relativePath: row["relativePath"],
                    passengerCount: row["passengerCount"],
                    createdAt: Date(timeIntervalSince1970: row["createdAt"])
                )
            }
        }
        let passengers = try fetchPassengers(search: nil, limit: Int.max, offset: 0)
        let groups = Dictionary(
            grouping: passengers.filter { !$0.normalizedDepartureDate.isEmpty },
            by: \.normalizedDepartureDate
        )
        var byName = Dictionary(uniqueKeysWithValues: stored.map { ($0.name, $0) })
        for (date, members) in groups {
            byName[date] = ArchiveRecord(
                id: Self.stableArchiveID(date),
                name: date,
                relativePath: "",
                passengerCount: members.count,
                createdAt: members.map(\.createdAt).min() ?? Date()
            )
        }
        return byName.values.sorted { $0.name > $1.name }
    }

    public func eraseAll() throws {
        try pool.write { db in
            try db.execute(sql: "DELETE FROM import_staging_rows")
            try db.execute(sql: "DELETE FROM import_jobs")
            try db.execute(sql: "DELETE FROM import_batches")
            try db.execute(sql: "DELETE FROM passenger_photos")
            try db.execute(sql: "DELETE FROM passenger_records")
            try db.execute(sql: "DELETE FROM archives")
        }
        for directory in ["Staging", "Photos", "Exports", "Backups"] {
            let url = containerURL.appendingPathComponent(directory, isDirectory: true)
            try? FileManager.default.removeItem(at: url)
        }
    }

}

extension AppDatabase {
    struct JobContext: Sendable {
        let job: ImportJob
        let batchID: UUID
        let stagedPath: String
        let sha256: String
        let checkpointRow: Int
        let outputPath: String?
    }

    func createImportBatch(
        replaceExisting: Bool,
        duplicateStrategy: DuplicateStrategy
    ) throws -> UUID {
        let id = UUID()
        try pool.write { db in
            try db.execute(
                sql: "INSERT INTO import_batches (id, replaceRequested, replaceConsumed, duplicateStrategy, createdAt) VALUES (?, ?, 0, ?, ?)",
                arguments: [id.uuidString, replaceExisting, duplicateStrategy.rawValue, Date().timeIntervalSince1970]
            )
        }
        return id
    }

    func createImportJob(
        id: UUID = UUID(),
        batchID: UUID,
        fileName: String,
        stagedPath: String,
        sha256: String
    ) throws -> UUID {
        let now = Date().timeIntervalSince1970
        try pool.write { db in
            try db.execute(
                sql: """
                    INSERT INTO import_jobs
                    (id, batchID, fileName, status, totalRows, processedRows, message, stagedPath,
                     sha256, checkpointRow, outputPath, createdAt, updatedAt)
                    VALUES (?, ?, ?, ?, 0, 0, NULL, ?, ?, 0, NULL, ?, ?)
                    """,
                arguments: [
                    id.uuidString, batchID.uuidString, fileName, ImportStatus.queued.rawValue,
                    stagedPath, sha256, now, now
                ]
            )
        }
        return id
    }

    func createFailedImportJob(batchID: UUID, fileName: String, message: String) throws {
        let now = Date().timeIntervalSince1970
        try pool.write { db in
            try db.execute(
                sql: """
                    INSERT INTO import_jobs
                    (id, batchID, fileName, status, totalRows, processedRows, message, stagedPath,
                     sha256, checkpointRow, outputPath, createdAt, updatedAt)
                    VALUES (?, ?, ?, ?, 0, 0, ?, '', '', 0, NULL, ?, ?)
                    """,
                arguments: [
                    UUID().uuidString, batchID.uuidString, fileName, ImportStatus.failed.rawValue,
                    message, now, now
                ]
            )
        }
    }

    func nextRunnableJob() throws -> JobContext? {
        try pool.read { db in
            guard let row = try Row.fetchOne(db, sql: """
                SELECT * FROM import_jobs
                WHERE status = ?
                ORDER BY createdAt ASC
                LIMIT 1
                """, arguments: [ImportStatus.queued.rawValue]) else { return nil }
            return try Self.decodeContext(row)
        }
    }

    func requeuePausedJobs() throws {
        try pool.write { db in
            try db.execute(
                sql: """
                    UPDATE import_jobs
                    SET status = ?, message = NULL, updatedAt = ?
                    WHERE status = ?
                    """,
                arguments: [
                    ImportStatus.queued.rawValue, Date().timeIntervalSince1970,
                    ImportStatus.paused.rawValue
                ]
            )
        }
    }

    func jobContext(id: UUID) throws -> JobContext? {
        try pool.read { db in
            guard let row = try Row.fetchOne(db, sql: "SELECT * FROM import_jobs WHERE id = ?", arguments: [id.uuidString]) else {
                return nil
            }
            return try Self.decodeContext(row)
        }
    }

    func transitionJob(
        id: UUID,
        to next: ImportStatus,
        message: String? = nil,
        totalRows: Int? = nil,
        outputPath: String? = nil
    ) throws {
        try pool.write { db in
            guard let raw: String = try String.fetchOne(
                db,
                sql: "SELECT status FROM import_jobs WHERE id = ?",
                arguments: [id.uuidString]
            ), let current = ImportStatus(rawValue: raw) else { throw OfflineDataError.missingJob(id) }
            guard current == next || Self.allowedTransitions[current, default: []].contains(next) else {
                throw OfflineDataError.invalidState(from: current, to: next)
            }
            try db.execute(
                sql: """
                    UPDATE import_jobs
                    SET status = ?, message = COALESCE(?, message),
                        totalRows = COALESCE(?, totalRows), outputPath = COALESCE(?, outputPath),
                        updatedAt = ?
                    WHERE id = ?
                    """,
                arguments: [next.rawValue, message, totalRows, outputPath, Date().timeIntervalSince1970, id.uuidString]
            )
        }
    }

    func replaceJobMessage(id: UUID, message: String?) throws {
        try pool.write { db in
            try db.execute(
                sql: "UPDATE import_jobs SET message = ?, updatedAt = ? WHERE id = ?",
                arguments: [message, Date().timeIntervalSince1970, id.uuidString]
            )
        }
    }

    /// Persists parser output without reviving a job that was paused or cancelled
    /// while the synchronous Rust parser was running.
    func recordParsedOutputIfStillImporting(
        id: UUID,
        totalRows: Int,
        outputPath: String
    ) throws -> Bool {
        try pool.write { db in
            let raw: String? = try String.fetchOne(
                db,
                sql: "SELECT status FROM import_jobs WHERE id = ?",
                arguments: [id.uuidString]
            )
            guard raw == ImportStatus.importing.rawValue else { return false }
            try db.execute(
                sql: """
                    UPDATE import_jobs
                    SET message = ?, totalRows = ?, outputPath = ?, updatedAt = ?
                    WHERE id = ?
                    """,
                arguments: [
                    "Satırlar güvenli alana aktarılıyor.", totalRows, outputPath,
                    Date().timeIntervalSince1970, id.uuidString
                ]
            )
            return true
        }
    }

    func stagePassengers(_ passengers: [Passenger], jobID: UUID, checkpointRow: Int) throws {
        guard passengers.count <= 250 else { throw DatabaseInvariantError.batchTooLarge(passengers.count) }
        let encrypted = try passengers.map { passenger in
            (passenger, try cipher.encrypt(passenger, recordID: passenger.id))
        }
        try pool.write { db in
            let raw: String? = try String.fetchOne(
                db,
                sql: "SELECT status FROM import_jobs WHERE id = ?",
                arguments: [jobID.uuidString]
            )
            guard raw == ImportStatus.importing.rawValue else { throw OfflineDataError.cancelled }
            for (offset, item) in encrypted.enumerated() {
                try db.execute(
                    sql: """
                        INSERT OR REPLACE INTO import_staging_rows
                        (jobID, rowNumber, passengerID, ciphertext, identityKey, sortOrder, createdAt)
                        VALUES (?, ?, ?, ?, ?, ?, ?)
                        """,
                    arguments: [
                        jobID.uuidString, checkpointRow + offset + 1, item.0.id.uuidString,
                        item.1, item.0.identityStorageKey, item.0.sortOrder, Date().timeIntervalSince1970
                    ]
                )
            }
            let newCheckpoint = checkpointRow + encrypted.count
            try db.execute(
                sql: """
                    UPDATE import_jobs
                    SET checkpointRow = ?, processedRows = ?, updatedAt = ?
                    WHERE id = ?
                    """,
                arguments: [newCheckpoint, newCheckpoint, Date().timeIntervalSince1970, jobID.uuidString]
            )
        }
    }

    func commitStagedPassengers(jobID: UUID) throws {
        try pool.write { db in
            guard let row = try Row.fetchOne(db, sql: "SELECT * FROM import_jobs WHERE id = ?", arguments: [jobID.uuidString]) else {
                throw OfflineDataError.missingJob(jobID)
            }
            let state = ImportStatus(rawValue: row["status"] as String)
            guard state == .committing else {
                throw OfflineDataError.invalidState(from: state ?? .failed, to: .completed)
            }
            guard
                let batchID = UUID(uuidString: row["batchID"]),
                let batch = try Row.fetchOne(db, sql: "SELECT * FROM import_batches WHERE id = ?", arguments: [batchID.uuidString])
            else { throw OfflineDataError.corruptRecord }
            let stagedCount = try Int.fetchOne(
                db,
                sql: "SELECT COUNT(*) FROM import_staging_rows WHERE jobID = ?",
                arguments: [jobID.uuidString]
            ) ?? 0
            guard stagedCount > 0 else { throw DatabaseInvariantError.emptyImport }
            let replaceRequested: Bool = batch["replaceRequested"]
            let replaceConsumed: Bool = batch["replaceConsumed"]
            let duplicateStrategy = DuplicateStrategy(rawValue: batch["duplicateStrategy"] as String) ?? .skip
            if replaceRequested && !replaceConsumed {
                try db.execute(sql: "DELETE FROM passenger_records")
                try db.execute(
                    sql: "UPDATE import_batches SET replaceConsumed = 1 WHERE id = ? AND replaceConsumed = 0",
                    arguments: [batchID.uuidString]
                )
            }
            let now = Date().timeIntervalSince1970
            var existingByKey: [String: (id: String, sortOrder: Int)] = [:]
            var nextSortOrder = (try Int.fetchOne(db, sql: "SELECT MAX(sortOrder) FROM passenger_records") ?? -1) + 1
            for existing in try Row.fetchAll(
                db,
                sql: "SELECT id, identityKey, sortOrder FROM passenger_records WHERE identityKey <> ''"
            ) {
                let key: String = existing["identityKey"]
                existingByKey[key] = (existing["id"], existing["sortOrder"])
            }
            for staged in try Row.fetchAll(
                db,
                sql: "SELECT passengerID, ciphertext, identityKey, sortOrder, createdAt FROM import_staging_rows WHERE jobID = ? ORDER BY rowNumber",
                arguments: [jobID.uuidString]
            ) {
                guard let passengerID = UUID(uuidString: staged["passengerID"]), let payload: Data = staged["ciphertext"] else {
                    throw OfflineDataError.corruptRecord
                }
                let passenger = try cipher.decrypt(Passenger.self, from: payload, recordID: passengerID)
                let identity = passenger.identityStorageKey
                if let existing = existingByKey[identity], !identity.isEmpty {
                    if duplicateStrategy == .skip { continue }
                    if duplicateStrategy == .overwrite {
                        guard let existingUUID = UUID(uuidString: existing.id) else { throw OfflineDataError.corruptRecord }
                        let replacement = passenger.replacingID(existingUUID, sortOrder: existing.sortOrder)
                        let replacementPayload = try cipher.encrypt(replacement, recordID: existingUUID)
                        try db.execute(
                            sql: "UPDATE passenger_records SET ciphertext = ?, identityKey = ?, sortOrder = ?, sourceJobID = ?, updatedAt = ? WHERE id = ?",
                            arguments: [replacementPayload, replacement.identityStorageKey, replacement.sortOrder, jobID.uuidString, now, existing.id]
                        )
                        // Keeping the row ID preserves passenger_photos foreign-key matches.
                        continue
                    }
                }
                let persisted = passenger.replacingID(passengerID, sortOrder: nextSortOrder)
                let persistedPayload = try cipher.encrypt(persisted, recordID: passengerID)
                try db.execute(
                    sql: "INSERT OR REPLACE INTO passenger_records (id, ciphertext, identityKey, sortOrder, sourceJobID, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)",
                    arguments: [passengerID.uuidString, persistedPayload, persisted.identityStorageKey, nextSortOrder, jobID.uuidString, staged["createdAt"] as Double, now]
                )
                if !identity.isEmpty { existingByKey[identity] = (passengerID.uuidString, nextSortOrder) }
                nextSortOrder += 1
            }
            try db.execute(sql: "DELETE FROM import_staging_rows WHERE jobID = ?", arguments: [jobID.uuidString])
            try db.execute(
                sql: """
                    UPDATE import_jobs
                    SET status = ?, totalRows = processedRows, message = NULL, updatedAt = ?
                    WHERE id = ?
                    """,
                arguments: [ImportStatus.completed.rawValue, now, jobID.uuidString]
            )
        }
    }

    func retryImportJob(id: UUID) throws {
        try pool.write { db in
            guard let raw: String = try String.fetchOne(db, sql: "SELECT status FROM import_jobs WHERE id = ?", arguments: [id.uuidString]),
                  let current = ImportStatus(rawValue: raw) else { throw OfflineDataError.missingJob(id) }
            guard current == .failed || current == .paused || current == .cancelled else {
                throw OfflineDataError.invalidState(from: current, to: .queued)
            }
            try db.execute(
                sql: "UPDATE import_jobs SET status = ?, message = NULL, updatedAt = ? WHERE id = ?",
                arguments: [ImportStatus.queued.rawValue, Date().timeIntervalSince1970, id.uuidString]
            )
        }
    }

    func removeImportJob(id: UUID) throws {
        try pool.write { db in
            try db.execute(sql: "DELETE FROM import_jobs WHERE id = ?", arguments: [id.uuidString])
        }
    }

    func recoverInterruptedJobs() throws {
        try pool.write { db in
            try db.execute(
                sql: """
                    UPDATE import_jobs
                    SET status = ?, message = ?, updatedAt = ?
                    WHERE status IN (?, ?, ?)
                    """,
                arguments: [
                    ImportStatus.paused.rawValue, "Uygulama kapandı; kaldığı yerden devam etmeye hazır.",
                    Date().timeIntervalSince1970, ImportStatus.staging.rawValue,
                    ImportStatus.importing.rawValue, ImportStatus.committing.rawValue
                ]
            )
        }
    }

    func savePhoto(_ photo: PassengerPhoto, relativePath: String) throws {
        try pool.write { db in
            try db.execute(
                sql: """
                    INSERT INTO passenger_photos
                    (id, passengerID, originalFileName, relativePath, sha256, matchConfidence, createdAt)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                arguments: [
                    photo.id.uuidString, photo.passengerID?.uuidString, photo.originalFileName,
                    relativePath, photo.sha256, photo.matchConfidence, photo.createdAt.timeIntervalSince1970
                ]
            )
        }
    }

    func hasPhoto(sha256: String) throws -> Bool {
        try pool.read { db in
            (try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM passenger_photos WHERE sha256 = ?", arguments: [sha256]) ?? 0) > 0
        }
    }

    func addArchive(_ archive: ArchiveRecord) throws {
        try pool.write { db in
            try db.execute(
                sql: "INSERT INTO archives (id, name, relativePath, passengerCount, createdAt) VALUES (?, ?, ?, ?, ?)",
                arguments: [archive.id.uuidString, archive.name, archive.relativePath, archive.passengerCount, archive.createdAt.timeIntervalSince1970]
            )
        }
    }

    private static let allowedTransitions: [ImportStatus: Set<ImportStatus>] = [
        .queued: [.staging, .importing, .failed, .cancelled],
        .staging: [.importing, .paused, .failed, .cancelled],
        .importing: [.paused, .committing, .failed, .cancelled],
        .paused: [.queued, .importing, .failed, .cancelled],
        .committing: [.completed, .paused, .failed],
        .completed: [],
        .failed: [.queued, .cancelled],
        .cancelled: [.queued]
    ]

    private static func decodeJob(_ row: Row) throws -> ImportJob {
        guard
            let id = UUID(uuidString: row["id"]),
            let status = ImportStatus(rawValue: row["status"])
        else { throw OfflineDataError.corruptRecord }
        return ImportJob(
            id: id,
            fileName: row["fileName"],
            status: status,
            totalRows: row["totalRows"],
            processedRows: row["processedRows"],
            message: row["message"],
            createdAt: Date(timeIntervalSince1970: row["createdAt"]),
            updatedAt: Date(timeIntervalSince1970: row["updatedAt"])
        )
    }

    private static func stableArchiveID(_ value: String) -> UUID {
        let hex = SHA256.hash(data: Data("archive:\(value)".utf8))
            .prefix(16)
            .map { String(format: "%02x", $0) }
            .joined()
        let formatted = "\(hex.prefix(8))-\(hex.dropFirst(8).prefix(4))-\(hex.dropFirst(12).prefix(4))-\(hex.dropFirst(16).prefix(4))-\(hex.dropFirst(20).prefix(12))"
        return UUID(uuidString: formatted) ?? UUID()
    }

    private static func decodeContext(_ row: Row) throws -> JobContext {
        guard let batchID = UUID(uuidString: row["batchID"] as String) else {
            throw OfflineDataError.corruptRecord
        }
        return JobContext(
            job: try decodeJob(row),
            batchID: batchID,
            stagedPath: row["stagedPath"],
            sha256: row["sha256"],
            checkpointRow: row["checkpointRow"],
            outputPath: row["outputPath"]
        )
    }
}

public enum DatabaseInvariantError: LocalizedError, Sendable {
    case batchTooLarge(Int)
    case emptyImport

    public var errorDescription: String? {
        switch self {
        case let .batchTooLarge(count): "Atomic staging batches are limited to 250 rows (received \(count))."
        case .emptyImport: "Aktarılabilir yolcu satırı bulunamadı."
        }
    }
}
