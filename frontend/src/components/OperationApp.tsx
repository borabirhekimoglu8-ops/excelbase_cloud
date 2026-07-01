"use client";

import { useState } from "react";
import { StoreProvider, useStore } from "@/lib/store";
import { HomeTab } from "@/components/tabs/HomeTab";
import { PassengersTab } from "@/components/tabs/PassengersTab";
import { IssuesTab } from "@/components/tabs/IssuesTab";
import { GalleryTab } from "@/components/tabs/GalleryTab";
import { ArchiveTab } from "@/components/tabs/ArchiveTab";
import { ImportTab } from "@/components/tabs/ImportTab";
import { PackageTab } from "@/components/tabs/PackageTab";

type TabKey = "home" | "passengers" | "issues" | "gallery" | "archive" | "import" | "package";

const TABS: { key: TabKey; label: string; icon: string }[] = [
  { key: "home", label: "Ana", icon: "◎" },
  { key: "passengers", label: "Yolcular", icon: "☰" },
  { key: "issues", label: "Eksikler", icon: "!" },
  { key: "gallery", label: "Galeri", icon: "▦" },
  { key: "archive", label: "Arşiv", icon: "🗂" },
  { key: "import", label: "Import", icon: "↑" },
  { key: "package", label: "Paket", icon: "⬢" },
];

function Shell() {
  const { summary, connected, toasts } = useStore();
  const [tab, setTab] = useState<TabKey>("home");
  const [passengerStatus, setPassengerStatus] = useState("");

  function navigate(target: string) {
    if (target === "passengers-fotosuz") {
      setPassengerStatus("Fotosuz");
      setTab("passengers");
      return;
    }
    setPassengerStatus("");
    setTab(target as TabKey);
  }

  const issueTotal = Object.values(summary.issue_counts).reduce((a, b) => a + b, 0);

  return (
    <div className="app-shell">
      <header className="hero-card">
        <div className="brand-mark" aria-hidden="true">
          <span>⛴</span>
        </div>
        <div className="hero-text">
          <p className="eyebrow">GATE VISA PAX · V7</p>
          <h1>Operasyon Merkezi</h1>
          <p className="hero-copy">
            {summary.passenger_count} yolcu · %{summary.readiness_percent} hazır
            {!connected && " · çevrimdışı"}
          </p>
        </div>
      </header>

      {!connected && (
        <div className="error-card">API bağlantısı kurulamadı. Sunucunun çalıştığından emin olun.</div>
      )}

      <main className="tab-content">
        {tab === "home" && <HomeTab onNavigate={navigate} />}
        {tab === "passengers" && <PassengersTab initialStatus={passengerStatus} />}
        {tab === "issues" && <IssuesTab />}
        {tab === "gallery" && <GalleryTab />}
        {tab === "archive" && <ArchiveTab />}
        {tab === "import" && <ImportTab />}
        {tab === "package" && <PackageTab />}
      </main>

      <nav className="tab-bar" aria-label="Ana gezinme">
        {TABS.map((t) => (
          <button
            key={t.key}
            className={t.key === tab ? "tab active" : "tab"}
            onClick={() => navigate(t.key)}
          >
            <span className="tab-icon" aria-hidden="true">
              {t.icon}
            </span>
            <span className="tab-label">{t.label}</span>
            {t.key === "issues" && issueTotal > 0 && <span className="tab-badge">{issueTotal}</span>}
          </button>
        ))}
      </nav>

      <div className="toast-stack" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast ${toast.tone}`}>
            {toast.text}
          </div>
        ))}
      </div>
    </div>
  );
}

export function OperationApp() {
  return (
    <StoreProvider>
      <Shell />
    </StoreProvider>
  );
}
