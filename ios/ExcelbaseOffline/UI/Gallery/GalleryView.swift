import CoreTransferable
import PhotosUI
import SwiftUI
import UniformTypeIdentifiers
import UIKit

struct GalleryView: View {
    @Environment(AppModel.self) private var model
    @State private var pickerItems: [PhotosPickerItem] = []
    @State private var isFilePickerPresented = false

    private let columns = [
        GridItem(.adaptive(minimum: 144, maximum: 220), spacing: AppSpacing.standard)
    ]

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: AppSpacing.section) {
                    OfflineStatusBanner()
                    importCard

                    if model.photos.isEmpty {
                        EmptyStateView(
                            title: "Henüz fotoğraf yok",
                            message: "Biyometrik fotoğrafları veya ZIP paketini seçin; eşleştirme cihaz içinde yapılır.",
                            symbol: "photo.on.rectangle.angled"
                        )
                        .frame(minHeight: 260)
                    } else {
                        LazyVGrid(columns: columns, spacing: AppSpacing.standard) {
                            ForEach(model.photos) { photo in
                                PhotoCard(photo: photo)
                            }
                        }
                    }
                }
                .padding(AppSpacing.standard)
            }
            .background(Color(.systemGroupedBackground))
            .navigationTitle("Galeri")
            .onChange(of: pickerItems) { _, items in
                Task { await importPickerItems(items) }
            }
            .fileImporter(
                isPresented: $isFilePickerPresented,
                allowedContentTypes: [.image, .zip],
                allowsMultipleSelection: true
            ) { result in
                switch result {
                case .success(let urls):
                    Task { await model.importPhotoFiles(urls) }
                case .failure(let error):
                    model.alertMessage = error.localizedDescription
                }
            }
        }
    }

    private var importCard: some View {
        SectionCard {
            VStack(alignment: .leading, spacing: AppSpacing.standard) {
                Label("Fotoğrafları eşleştirin", systemImage: "person.crop.rectangle.stack")
                    .font(.headline)
                Text("Dosya adı pasaport numarasıyla eşleşen fotoğraflar otomatik olarak yolcuya bağlanır.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)

                HStack {
                    PhotosPicker(
                        selection: $pickerItems,
                        maxSelectionCount: nil,
                        matching: .images
                    ) {
                        Label("Fotoğraflar", systemImage: "photo.badge.plus")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)

                    Button {
                        isFilePickerPresented = true
                    } label: {
                        Label("Dosya / ZIP", systemImage: "folder")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.bordered)
                }
                .controlSize(.large)
            }
        }
    }

    private func importPickerItems(_ items: [PhotosPickerItem]) async {
        guard !items.isEmpty else { return }
        var stagedURLs: [URL] = []
        defer {
            for url in stagedURLs {
                try? FileManager.default.removeItem(at: url)
            }
        }
        do {
            for item in items {
                guard let file = try await item.loadTransferable(type: ImportedPhotoFile.self) else { continue }
                stagedURLs.append(file.url)
            }
            await model.importPhotoFiles(stagedURLs)
            pickerItems = []
        } catch {
            model.alertMessage = error.localizedDescription
        }
    }
}

private struct ImportedPhotoFile: Transferable, Sendable {
    let url: URL

    static var transferRepresentation: some TransferRepresentation {
        FileRepresentation(importedContentType: .image) { received in
            let staging = FileManager.default.temporaryDirectory
                .appendingPathComponent("ExcelbasePhotoSelection", isDirectory: true)
            try FileManager.default.createDirectory(at: staging, withIntermediateDirectories: true)
            let originalName = received.file.lastPathComponent
            let destination = staging.appendingPathComponent("\(UUID().uuidString)-\(originalName)")
            try FileManager.default.copyItem(at: received.file, to: destination)
            return ImportedPhotoFile(url: destination)
        }
    }
}

private struct PhotoCard: View {
    let photo: PhotoSummary

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Group {
                if let image = UIImage(contentsOfFile: photo.localURL.path) {
                    Image(uiImage: image)
                        .resizable()
                        .scaledToFill()
                } else {
                    Image(systemName: "person.crop.rectangle")
                        .resizable()
                        .scaledToFit()
                        .padding(32)
                        .foregroundStyle(.secondary)
                }
            }
            .frame(maxWidth: .infinity)
            .aspectRatio(4 / 5, contentMode: .fit)
            .background(Color(.tertiarySystemFill))
            .clipShape(RoundedRectangle(cornerRadius: AppRadius.control))

            Text(photo.passengerName)
                .font(.subheadline.weight(.semibold))
                .lineLimit(1)
            HStack {
                Text(photo.passportNumber)
                    .font(.caption.monospaced())
                    .foregroundStyle(.secondary)
                Spacer()
                Image(systemName: photo.matched ? "link.circle.fill" : "questionmark.circle")
                    .foregroundStyle(photo.matched ? .green : .orange)
                    .accessibilityLabel(photo.matched ? "Yolcuyla eşleşti" : "Eşleşmedi")
            }
        }
        .padding(10)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: AppRadius.card))
        .accessibilityElement(children: .combine)
    }
}
