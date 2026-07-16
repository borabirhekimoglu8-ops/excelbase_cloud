import SwiftUI

struct ArchiveView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        NavigationStack {
            Group {
                if model.archives.isEmpty {
                    EmptyStateView(
                        title: "Arşiv boş",
                        message: "Gidiş tarihi bulunan yolcular operasyon tarihine göre burada gruplanır.",
                        symbol: "archivebox"
                    )
                } else {
                    List(model.archives) { archive in
                        ArchiveRow(archive: archive)
                    }
                    .listStyle(.insetGrouped)
                }
            }
            .background(Color(.systemGroupedBackground))
            .navigationTitle("Arşiv")
            .refreshable {
                try? await model.refreshAll()
            }
        }
    }
}

private struct ArchiveRow: View {
    let archive: ArchiveRowSummary

    private var readiness: Double {
        guard archive.passengerCount > 0 else { return 0 }
        return Double(archive.readyCount) / Double(archive.passengerCount)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(archive.title)
                        .font(.headline)
                    Text(archive.travelDate, format: .dateTime.day().month(.wide).year())
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Text("\(archive.passengerCount) yolcu")
                    .font(.subheadline.weight(.semibold))
            }

            ProgressView(value: readiness)
                .tint(readiness == 1 ? .green : .accentColor)

            Text("\(archive.readyCount) hazır · \(archive.passengerCount - archive.readyCount) kontrol bekliyor")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding(.vertical, 6)
        .accessibilityElement(children: .combine)
    }
}
