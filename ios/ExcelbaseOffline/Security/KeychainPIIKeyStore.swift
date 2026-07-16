import CryptoKit
import Foundation
import Security

public protocol PIIKeyProviding: Sendable {
    func loadOrCreateKey() throws -> SymmetricKey
}

public struct KeychainPIIKeyStore: PIIKeyProviding, Sendable {
    private let service: String
    private let account: String

    public init(
        service: String = "com.excelbase.offline.pii",
        account: String = "record-key-v1"
    ) {
        self.service = service
        self.account = account
    }

    public func loadOrCreateKey() throws -> SymmetricKey {
        if let stored = try read() {
            guard stored.count == 32 else { throw KeychainError.invalidKey }
            return SymmetricKey(data: stored)
        }

        var bytes = Data(count: 32)
        let status = bytes.withUnsafeMutableBytes { buffer in
            SecRandomCopyBytes(kSecRandomDefault, 32, buffer.baseAddress!)
        }
        guard status == errSecSuccess else { throw KeychainError.status(status) }

        do {
            try add(bytes)
            return SymmetricKey(data: bytes)
        } catch KeychainError.duplicate {
            guard let winner = try read(), winner.count == 32 else {
                throw KeychainError.invalidKey
            }
            return SymmetricKey(data: winner)
        }
    }

    private func read() throws -> Data? {
        let query: [CFString: Any] = [
            kSecClass: kSecClassGenericPassword,
            kSecAttrService: service,
            kSecAttrAccount: account,
            kSecReturnData: true,
            kSecMatchLimit: kSecMatchLimitOne
        ]
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data else {
            throw KeychainError.status(status)
        }
        return data
    }

    private func add(_ data: Data) throws {
        let query: [CFString: Any] = [
            kSecClass: kSecClassGenericPassword,
            kSecAttrService: service,
            kSecAttrAccount: account,
            kSecValueData: data,
            kSecAttrAccessible: kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        ]
        let status = SecItemAdd(query as CFDictionary, nil)
        if status == errSecDuplicateItem { throw KeychainError.duplicate }
        guard status == errSecSuccess else { throw KeychainError.status(status) }
    }
}

public enum KeychainError: LocalizedError, Sendable {
    case status(OSStatus)
    case invalidKey
    case duplicate

    public var errorDescription: String? {
        switch self {
        case let .status(status): "Anahtar zinciri hatası (\(status))."
        case .invalidKey: "Anahtar zincirindeki PII anahtarı geçersiz."
        case .duplicate: "PII anahtarı başka bir işlem tarafından oluşturuldu."
        }
    }
}
