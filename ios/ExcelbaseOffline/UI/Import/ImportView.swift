import SwiftUI
import UniformTypeIdentifiers

struct ImportView: View {
    @Environment(AppModel.self) private var model
    @State private var isFilePickerPresented = false

    var body: some View {
        @Bindable var model = model

        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: AppSpacing.section) {
                    OfflineStatusBanner()
                    selectionCard

                    if model.resumableImportCount > 0 {
                        resumeCard
                    }

                    VStack(alignment: .leading, spacing: 12) {
                        HStack {
                            Text("Aktarım kuyruğu")
                                .font(.title3.weight(.bold))
                            Spacer()
                            Text(model.importJobs.count, format: .number)
                                .font(.subheadline.monospacedDigit())
                                .foregroundStyle(.secondary)
                        }

                        if model.importJobs.isEmpty {
                            SectionCard {
                                EmptyStateView(
                                    title: "Kuyruk boş",
                                    message: "Seçtiğiniz listeler cihaz içinde sırayla işlenir.",
                                    symbol: "tray"
                                )
                                .frame(minHeight: 180)
                            }
                        } else {
                            ForEach(model.importJobs) { job in
                                ImportJobCard(job: job)
                            }
                        }
                    }
                }
                .padding(AppSpacing.standard)
            }
            .background(Color(.systemGroupedBackground))
            .navigationTitle("Toplu Aktarım")
            .fileImporter(
                isPresented: $isFilePickerPresented,
                allowedContentTypes: [.excelXLSX, .excelXLS, .excelXLSM, .commaSeparatedText, .excelODS, .zip],
                allowsMultipleSelection: true
            ) { result in
                switch result {
                case .success(let urls):
                    Task { await model.importPassengerFiles(urls) }
                case .failure(let error):
                    model.alertMessage = error.localizedDescription
                }
            }
        }
    }

    private var selectionCard: some View {
        SectionCard {
            VStack(alignment: .leading, spacing: AppSpacing.standard) {
                Label("Yolcu listelerini seçin", systemImage: "doc.on.doc")
                    .font(.title3.weight(.bold))
                Text("XLSX, XLS, XLSM, CSV, ODS ve ZIP dosyaları. Uygulama yapay bir dosya adedi sınırı koymaz.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)

                Button {
                    isFilePickerPresented = true
                } label: {
                    Label("Dosyaları seç", systemImage: "folder.badge.plus")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)

                Toggle("Mevcut listeyi ilk dosyayla değiştir", isOn: Binding(
                    get: { model.replaceExistingList },
                    set: { model.replaceExistingList = $0 }
                ))
                .font(.subheadline.weight(.semibold))

                VStack(alignment: .leading, spacing: 8) {
                    Text("Tekrar durumunda")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                    Picker("Tekrar durumunda", selection: Binding(
                        get: { model.duplicateStrategy },
                        set: { model.duplicateStrategy = $0 }
                    )) {
                        ForEach(ImportDuplicateStrategy.allCases) { strategy in
                            Text(strategy.title).tag(strategy)
                        }
                    }
                    .pickerStyle(.menu)
                    .frame(maxWidth: .infinity, alignment: .leading)
                }

                Label(
                    "Her dosyadan sonra ilerleme kaydedilir. iOS işlemi durdurursa uygulama yeniden açıldığında kuyruk kaldığı yerden devam eder.",
                    systemImage: "arrow.clockwise.circle"
                )
                .font(.caption)
                .foregroundStyle(.secondary)
            }
        }
    }

    private var resumeCard: some View {
        SectionCard {
            HStack(spacing: 14) {
                Image(systemName: "play.square.stack")
                    .font(.title2)
                    .foregroundStyle(Color.accentColor)
                VStack(alignment: .leading, spacing: 3) {
                    Text("Bekleyen aktarım bulundu")
                        .font(.headline)
                    Text("\(model.resumableImportCount) dosya yeniden başlatılabilir.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Button("Devam et") {
                    Task { await model.resumeImports() }
                }
                .buttonStyle(.bordered)
            }
        }
    }
}

private struct ImportJobCard: View {
    @Environment(AppModel.self) private var model
    let job: ImportJobSummary

    var body: some View {
        SectionCard {
            VStack(alignment: .leading, spacing: 12) {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 3) {
                        Text(job.fileName)
                            .font(.headline)
                            .lineLimit(2)
                        Text("\(job.processedRows) / \(job.totalRows) satır")
                            .font(.caption.monospacedDigit())
                            .foregroundStyle(.secondary)
                    }
                    Spacer(minLength: 8)
                    ImportPhaseBadge(phase: job.phase)
                }

                ProgressView(value: job.progress)

                if let message = job.message, !message.isEmpty {
                    Text(message)
                        .font(.caption)
                        .foregroundStyle(job.phase == .failed ? .red : .secondary)
                }

                if job.phase == .failed || job.phase == .paused {
                    HStack {
                        Button("Yeniden dene") {
                            Task { await model.retryImport(id: job.id) }
                        }
                        .buttonStyle(.bordered)

                        Button("Kaldır", role: .destructive) {
                            Task { await model.removeImport(id: job.id) }
                        }
                        .buttonStyle(.bordered)
                    }
                }
            }
        }
    }
}

private extension UTType {
    static let excelXLSX = UTType(filenameExtension: "xlsx") ?? .data
    static let excelXLS = UTType(filenameExtension: "xls") ?? .data
    static let excelXLSM = UTType(filenameExtension: "xlsm") ?? .data
    static let excelODS = UTType(filenameExtension: "ods") ?? .data
}
