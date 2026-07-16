import SwiftUI

struct DashboardView: View {
    @Environment(AppModel.self) private var model
    private let columns = [GridItem(.flexible()), GridItem(.flexible())]

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: AppSpacing.section) {
                    OfflineStatusBanner()

                    LazyVGrid(columns: columns, spacing: AppSpacing.standard) {
                        MetricTile(
                            title: "Toplam yolcu",
                            value: model.dashboard.passengerCount,
                            symbol: "person.2.fill"
                        )
                        MetricTile(
                            title: "Hazır",
                            value: model.dashboard.readyCount,
                            symbol: "checkmark.seal.fill",
                            tint: .green
                        )
                        MetricTile(
                            title: "Fotoğraf eksik",
                            value: model.dashboard.missingPhotoCount,
                            symbol: "person.crop.rectangle.badge.exclamationmark",
                            tint: .orange
                        )
                        MetricTile(
                            title: "Eşleşen fotoğraf",
                            value: model.dashboard.matchedPhotoCount,
                            symbol: "photo.badge.checkmark",
                            tint: .green
                        )
                        MetricTile(
                            title: "Kontrol gerekli",
                            value: model.dashboard.issueCount,
                            symbol: "exclamationmark.triangle.fill",
                            tint: .red
                        )
                    }

                    readinessCard
                    feeCard
                    quickActions
                }
                .padding(AppSpacing.standard)
            }
            .background(Color(.systemGroupedBackground))
            .navigationTitle("Excelbase")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Button {
                            Task { try? await model.refreshAll() }
                        } label: {
                            Label("Yenile", systemImage: "arrow.clockwise")
                        }
                        Button {
                            model.isSettingsPresented = true
                        } label: {
                            Label("Ayarlar ve çıktılar", systemImage: "gearshape")
                        }
                    } label: {
                        Label("İşlemler", systemImage: "ellipsis.circle")
                    }
                }
            }
            .refreshable { try? await model.refreshAll() }
        }
    }

    private var feeCard: some View {
        SectionCard {
            VStack(alignment: .leading, spacing: 12) {
                Label("Ücret özeti", systemImage: "banknote")
                    .font(.headline)
                HStack {
                    feeValue("Yetişkin", value: model.dashboard.adultFeeTotal)
                    Divider()
                    feeValue("Çocuk", value: model.dashboard.childFeeTotal)
                }
                .frame(minHeight: 52)
            }
        }
    }

    private func feeValue(_ title: String, value: Decimal) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(title)
                .font(.caption)
                .foregroundStyle(.secondary)
            Text(value, format: .currency(code: "EUR"))
                .font(.headline.monospacedDigit())
                .lineLimit(1)
                .minimumScaleFactor(0.75)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var readinessCard: some View {
        let total = model.dashboard.passengerCount
        let readiness = total == 0 ? 0 : Double(model.dashboard.readyCount) / Double(total)

        return SectionCard {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    Text("Operasyon hazırlığı")
                        .font(.headline)
                    Spacer()
                    Text(readiness, format: .percent.precision(.fractionLength(0)))
                        .font(.headline.monospacedDigit())
                }
                ProgressView(value: readiness)
                    .tint(readiness == 1 ? .green : .accentColor)
                Text(total == 0 ? "İlk yolcu listenizi Aktarım sekmesinden ekleyin." : "Hazır kayıtlar, fotoğrafı ve zorunlu alanları tamamlanan yolculardır.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private var quickActions: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Hızlı işlemler")
                .font(.title3.weight(.bold))

            SectionCard {
                VStack(spacing: 0) {
                    actionButton("Yolcu listesi ekle", symbol: "doc.badge.plus", tab: .imports)
                    Divider().padding(.leading, 36)
                    actionButton("Yolcuları kontrol et", symbol: "person.text.rectangle", tab: .passengers)
                    Divider().padding(.leading, 36)
                    Button {
                        model.isSettingsPresented = true
                    } label: {
                        HStack(spacing: 12) {
                            Image(systemName: "square.and.arrow.up")
                                .frame(width: 24)
                            Text("Çıktılar")
                                .foregroundStyle(.primary)
                            Spacer()
                            Image(systemName: "chevron.right")
                                .font(.caption.weight(.bold))
                                .foregroundStyle(.tertiary)
                        }
                        .padding(.vertical, 14)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    private func actionButton(_ title: String, symbol: String, tab: AppTab) -> some View {
        Button {
            model.selectedTab = tab
        } label: {
            HStack(spacing: 12) {
                Image(systemName: symbol)
                    .frame(width: 24)
                Text(title)
                    .foregroundStyle(.primary)
                Spacer()
                Image(systemName: "chevron.right")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(.tertiary)
            }
            .padding(.vertical, 14)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}
