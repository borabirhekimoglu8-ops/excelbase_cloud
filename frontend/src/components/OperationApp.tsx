"use client";

import { useState } from "react";
import { AuthGate, useAuth } from "@/lib/auth";
import { StoreProvider, useStore } from "@/lib/store";
import { AppHeaderHome, AppHeaderScreen } from "@/components/ido/AppHeader";
import { BottomNav, NavKey, PrimaryNavKey } from "@/components/ido/BottomNav";
import { QuickCreateSheet } from "@/components/QuickCreateSheet";
import { AssistantWorkspace } from "@/components/assistant/AssistantWorkspace";
import {
  AssistantConversationState,
  emptyAssistantConversation,
} from "@/lib/assistant/conversation";
import { HomeTab } from "@/components/tabs/HomeTab";
import { WorkFilesTab } from "@/components/tabs/WorkFilesTab";
import { DocumentsTab } from "@/components/tabs/DocumentsTab";
import { ReportsTab, ReportDestination } from "@/components/tabs/ReportsTab";
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
import { WorkFileForm } from "@/components/WorkFileForm";
import { WorkFileDetail } from "@/components/WorkFileDetail";

type RootScreen = {
  kind: "root";
  tab: PrimaryNavKey;
  passengerStatus?: string;
  openDocumentUpload?: boolean;
};

type Screen =
  | RootScreen
  | { kind: "work-file"; id: string }
  | { kind: "new-work-file" }
  | { kind: "new-passenger" }
  | { kind: "import" }
  | { kind: "records" }
  | { kind: "assistant" }
  | { kind: "settings" }
  | { kind: "settings-sub"; sub: SettingsSub };

const ROOT_TITLES: Record<Exclude<PrimaryNavKey, "home">, string> = {
  "work-files": "İş Dosyaları",
  passengers: "Gate Visa · Yolcular",
  documents: "Evrak Merkezi",
  reports: "Raporlar",
};

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
  const [screen, setScreen] = useState<Screen>({ kind: "root", tab: "home" });
  const [quickCreateOpen, setQuickCreateOpen] = useState(false);
  const [assistantReturnScreen, setAssistantReturnScreen] = useState<Screen>({ kind: "root", tab: "home" });
  const [assistantConversation, setAssistantConversation] = useState<AssistantConversationState>(
    () => emptyAssistantConversation(),
  );

  function goRoot(tab: PrimaryNavKey, extras: Partial<RootScreen> = {}) {
    setScreen({ kind: "root", tab, ...extras });
  }

  function openAssistant() {
    if (screen.kind !== "assistant") setAssistantReturnScreen(screen);
    setScreen({ kind: "assistant" });
  }

  function navigate(target: string) {
    if (target === "passengers-fotosuz") {
      goRoot("passengers", { passengerStatus: "Fotosuz" });
      return;
    }
    if (target === "passengers-eksik") {
      goRoot("passengers", { passengerStatus: "Eksik" });
      return;
    }
    if (target === "home" || target === "work-files" || target === "passengers" || target === "documents" || target === "reports") {
      goRoot(target);
      return;
    }
    if (target === "records") {
      setScreen({ kind: "records" });
      return;
    }
    if (target === "import") {
      setScreen({ kind: "import" });
      return;
    }
    goRoot("home");
  }

  function onNavSelect(key: NavKey) {
    if (key === "home" || key === "work-files" || key === "passengers" || key === "documents" || key === "reports") {
      goRoot(key);
      return;
    }
    if (key === "records") setScreen({ kind: "records" });
    else if (key === "import") setScreen({ kind: "import" });
    else setScreen({ kind: "settings" });
  }

  function openReport(destination: ReportDestination) {
    if (destination === "records") {
      setScreen({ kind: "records" });
      return;
    }
    setScreen({ kind: "settings-sub", sub: destination });
  }

  const bottomNavActive: PrimaryNavKey | null = screen.kind === "root"
    ? screen.tab
    : screen.kind === "import"
      ? "passengers"
      : screen.kind === "records"
        ? "reports"
        : null;
  const showDateScope = (
    (screen.kind === "root" && (screen.tab === "passengers" || screen.tab === "reports"))
    || screen.kind === "records"
  );
  const stickyContent = screen.kind === "import" || screen.kind === "new-passenger" || screen.kind === "new-work-file";

  return (
    <div className="ido-app">
      <div className={`ido-frame${screen.kind === "assistant" ? " assistant-mode" : ""}`}>
        {screen.kind === "root" && screen.tab === "home" && (
          <AppHeaderHome
            onAssistant={openAssistant}
            onSettings={() => setScreen({ kind: "settings" })}
          />
        )}
        {screen.kind === "root" && screen.tab !== "home" && (
          <AppHeaderScreen
            title={ROOT_TITLES[screen.tab]}
            brand={screen.tab === "passengers" ? "ido" : "operations"}
            onAssistant={openAssistant}
            onSettings={() => setScreen({ kind: "settings" })}
          />
        )}
        {screen.kind === "work-file" && (
          <AppHeaderScreen title="İş Dosyası" brand="operations" onBack={() => goRoot("work-files")} />
        )}
        {screen.kind === "new-work-file" && (
          <AppHeaderScreen title="Yeni İş Dosyası" brand="operations" onBack={() => goRoot("work-files")} />
        )}
        {screen.kind === "records" && (
          <AppHeaderScreen
            title="Kayıt Klasörleri"
            brand="ido"
            onBack={() => goRoot("reports")}
            action={
              user.role !== "viewer" ? (
                <button className="ido-header-action" onClick={() => setScreen({ kind: "new-passenger" })} type="button">
                  + YENİ
                </button>
              ) : undefined
            }
          />
        )}
        {screen.kind === "new-passenger" && (
          <AppHeaderScreen
            title="Yeni Yolcu Kaydı"
            brand="ido"
            onBack={() => {
              if (window.confirm("Yeni kayıt ekranından çıkılsın mı? Kaydedilmemiş bilgiler silinir.")) {
                goRoot("passengers");
              }
            }}
          />
        )}
        {screen.kind === "import" && (
          <AppHeaderScreen title="Toplu Yolcu Yükleme" brand="ido" onBack={() => goRoot("passengers")} />
        )}
        {screen.kind === "assistant" && (
          <AppHeaderScreen
            title="Claude Sonnet"
            brand="operations"
            onBack={() => setScreen(
              assistantReturnScreen.kind === "assistant"
                ? { kind: "root", tab: "home" }
                : assistantReturnScreen,
            )}
          />
        )}
        {screen.kind === "settings" && (
          <AppHeaderScreen title="Ayarlar" brand="operations" onBack={() => goRoot("home")} />
        )}
        {screen.kind === "settings-sub" && (
          <AppHeaderScreen
            title={SETTINGS_TITLES[screen.sub]}
            brand={screen.sub === "management" ? "operations" : "ido"}
            onBack={() => setScreen({ kind: "settings" })}
          />
        )}

        <div
          className={`ido-content${stickyContent ? " has-sticky" : ""}${screen.kind === "assistant" ? " assistant-content" : ""}`}
        >
          {showDateScope && (
            <div style={{ marginBottom: -2 }}>
              <DateScopeBar fixedField={screen.kind === "records" ? "created" : undefined} />
            </div>
          )}

          {screen.kind === "root" && screen.tab === "home" && (
            <HomeTab
              onNavigate={navigate}
              onOpenWorkFile={(id) => setScreen({ kind: "work-file", id })}
              onAssistant={openAssistant}
            />
          )}
          {screen.kind === "root" && screen.tab === "work-files" && (
            <WorkFilesTab
              onCreate={() => setScreen({ kind: "new-work-file" })}
              onOpen={(id) => setScreen({ kind: "work-file", id })}
            />
          )}
          {screen.kind === "root" && screen.tab === "passengers" && (
            <PassengersTab initialStatus={screen.passengerStatus ?? ""} />
          )}
          {screen.kind === "root" && screen.tab === "documents" && (
            <DocumentsTab
              autoOpenUpload={Boolean(screen.openDocumentUpload)}
              onOpenGallery={() => setScreen({ kind: "settings-sub", sub: "gallery" })}
            />
          )}
          {screen.kind === "root" && screen.tab === "reports" && <ReportsTab onOpen={openReport} />}
          {screen.kind === "work-file" && <WorkFileDetail id={screen.id} onBack={() => goRoot("work-files")} />}
          {screen.kind === "new-work-file" && (
            <WorkFileForm
              onCancel={() => goRoot("work-files")}
              onSaved={(id) => setScreen({ kind: "work-file", id })}
            />
          )}
          {screen.kind === "records" && (
            <RecordsTab canCreate={user.role !== "viewer"} onCreate={() => setScreen({ kind: "new-passenger" })} />
          )}
          {screen.kind === "new-passenger" && (
            <PassengerRecordForm
              onCancel={() => goRoot("passengers")}
              onSaved={() => goRoot("passengers")}
            />
          )}
          {screen.kind === "import" && <ImportTab onNavigate={navigate} />}
          {screen.kind === "assistant" && (
            <AssistantWorkspace
              conversation={assistantConversation}
              setConversation={setAssistantConversation}
            />
          )}
          {screen.kind === "settings" && (
            <SettingsTab onOpen={(sub) => setScreen({ kind: "settings-sub", sub })} />
          )}
          {screen.kind === "settings-sub" && screen.sub === "issues" && <IssuesTab />}
          {screen.kind === "settings-sub" && screen.sub === "gallery" && <GalleryTab />}
          {screen.kind === "settings-sub" && screen.sub === "archive" && <ArchiveTab />}
          {screen.kind === "settings-sub" && screen.sub === "package" && <PackageTab />}
          {screen.kind === "settings-sub" && screen.sub === "management" && <ManagementTab />}
        </div>

        {bottomNavActive && (
          <BottomNav
            active={bottomNavActive}
            onSelect={onNavSelect}
            onQuickCreate={screen.kind === "root" && user.role !== "viewer" ? () => setQuickCreateOpen(true) : undefined}
          />
        )}

        <QuickCreateSheet
          open={quickCreateOpen}
          onClose={() => setQuickCreateOpen(false)}
          onNewWorkFile={() => setScreen({ kind: "new-work-file" })}
          onNewPassenger={() => setScreen({ kind: "new-passenger" })}
          onUploadDocument={() => goRoot("documents", { openDocumentUpload: true })}
          onBulkImport={() => setScreen({ kind: "import" })}
        />

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
