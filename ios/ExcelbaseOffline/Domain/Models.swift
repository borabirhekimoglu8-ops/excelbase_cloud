import CryptoKit
import Foundation

public struct Passenger: Identifiable, Codable, Hashable, Sendable {
    public let id: UUID
    public var sortOrder: Int
    public var no: String
    public var firstName: String
    public var lastName: String
    public var fullName: String
    public var passportNumber: String
    public var voucher: String
    public var departureDate: String
    public var arrivalDate: String
    public var adultFee: String
    public var childFee: String
    public var sourceFile: String
    public var sheet: String
    public var photoRef: String
    public var duplicate: Bool
    public var createdAt: Date
    public var updatedAt: Date

    public init(
        id: UUID = UUID(),
        sortOrder: Int = 0,
        no: String = "",
        firstName: String = "",
        lastName: String = "",
        fullName: String,
        passportNumber: String,
        voucher: String = "",
        departureDate: String = "",
        arrivalDate: String = "",
        adultFee: String = "",
        childFee: String = "",
        sourceFile: String = "",
        sheet: String = "",
        photoRef: String = "",
        duplicate: Bool = false,
        createdAt: Date = Date(),
        updatedAt: Date = Date()
    ) {
        self.id = id
        self.sortOrder = sortOrder
        self.no = no
        self.firstName = firstName
        self.lastName = lastName
        self.fullName = fullName
        self.passportNumber = passportNumber
        self.voucher = voucher
        self.departureDate = departureDate
        self.arrivalDate = arrivalDate
        self.adultFee = adultFee
        self.childFee = childFee
        self.sourceFile = sourceFile
        self.sheet = sheet
        self.photoRef = photoRef
        self.duplicate = duplicate
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }

    public var hasPhoto: Bool { !photoRef.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

    public var issues: [String] {
        var result: [String] = []
        if fullName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { result.append("Ad soyad eksik") }
        let passport = normalizedPassport
        if passport.isEmpty { result.append("Pasaport eksik") }
        else if passport.count < 6 { result.append("Pasaport formatı") }
        if voucher.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { result.append("Voucher eksik") }
        let departure = Self.parsedDate(departureDate)
        let arrival = Self.parsedDate(arrivalDate)
        if departure == nil { result.append("Gidiş tarihi eksik veya hatalı") }
        if arrival == nil { result.append("Varış tarihi eksik veya hatalı") }
        if let departure, let arrival, arrival < departure {
            result.append("Varış tarihi gidişten önce")
        }
        if adultFee.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
           childFee.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            result.append("Vize ücreti eksik")
        }
        if !hasPhoto { result.append("Fotoğraf eksik") }
        if duplicate { result.append("Tekrar kayıt") }
        return result
    }

    public var duplicateIdentityKey: String {
        guard !normalizedPassport.isEmpty, Self.parsedDate(departureDate) != nil else { return "" }
        return "\(normalizedPassport)|\(normalizedDepartureDate)"
    }

    public var normalizedDepartureDate: String { Self.normalizedDate(departureDate) }

    /// Stable, non-plaintext index for local duplicate lookup metadata.
    public var identityStorageKey: String {
        guard !duplicateIdentityKey.isEmpty else { return "" }
        return SHA256.hash(data: Data(duplicateIdentityKey.utf8))
            .map { String(format: "%02x", $0) }.joined()
    }

    public var normalizedPassport: String {
        passportNumber.uppercased().filter(\.isLetterOrNumber)
    }

    public func replacingID(_ id: UUID, sortOrder: Int? = nil) -> Passenger {
        Passenger(
            id: id,
            sortOrder: sortOrder ?? self.sortOrder,
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
            sourceFile: sourceFile,
            sheet: sheet,
            photoRef: photoRef,
            duplicate: duplicate,
            createdAt: createdAt,
            updatedAt: Date()
        )
    }

    private static func normalizedDate(_ value: String) -> String {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return "" }
        guard let date = parsedDate(trimmed) else { return trimmed.lowercased() }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: date)
    }

    private static func parsedDate(_ value: String) -> Date? {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        let formats = [
            "yyyy-MM-dd", "dd.MM.yyyy", "dd/MM/yyyy", "yyyy/MM/dd",
            "yyyy-MM-dd'T'HH:mm:ss", "yyyy-MM-dd HH:mm:ss"
        ]
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.isLenient = false
        for format in formats {
            formatter.dateFormat = format
            if let date = formatter.date(from: trimmed) {
                return date
            }
        }
        return nil
    }
}

public enum DuplicateStrategy: String, Codable, CaseIterable, Sendable {
    case skip
    case overwrite
    case add
}

public enum ImportStatus: String, Codable, CaseIterable, Sendable {
    case queued
    case staging
    case importing
    case paused
    case committing
    case completed
    case failed
    case cancelled

    public var isTerminal: Bool {
        self == .completed || self == .failed || self == .cancelled
    }
}

public struct ImportJob: Identifiable, Codable, Hashable, Sendable {
    public let id: UUID
    public var fileName: String
    public var status: ImportStatus
    public var totalRows: Int
    public var processedRows: Int
    public var message: String?
    public var createdAt: Date
    public var updatedAt: Date

    public init(
        id: UUID = UUID(),
        fileName: String,
        status: ImportStatus = .queued,
        totalRows: Int = 0,
        processedRows: Int = 0,
        message: String? = nil,
        createdAt: Date = Date(),
        updatedAt: Date = Date()
    ) {
        self.id = id
        self.fileName = fileName
        self.status = status
        self.totalRows = totalRows
        self.processedRows = processedRows
        self.message = message
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }
}

public struct PassengerPhoto: Identifiable, Codable, Hashable, Sendable {
    public let id: UUID
    public var passengerID: UUID?
    public var originalFileName: String
    public var fileURL: URL
    public var sha256: String
    public var matchConfidence: Double?
    public var createdAt: Date

    public init(
        id: UUID = UUID(),
        passengerID: UUID? = nil,
        originalFileName: String,
        fileURL: URL,
        sha256: String,
        matchConfidence: Double? = nil,
        createdAt: Date = Date()
    ) {
        self.id = id
        self.passengerID = passengerID
        self.originalFileName = originalFileName
        self.fileURL = fileURL
        self.sha256 = sha256
        self.matchConfidence = matchConfidence
        self.createdAt = createdAt
    }
}

public struct ArchiveRecord: Identifiable, Codable, Hashable, Sendable {
    public let id: UUID
    public var name: String
    public var relativePath: String
    public var passengerCount: Int
    public var createdAt: Date

    public init(
        id: UUID = UUID(),
        name: String,
        relativePath: String,
        passengerCount: Int,
        createdAt: Date = Date()
    ) {
        self.id = id
        self.name = name
        self.relativePath = relativePath
        self.passengerCount = passengerCount
        self.createdAt = createdAt
    }
}

public enum ExportFormat: String, Codable, CaseIterable, Sendable {
    case xlsx
    case csv
    case backup
}

public enum OfflineDataError: LocalizedError, Sendable {
    case invalidState(from: ImportStatus, to: ImportStatus)
    case missingJob(UUID)
    case unsupportedFormat(String)
    case corruptRecord
    case cancelled
    case invalidDestination

    public var errorDescription: String? {
        switch self {
        case let .invalidState(from, to): "Geçersiz aktarım geçişi: \(from.rawValue) → \(to.rawValue)."
        case let .missingJob(id): "Aktarım işi bulunamadı: \(id.uuidString)."
        case let .unsupportedFormat(value): "Desteklenmeyen dosya biçimi: \(value)."
        case .corruptRecord: "Şifreli kayıt açılamadı."
        case .cancelled: "İşlem iptal edildi."
        case .invalidDestination: "Geçersiz hedef klasör."
        }
    }
}
