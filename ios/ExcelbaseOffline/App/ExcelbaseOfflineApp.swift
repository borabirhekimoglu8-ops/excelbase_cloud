import SwiftUI

@main
@MainActor
struct ExcelbaseOfflineApp: App {
    @State private var model = AppModel(provider: LiveAppDataProvider())

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(model)
                .tint(.accentColor)
                .task { await model.prepare() }
        }
    }
}

private struct RootView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        @Bindable var model = model

        TabView(selection: $model.selectedTab) {
            DashboardView()
                .tag(AppTab.dashboard)
                .tabItem { Label("Genel", systemImage: "rectangle.grid.2x2") }

            PassengersView()
                .tag(AppTab.passengers)
                .tabItem { Label("Yolcular", systemImage: "person.2") }

            ImportView()
                .tag(AppTab.imports)
                .tabItem { Label("Aktarım", systemImage: "square.and.arrow.down") }
                .badge(model.activeImportCount)

            GalleryView()
                .tag(AppTab.gallery)
                .tabItem { Label("Galeri", systemImage: "photo.on.rectangle.angled") }

            ArchiveView()
                .tag(AppTab.archive)
                .tabItem { Label("Arşiv", systemImage: "archivebox") }

        }
        .sheet(isPresented: $model.isSettingsPresented) {
            SettingsView()
        }
        .overlay {
            if model.isPreparing || model.isWorking {
                WorkingOverlay()
            }
        }
        .alert(
            "İşlem tamamlanamadı",
            isPresented: Binding(
                get: { model.alertMessage != nil },
                set: { if !$0 { model.alertMessage = nil } }
            )
        ) {
            Button("Tamam", role: .cancel) { model.alertMessage = nil }
        } message: {
            Text(model.alertMessage ?? "Bilinmeyen bir hata oluştu.")
        }
    }
}
