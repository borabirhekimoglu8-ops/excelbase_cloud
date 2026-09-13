"use client";

import { useEffect, useState } from "react";
import { AuthGate, useAuth } from "@/lib/auth";
import { StoreProvider, useStore } from "@/lib/store";
import { AppHeaderHome, AppHeaderScreen } from "@/components/ido/AppHeader";
import { BottomNav, NavKey, PrimaryNavKey, isPrimaryNavKey } from "@/components/ido/BottomNav";
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
import { PassengerRosterTab } from "@/components/tabs/PassengerRosterTab";
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
import { GateVisaTab } from "@/components/tabs/GateVisaTab";
import { SalesTab } from "@/components/tabs/SalesTab";
import { WorkFileForm } from "@/components/WorkFileForm";
import { WorkFileDetail } from "@/components/WorkFileDetail";
import {
  LAYOUT_PREFERENCE_KEY,
  LayoutPreference,
  parseLayoutPreference,
} from "@/lib/layoutPreference";
import { useEdgeSwipeBack } from "@/hooks/useEdgeSwipeBack";
import { useKeyboardInset } from "@/hooks/useKeyboardInset";

type RootScreen = {
  kind: "root";
  tab: PrimaryNavKey;
  /** Deep-links into the Kapı tab's embedded Yolcular subview. */
  gateView?: "folders" | "list" | "stats";
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
  | { kind: "sales" }
  | { kind: "reports" }
  | { kind: "assistant" }
  | { kind: "settings" }
  | { kind: "settings-sub"; sub: SettingsSub };

const ROOT_TITLES: Record<Exclude<PrimaryNavKey, "home">, string> = {
  "gate-visa": "Kapı Vizesi",
  "work-files": "İş Dosyaları",
  passengers: "Yolcu Listelerim",
  documents: "Evrak Merkezi",
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
  const [layoutPreference, setLayoutPreference] = useState<LayoutPreference>("auto");
  const [wideLayout, setWideLayout] = useState(false);

  useEffect(() => {
    try {
      setLayoutPreference(parseLayoutPreference(window.localStorage.getItem(LAYOUT_PREFERENCE_KEY)));
    } catch {
      setLayoutPreference("auto");
    }
    const media = window.matchMedia("(min-width: 761px)");
    const apply = () => setWideLayout(media.matches);
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, []);

  // The window is the scroll container, so a screen opened from the bottom of
  // a long page would otherwise appear already scrolled past its own header.
  const screenKey = [
    screen.kind,
    "tab" in screen ? screen.tab : "",
    "sub" in screen ? screen.sub : "",
    "id" in screen ? screen.id : "",
  ].join(":");
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }, [screenKey]);

  function updateLayoutPreference(nextPreference: LayoutPreference) {
    setLayoutPreference(nextPreference);
    try {
      window.localStorage.setItem(LAYOUT_PREFERENCE_KEY, nextPreference);
    } catch {
      // Özel tarama localStorage erişimini engellese de görünüm bu oturumda çalışır.
    }
  }

  function goRoot(tab: PrimaryNavKey, extras: Partial<RootScreen> = {}) {
    setScreen({ kind: "root", tab, ...extras });
  }

  function openAssistant() {
    if (screen.kind !== "assistant") setAssistantReturnScreen(screen);
    setScreen({ kind: "assistant" });
  }

  function navigate(target: string) {
    // "Fotosuz" and "Eksik" name a Gate Visa passenger's document status, which
    // only exists for the kapı vizeli çalışma listesi -- the Yolcular tab is
    // now the master roster and has no such status to filter on.
    if (target === "passengers-fotosuz") {
      goRoot("gate-visa", { gateView: "list", passengerStatus: "Fotosuz" });
      return;
    }
    if (target === "passengers-eksik") {
      goRoot("gate-visa", { gateView: "list", passengerStatus: "Eksik" });
      return;
    }
    if (target === "gate-visa-list") {
      goRoot("gate-visa", { gateView: "list" });
      return;
    }
    if (isPrimaryNavKey(target)) {
      goRoot(target);
      return;
    }
    if (target === "records" || target === "import" || target === "sales" || target === "reports") {
      setScreen({ kind: target });
      return;
    }
    if (target === "issues" || target === "gallery" || target === "archive" || target === "package" || target === "management") {
      setScreen({ kind: "settings-sub", sub: target });
      return;
    }
    if (target === "assistant") {
      openAssistant();
      return;
    }
    goRoot("home");
  }

  function onNavSelect(key: NavKey) {
    if (isPrimaryNavKey(key)) {
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

  // Import and the record folders are Kapı work, so the Kapı tab stays lit
  // underneath them. Sales and reports open from the home screen with a back
  // button and no tab bar, like settings.
  const bottomNavActive: PrimaryNavKey | null = screen.kind === "root"
    ? screen.tab
    : screen.kind === "import" || screen.kind === "records"
      ? "gate-visa"
      : null;
  const showDateScope = (
    (screen.kind === "root" && screen.tab === "gate-visa")
    || screen.kind === "records"
    || screen.kind === "reports"
  );
  const stickyContent = screen.kind === "import" || screen.kind === "new-passenger" || screen.kind === "new-work-file";
  const canGoBack = screen.kind !== "root" || screen.tab !== "home";
  const goBack = () => {
    if (screen.kind === "root") {
      goRoot("home");
      return;
    }
    if (screen.kind === "work-file" || screen.kind === "new-work-file") {
      goRoot("work-files");
      return;
    }
    if (screen.kind === "settings-sub") {
      setScreen({ kind: "settings" });
      return;
    }
    if (screen.kind === "assistant") {
      setScreen(assistantReturnScreen.kind === "assistant" ? { kind: "root", tab: "home" } : assistantReturnScreen);
      return;
    }
    if (screen.kind === "import" || screen.kind === "new-passenger" || screen.kind === "records") {
      goRoot("gate-visa", { gateView: screen.kind === "records" ? "folders" : "list" });
      return;
    }
    goRoot("home");
  };
  useKeyboardInset();
  useEdgeSwipeBack(canGoBack, goBack);
  const desktopSplit = (
    wideLayout
    && layoutPreference !== "mobile"
    && (screen.kind === "work-file" || (screen.kind === "root" && screen.tab === "work-files"))
  );

  return (
    <div className={`ido-app layout-${layoutPreference}`}>
      <div className={`ido-frame${screen.kind === "assistant" ? " assistant-mode" : ""}${bottomNavActive ? " has-primary-nav" : ""}`}>
        {screen.kind === "root" && screen.tab === "home" && (
          <AppHeaderHome
            onAssistant={openAssistant}
            onSettings={() => setScreen({ kind: "settings" })}
          />
        )}
        {screen.kind === "root" && screen.tab !== "home" && (
          <AppHeaderScreen
            title={ROOT_TITLES[screen.tab]}
            onAssistant={openAssistant}
            onSettings={() => setScreen({ kind: "settings" })}
          />
        )}
        {screen.kind === "work-file" && (
          <AppHeaderScreen title="İş Dosyası" onBack={() => goRoot("work-files")} />
        )}
        {screen.kind === "new-work-file" && (
          <AppHeaderScreen title="Yeni İş Dosyası" onBack={() => goRoot("work-files")} />
        )}
        {screen.kind === "sales" && (
          <AppHeaderScreen title="Satış Verileri" onBack={() => goRoot("home")} />
        )}
        {screen.kind === "reports" && (
          <AppHeaderScreen title="Raporlar" onBack={() => goRoot("home")} />
        )}
        {screen.kind === "records" && (
          <AppHeaderScreen
            title="Kayıt Klasörleri"
            onBack={() => goRoot("gate-visa")}
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
            onBack={() => {
              if (window.confirm("Yeni kayıt ekranından çıkılsın mı? Kaydedilmemiş bilgiler silinir.")) {
                goRoot("gate-visa", { gateView: "list" });
              }
            }}
          />
        )}
        {screen.kind === "import" && (
          <AppHeaderScreen
            title="Toplu Yolcu Yükleme"
            onBack={() => goRoot("gate-visa", { gateView: "list" })}
          />
        )}
        {screen.kind === "assistant" && (
          <AppHeaderScreen
            title="Asistan"
            onBack={() => setScreen(
              assistantReturnScreen.kind === "assistant"
                ? { kind: "root", tab: "home" }
                : assistantReturnScreen,
            )}
          />
        )}
        {screen.kind === "settings" && (
          <AppHeaderScreen title="Ayarlar" onBack={() => goRoot("home")} />
        )}
        {screen.kind === "settings-sub" && (
          <AppHeaderScreen
            title={SETTINGS_TITLES[screen.sub]}
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
            />
          )}
          {screen.kind === "root" && screen.tab === "work-files" && !desktopSplit && (
            <WorkFilesTab
              onCreate={() => setScreen({ kind: "new-work-file" })}
              onOpen={(id) => setScreen({ kind: "work-file", id })}
            />
          )}
          {desktopSplit && (
            <div className="ops-split">
              <WorkFilesTab
                onCreate={() => setScreen({ kind: "new-work-file" })}
                onOpen={(id) => setScreen({ kind: "work-file", id })}
              />
              {screen.kind === "work-file" ? (
                <WorkFileDetail id={screen.id} onBack={() => goRoot("work-files")} />
              ) : (
                <div className="xb-empty">
                  <strong>Bir iş dosyası seçin</strong>
                  <p>Soldaki listeden bir kayda dokunun; evrak, görev ve yolcular burada açılır.</p>
                </div>
              )}
            </div>
          )}
          {screen.kind === "root" && screen.tab === "passengers" && <PassengerRosterTab />}
          {screen.kind === "root" && screen.tab === "documents" && (
            <DocumentsTab
              autoOpenUpload={Boolean(screen.openDocumentUpload)}
              onOpenGallery={() => setScreen({ kind: "settings-sub", sub: "gallery" })}
            />
          )}
          {screen.kind === "root" && screen.tab === "gate-visa" && (
            <GateVisaTab
              canCreate={user.role !== "viewer"}
              onImport={() => setScreen({ kind: "import" })}
              onCreate={() => setScreen({ kind: "new-passenger" })}
              initialView={screen.gateView ?? "folders"}
              initialStatus={screen.passengerStatus ?? ""}
            />
          )}
          {screen.kind === "sales" && <SalesTab />}
          {screen.kind === "reports" && <ReportsTab onOpen={openReport} />}
          {screen.kind === "work-file" && !desktopSplit && <WorkFileDetail id={screen.id} onBack={() => goRoot("work-files")} />}
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
              onCancel={() => goRoot("gate-visa", { gateView: "list" })}
              onSaved={() => goRoot("gate-visa", { gateView: "list" })}
            />
          )}
          {screen.kind === "import" && <ImportTab onNavigate={navigate} />}
          {screen.kind === "assistant" && (
            <AssistantWorkspace
              conversation={assistantConversation}
              setConversation={setAssistantConversation}
              onNavigate={navigate}
            />
          )}
          {screen.kind === "settings" && (
            <SettingsTab
              layoutPreference={layoutPreference}
              onLayoutPreferenceChange={updateLayoutPreference}
              onOpen={(sub) => setScreen({ kind: "settings-sub", sub })}
            />
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
