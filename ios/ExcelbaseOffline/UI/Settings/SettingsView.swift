import SwiftUI

struct SettingsView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var isEraseConfirmationPresented = false

    var body: some View {
        NavigationStack {
            List {
                Section {
                    OfflineStatusBanner()
                        .listRowInsets(EdgeInsets())
                        .listRowBackground(Color.clear)
                }

                Section("Çıktılar") {
                    ForEach(ExportKind.allCases) { kind in
                        Button {
                            Task { await model.createExport(kind) }
                        } label: {
                            Label(kind.title, systemImage: kind.symbol)
                        }
                    }

                    if let url = model.exportedURL {
                        ShareLink(item: url) {
                            Label("Hazır dosyayı paylaş", systemImage: "square.and.arrow.up")
                                .fontWeight(.semibold)
                        }
                    }
                }

                Section("Cihaz içi çalışma") {
                    Label("Yerel SQLite, AES-GCM şifreli yolcu kayıtları", systemImage: "cylinder.split.1x2")
                    Label("Fotoğraflar uygulamanın özel alanında", systemImage: "lock.square")
                    Label("İnternet bağlantısı kullanılmaz", systemImage: "wifi.slash")
                }

                Section("Veri yönetimi") {
                    Button(role: .destructive) {
                        isEraseConfirmationPresented = true
                    } label: {
                        Label("Bu iPhone’daki tüm verileri sil", systemImage: "trash")
                    }
                } footer: {
                    Text("Silme işlemi yolcuları, aktarım kuyruğunu ve fotoğrafları kalıcı olarak kaldırır. Önce taşınabilir Excel/CSV çıktısı alın.")
                }

                Section("Uygulama") {
                    LabeledContent("Sürüm", value: appVersion)
                    LabeledContent("Çalışma modu", value: "Tamamen çevrimdışı")
                }
            }
            .navigationTitle("Ayarlar")
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Bitti") { dismiss() }
                }
            }
            .confirmationDialog(
                "Tüm cihaz verileri silinsin mi?",
                isPresented: $isEraseConfirmationPresented,
                titleVisibility: .visible
            ) {
                Button("Kalıcı olarak sil", role: .destructive) {
                    Task { await model.eraseAll() }
                }
                Button("Vazgeç", role: .cancel) {}
            } message: {
                Text("Bu işlem geri alınamaz.")
            }
        }
    }

    private var appVersion: String {
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String
        let build = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String
        return "\(version ?? "1.0") (\(build ?? "1"))"
    }
}
