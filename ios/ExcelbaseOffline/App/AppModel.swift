import Foundation
import Observation

enum AppTab: Hashable {
    case dashboard
    case passengers
    case imports
    case gallery
    case archive
}

enum PassengerDateScope: String, CaseIterable, Identifiable, Sendable {
    case all
    case today
    case week
    case month

    var id: String { rawValue }

    var title: String {
        switch self {
        case .all: "Tümü"
        case .today: "Bugün"
        case .week: "Bu hafta"
        case .month: "Bu ay"
        }
    }
}

struct DashboardSnapshot: Sendable {
    let passengerCount: Int
    let readyCount: Int
    let missingPhotoCount: Int
    let issueCount: Int
    let matchedPhotoCount: Int
    let adultFeeTotal: Decimal
    let childFeeTotal: Decimal
    let lastImportAt: Date?

    static let empty = DashboardSnapshot(
        passengerCount: 0,
        readyCount: 0,
        missingPhotoCount: 0,
        issueCount: 0,
        matchedPhotoCount: 0,
        adultFeeTotal: 0,
        childFeeTotal: 0,
        lastImportAt: nil
    )
}

struct PassengerSummary: Identifiable, Sendable {
    let id: String
    let fullName: String
    let passportNumber: String
    let voucher: String?
    let departureDate: Date?
    let arrivalDate: Date?
    let adultFee: Decimal
    let childFee: Decimal
    let hasPhoto: Bool
    let issues: [String]
    let isDuplicate: Bool
}

enum ImportDuplicateStrategy: String, CaseIterable, Identifiable, Sendable {
    case skip
    case overwrite
    case add

    var id: String { rawValue }

    var title: String {
        switch self {
        case .skip: "Mevcut kaydı koru"
        case .overwrite: "Yeni verilerle güncelle"
        case .add: "Ayrı kayıt olarak ekle"
        }
    }
}

enum ImportJobPhase: String, Sendable {
    case waiting
    case processing
    case paused
    case completed
    case failed

    var title: String {
        switch self {
        case .waiting: "Bekliyor"
        case .processing: "İşleniyor"
        case .paused: "Duraklatıldı"
        case .completed: "Tamamlandı"
        case .failed: "Hata"
        }
    }

    var symbol: String {
        switch self {
        case .waiting: "clock"
        case .processing: "arrow.triangle.2.circlepath"
        case .paused: "pause.fill"
        case .completed: "checkmark"
        case .failed: "exclamationmark.triangle.fill"
        }
    }
}

struct ImportJobSummary: Identifiable, Sendable {
    let id: String
    let fileName: String
    let phase: ImportJobPhase
    let processedRows: Int
    let totalRows: Int
    let message: String?

    var progress: Double {
        guard totalRows > 0 else { return phase == .completed ? 1 : 0 }
        return min(max(Double(processedRows) / Double(totalRows), 0), 1)
    }
}

struct PhotoSummary: Identifiable, Sendable {
    let id: String
    let passengerName: String
    let passportNumber: String
    let localURL: URL
    let matched: Bool
}

struct ArchiveRowSummary: Identifiable, Sendable {
    let id: String
    let title: String
    let travelDate: Date
    let passengerCount: Int
    let readyCount: Int
}

enum ExportKind: String, CaseIterable, Identifiable, Sendable {
    case excel
    case csv

    var id: String { rawValue }

    var title: String {
        switch self {
        case .excel: "Excel listesi"
        case .csv: "CSV listesi"
        }
    }

    var symbol: String {
        switch self {
        case .excel: "tablecells"
        case .csv: "doc.text"
        }
    }
}

protocol AppDataProviding: Sendable {
    func prepare() async throws
    func dashboard() async throws -> DashboardSnapshot
    func passengers(query: String) async throws -> [PassengerSummary]
    func importJobs() async throws -> [ImportJobSummary]
    func enqueue(
        files: [URL],
        replaceExisting: Bool,
        strategy: ImportDuplicateStrategy
    ) async throws
    func resumeImports() async throws
    func retryImport(id: String) async throws
    func removeImport(id: String) async throws
    func importPhotos(files: [URL]) async throws
    func photos() async throws -> [PhotoSummary]
    func archives() async throws -> [ArchiveRowSummary]
    func export(kind: ExportKind) async throws -> URL
    func eraseAll() async throws
}

@MainActor
@Observable
final class AppModel {
    var selectedTab: AppTab = .dashboard
    var dashboard: DashboardSnapshot = .empty
    var passengers: [PassengerSummary] = []
    var importJobs: [ImportJobSummary] = []
    var photos: [PhotoSummary] = []
    var archives: [ArchiveRowSummary] = []
    var passengerQuery = ""
    var passengerDateScope: PassengerDateScope = .all
    var replaceExistingList = false
    var duplicateStrategy: ImportDuplicateStrategy = .skip
    var isSettingsPresented = false
    var isPreparing = true
    var isWorking = false
    var exportedURL: URL?
    var alertMessage: String?

    private let provider: any AppDataProviding
    private var didPrepare = false
    private var importMonitor: Task<Void, Never>?

    init(provider: any AppDataProviding) {
        self.provider = provider
    }

    var activeImportCount: Int {
        importJobs.filter { $0.phase == .processing || $0.phase == .waiting }.count
    }

    var resumableImportCount: Int {
        importJobs.filter { $0.phase == .paused || $0.phase == .failed }.count
    }

    var visiblePassengers: [PassengerSummary] {
        guard passengerDateScope != .all else { return passengers }
        let calendar = Calendar.current
        let now = Date()
        return passengers.filter { passenger in
            guard let departure = passenger.departureDate else { return false }
            switch passengerDateScope {
            case .all:
                return true
            case .today:
                return calendar.isDate(departure, inSameDayAs: now)
            case .week:
                return calendar.dateInterval(of: .weekOfYear, for: now)?.contains(departure) == true
            case .month:
                return calendar.isDate(departure, equalTo: now, toGranularity: .month)
            }
        }
    }

    func prepare() async {
        guard !didPrepare else { return }
        didPrepare = true
        isPreparing = true
        defer { isPreparing = false }

        do {
            try await provider.prepare()
            try await refreshAll()
            try await provider.resumeImports()
            importJobs = try await provider.importJobs()
            startImportMonitorIfNeeded()
        } catch {
            didPrepare = false
            show(error)
        }
    }

    func refreshAll() async throws {
        async let dashboard = provider.dashboard()
        async let passengers = provider.passengers(query: passengerQuery)
        async let importJobs = provider.importJobs()
        async let photos = provider.photos()
        async let archives = provider.archives()

        self.dashboard = try await dashboard
        self.passengers = try await passengers
        self.importJobs = try await importJobs
        self.photos = try await photos
        self.archives = try await archives
    }

    func refreshPassengers() async {
        do {
            passengers = try await provider.passengers(query: passengerQuery)
        } catch {
            show(error)
        }
    }

    func importPassengerFiles(_ urls: [URL]) async {
        guard !urls.isEmpty else { return }
        await perform {
            try await provider.enqueue(
                files: urls,
                replaceExisting: replaceExistingList,
                strategy: duplicateStrategy
            )
            importJobs = try await provider.importJobs()
            dashboard = try await provider.dashboard()
            passengers = try await provider.passengers(query: passengerQuery)
            startImportMonitorIfNeeded()
        }
    }

    func importPhotoFiles(_ urls: [URL]) async {
        guard !urls.isEmpty else { return }
        await perform {
            try await provider.importPhotos(files: urls)
            photos = try await provider.photos()
            dashboard = try await provider.dashboard()
            passengers = try await provider.passengers(query: passengerQuery)
        }
    }

    func resumeImports() async {
        await perform {
            try await provider.resumeImports()
            importJobs = try await provider.importJobs()
            startImportMonitorIfNeeded()
        }
    }

    func retryImport(id: String) async {
        await perform {
            try await provider.retryImport(id: id)
            importJobs = try await provider.importJobs()
            startImportMonitorIfNeeded()
        }
    }

    func removeImport(id: String) async {
        await perform {
            try await provider.removeImport(id: id)
            importJobs = try await provider.importJobs()
        }
    }

    func createExport(_ kind: ExportKind) async {
        await perform {
            exportedURL = try await provider.export(kind: kind)
        }
    }

    func eraseAll() async {
        await perform {
            try await provider.eraseAll()
            exportedURL = nil
            try await refreshAll()
        }
    }

    private func perform(_ operation: () async throws -> Void) async {
        isWorking = true
        defer { isWorking = false }
        do {
            try await operation()
        } catch {
            show(error)
        }
    }

    private func show(_ error: Error) {
        alertMessage = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
    }

    private func startImportMonitorIfNeeded() {
        guard importMonitor == nil else { return }
        guard importJobs.contains(where: { $0.phase == .waiting || $0.phase == .processing }) else { return }

        importMonitor = Task { [weak self] in
            var completedIDs = Set(self?.importJobs.filter { $0.phase == .completed }.map(\.id) ?? [])
            while !Task.isCancelled {
                do {
                    try await Task<Never, Never>.sleep(for: .milliseconds(500))
                    guard let self else { return }
                    let jobs = try await self.provider.importJobs()
                    self.importJobs = jobs
                    let latestCompletedIDs = Set(jobs.filter { $0.phase == .completed }.map(\.id))
                    let hasActiveJobs = jobs.contains { $0.phase == .waiting || $0.phase == .processing }
                    if latestCompletedIDs != completedIDs || !hasActiveJobs {
                        self.dashboard = try await self.provider.dashboard()
                        self.passengers = try await self.provider.passengers(query: self.passengerQuery)
                        self.archives = try await self.provider.archives()
                        completedIDs = latestCompletedIDs
                    }
                    if !hasActiveJobs {
                        self.photos = try await self.provider.photos()
                        self.importMonitor = nil
                        return
                    }
                } catch is CancellationError {
                    self?.importMonitor = nil
                    return
                } catch {
                    self?.show(error)
                    self?.importMonitor = nil
                    return
                }
            }
        }
    }
}
