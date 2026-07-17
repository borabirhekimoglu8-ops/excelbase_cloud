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
import { PassengerRecordForm } from "@/components/PassengerRecordForm";
import { RecordsTab } from "@/components/tabs/RecordsTab";

type Screen =
  | { kind: "home" }
  | { kind: "records" }
  | { kind: "passengers"; status: string }
  | { kind: "new-record" }
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
    if (target === "home" || target === "records" || target === "import") {
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
    else if (key === "records") setScreen({ kind: "records" });
    else if (key === "passengers") setScreen({ kind: "passengers", status: "" });
    else if (key === "import") setScreen({ kind: "import" });
    else setScreen({ kind: "settings" });
  }

  const activeNav: NavKey =
    screen.kind === "home"
      ? "home"
      : screen.kind === "records"
        ? "records"
        : screen.kind === "passengers"
          ? "passengers"
          : screen.kind === "import"
            ? "import"
            : "settings";

  return (
    <div className="ido-app">
      <div className="ido-frame">
        {screen.kind === "home" && <AppHeaderHome />}
        {screen.kind === "records" && (
          <AppHeaderScreen
            title="Kayıt Klasörleri"
            onBack={() => navigate("home")}
            action={
              user.role !== "viewer" ? (
                <button className="ido-header-action" onClick={() => setScreen({ kind: "new-record" })} type="button">
                  + YENİ
                </button>
              ) : undefined
            }
          />
        )}
        {screen.kind === "passengers" && (
          <AppHeaderScreen
            title="Yolcular"
            onBack={() => navigate("home")}
            action={
              user.role !== "viewer" ? (
                <button className="ido-header-action" onClick={() => setScreen({ kind: "new-record" })} type="button">
                  + YENİ
                </button>
              ) : undefined
            }
          />
        )}
        {screen.kind === "new-record" && (
          <AppHeaderScreen
            title="Yeni Yolcu Kaydı"
            onBack={() => {
              if (window.confirm("Yeni kayıt ekranından çıkılsın mı? Kaydedilmemiş bilgiler silinir.")) {
                setScreen({ kind: "records" });
              }
            }}
          />
        )}
        {screen.kind === "import" && <AppHeaderScreen title="Toplu Yükleme" onBack={() => navigate("home")} />}
        {screen.kind === "settings" && <AppHeaderScreen title="Ayarlar" onBack={() => navigate("home")} />}
        {screen.kind === "settings-sub" && (
          <AppHeaderScreen title={SETTINGS_TITLES[screen.sub]} onBack={() => setScreen({ kind: "settings" })} />
        )}

        <div className={`ido-content${screen.kind === "import" || screen.kind === "new-record" ? " has-sticky" : ""}`}>
          {screen.kind !== "import" && screen.kind !== "new-record" && (
            <div style={{ marginBottom: -2 }}>
              <DateScopeBar fixedField={screen.kind === "records" ? "created" : undefined} />
            </div>
          )}
          {screen.kind === "home" && <HomeTab onNavigate={navigate} />}
          {screen.kind === "records" && (
            <RecordsTab
              canCreate={user.role !== "viewer"}
              onCreate={() => setScreen({ kind: "new-record" })}
            />
          )}
          {screen.kind === "passengers" && <PassengersTab initialStatus={screen.status} />}
          {screen.kind === "new-record" && (
            <PassengerRecordForm
              onCancel={() => setScreen({ kind: "records" })}
              onSaved={() => setScreen({ kind: "passengers", status: "" })}
            />
          )}
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

        {screen.kind !== "new-record" && <BottomNav active={activeNav} onSelect={onNavSelect} />}

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
