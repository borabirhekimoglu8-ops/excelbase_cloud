import Foundation

public actor ImportCoordinator {
    private let database: AppDatabase
    private let bridge: any RustImportBridge
    private let stager: StagedFileManager
    private var runner: Task<Void, Never>?

    public init(database: AppDatabase, bridge: any RustImportBridge = DelimitedTextBridge()) {
        self.database = database
        self.bridge = bridge
        self.stager = StagedFileManager(containerURL: database.containerURL)
    }

    public func enqueue(
        urls: [URL],
        replaceExisting: Bool,
        strategy: DuplicateStrategy = .skip
    ) async {
        try? await enqueueThrowing(urls: urls, replaceExisting: replaceExisting, strategy: strategy)
    }

    public func enqueueThrowing(
        urls: [URL],
        replaceExisting: Bool,
        strategy: DuplicateStrategy = .skip
    ) async throws {
        guard !urls.isEmpty else { return }
        let batchID = try database.createImportBatch(replaceExisting: replaceExisting, duplicateStrategy: strategy)
        for url in urls {
            try Task.checkCancellation()
            do {
                let file = try await stager.stage(url: url)
                _ = try database.createImportJob(
                    batchID: batchID,
                    fileName: file.originalName,
                    stagedPath: file.url.path,
                    sha256: file.sha256
                )
                startRunnerIfNeeded()
            } catch {
                try database.createFailedImportJob(
                    batchID: batchID,
                    fileName: url.lastPathComponent,
                    message: error.localizedDescription
                )
            }
        }
        startRunnerIfNeeded()
    }

    public func resumePending() async {
        try? database.requeuePausedJobs()
        startRunnerIfNeeded()
    }

    public func retry(jobID: UUID) async throws {
        try database.retryImportJob(id: jobID)
        startRunnerIfNeeded()
    }

    public func remove(jobID: UUID) async throws {
        guard let context = try database.jobContext(id: jobID) else { return }
        if !context.job.status.isTerminal { try await cancel(jobID: jobID) }
        try? FileManager.default.removeItem(atPath: context.stagedPath)
        if let outputPath = context.outputPath { try? FileManager.default.removeItem(atPath: outputPath) }
        try database.removeImportJob(id: jobID)
    }

    public func pause(jobID: UUID) async throws {
        guard let job = try database.jobContext(id: jobID)?.job else { throw OfflineDataError.missingJob(jobID) }
        if job.status == .queued || job.status == .importing || job.status == .staging || job.status == .committing {
            try database.transitionJob(id: jobID, to: .paused, message: "Kullanıcı tarafından duraklatıldı.")
        }
    }

    public func cancel(jobID: UUID) async throws {
        guard let job = try database.jobContext(id: jobID)?.job else { throw OfflineDataError.missingJob(jobID) }
        if !job.status.isTerminal {
            try database.transitionJob(id: jobID, to: .cancelled, message: "İptal edildi.")
        }
    }

    private func startRunnerIfNeeded() {
        guard runner == nil else { return }
        runner = Task { [weak self] in
            await self?.runPendingLoop()
        }
    }

    private func runPendingLoop() async {
        defer { runner = nil }
        while !Task.isCancelled {
            do {
                guard let context = try database.nextRunnableJob() else { return }
                await process(context)
            } catch {
                return
            }
            await Task.yield()
        }
    }

    private func process(_ initial: AppDatabase.JobContext) async {
        let jobID = initial.job.id
        var extractionDirectory: URL?
        defer {
            if let extractionDirectory {
                try? FileManager.default.removeItem(at: extractionDirectory)
            }
        }
        do {
            try database.transitionJob(id: jobID, to: .importing, message: "Dosya cihazda işleniyor.")
            let input = URL(fileURLWithPath: initial.stagedPath)
            let output = initial.outputPath.map(URL.init(fileURLWithPath:))
                ?? database.containerURL.appendingPathComponent("Staging/\(jobID.uuidString).ndjson")

            let summary: RustImportSummary
            if initial.outputPath == nil || !FileManager.default.fileExists(atPath: output.path) {
                if input.pathExtension.lowercased() == "zip" {
                    let extraction = database.containerURL.appendingPathComponent("Staging/\(jobID.uuidString)-zip", isDirectory: true)
                    extractionDirectory = extraction
                    try ProtectedContainer.prepareDirectory(at: extraction)
                    summary = try await bridge.importZIPToNDJSON(input: input, extractionDirectory: extraction, output: output)
                } else {
                    summary = try await bridge.importToNDJSON(input: input, output: output)
                }
                guard try database.recordParsedOutputIfStillImporting(
                    id: jobID,
                    totalRows: summary.rowCount,
                    outputPath: output.path
                ) else { return }
            } else {
                summary = RustImportSummary(rowCount: initial.job.totalRows)
            }

            guard try database.jobContext(id: jobID)?.job.status == .importing else { return }
            var reader = try NDJSONLineReader(url: output)
            var rowNumber = 0
            var batch: [Passenger] = []
            batch.reserveCapacity(250)
            while let line = try reader.nextLine() {
                rowNumber += 1
                if rowNumber <= initial.checkpointRow { continue }
                try Task.checkCancellation()
                guard try database.jobContext(id: jobID)?.job.status == .importing else { return }
                let wireRow = try JSONDecoder().decode(ImportedPassengerRow.self, from: line)
                let passenger = wireRow.passenger(sortOrder: rowNumber - 1, fallbackSource: initial.job.fileName)
                batch.append(passenger)
                if batch.count == 250 {
                    try database.stagePassengers(batch, jobID: jobID, checkpointRow: rowNumber - batch.count)
                    batch.removeAll(keepingCapacity: true)
                    await Task.yield()
                }
            }
            if !batch.isEmpty {
                try database.stagePassengers(batch, jobID: jobID, checkpointRow: rowNumber - batch.count)
            }
            guard rowNumber > 0 || summary.rowCount > 0 else { throw DatabaseInvariantError.emptyImport }
            guard try database.jobContext(id: jobID)?.job.status == .importing else { return }
            try database.transitionJob(id: jobID, to: .committing, message: "Liste atomik olarak güncelleniyor.")
            try database.commitStagedPassengers(jobID: jobID)
            try? FileManager.default.removeItem(at: output)
            try? FileManager.default.removeItem(at: input)
        } catch is CancellationError {
            try? database.transitionJob(id: jobID, to: .paused, message: "İşlem duraklatıldı.")
        } catch {
            let state = try? database.jobContext(id: jobID)?.job.status
            if state != .paused && state != .cancelled {
                try? database.transitionJob(id: jobID, to: .failed, message: error.localizedDescription)
            }
        }
    }
}

private struct NDJSONLineReader {
    private let handle: FileHandle
    private var buffer = Data()
    private var reachedEOF = false

    init(url: URL) throws { handle = try FileHandle(forReadingFrom: url) }

    mutating func nextLine() throws -> Data? {
        while true {
            if let newline = buffer.firstIndex(of: 0x0A) {
                let line = Data(buffer[..<newline])
                buffer.removeSubrange(...newline)
                if line.isEmpty { continue }
                return line
            }
            if reachedEOF {
                guard !buffer.isEmpty else { try? handle.close(); return nil }
                defer { buffer.removeAll() }
                return buffer
            }
            let chunk = try handle.read(upToCount: 65_536) ?? Data()
            if chunk.isEmpty { reachedEOF = true }
            else { buffer.append(chunk) }
        }
    }
}

struct ImportedPassengerRow: Decodable, Sendable {
    let no: String
    let firstName: String
    let lastName: String
    let fullName: String
    let passportNumber: String
    let voucher: String
    let departureDate: String
    let arrivalDate: String
    let adultFee: String
    let childFee: String
    let sourceFile: String
    let sheet: String
    let photoRef: String

    enum CodingKeys: String, CodingKey {
        case no = "No"
        case firstName = "Ad"
        case lastName = "Soyad"
        case fullName = "Yolcu Adı Soyadı"
        case passportNumber = "Pasaport No"
        case voucher = "Voucher"
        case departureDate = "Gidiş Tarihi"
        case arrivalDate = "Varış Tarihi"
        case adultFee = "Vize Ücreti Yetişkin"
        case childFee = "Vize Ücreti Çocuk"
        case sourceFile = "Kaynak Dosya"
        case sheet = "Sayfa"
        case photoRef = "Foto"
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        func text(_ key: CodingKeys) -> String {
            if let value = try? container.decode(String.self, forKey: key) { return value }
            if let value = try? container.decode(Int.self, forKey: key) { return String(value) }
            if let value = try? container.decode(Double.self, forKey: key) { return String(value) }
            return ""
        }
        no = text(.no)
        firstName = text(.firstName)
        lastName = text(.lastName)
        let suppliedFullName = text(.fullName)
        fullName = suppliedFullName.isEmpty ? "\(firstName) \(lastName)".trimmingCharacters(in: .whitespaces) : suppliedFullName
        passportNumber = text(.passportNumber)
        voucher = text(.voucher)
        departureDate = text(.departureDate)
        arrivalDate = text(.arrivalDate)
        adultFee = text(.adultFee)
        childFee = text(.childFee)
        sourceFile = text(.sourceFile)
        sheet = text(.sheet)
        photoRef = text(.photoRef)
    }

    func passenger(sortOrder: Int, fallbackSource: String) -> Passenger {
        Passenger(
            sortOrder: sortOrder,
            no: no,
            firstName: firstName,
            lastName: lastName,
            fullName: fullName,
            passportNumber: passportNumber,
            voucher: voucher,
            departureDate: departureDate,
            arrivalDate: arrivalDate,
            adultFee: adultFee,
            childFee: childFee,
            sourceFile: sourceFile.isEmpty ? fallbackSource : sourceFile,
            sheet: sheet,
            photoRef: photoRef
        )
    }
}
