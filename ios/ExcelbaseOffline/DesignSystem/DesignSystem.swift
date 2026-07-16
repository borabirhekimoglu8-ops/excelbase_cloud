import SwiftUI

enum AppSpacing {
    static let compact: CGFloat = 8
    static let standard: CGFloat = 16
    static let section: CGFloat = 24
}

enum AppRadius {
    static let control: CGFloat = 12
    static let card: CGFloat = 16
}

struct OfflineStatusBanner: View {
    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "iphone.gen3")
                .foregroundStyle(Color.accentColor)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text("Bu iPhone’da çalışıyor")
                    .font(.subheadline.weight(.semibold))
                Text("İnternet veya açık bilgisayar gerekmez")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
            Image(systemName: "checkmark.shield.fill")
                .foregroundStyle(.green)
                .accessibilityLabel("Cihaz içi veri koruması etkin")
        }
        .padding(AppSpacing.standard)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: AppRadius.card))
        .overlay {
            RoundedRectangle(cornerRadius: AppRadius.card)
                .stroke(Color(.separator).opacity(0.35), lineWidth: 0.5)
        }
    }
}

struct SectionCard<Content: View>: View {
    let content: Content

    init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    var body: some View {
        content
            .padding(AppSpacing.standard)
            .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: AppRadius.card))
            .overlay {
                RoundedRectangle(cornerRadius: AppRadius.card)
                    .stroke(Color(.separator).opacity(0.35), lineWidth: 0.5)
            }
    }
}

struct MetricTile: View {
    let title: String
    let value: Int
    let symbol: String
    var tint: Color = .accentColor

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Image(systemName: symbol)
                .font(.headline)
                .foregroundStyle(tint)
                .accessibilityHidden(true)
            Text(value, format: .number)
                .font(.title2.weight(.bold))
                .monospacedDigit()
            Text(title)
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(1)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(AppSpacing.standard)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: AppRadius.card))
        .accessibilityElement(children: .combine)
    }
}

struct EmptyStateView: View {
    let title: String
    let message: String
    let symbol: String

    var body: some View {
        ContentUnavailableView(
            title,
            systemImage: symbol,
            description: Text(message)
        )
    }
}

struct ImportPhaseBadge: View {
    let phase: ImportJobPhase

    private var color: Color {
        switch phase {
        case .waiting, .paused: .orange
        case .processing: .blue
        case .completed: .green
        case .failed: .red
        }
    }

    var body: some View {
        Label(phase.title, systemImage: phase.symbol)
            .font(.caption.weight(.semibold))
            .foregroundStyle(color)
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(color.opacity(0.12), in: Capsule())
    }
}

struct WorkingOverlay: View {
    var body: some View {
        ZStack {
            Color.black.opacity(0.2).ignoresSafeArea()
            ProgressView("İşlem sürüyor…")
                .padding(AppSpacing.section)
                .background(.regularMaterial, in: RoundedRectangle(cornerRadius: AppRadius.card))
        }
        .accessibilityAddTraits(.isModal)
    }
}
