import Foundation

public struct RustImportSummary: Codable, Hashable, Sendable {
    public let rowCount: Int
    public let warningCount: Int

    public init(rowCount: Int, warningCount: Int = 0) {
        self.rowCount = rowCount
        self.warningCount = warningCount
    }
}

public struct RustExportSummary: Codable, Hashable, Sendable {
    public let rowCount: Int
    public let byteCount: Int64

    public init(rowCount: Int, byteCount: Int64) {
        self.rowCount = rowCount
        self.byteCount = byteCount
    }
}

public struct RustPhotoArchiveSummary: Codable, Hashable, Sendable {
    public let extractionDirectory: URL
    public let manifestURL: URL
    public let fileCount: Int
    public let uncompressedByteCount: Int64

    public init(extractionDirectory: URL, manifestURL: URL, fileCount: Int, uncompressedByteCount: Int64) {
        self.extractionDirectory = extractionDirectory
        self.manifestURL = manifestURL
        self.fileCount = fileCount
        self.uncompressedByteCount = uncompressedByteCount
    }
}

/// Keeps persistence independent of generated UniFFI symbol casing.
/// The composition root can pass `ExcelbaseCore.importToNdjson` closures when bindings are present.
public protocol RustImportBridge: Sendable {
    func importToNDJSON(input: URL, output: URL) async throws -> RustImportSummary
    func importZIPToNDJSON(input: URL, extractionDirectory: URL, output: URL) async throws -> RustImportSummary
    func extractPhotoZIP(input: URL, extractionDirectory: URL) async throws -> RustPhotoArchiveSummary
    func exportNDJSONToXLSX(input: URL, output: URL) async throws -> RustExportSummary
    func exportNDJSONToCSV(input: URL, output: URL) async throws -> RustExportSummary
}

public struct UniFFIRustImportBridge: RustImportBridge, Sendable {
    public typealias ImportClosure = @Sendable (String, String) throws -> RustImportSummary
    public typealias ZIPImportClosure = @Sendable (String, String, String) throws -> RustImportSummary
    public typealias ExportClosure = @Sendable (String, String) throws -> RustExportSummary
    public typealias PhotoZIPClosure = @Sendable (String, String) throws -> RustPhotoArchiveSummary

    private let importFile: ImportClosure
    private let importZIP: ZIPImportClosure
    private let exportXLSX: ExportClosure
    private let exportCSV: ExportClosure
    private let extractPhotos: PhotoZIPClosure

    public init(
        importFile: @escaping ImportClosure,
        importZIP: @escaping ZIPImportClosure,
        extractPhotoZIP: @escaping PhotoZIPClosure,
        exportXLSX: @escaping ExportClosure,
        exportCSV: @escaping ExportClosure
    ) {
        self.importFile = importFile
        self.importZIP = importZIP
        self.extractPhotos = extractPhotoZIP
        self.exportXLSX = exportXLSX
        self.exportCSV = exportCSV
    }

    public func importToNDJSON(input: URL, output: URL) async throws -> RustImportSummary {
        try await Task.detached { try importFile(input.path, output.path) }.value
    }

    public func importZIPToNDJSON(input: URL, extractionDirectory: URL, output: URL) async throws -> RustImportSummary {
        try await Task.detached { try importZIP(input.path, extractionDirectory.path, output.path) }.value
    }

    public func extractPhotoZIP(input: URL, extractionDirectory: URL) async throws -> RustPhotoArchiveSummary {
        try await Task.detached { try extractPhotos(input.path, extractionDirectory.path) }.value
    }

    public func exportNDJSONToXLSX(input: URL, output: URL) async throws -> RustExportSummary {
        try await Task.detached { try exportXLSX(input.path, output.path) }.value
    }

    public func exportNDJSONToCSV(input: URL, output: URL) async throws -> RustExportSummary {
        try await Task.detached { try exportCSV(input.path, output.path) }.value
    }
}

/// Test/preview fallback. Production XLSX/ZIP support is supplied by the Rust UniFFI bridge.
public struct DelimitedTextBridge: RustImportBridge, Sendable {
    public init() {}

    public func importToNDJSON(input: URL, output: URL) async throws -> RustImportSummary {
        guard input.pathExtension.lowercased() == "csv" else {
            throw OfflineDataError.unsupportedFormat(input.pathExtension)
        }
        let text = try String(contentsOf: input, encoding: .utf8)
        let lines = text.split(whereSeparator: \.isNewline).map(String.init)
        guard let first = lines.first else { return RustImportSummary(rowCount: 0) }
        let headers = Self.csvFields(first).map(Self.canonicalHeader)
        var outputData = Data()
        var count = 0
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        for line in lines.dropFirst() where !line.trimmingCharacters(in: .whitespaces).isEmpty {
            let values = Self.csvFields(line)
            var fields: [String: String] = [:]
            for (index, header) in headers.enumerated() where index < values.count { fields[header] = values[index] }
            let passenger = Passenger(
                sortOrder: count,
                no: fields["no", default: ""],
                firstName: fields["first_name", default: ""],
                lastName: fields["last_name", default: ""],
                fullName: fields["full_name"] ?? "\(fields["first_name", default: ""]) \(fields["last_name", default: ""])".trimmingCharacters(in: .whitespaces),
                passportNumber: fields["passport_number", default: ""],
                voucher: fields["voucher", default: ""],
                departureDate: fields["departure_date", default: ""],
                arrivalDate: fields["arrival_date", default: ""],
                adultFee: fields["adult_fee", default: ""],
                childFee: fields["child_fee", default: ""],
                sourceFile: input.lastPathComponent,
                sheet: "CSV"
            )
            outputData.append(try encoder.encode(FallbackPassengerRow(passenger)))
            outputData.append(0x0A)
            count += 1
        }
        try outputData.write(to: output, options: .atomic)
        return RustImportSummary(rowCount: count)
    }

    public func importZIPToNDJSON(input: URL, extractionDirectory: URL, output: URL) async throws -> RustImportSummary {
        throw OfflineDataError.unsupportedFormat("zip")
    }

    public func extractPhotoZIP(input: URL, extractionDirectory: URL) async throws -> RustPhotoArchiveSummary {
        throw OfflineDataError.unsupportedFormat("photo zip requires Rust core")
    }

    public func exportNDJSONToXLSX(input: URL, output: URL) async throws -> RustExportSummary {
        throw OfflineDataError.unsupportedFormat("xlsx")
    }

    public func exportNDJSONToCSV(input: URL, output: URL) async throws -> RustExportSummary {
        throw OfflineDataError.unsupportedFormat("csv export requires Rust core")
    }

    private static func csvFields(_ line: String) -> [String] {
        var fields: [String] = []
        var current = ""
        var quoted = false
        var index = line.startIndex
        while index < line.endIndex {
            let character = line[index]
            if character == "\"" {
                let next = line.index(after: index)
                if quoted, next < line.endIndex, line[next] == "\"" { current.append("\""); index = next }
                else { quoted.toggle() }
            } else if character == ",", !quoted { fields.append(current); current = "" }
            else { current.append(character) }
            index = line.index(after: index)
        }
        fields.append(current)
        return fields
    }

    private static func canonicalHeader(_ raw: String) -> String {
        let value = raw.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: .current)
            .lowercased().filter { $0.isLetter || $0.isNumber }
        let map = [
            "no": "no", "name": "first_name", "ad": "first_name", "surname": "last_name", "soyad": "last_name",
            "fullname": "full_name", "yolcuadsoyad": "full_name", "passportnumber": "passport_number",
            "pasaportno": "passport_number", "voucher": "voucher", "departure": "departure_date",
            "gidistarihi": "departure_date", "arrival": "arrival_date", "varistarihi": "arrival_date",
            "adult": "adult_fee", "vizeucretiyetiskin": "adult_fee", "child": "child_fee",
            "vizeucreticocuk": "child_fee"
        ]
        return map[value] ?? value
    }
}

private struct FallbackPassengerRow: Encodable {
    let passenger: Passenger

    init(_ passenger: Passenger) { self.passenger = passenger }

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

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(passenger.no, forKey: .no)
        try container.encode(passenger.firstName, forKey: .firstName)
        try container.encode(passenger.lastName, forKey: .lastName)
        try container.encode(passenger.fullName, forKey: .fullName)
        try container.encode(passenger.passportNumber, forKey: .passportNumber)
        try container.encode(passenger.voucher, forKey: .voucher)
        try container.encode(passenger.departureDate, forKey: .departureDate)
        try container.encode(passenger.arrivalDate, forKey: .arrivalDate)
        try container.encode(passenger.adultFee, forKey: .adultFee)
        try container.encode(passenger.childFee, forKey: .childFee)
        try container.encode(passenger.sourceFile, forKey: .sourceFile)
        try container.encode(passenger.sheet, forKey: .sheet)
        try container.encode(passenger.photoRef, forKey: .photoRef)
    }
}
