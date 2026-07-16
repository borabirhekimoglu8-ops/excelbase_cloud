import Foundation

actor LiveAppDataProvider: AppDataProviding {
    private struct Dependencies: Sendable {
        let database: AppDatabase
        let coordinator: ImportCoordinator
        let photoVault: PhotoVault
        let exporter: ExportService
    }

    private let startup: Result<Dependencies, LiveProviderError>

    init() {
        do {
            guard let applicationSupport = FileManager.default.urls(
                for: .applicationSupportDirectory,
                in: .userDomainMask
            ).first else {
                throw LiveProviderError.applicationSupportUnavailable
            }
            let container = applicationSupport.appendingPathComponent("ExcelbaseOffline", isDirectory: true)
            let database = try AppDatabase(databaseURL: container.appendingPathComponent("excelbase.sqlite"))
            let bridge = Self.makeRustBridge()
            startup = .success(
                Dependencies(
                    database: database,
                    coordinator: ImportCoordinator(database: database, bridge: bridge),
                    photoVault: PhotoVault(database: database, bridge: bridge),
                    exporter: ExportService(database: database, bridge: bridge)
                )
            )
        } catch {
            startup = .failure(.startup(error.localizedDescription))
        }
    }

    func prepare() async throws {
        _ = try dependencies()
    }

    func dashboard() async throws -> DashboardSnapshot {
        let dependencies = try dependencies()
        let passengers = try dependencies.database.fetchPassengers(search: nil, limit: Int.max, offset: 0)
        let jobs = try dependencies.database.fetchImportJobs()
        let photos = try dependencies.database.fetchPhotos(limit: Int.max)

        return DashboardSnapshot(
            passengerCount: try dependencies.database.passengerCount(),
            readyCount: passengers.filter { $0.issues.isEmpty }.count,
            missingPhotoCount: passengers.filter { !$0.hasPhoto }.count,
            issueCount: passengers.filter { !$0.issues.isEmpty }.count,
            matchedPhotoCount: photos.filter { $0.passengerID != nil }.count,
            adultFeeTotal: passengers.reduce(Decimal.zero) { $0 + Self.decimal($1.adultFee) },
            childFeeTotal: passengers.reduce(Decimal.zero) { $0 + Self.decimal($1.childFee) },
            lastImportAt: jobs.filter { $0.status == .completed }.map(\.updatedAt).max()
        )
    }

    func passengers(query: String) async throws -> [PassengerSummary] {
        let database = try dependencies().database
        return try database.fetchPassengers(
            search: query.isEmpty ? nil : query,
            limit: Int.max,
            offset: 0
        ).map { passenger in
            PassengerSummary(
                id: passenger.id.uuidString,
                fullName: passenger.fullName,
                passportNumber: passenger.passportNumber,
                voucher: passenger.voucher.nilIfEmpty,
                departureDate: Self.date(passenger.departureDate),
                arrivalDate: Self.date(passenger.arrivalDate),
                adultFee: Self.decimal(passenger.adultFee),
                childFee: Self.decimal(passenger.childFee),
                hasPhoto: passenger.hasPhoto,
                issues: passenger.issues,
                isDuplicate: passenger.duplicate
            )
        }
    }

    func importJobs() async throws -> [ImportJobSummary] {
        try dependencies().database.fetchImportJobs().map { job in
            ImportJobSummary(
                id: job.id.uuidString,
                fileName: job.fileName,
                phase: Self.phase(job.status),
                processedRows: job.processedRows,
                totalRows: job.totalRows,
                message: job.message
            )
        }
    }

    func enqueue(
        files: [URL],
        replaceExisting: Bool,
        strategy: ImportDuplicateStrategy
    ) async throws {
        try await dependencies().coordinator.enqueueThrowing(
            urls: files,
            replaceExisting: replaceExisting,
            strategy: DuplicateStrategy(rawValue: strategy.rawValue) ?? .skip
        )
    }

    func resumeImports() async throws {
        let coordinator = try dependencies().coordinator
        await coordinator.resumePending()
    }

    func retryImport(id: String) async throws {
        let coordinator = try dependencies().coordinator
        try await coordinator.retry(jobID: try Self.uuid(id))
    }

    func removeImport(id: String) async throws {
        let coordinator = try dependencies().coordinator
        try await coordinator.remove(jobID: try Self.uuid(id))
    }

    func importPhotos(files: [URL]) async throws {
        let vault = try dependencies().photoVault
        try await vault.importPhotos(urls: files)
    }

    func photos() async throws -> [PhotoSummary] {
        let database = try dependencies().database
        let passengers = try database.fetchPassengers(search: nil, limit: Int.max, offset: 0)
        let passengerByID = Dictionary(uniqueKeysWithValues: passengers.map { ($0.id, $0) })
        return try database.fetchPhotos(limit: Int.max).map { photo in
            let passenger = photo.passengerID.flatMap { passengerByID[$0] }
            return PhotoSummary(
                id: photo.id.uuidString,
                passengerName: passenger?.fullName ?? "Eşleşmeyen fotoğraf",
                passportNumber: passenger?.passportNumber ?? photo.originalFileName,
                localURL: photo.fileURL,
                matched: passenger != nil
            )
        }
    }

    func archives() async throws -> [ArchiveRowSummary] {
        let database = try dependencies().database
        let passengers = try database.fetchPassengers(search: nil, limit: Int.max, offset: 0)
        let calendar = Calendar.current
        let datedPassengers = passengers.compactMap { passenger -> (Date, Passenger)? in
            guard let departure = Self.date(passenger.departureDate) else { return nil }
            return (calendar.startOfDay(for: departure), passenger)
        }
        let groups = Dictionary(grouping: datedPassengers) { $0.0 }

        return groups.map { date, entries in
            let passengersForDate = entries.map { $0.1 }
            return ArchiveRowSummary(
                id: Self.archiveKey(date),
                title: Self.archiveTitle(date),
                travelDate: date,
                passengerCount: passengersForDate.count,
                readyCount: passengersForDate.filter { $0.issues.isEmpty }.count
            )
        }
        .sorted { $0.travelDate > $1.travelDate }
    }

    func export(kind: ExportKind) async throws -> URL {
        let dependencies = try dependencies()
        let shareDirectory = dependencies.database.containerURL.appendingPathComponent("Share", isDirectory: true)
        try ProtectedContainer.prepareDirectory(at: shareDirectory)
        let stamp = Self.timestamp()

        switch kind {
        case .excel:
            return try await dependencies.exporter.export(
                format: .xlsx,
                destination: shareDirectory.appendingPathComponent("Excelbase-\(stamp).xlsx")
            )
        case .csv:
            return try await dependencies.exporter.export(
                format: .csv,
                destination: shareDirectory.appendingPathComponent("Excelbase-\(stamp).csv")
            )
        }
    }

    func eraseAll() async throws {
        let database = try dependencies().database
        try database.eraseAll()
        try? FileManager.default.removeItem(
            at: database.containerURL.appendingPathComponent("Share", isDirectory: true)
        )
    }

    private func dependencies() throws -> Dependencies {
        try startup.get()
    }

    private nonisolated static func makeRustBridge() -> UniFFIRustImportBridge {
        UniFFIRustImportBridge(
            importFile: { input, output in
                let summary = try importToNdjson(inputPath: input, outputPath: output)
                return RustImportSummary(rowCount: Int(clamping: summary.rows))
            },
            importZIP: { input, extraction, output in
                let summary = try importZipToNdjson(
                    zipPath: input,
                    extractionDir: extraction,
                    outputPath: output
                )
                return RustImportSummary(rowCount: Int(clamping: summary.rows))
            },
            extractPhotoZIP: { input, extraction in
                let summary = try extractPhotoZip(zipPath: input, extractionDir: extraction)
                return RustPhotoArchiveSummary(
                    extractionDirectory: URL(fileURLWithPath: summary.extractionDir, isDirectory: true),
                    manifestURL: URL(fileURLWithPath: summary.manifestPath),
                    fileCount: Int(clamping: summary.files),
                    uncompressedByteCount: Int64(clamping: summary.uncompressedBytes)
                )
            },
            exportXLSX: { input, output in
                let summary = try exportNdjsonToXlsx(inputPath: input, outputPath: output)
                return RustExportSummary(
                    rowCount: Int(clamping: summary.rows),
                    byteCount: Self.fileSize(output)
                )
            },
            exportCSV: { input, output in
                let summary = try exportNdjsonToCsv(inputPath: input, outputPath: output)
                return RustExportSummary(
                    rowCount: Int(clamping: summary.rows),
                    byteCount: Self.fileSize(output)
                )
            }
        )
    }

    private nonisolated static func phase(_ status: ImportStatus) -> ImportJobPhase {
        switch status {
        case .queued: .waiting
        case .staging, .importing, .committing: .processing
        case .paused: .paused
        case .completed: .completed
        case .failed, .cancelled: .failed
        }
    }

    private nonisolated static func uuid(_ value: String) throws -> UUID {
        guard let id = UUID(uuidString: value) else { throw LiveProviderError.invalidIdentifier }
        return id
    }

    private nonisolated static func decimal(_ value: String) -> Decimal {
        var normalized = value.filter { $0.isNumber || $0 == "," || $0 == "." || $0 == "-" }
        guard !normalized.isEmpty else { return 0 }
        if let comma = normalized.lastIndex(of: ","), let dot = normalized.lastIndex(of: ".") {
            if comma > dot {
                normalized.removeAll(where: { $0 == "." })
                normalized = normalized.replacingOccurrences(of: ",", with: ".")
            } else {
                normalized.removeAll(where: { $0 == "," })
            }
        } else if normalized.contains(",") {
            normalized = normalized.replacingOccurrences(of: ",", with: ".")
        }
        return Decimal(string: normalized, locale: Locale(identifier: "en_US_POSIX")) ?? 0
    }

    private nonisolated static func date(_ value: String) -> Date? {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = .current
        for format in ["yyyy-MM-dd", "dd.MM.yyyy", "dd/MM/yyyy", "yyyy/MM/dd"] {
            formatter.dateFormat = format
            if let date = formatter.date(from: value.trimmingCharacters(in: .whitespacesAndNewlines)) {
                return date
            }
        }
        return nil
    }

    private nonisolated static func timestamp() -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyyMMdd-HHmmss"
        return formatter.string(from: Date())
    }

    private nonisolated static func archiveKey(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = .current
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: date)
    }

    private nonisolated static func archiveTitle(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "tr_TR")
        formatter.dateStyle = .long
        formatter.timeStyle = .none
        return formatter.string(from: date)
    }

    private nonisolated static func fileSize(_ path: String) -> Int64 {
        let attributes = try? FileManager.default.attributesOfItem(atPath: path)
        return (attributes?[.size] as? NSNumber)?.int64Value ?? 0
    }
}

private enum LiveProviderError: LocalizedError, Sendable {
    case applicationSupportUnavailable
    case invalidIdentifier
    case startup(String)

    var errorDescription: String? {
        switch self {
        case .applicationSupportUnavailable:
            "Uygulamanın korumalı veri klasörü açılamadı."
        case .invalidIdentifier:
            "Aktarım kaydının kimliği geçersiz."
        case .startup(let message):
            "Yerel veri katmanı başlatılamadı: \(message)"
        }
    }
}

private extension String {
    var nilIfEmpty: String? {
        let trimmed = trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}
