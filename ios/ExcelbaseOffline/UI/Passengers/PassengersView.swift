import SwiftUI

struct PassengersView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        @Bindable var model = model

        NavigationStack {
            VStack(spacing: 0) {
                DateScopeFilter(selection: $model.passengerDateScope)
                    .padding(.vertical, 10)
                    .background(Color(.systemGroupedBackground))

                if model.visiblePassengers.isEmpty {
                    EmptyStateView(
                        title: model.passengers.isEmpty && model.passengerQuery.isEmpty ? "Henüz yolcu yok" : "Sonuç bulunamadı",
                        message: model.passengers.isEmpty && model.passengerQuery.isEmpty
                            ? "Excel, CSV veya ZIP listenizi Aktarım sekmesinden ekleyin."
                            : "Aramayı veya tarih filtresini değiştirerek tekrar deneyin.",
                        symbol: "person.2"
                    )
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    List(model.visiblePassengers) { passenger in
                        PassengerRow(passenger: passenger)
                    }
                    .listStyle(.insetGrouped)
                }
            }
            .background(Color(.systemGroupedBackground))
            .navigationTitle("Yolcular")
            .navigationBarTitleDisplayMode(.large)
            .searchable(text: $model.passengerQuery, prompt: "Ad veya belge numarası")
            .onSubmit(of: .search) {
                Task { await model.refreshPassengers() }
            }
            .onChange(of: model.passengerQuery) { _, newValue in
                if newValue.isEmpty {
                    Task { await model.refreshPassengers() }
                }
            }
            .refreshable { await model.refreshPassengers() }
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Text(model.visiblePassengers.count, format: .number)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(.secondary)
                        .accessibilityLabel("Gösterilen yolcu sayısı: \(model.visiblePassengers.count)")
                }
            }
        }
    }
}

private struct DateScopeFilter: View {
    @Binding var selection: PassengerDateScope

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(PassengerDateScope.allCases) { scope in
                    Button(scope.title) {
                        selection = scope
                    }
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(selection == scope ? Color.white : Color.primary)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 9)
                    .background(
                        selection == scope ? Color.accentColor : Color(.secondarySystemGroupedBackground),
                        in: RoundedRectangle(cornerRadius: AppRadius.control)
                    )
                    .overlay {
                        if selection != scope {
                            RoundedRectangle(cornerRadius: AppRadius.control)
                                .stroke(Color(.separator).opacity(0.45), lineWidth: 0.5)
                        }
                    }
                    .accessibilityAddTraits(selection == scope ? .isSelected : [])
                }
            }
            .padding(.horizontal, AppSpacing.standard)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Gidiş tarihi filtresi")
    }
}

private struct PassengerRow: View {
    let passenger: PassengerSummary

    var body: some View {
        HStack(spacing: 14) {
            Image(systemName: passenger.hasPhoto ? "person.crop.square.fill" : "person.crop.square")
                .font(.title2)
                .foregroundStyle(passenger.hasPhoto ? Color.accentColor : Color.secondary)
                .frame(width: 36)
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 4) {
                Text(passenger.fullName)
                    .font(.body.weight(.semibold))
                    .lineLimit(1)
                HStack(spacing: 8) {
                    Text(passenger.passportNumber.isEmpty ? "Pasaport numarası yok" : passenger.passportNumber)
                    if let voucher = passenger.voucher, !voucher.isEmpty {
                        Text("•")
                        Text(voucher)
                    }
                }
                .font(.caption)
                .foregroundStyle(.secondary)

                if passenger.departureDate != nil || passenger.arrivalDate != nil {
                    HStack(spacing: 5) {
                        if let departure = passenger.departureDate {
                            Text(departure, format: .dateTime.day().month(.twoDigits).year())
                        }
                        if passenger.departureDate != nil && passenger.arrivalDate != nil {
                            Image(systemName: "arrow.right")
                                .accessibilityLabel("dönüş")
                        }
                        if let arrival = passenger.arrivalDate {
                            Text(arrival, format: .dateTime.day().month(.twoDigits).year())
                        }
                    }
                    .font(.caption2.monospacedDigit())
                    .foregroundStyle(.tertiary)
                }
            }

            Spacer(minLength: 8)

            if passenger.isDuplicate {
                Image(systemName: "doc.on.doc.fill")
                    .foregroundStyle(.red)
                    .accessibilityLabel("Tekrarlı kayıt")
            } else if !passenger.issues.isEmpty {
                Label("\(passenger.issues.count)", systemImage: "exclamationmark.triangle.fill")
                    .labelStyle(.titleAndIcon)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.orange)
                    .accessibilityLabel("\(passenger.issues.count) kontrol gerekli")
            } else {
                Image(systemName: "checkmark.circle.fill")
                    .foregroundStyle(.green)
                    .accessibilityLabel("Hazır")
            }
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
    }
}
