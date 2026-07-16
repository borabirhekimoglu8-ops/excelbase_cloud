import Foundation

public struct PhotoMatch: Hashable, Sendable {
    public let passengerID: UUID
    public let confidence: Double
    public let reason: String
}

public struct PhotoMatcher: Sendable {
    public init() {}

    public func bestMatch(fileName: String, passengers: [Passenger]) -> PhotoMatch? {
        let stem = URL(fileURLWithPath: fileName).deletingPathExtension().lastPathComponent
        let normalized = normalize(stem)
        guard !normalized.isEmpty else { return nil }

        var candidates: [PhotoMatch] = []
        for passenger in passengers {
            let passport = normalize(passenger.passportNumber)
            if passport.count >= 4, normalized.contains(passport) {
                candidates.append(PhotoMatch(passengerID: passenger.id, confidence: 1, reason: "passport"))
                continue
            }

            let first = normalize(passenger.firstName)
            let last = normalize(passenger.lastName)
            let full = normalize(passenger.fullName)
            if !full.isEmpty, normalized.contains(full) {
                candidates.append(PhotoMatch(passengerID: passenger.id, confidence: 0.90, reason: "full-name"))
            } else if !first.isEmpty, !last.isEmpty, normalized.contains(first), normalized.contains(last) {
                candidates.append(PhotoMatch(passengerID: passenger.id, confidence: 0.75, reason: "name-tokens"))
            }
        }
        guard let topConfidence = candidates.map(\.confidence).max() else { return nil }
        let top = candidates.filter { abs($0.confidence - topConfidence) < 0.000_1 }
        guard Set(top.map(\.passengerID)).count == 1 else { return nil }
        return top.first
    }

    private func normalize(_ value: String) -> String {
        value.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: Locale(identifier: "tr_TR"))
            .uppercased().filter(\.isLetterOrNumber)
    }
}
