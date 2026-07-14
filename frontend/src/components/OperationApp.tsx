"use client";

import { useMemo, useState } from "react";
import { AuthGate, useAuth } from "@/lib/auth";
import { StoreProvider, useStore } from "@/lib/store";
import { DateScopeBar } from "@/components/DateScopeBar";
import { HomeTab } from "@/components/tabs/HomeTab";
import { PassengersTab } from "@/components/tabs/PassengersTab";
import { IssuesTab } from "@/components/tabs/IssuesTab";
import { GalleryTab } from "@/components/tabs/GalleryTab";
import { ArchiveTab } from "@/components/tabs/ArchiveTab";
import { ImportTab } from "@/components/tabs/ImportTab";
import { PackageTab } from "@/components/tabs/PackageTab";
import { ManagementTab } from "@/components/tabs/ManagementTab";
import { UI_VERSION } from "@/lib/version";

type TabKey = "home" | "passengers" | "issues" | "gallery" | "archive" | "import" | "package" | "management";

const TABS: Array<{ key: TabKey; label: string; code: string; roles?: string[] }> = [
  { key: "home", label: "Genel", code: "01" },
  { key: "passengers", label: "Yolcular", code: "02" },
  { key: "issues", label: "Kontrol", code: "03" },
  { key: "gallery", label: "Galeri", code: "04" },
  { key: "archive", label: "Arşiv", code: "05" },
  { key: "import", label: "Aktarım", code: "06", roles: ["admin", "operator"] },
  { key: "package", label: "Teslim", code: "07" },
  { key: "management", label: "Yönetim", code: "08", roles: ["admin"] },
];

const ROLE_LABELS: Record<string, string> = {
  admin: "Yönetici",
  operator: "Operasyon",
  viewer: "Görüntüleme",
};

function Shell() {
  const { summary, connected, toasts } = useStore();
  const { user, signOut } = useAuth();
  const [tab, setTab] = useState<TabKey>("home");
  const [passengerStatus, setPassengerStatus] = useState("");

  const tabs = useMemo(
    () => TABS.filter((item) => !item.roles || item.roles.includes(user.role)),
    [user.role],
  );

  function navigate(target: string) {
    if (target === "passengers-fotosuz") {
      setPassengerStatus("Fotosuz");
      setTab("passengers");
      return;
    }
    if (!tabs.some((item) => item.key === target)) return;
    setPassengerStatus("");
    setTab(target as TabKey);
  }

  const issueTotal = Object.values(summary.issue_counts).reduce((a, b) => a + b, 0);

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand-lockup">
          <span className="brand-symbol">GV</span>
          <div>
            <strong>Gate Visa Operations</strong>
            <small>Passenger Operations Platform</small>
          </div>
        </div>
        <div className="header-account">
          <div className="account-copy">
            <strong>{user.name}</strong>
            <small>{ROLE_LABELS[user.role] ?? user.role}</small>
          </div>
          <button className="account-action" onClick={() => void signOut()} type="button">Çıkış</button>
        </div>
      </header>

      <div className="status-strip">
        <span className={connected ? "system-dot online" : "system-dot offline"} />
        <span>{connected ? "Sistem çevrimiçi" : "Sunucu bağlantısı yok"}</span>
        <span className="status-divider" />
        <span>{summary.passenger_count} yolcu</span>
        <span className="status-divider" />
        <span>%{summary.readiness_percent} hazır</span>
        <span className="status-divider" />
        <span>
          v{UI_VERSION}
          {summary.version && summary.version !== UI_VERSION ? ` · sunucu v${summary.version} — sayfayı yenileyin` : ""}
        </span>
      </div>

      <DateScopeBar />

      <main className="tab-content">
        {tab === "home" && <HomeTab onNavigate={navigate} />}
        {tab === "passengers" && <PassengersTab initialStatus={passengerStatus} />}
        {tab === "issues" && <IssuesTab />}
        {tab === "gallery" && <GalleryTab />}
        {tab === "archive" && <ArchiveTab />}
        {tab === "import" && <ImportTab />}
        {tab === "package" && <PackageTab />}
        {tab === "management" && <ManagementTab />}
      </main>

      <nav className="tab-bar" aria-label="Ana gezinme">
        {tabs.map((item) => (
          <button
            key={item.key}
            className={item.key === tab ? "tab active" : "tab"}
            onClick={() => navigate(item.key)}
            type="button"
          >
            <span className="tab-code">{item.code}</span>
            <span className="tab-label">{item.label}</span>
            {item.key === "issues" && issueTotal > 0 && <span className="tab-badge">{issueTotal}</span>}
          </button>
        ))}
      </nav>

      <div className="toast-stack" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast ${toast.tone}`}>{toast.text}</div>
        ))}
      </div>
    </div>
  );
}

export function OperationApp() {
  return (
    <AuthGate>
      <StoreProvider>
        <Shell />
      </StoreProvider>
    </AuthGate>
  );
}
