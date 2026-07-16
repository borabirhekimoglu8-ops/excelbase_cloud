"use client";

import { useState } from "react";
import { AuthGate, useAuth } from "@/lib/auth";
import { StoreProvider, useStore } from "@/lib/store";
import { AppHeaderHome, AppHeaderScreen } from "@/components/ido/AppHeader";
import { BottomNav, NavKey } from "@/components/ido/BottomNav";
import { HomeTab } from "@/components/tabs/HomeTab";
import { PassengersTab } from "@/components/tabs/PassengersTab";
import { ImportTab } from "@/components/tabs/ImportTab";
import { SettingsTab, SettingsSub } from "@/components/tabs/SettingsTab";
import { IssuesTab } from "@/components/tabs/IssuesTab";
import { GalleryTab } from "@/components/tabs/GalleryTab";
import { ArchiveTab } from "@/components/tabs/ArchiveTab";
import { PackageTab } from "@/components/tabs/PackageTab";
import { ManagementTab } from "@/components/tabs/ManagementTab";
import { DateScopeBar } from "@/components/DateScopeBar";

type Screen =
  | { kind: "home" }
  | { kind: "passengers"; status: string }
  | { kind: "import" }
  | { kind: "settings" }
  | { kind: "settings-sub"; sub: SettingsSub };

const SETTINGS_TITLES: Record<SettingsSub, string> = {
  issues: "Kontrol Merkezi",
  gallery: "Fotoğraf Galerisi",
  archive: "Tarih Arşivi",
  package: "Çıktılar ve Yedek",
  management: "Cihaz ve Güvenlik",
};

function Shell() {
  const { toasts } = useStore();
  const { user } = useAuth();
  const [screen, setScreen] = useState<Screen>({ kind: "home" });

  function navigate(target: string) {
    if (target === "passengers-fotosuz") {
      setScreen({ kind: "passengers", status: "Fotosuz" });
      return;
    }
    if (target === "passengers-eksik") {
      setScreen({ kind: "passengers", status: "Eksik" });
      return;
    }
    if (target === "home" || target === "import") {
      setScreen({ kind: target });
      return;
    }
    if (target === "passengers") {
      setScreen({ kind: "passengers", status: "" });
      return;
    }
    setScreen({ kind: "home" });
  }

  function onNavSelect(key: NavKey) {
    if (key === "home") setScreen({ kind: "home" });
    else if (key === "passengers") setScreen({ kind: "passengers", status: "" });
    else if (key === "import") setScreen({ kind: "import" });
    else setScreen({ kind: "settings" });
  }

  const activeNav: NavKey =
    screen.kind === "home"
      ? "home"
      : screen.kind === "passengers"
        ? "passengers"
        : screen.kind === "import"
          ? "import"
          : "settings";

  return (
    <div className="ido-app">
      <div className="ido-frame">
        {screen.kind === "home" && <AppHeaderHome />}
        {screen.kind === "passengers" && (
          <AppHeaderScreen
            title="Yolcular"
            onBack={() => navigate("home")}
            action={
              user.role !== "viewer" ? (
                <button className="ido-header-action" onClick={() => navigate("import")} type="button">
                  TOPLU EKLE
                </button>
              ) : undefined
            }
          />
        )}
        {screen.kind === "import" && <AppHeaderScreen title="Toplu Yükleme" onBack={() => navigate("home")} />}
        {screen.kind === "settings" && <AppHeaderScreen title="Ayarlar" onBack={() => navigate("home")} />}
        {screen.kind === "settings-sub" && (
          <AppHeaderScreen title={SETTINGS_TITLES[screen.sub]} onBack={() => setScreen({ kind: "settings" })} />
        )}

        <div className={`ido-content${screen.kind === "import" ? " has-sticky" : ""}`}>
          {screen.kind !== "import" && (
            <div style={{ marginBottom: -2 }}>
              <DateScopeBar />
            </div>
          )}
          {screen.kind === "home" && <HomeTab onNavigate={navigate} />}
          {screen.kind === "passengers" && <PassengersTab initialStatus={screen.status} />}
          {screen.kind === "import" && <ImportTab onNavigate={navigate} />}
          {screen.kind === "settings" && (
            <SettingsTab onOpen={(sub) => setScreen({ kind: "settings-sub", sub })} />
          )}
          {screen.kind === "settings-sub" && screen.sub === "issues" && <IssuesTab />}
          {screen.kind === "settings-sub" && screen.sub === "gallery" && <GalleryTab />}
          {screen.kind === "settings-sub" && screen.sub === "archive" && <ArchiveTab />}
          {screen.kind === "settings-sub" && screen.sub === "package" && <PackageTab />}
          {screen.kind === "settings-sub" && screen.sub === "management" && <ManagementTab />}
        </div>

        <BottomNav active={activeNav} onSelect={onNavSelect} />

        <div className="toast-stack" aria-live="polite">
          {toasts.map((toast) => (
            <div key={toast.id} className={`toast ${toast.tone}`}>{toast.text}</div>
          ))}
        </div>
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
