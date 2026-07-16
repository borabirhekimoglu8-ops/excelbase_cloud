import Foundation

public protocol PassengerExporting: Sendable {
    func export(format: ExportFormat, destination: URL) async throws -> URL
}

public actor ExportService: PassengerExporting {
    private let database: AppDatabase
    private let bridge: any RustImportBridge
    private let backupService: any BackupServicing

    public init(
        database: AppDatabase,
        bridge: any RustImportBridge = DelimitedTextBridge(),
        backupService: (any BackupServicing)? = nil
    ) {
        self.database = database
        self.bridge = bridge
        self.backupService = backupService ?? UnavailableBackupService()
    }

    public func export(format: ExportFormat, destination: URL) async throws -> URL {
        if format == .backup { return try await backupService.createBackup(destination: destination) }
        let working = database.containerURL.appendingPathComponent("Exports", isDirectory: true)
        try ProtectedContainer.prepareDirectory(at: working)
        let ndjson = working.appendingPathComponent("\(UUID().uuidString).ndjson")
        defer { try? FileManager.default.removeItem(at: ndjson) }
        try writeNDJSON(to: ndjson)

        let temporary = working.appendingPathComponent("\(UUID().uuidString).\(format.rawValue)")
        defer { try? FileManager.default.removeItem(at: temporary) }
        switch format {
        case .xlsx:
            _ = try await bridge.exportNDJSONToXLSX(input: ndjson, output: temporary)
        case .csv:
            do {
                _ = try await bridge.exportNDJSONToCSV(input: ndjson, output: temporary)
            } catch OfflineDataError.unsupportedFormat(_) {
                try writeCSV(to: temporary)
            }
        case .backup:
            throw OfflineDataError.invalidDestination
        }
        try ProtectedContainer.protectFile(at: temporary)
        return try copyAtomicallyFromSandbox(temporary, to: destination)
    }

    private func writeNDJSON(to url: URL) throws {
        FileManager.default.createFile(atPath: url.path, contents: nil)
        let handle = try FileHandle(forWritingTo: url)
        defer { try? handle.close() }
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        for passenger in try database.fetchPassengers(search: nil, limit: Int.max, offset: 0) {
            try handle.write(contentsOf: encoder.encode(ExportPassengerRow(passenger)))
            try handle.write(contentsOf: Data([0x0A]))
        }
        try handle.synchronize()
    }

    private func writeCSV(to url: URL) throws {
        let headers = [
            "No", "Ad", "Soyad", "Yolcu Adı Soyadı", "Pasaport No", "Voucher",
            "Gidiş Tarihi", "Varış Tarihi", "Vize Ücreti Yetişkin", "Vize Ücreti Çocuk",
            "Kaynak Dosya", "Sayfa", "Foto"
        ]
        FileManager.default.createFile(atPath: url.path, contents: nil)
        let handle = try FileHandle(forWritingTo: url)
        defer { try? handle.close() }
        try handle.write(contentsOf: Data([0xEF, 0xBB, 0xBF]))
        try handle.write(contentsOf: Data((headers.joined(separator: ";") + "\r\n").utf8))
        for passenger in try database.fetchPassengers(search: nil, limit: Int.max, offset: 0) {
            let line = [
                passenger.no, passenger.firstName, passenger.lastName, passenger.fullName, passenger.passportNumber,
                passenger.voucher, passenger.departureDate, passenger.arrivalDate,
                passenger.adultFee, passenger.childFee, passenger.sourceFile, passenger.sheet, passenger.photoRef
            ].map(csvEscape).joined(separator: ";") + "\r\n"
            try handle.write(contentsOf: Data(line.utf8))
        }
        try handle.synchronize()
    }

    private func csvEscape(_ value: String) -> String {
        if value.contains(";") || value.contains("\"") || value.contains("\n") || value.contains("\r") {
            return "\"\(value.replacingOccurrences(of: "\"", with: "\"\""))\""
        }
        return value
    }

    private func copyAtomicallyFromSandbox(_ source: URL, to destination: URL) throws -> URL {
        let didAccess = destination.startAccessingSecurityScopedResource()
        defer { if didAccess { destination.stopAccessingSecurityScopedResource() } }
        let parent = destination.deletingLastPathComponent()
        let temporary = parent.appendingPathComponent(".\(UUID().uuidString).partial")
        try FileManager.default.copyItem(at: source, to: temporary)
        if FileManager.default.fileExists(atPath: destination.path) {
            _ = try FileManager.default.replaceItemAt(destination, withItemAt: temporary)
        } else {
            try FileManager.default.moveItem(at: temporary, to: destination)
        }
        return destination
    }
}

private struct ExportPassengerRow: Encodable {
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

    init(_ passenger: Passenger) {
        no = passenger.no
        firstName = passenger.firstName
        lastName = passenger.lastName
        fullName = passenger.fullName
        passportNumber = passenger.passportNumber
        voucher = passenger.voucher
        departureDate = passenger.departureDate
        arrivalDate = passenger.arrivalDate
        adultFee = passenger.adultFee
        childFee = passenger.childFee
        sourceFile = passenger.sourceFile
        sheet = passenger.sheet
        photoRef = passenger.photoRef
    }

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
}
