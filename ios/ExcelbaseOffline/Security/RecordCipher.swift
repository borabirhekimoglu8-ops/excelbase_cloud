import CryptoKit
import Foundation

public protocol RecordCiphering: Sendable {
    func encrypt<T: Encodable & Sendable>(_ value: T, recordID: UUID) throws -> Data
    func decrypt<T: Decodable & Sendable>(_ type: T.Type, from envelope: Data, recordID: UUID) throws -> T
}

public struct AESGCMRecordCipher: RecordCiphering, Sendable {
    private static let currentEnvelopeVersion: UInt8 = 2
    private static let legacyEnvelopeVersion: UInt8 = 1
    private let key: SymmetricKey

    /// Resolves Keychain once. Importing thousands of rows must not perform a
    /// Keychain query for every AES operation.
    public init(keyProvider: any PIIKeyProviding = KeychainPIIKeyStore()) throws {
        self.key = try keyProvider.loadOrCreateKey()
    }

    public func encrypt<T: Encodable & Sendable>(_ value: T, recordID: UUID) throws -> Data {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .custom { date, encoder in
            var container = encoder.singleValueContainer()
            try container.encode(date.timeIntervalSinceReferenceDate.bitPattern)
        }
        encoder.outputFormatting = [.sortedKeys]
        let plaintext = try encoder.encode(value)
        let sealed = try AES.GCM.seal(
            plaintext,
            using: key,
            authenticating: authenticatedData(for: recordID, version: Self.currentEnvelopeVersion)
        )
        guard let combined = sealed.combined else { throw OfflineDataError.corruptRecord }
        return Data([Self.currentEnvelopeVersion]) + combined
    }

    public func decrypt<T: Decodable & Sendable>(
        _ type: T.Type,
        from envelope: Data,
        recordID: UUID
    ) throws -> T {
        guard let version = envelope.first,
              version == Self.currentEnvelopeVersion || version == Self.legacyEnvelopeVersion
        else { throw OfflineDataError.corruptRecord }
        let box = try AES.GCM.SealedBox(combined: envelope.dropFirst())
        let plaintext = try AES.GCM.open(
            box,
            using: key,
            authenticating: authenticatedData(for: recordID, version: version)
        )
        let decoder = JSONDecoder()
        if version == Self.legacyEnvelopeVersion {
            decoder.dateDecodingStrategy = .millisecondsSince1970
        } else {
            decoder.dateDecodingStrategy = .custom { decoder in
                let bits = try decoder.singleValueContainer().decode(UInt64.self)
                return Date(timeIntervalSinceReferenceDate: Double(bitPattern: bits))
            }
        }
        return try decoder.decode(type, from: plaintext)
    }

    private func authenticatedData(for recordID: UUID, version: UInt8) -> Data {
        Data("excelbase-record-v\(version):\(recordID.uuidString.lowercased())".utf8)
    }
}

public struct InMemoryPIIKeyProvider: PIIKeyProviding, Sendable {
    private let material: Data

    public init(material: Data = Data(repeating: 0xA7, count: 32)) {
        precondition(material.count == 32)
        self.material = material
    }

    public func loadOrCreateKey() throws -> SymmetricKey { SymmetricKey(data: material) }
}
