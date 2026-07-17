"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styles from "./PwaBootstrap.module.css";

const SHELL_VERSION = "2026.07.17.2";
const INSTALL_HINT_KEY = "excelbase:pwa-install-hint:2026-07";

type WorkerState = "checking" | "ready" | "unsupported" | "error";
type StorageState = "checking" | "persistent" | "standard" | "unsupported";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

interface NavigatorWithStandalone extends Navigator {
  standalone?: boolean;
}

function isIosDevice() {
  const ua = window.navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && window.navigator.maxTouchPoints > 1);
}

function isStandaloneMode() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    Boolean((window.navigator as NavigatorWithStandalone).standalone)
  );
}

function formatStorage(bytes?: number) {
  if (!bytes || bytes < 1) return "—";
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  return `${Math.max(1, Math.round(bytes / 1024 ** 2))} MB`;
}

function installHintWasDismissed() {
  try {
    return window.localStorage.getItem(INSTALL_HINT_KEY) !== null;
  } catch {
    return false;
  }
}

function rememberInstallHintDismissal() {
  try {
    window.localStorage.setItem(INSTALL_HINT_KEY, "dismissed");
  } catch {
    // Private browsing may make localStorage unavailable; dismissal still works for this page.
  }
}

export function PwaBootstrap() {
  const [online, setOnline] = useState(true);
  const [workerState, setWorkerState] = useState<WorkerState>("checking");
  const [storageState, setStorageState] = useState<StorageState>("checking");
  const [storageUsage, setStorageUsage] = useState<number>();
  const [storageQuota, setStorageQuota] = useState<number>();
  const [storageMessage, setStorageMessage] = useState("");
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [standalone, setStandalone] = useState(false);
  const [ios, setIos] = useState(false);
  const [introVisible, setIntroVisible] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const reloadingRef = useRef(false);
  const updateRequestedRef = useRef(false);

  const refreshStorageState = useCallback(async () => {
    if (!navigator.storage) {
      setStorageState("unsupported");
      return;
    }

    try {
      const [persistent, estimate] = await Promise.all([
        navigator.storage.persisted?.() ?? Promise.resolve(false),
        navigator.storage.estimate?.() ?? Promise.resolve({}),
      ]);
      setStorageState(persistent ? "persistent" : "standard");
      setStorageUsage(estimate.usage);
      setStorageQuota(estimate.quota);
    } catch {
      setStorageState("unsupported");
    }
  }, []);

  useEffect(() => {
    setOnline(window.navigator.onLine);
    setStandalone(isStandaloneMode());
    setIos(isIosDevice());
    void refreshStorageState();

    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    const handleInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    const handleInstalled = () => {
      setStandalone(true);
      setInstallPrompt(null);
      setIntroVisible(false);
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    window.addEventListener("beforeinstallprompt", handleInstallPrompt);
    window.addEventListener("appinstalled", handleInstalled);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("beforeinstallprompt", handleInstallPrompt);
      window.removeEventListener("appinstalled", handleInstalled);
    };
  }, [refreshStorageState]);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) {
      setWorkerState("unsupported");
      return;
    }

    let cancelled = false;
    const handleControllerChange = () => {
      if (!updateRequestedRef.current || reloadingRef.current) return;
      reloadingRef.current = true;
      window.location.reload();
    };

    navigator.serviceWorker.addEventListener("controllerchange", handleControllerChange);

    void (async () => {
      try {
        const registration = await navigator.serviceWorker.register(`/sw.js?v=${SHELL_VERSION}`, {
          scope: "/",
          updateViaCache: "none",
        });
        if (cancelled) return;

        const markWaiting = (worker: ServiceWorker | null) => {
          if (worker && navigator.serviceWorker.controller) setWaitingWorker(worker);
        };

        markWaiting(registration.waiting);
        registration.addEventListener("updatefound", () => {
          const worker = registration.installing;
          if (!worker) return;
          worker.addEventListener("statechange", () => {
            if (worker.state === "installed") {
              if (navigator.serviceWorker.controller) setWaitingWorker(worker);
              else setWorkerState("ready");
            }
          });
        });

        await navigator.serviceWorker.ready;
        if (!cancelled) setWorkerState("ready");
      } catch {
        if (!cancelled) setWorkerState("error");
      }
    })();

    return () => {
      cancelled = true;
      navigator.serviceWorker.removeEventListener("controllerchange", handleControllerChange);
    };
  }, []);

  useEffect(() => {
    if (standalone || (!ios && !installPrompt)) return;
    if (installHintWasDismissed()) return;

    const timer = window.setTimeout(() => setIntroVisible(true), 900);
    return () => window.clearTimeout(timer);
  }, [installPrompt, ios, standalone]);

  useEffect(() => {
    if (!sheetOpen) return;
    const previousOverflow = document.body.style.overflow;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSheetOpen(false);
    };
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
      previousFocus?.focus();
    };
  }, [sheetOpen]);

  const dismissIntro = useCallback(() => {
    rememberInstallHintDismissal();
    setIntroVisible(false);
  }, []);

  const showInstallation = useCallback(() => {
    setSheetOpen(true);
    dismissIntro();
  }, [dismissIntro]);

  const installApplication = useCallback(async () => {
    if (!installPrompt) {
      setSheetOpen(true);
      return;
    }

    try {
      await installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      if (choice.outcome === "accepted") {
        setStandalone(true);
        setSheetOpen(false);
      }
    } catch {
      setSheetOpen(true);
    }
    setInstallPrompt(null);
    dismissIntro();
  }, [dismissIntro, installPrompt]);

  const requestPersistentStorage = useCallback(async () => {
    if (!navigator.storage?.persist) {
      setStorageState("unsupported");
      setStorageMessage("Bu tarayıcı kalıcı saklama isteğini desteklemiyor. Düzenli yedek alın.");
      return;
    }

    try {
      const granted = await navigator.storage.persist();
      setStorageState(granted ? "persistent" : "standard");
      setStorageMessage(
        granted
          ? "Kalıcı saklama izni verildi. Yine de düzenli cihaz yedeği alın."
          : "Tarayıcı kalıcı saklama izni vermedi. Verileri düzenli dışa aktarıp yedekleyin.",
      );
      await refreshStorageState();
    } catch {
      setStorageMessage("Saklama izni alınamadı. Verileri düzenli dışa aktarıp yedekleyin.");
    }
  }, [refreshStorageState]);

  const applyUpdate = useCallback(() => {
    updateRequestedRef.current = true;
    waitingWorker?.postMessage({ type: "SKIP_WAITING" });
  }, [waitingWorker]);

  const workerLabel = useMemo(() => {
    if (workerState === "ready") return "Hazır";
    if (workerState === "checking") return "Hazırlanıyor";
    if (workerState === "unsupported") return "Desteklenmiyor";
    return "Kontrol gerekli";
  }, [workerState]);

  const storageLabel = useMemo(() => {
    if (storageState === "persistent") return "Kalıcı";
    if (storageState === "standard") return "Standart";
    if (storageState === "checking") return "Kontrol ediliyor";
    return "Bilinmiyor";
  }, [storageState]);

  const installCopy = ios
    ? "Safari üzerinden Ana Ekran’a ekleyin; Gate Visa Checklist tam ekran ve çevrimdışı açılır."
    : "Gate Visa Checklist’i bu cihaza kurarak tam ekran ve çevrimdışı kullanın.";

  return (
    <>
      <div className={styles.liveRegion} aria-live="polite">
        {waitingWorker ? (
          <div className={styles.banner} role="status">
            <div className={styles.bannerMark} aria-hidden="true">↻</div>
            <div className={styles.bannerCopy}>
              <strong>Güncelleme hazır</strong>
              <span>Devam eden dosya işlemi yoksa güvenle uygulayın.</span>
            </div>
            <div className={styles.bannerActions}>
              <button className={styles.bannerAction} type="button" onClick={applyUpdate}>Güncelle</button>
              <button
                className={styles.bannerDismiss}
                type="button"
                aria-label="Güncelleme bildirimini kapat"
                onClick={() => setWaitingWorker(null)}
              >×</button>
            </div>
          </div>
        ) : introVisible ? (
          <div className={styles.banner} role="status">
            <div className={styles.bannerMark} aria-hidden="true">+</div>
            <div className={styles.bannerCopy}>
              <strong>Cihaza kurun</strong>
              <span>{installCopy}</span>
            </div>
            <div className={styles.bannerActions}>
              <button
                className={styles.bannerAction}
                type="button"
                onClick={installPrompt ? installApplication : showInstallation}
              >Kurulum</button>
              <button
                className={styles.bannerDismiss}
                type="button"
                aria-label="Kurulum bildirimini kapat"
                onClick={dismissIntro}
              >×</button>
            </div>
          </div>
        ) : !online ? (
          <button className={styles.offlineButton} type="button" onClick={() => setSheetOpen(true)}>
            <span className={styles.offlineDot} aria-hidden="true" />
            Çevrimdışı · cihazdaki veriler
          </button>
        ) : null}
      </div>

      {sheetOpen ? (
        <div
          className={styles.overlay}
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setSheetOpen(false);
          }}
        >
          <section className={styles.sheet} role="dialog" aria-modal="true" aria-labelledby="pwa-sheet-title">
            <header className={styles.sheetHeader}>
              <div>
                <p>Cihaz kullanımı</p>
                <h2 id="pwa-sheet-title">Çevrimdışı Gate Visa Checklist</h2>
              </div>
              <button
                ref={closeButtonRef}
                className={styles.closeButton}
                type="button"
                aria-label="Pencereyi kapat"
                onClick={() => setSheetOpen(false)}
              >×</button>
            </header>

            <div className={styles.sheetBody}>
              <div className={styles.statusGrid} aria-label="Uygulama durumu">
                <div className={styles.statusItem}>
                  <span>Bağlantı</span>
                  <strong>{online ? "Çevrimiçi" : "Çevrimdışı"}</strong>
                </div>
                <div className={styles.statusItem}>
                  <span>Uygulama kabuğu</span>
                  <strong>{workerLabel}</strong>
                </div>
                <div className={styles.statusItem}>
                  <span>Yerel saklama</span>
                  <strong>{storageLabel}</strong>
                </div>
              </div>

              <div className={styles.section}>
                <p className={styles.sectionLabel}>{standalone ? "Uygulama kuruldu" : "Ana ekrana ekleyin"}</p>
                {standalone ? (
                  <p className={styles.explanation}>Gate Visa Checklist bu cihazda bağımsız uygulama olarak çalışıyor.</p>
                ) : ios ? (
                  <>
                    <p className={styles.explanation}>İlk kurulum için sayfayı Safari’de açın ve şu adımları izleyin:</p>
                    <ol className={styles.steps}>
                      <li>Safari’de Paylaş düğmesine dokunun.</li>
                      <li>“Ana Ekrana Ekle” seçeneğini açın.</li>
                      <li>Sağ üstteki “Ekle” düğmesine dokunun.</li>
                    </ol>
                  </>
                ) : installPrompt ? (
                  <button className={styles.primaryAction} type="button" onClick={installApplication}>
                    Bu cihaza kur
                  </button>
                ) : (
                  <p className={styles.explanation}>Tarayıcı menüsünden “Uygulamayı yükle” veya “Ana ekrana ekle” seçeneğini kullanın.</p>
                )}
              </div>

              <div className={styles.section}>
                <p className={styles.sectionLabel}>Cihaz saklama alanı</p>
                <p className={styles.explanation}>
                  Kullanım: {formatStorage(storageUsage)} · Kullanılabilir kota: {formatStorage(storageQuota)}
                </p>
                {storageState === "standard" ? (
                  <button className={styles.secondaryAction} type="button" onClick={requestPersistentStorage}>
                    Kalıcı saklama izni iste
                  </button>
                ) : null}
                {storageMessage ? <p className={styles.storageMessage}>{storageMessage}</p> : null}
              </div>

              <p className={styles.limitNote}>
                İlk kurulum ve uygulama güncellemeleri internet ister. Sonrasında cihazdaki verilere çevrimdışı
                erişebilirsiniz. iPhone başka bir uygulamaya geçildiğinde çalışan işlemi duraklatabilir; aktif dosya
                tamamlanana kadar Gate Visa Checklist’i ekranda tutun. Tamamlanan dosyalar cihazda kalır.
              </p>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
