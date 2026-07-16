import CryptoKit
import Foundation
import XCTest
@testable import ExcelbaseOffline

final class DataLayerTests: XCTestCase {
    func testAESGCMRoundTripRejectsTamperingAndRecordSwap() throws {
        let cipher = try AESGCMRecordCipher(keyProvider: InMemoryPIIKeyProvider())
        let firstID = UUID()
        let secondID = UUID()
        let passenger = samplePassenger(id: firstID)
        let encrypted = try cipher.encrypt(passenger, recordID: firstID)

        XCTAssertEqual(try cipher.decrypt(Passenger.self, from: encrypted, recordID: firstID), passenger)
        XCTAssertThrowsError(try cipher.decrypt(Passenger.self, from: encrypted, recordID: secondID))

        var tampered = encrypted
        tampered[tampered.index(before: tampered.endIndex)] ^= 0x01
        XCTAssertThrowsError(try cipher.decrypt(Passenger.self, from: tampered, recordID: firstID))
    }

    func testV7IdentityCanonicalizationAndValidation() {
        var passenger = samplePassenger(passport: " tr-12 34 ", departure: "16.07.2026")
        XCTAssertEqual(passenger.duplicateIdentityKey, "TR1234|2026-07-16")
        XCTAssertEqual(passenger.identityStorageKey.count, 64)
        XCTAssertFalse(passenger.identityStorageKey.contains("TR1234"))

        passenger.voucher = ""
        passenger.photoRef = ""
        XCTAssertTrue(passenger.issues.contains("Voucher eksik"))
        XCTAssertTrue(passenger.issues.contains("Fotoğraf eksik"))
    }

    func testReplaceBatchIsConsumedOnlyByFirstSuccessfulFile() throws {
        let database = try makeDatabase()
        try commit([samplePassenger(name: "OLD", passport: "A123456")], to: database)

        let replacementBatch = try database.createImportBatch(replaceExisting: true, duplicateStrategy: .add)
        let badJob = try database.createImportJob(
            batchID: replacementBatch,
            fileName: "empty.xlsx",
            stagedPath: "/tmp/empty.xlsx",
            sha256: "empty"
        )
        try database.transitionJob(id: badJob, to: .importing)
        try database.transitionJob(id: badJob, to: .committing)
        XCTAssertThrowsError(try database.commitStagedPassengers(jobID: badJob))
        try database.transitionJob(id: badJob, to: .failed, message: "empty")
        XCTAssertEqual(try database.fetchPassengers().map(\.fullName), ["OLD"])

        let firstGood = try makeJob(batchID: replacementBatch, database: database, name: "first.xlsx")
        try database.stagePassengers(
            [samplePassenger(name: "NEW-1", passport: "B123456")],
            jobID: firstGood,
            checkpointRow: 0
        )
        try database.transitionJob(id: firstGood, to: .committing)
        try database.commitStagedPassengers(jobID: firstGood)
        XCTAssertEqual(try database.fetchPassengers().map(\.fullName), ["NEW-1"])

        let secondGood = try makeJob(batchID: replacementBatch, database: database, name: "second.xlsx")
        try database.stagePassengers(
            [samplePassenger(name: "NEW-2", passport: "C123456")],
            jobID: secondGood,
            checkpointRow: 0
        )
        try database.transitionJob(id: secondGood, to: .committing)
        try database.commitStagedPassengers(jobID: secondGood)
        XCTAssertEqual(Set(try database.fetchPassengers().map(\.fullName)), ["NEW-1", "NEW-2"])
    }

    func testOverwritePreservesPassengerIDAndPhotoRelationship() throws {
        let database = try makeDatabase()
        let original = samplePassenger(name: "ORIGINAL", passport: "P123456", departure: "2026-08-10")
        try commit([original], to: database)
        let photoID = UUID()
        try database.savePhoto(
            PassengerPhoto(
                id: photoID,
                passengerID: original.id,
                originalFileName: "P123456.jpg",
                fileURL: database.containerURL.appendingPathComponent("Photos/\(photoID).jpg"),
                sha256: "abc"
            ),
            relativePath: "Photos/\(photoID).jpg"
        )

        let batch = try database.createImportBatch(replaceExisting: false, duplicateStrategy: .overwrite)
        let job = try makeJob(batchID: batch, database: database, name: "overwrite.xlsx")
        let update = samplePassenger(name: "UPDATED", passport: "P123456", departure: "2026-08-10")
        try database.stagePassengers([update], jobID: job, checkpointRow: 0)
        try database.transitionJob(id: job, to: .committing)
        try database.commitStagedPassengers(jobID: job)

        let saved = try XCTUnwrap(database.fetchPassengers().first)
        XCTAssertEqual(saved.id, original.id)
        XCTAssertEqual(saved.fullName, "UPDATED")
        XCTAssertTrue(saved.hasPhoto)
        XCTAssertEqual(try database.fetchPhotos(limit: 10).first?.passengerID, original.id)
    }

    func testCheckpointRecoveryPausesWithoutLosingStaging() throws {
        let directory = try temporaryDirectory()
        let url = directory.appendingPathComponent("app.sqlite")
        let cipher = try AESGCMRecordCipher(keyProvider: InMemoryPIIKeyProvider())
        let database = try AppDatabase(databaseURL: url, cipher: cipher)
        let batch = try database.createImportBatch(replaceExisting: false, duplicateStrategy: .skip)
        let job = try makeJob(batchID: batch, database: database, name: "large.xlsx")
        let rows = (0..<250).map {
            samplePassenger(name: "P\($0)", passport: "X\(String(format: "%06d", $0))")
        }
        try database.stagePassengers(rows, jobID: job, checkpointRow: 0)

        let reopened = try AppDatabase(databaseURL: url, cipher: cipher)
        let context = try XCTUnwrap(reopened.jobContext(id: job))
        XCTAssertEqual(context.job.status, .paused)
        XCTAssertEqual(context.checkpointRow, 250)
    }

    func testTurkishWireDTOMapsExactV7Fields() throws {
        let json = #"{"No":"7","Ad":"AYŞE","Soyad":"YILMAZ","Yolcu Adı Soyadı":"AYŞE YILMAZ","Pasaport No":"TR123456","Voucher":"V-1","Gidiş Tarihi":"2026-07-16","Varış Tarihi":"2026-07-20","Vize Ücreti Yetişkin":"25","Vize Ücreti Çocuk":"0","Kaynak Dosya":"liste.xlsx","Sayfa":"PAX","Foto":""}"#.data(using: .utf8)!
        let row = try JSONDecoder().decode(ImportedPassengerRow.self, from: json)
        let passenger = row.passenger(sortOrder: 6, fallbackSource: "fallback.xlsx")
        XCTAssertEqual(passenger.no, "7")
        XCTAssertEqual(passenger.passportNumber, "TR123456")
        XCTAssertEqual(passenger.sourceFile, "liste.xlsx")
        XCTAssertEqual(passenger.sortOrder, 6)
    }

    func testPausedJobIsNotRevivedWhenParserReturns() throws {
        let database = try makeDatabase()
        let batch = try database.createImportBatch(replaceExisting: false, duplicateStrategy: .skip)
        let job = try makeJob(batchID: batch, database: database, name: "pause.xlsx")
        try database.transitionJob(id: job, to: .paused, message: "paused")

        XCTAssertFalse(
            try database.recordParsedOutputIfStillImporting(
                id: job,
                totalRows: 12,
                outputPath: "/tmp/pause.ndjson"
            )
        )
        let context = try XCTUnwrap(database.jobContext(id: job))
        XCTAssertEqual(context.job.status, .paused)
        XCTAssertNil(context.outputPath)
        XCTAssertNil(try database.nextRunnableJob())

        try database.requeuePausedJobs()
        XCTAssertEqual(try database.nextRunnableJob()?.job.id, job)
    }

    func testDelimitedFallbackEmitsTurkishWireContract() async throws {
        let directory = try temporaryDirectory()
        let input = directory.appendingPathComponent("pax.csv")
        let output = directory.appendingPathComponent("pax.ndjson")
        try Data("NAME,SURNAME,PASSPORT NUMBER,DEPARTURE\nAYSE,YILMAZ,T1234567,2026-07-16\n".utf8)
            .write(to: input)

        _ = try await DelimitedTextBridge().importToNDJSON(input: input, output: output)
        let line = try XCTUnwrap(String(contentsOf: output, encoding: .utf8).split(separator: "\n").first)
        let row = try JSONDecoder().decode(ImportedPassengerRow.self, from: Data(line.utf8))
        XCTAssertEqual(row.fullName, "AYSE YILMAZ")
        XCTAssertEqual(row.passportNumber, "T1234567")
    }

    func testPhotoMatcherRejectsAmbiguousPassportAndUsesSpecifiedConfidence() {
        let first = samplePassenger(name: "AYŞE YILMAZ", passport: "T1234567")
        let duplicate = samplePassenger(name: "AYŞE YILMAZ", passport: "T1234567")
        let matcher = PhotoMatcher()
        XCTAssertNil(matcher.bestMatch(fileName: "T1234567.jpg", passengers: [first, duplicate]))

        let unique = matcher.bestMatch(fileName: "T1234567.jpg", passengers: [first])
        XCTAssertEqual(unique?.passengerID, first.id)
        XCTAssertEqual(unique?.confidence, 1.0)

        let name = matcher.bestMatch(fileName: "AYSEYILMAZ.jpg", passengers: [first])
        XCTAssertEqual(name?.confidence, 0.90)
    }

    func testStagerHashesAllSelectedFilesWithoutCountCap() async throws {
        let directory = try temporaryDirectory()
        let inputs = directory.appendingPathComponent("inputs", isDirectory: true)
        try FileManager.default.createDirectory(at: inputs, withIntermediateDirectories: true)
        let urls = try (0..<32).map { index -> URL in
            let url = inputs.appendingPathComponent("\(index).csv")
            try Data("row-\(index)".utf8).write(to: url)
            return url
        }
        let stager = StagedFileManager(containerURL: directory.appendingPathComponent("private", isDirectory: true))
        let staged = try await stager.stage(urls: urls)
        XCTAssertEqual(staged.count, urls.count)
        XCTAssertEqual(Set(staged.map(\.sha256)).count, urls.count)
        XCTAssertTrue(staged.allSatisfy { FileManager.default.fileExists(atPath: $0.url.path) })
    }

    func testCSVExportUsesBOMSemicolonAndAllThirteenV7Columns() async throws {
        let database = try makeDatabase()
        try commit([samplePassenger(name: "AYŞE; YILMAZ")], to: database)
        let service = ExportService(database: database, bridge: DelimitedTextBridge())
        let destination = try temporaryDirectory().appendingPathComponent("pax.csv")
        _ = try await service.export(format: .csv, destination: destination)

        let data = try Data(contentsOf: destination)
        XCTAssertEqual(Array(data.prefix(3)), [0xEF, 0xBB, 0xBF])
        let text = try XCTUnwrap(String(data: data, encoding: .utf8))
        XCTAssertTrue(text.contains("No;Ad;Soyad;Yolcu Adı Soyadı;Pasaport No"))
        XCTAssertEqual(text.split(separator: "\n").first?.split(separator: ";", omittingEmptySubsequences: false).count, 13)
        XCTAssertTrue(text.contains("\"AYŞE; YILMAZ\""))
    }

    private func commit(_ passengers: [Passenger], to database: AppDatabase) throws {
        let batch = try database.createImportBatch(replaceExisting: false, duplicateStrategy: .add)
        let job = try makeJob(batchID: batch, database: database, name: "seed.xlsx")
        try database.stagePassengers(passengers, jobID: job, checkpointRow: 0)
        try database.transitionJob(id: job, to: .committing)
        try database.commitStagedPassengers(jobID: job)
    }

    private func makeJob(batchID: UUID, database: AppDatabase, name: String) throws -> UUID {
        let id = try database.createImportJob(
            batchID: batchID,
            fileName: name,
            stagedPath: "/tmp/\(name)",
            sha256: UUID().uuidString
        )
        try database.transitionJob(id: id, to: .importing)
        return id
    }

    private func makeDatabase() throws -> AppDatabase {
        try AppDatabase(
            databaseURL: temporaryDirectory().appendingPathComponent("app.sqlite"),
            cipher: try AESGCMRecordCipher(keyProvider: InMemoryPIIKeyProvider())
        )
    }

    private func temporaryDirectory() throws -> URL {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: url) }
        return url
    }

    private func samplePassenger(
        id: UUID = UUID(),
        name: String = "TEST PASSENGER",
        passport: String = "T1234567",
        departure: String = "2026-07-16"
    ) -> Passenger {
        Passenger(
            id: id,
            no: "1",
            firstName: name.components(separatedBy: " ").first ?? name,
            lastName: name.components(separatedBy: " ").dropFirst().joined(separator: " "),
            fullName: name,
            passportNumber: passport,
            voucher: "V-1",
            departureDate: departure,
            arrivalDate: "2026-07-20",
            adultFee: "25",
            childFee: "0",
            sourceFile: "test.xlsx",
            sheet: "PAX"
        )
    }
}
