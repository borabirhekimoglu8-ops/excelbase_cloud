import Foundation

public protocol BackupServicing: Sendable {
    func createBackup(destination: URL) async throws -> URL
}

/// Portable backup intentionally remains unavailable until both the database and
/// photo payloads can be encrypted with a user-held recovery secret.
public struct UnavailableBackupService: BackupServicing, Sendable {
    public init() {}

    public func createBackup(destination: URL) async throws -> URL {
        throw BackupUnavailableError()
    }
}

public struct BackupUnavailableError: LocalizedError, Sendable {
    public init() {}

    public var errorDescription: String? {
        "Taşınabilir şifreli yedek bu sürümde etkin değil. Veritabanı ve fotoğraflar birlikte şifrelenmeden yedek oluşturulmaz."
    }
}
