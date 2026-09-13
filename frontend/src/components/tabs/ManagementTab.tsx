"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  attachRecoveryKey,
  fetchAudit,
  lastBackupAt,
  recoveryHint,
} from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useStore } from "@/lib/store";
import { LocalDownloadButton } from "@/components/LocalDownloadButton";
import {
  createSyncToken,
  formatSyncToken,
  pullVaultBlob,
  pushVaultBlob,
  VAULT_SYNC_TOKEN_META,
} from "@/lib/offline/vaultSync";
import { getMeta, setMeta } from "@/lib/offline/vault";
import { localExportEncryptedBackup, localRestoreEncryptedBackup } from "@/lib/offline/localApi";
import type { AuditEntry } from "@/lib/api";

type StorageState = {
  usage: number;
  quota: number;
  persisted: boolean | null;
};

function formatBytes(value: number): string {
  if (!value) return "0 MB";
  const mb = value / (1024 * 1024);
  if (mb < 1024) return `${mb.toLocaleString("tr-TR", { maximumFractionDigits: 1 })} MB`;
  return `${(mb / 1024).toLocaleString("tr-TR", { maximumFractionDigits: 2 })} GB`;
}

function formatWhen(iso: string | null): string {
  if (!iso) return "Henüz alınmadı";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Henüz alınmadı";
  return date.toLocaleString("tr-TR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function ManagementTab() {
  const { user, signOut } = useAuth();
  const { summary, notify } = useStore();
  const [storage, setStorage] = useState<StorageState>({ usage: 0, quota: 0, persisted: null });
  const [busy, setBusy] = useState(false);
  const [backupAt, setBackupAt] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [freshRecovery, setFreshRecovery] = useState<string | null>(null);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [syncToken, setSyncToken] = useState("");
  const [syncBusy, setSyncBusy] = useState(false);

  const refreshStorage = useCallback(async () => {
    const estimate = await navigator.storage?.estimate?.();
    const persisted = navigator.storage?.persisted ? await navigator.storage.persisted() : null;
    setStorage({ usage: estimate?.usage ?? 0, quota: estimate?.quota ?? 0, persisted });
  }, []);

  useEffect(() => {
    void refreshStorage();
    void lastBackupAt().then(setBackupAt);
    void recoveryHint().then(setHint);
    void fetchAudit().then(setAudit).catch(() => setAudit([]));
    void getMeta<string>(VAULT_SYNC_TOKEN_META).then((value) => {
      if (value) setSyncToken(formatSyncToken(value));
    });
  }, [refreshStorage, summary.passenger_count]);

  async function requestPersistence() {
    if (!navigator.storage?.persist) {
      notify("Bu iOS sürümü kalıcı depolama isteğini desteklemiyor.", "warn");
      return;
    }
    setBusy(true);
    try {
      const granted = await navigator.storage.persist();
      notify(
        granted
          ? "Cihaz kalıcı depolama izni verdi."
          : "iOS kalıcı depolamayı garanti etmedi; düzenli yedek alın.",
        granted ? "ok" : "warn",
      );
      await refreshStorage();
    } finally {
      setBusy(false);
    }
  }

  async function issueRecovery() {
    setBusy(true);
    try {
      const key = await attachRecoveryKey();
      setFreshRecovery(key);
      setHint(key.slice(-4));
      notify("Yeni kurtarma kodu üretildi. Ekrandaki kodu yazın.", "ok");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Kurtarma kodu üretilemedi.", "error");
    } finally {
      setBusy(false);
    }
  }

  async function ensureToken(): Promise<string> {
    if (syncToken) return syncToken;
    const next = createSyncToken();
    await setMeta(VAULT_SYNC_TOKEN_META, next);
    setSyncToken(next);
    return next;
  }

  async function pushSync() {
    setSyncBusy(true);
    try {
      const token = await ensureToken();
      await pushVaultBlob(token, await localExportEncryptedBackup());
      notify("Şifreli kasa sunucuya kopyalandı. Diğer cihaz aynı kodla alabilir.", "ok");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Gönderilemedi.", "error");
    } finally {
      setSyncBusy(false);
    }
  }

  async function pullSync(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const token = String(form.get("token") ?? syncToken);
    setSyncBusy(true);
    try {
      const blob = await pullVaultBlob(token);
      const file = new File([blob], "excelbase.excelbase-backup", { type: blob.type });
      await localRestoreEncryptedBackup(file);
      notify("Yedek alındı. Kasayı yeniden açın.", "ok");
      await signOut();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Yedek alınamadı.", "error");
    } finally {
      setSyncBusy(false);
    }
  }

  const percent = storage.quota ? Math.min(100, Math.round((storage.usage / storage.quota) * 100)) : 0;

  return (
    <div className="tab-body">
      <div className="section-heading">
        <div>
          <p className="overline">Yerel kasa</p>
          <h2>Cihaz ve güvenlik</h2>
          <p>Yolcu, PDF evrak ve biyometrik fotoğraf verileri bu iPhone&apos;da şifreli tutulur; çalışma sırasında sunucuya gönderilmez.</p>
        </div>
      </div>

      <section className="panel-card">
        <div className="panel-head">
          <div>
            <h3>Şifreli yedek</h3>
            <p>Son yedek: {formatWhen(backupAt)}. Paylaş veya Dosyalar&apos;a kaydet.</p>
          </div>
          <span className={`ic-pill ${backupAt ? "ic-pill-ok" : "ic-pill-warn"}`}>
            {backupAt ? "Alındı" : "Gerekli"}
          </span>
        </div>
        <LocalDownloadButton kind="backup">Şifreli yedek al</LocalDownloadButton>
      </section>

      <section className="panel-card">
        <div className="panel-head">
          <div>
            <h3>Kurtarma kodu</h3>
            <p>
              {hint
                ? `Kayıtlı kod …${hint} ile biter. Kodu kaybettiyseniz yenisini üretin; eskisi geçersiz olur.`
                : "Bu kasa için henüz kurtarma kodu yok."}
            </p>
          </div>
        </div>
        {freshRecovery && <p className="xb-recovery-key">{freshRecovery}</p>}
        <button className="soft-btn" disabled={busy} onClick={() => void issueRecovery()} type="button">
          {hint ? "Yeni kurtarma kodu üret" : "Kurtarma kodu üret"}
        </button>
      </section>

      <section className="panel-card">
        <div className="panel-head">
          <div>
            <h3>Cihazlar arası kopya</h3>
            <p>Sunucu yalnız şifreli paketi tutar. Aynı eşleme kodunu ikinci telefona yazın.</p>
          </div>
        </div>
        {syncToken && <p className="xb-recovery-key">{syncToken}</p>}
        <button className="soft-btn" disabled={syncBusy} onClick={() => void pushSync()} type="button">
          {syncBusy ? "Gönderiliyor…" : "Bu cihazı sunucuya kopyala"}
        </button>
        <form className="auth-form" onSubmit={pullSync} style={{ marginTop: 10 }}>
          <label className="field">
            <span>Eşleme kodu</span>
            <input name="token" defaultValue={syncToken} autoComplete="off" spellCheck={false} />
          </label>
          <button className="soft-btn" disabled={syncBusy} type="submit">Diğer cihazdan al</button>
        </form>
      </section>

      <section className="panel-card">
        <div className="panel-head">
          <div>
            <h3>Çevrimdışı depolama</h3>
            <p>{formatBytes(storage.usage)} kullanılıyor{storage.quota ? ` · ${formatBytes(storage.quota)} ayrılabilir alan` : ""}</p>
          </div>
          <span className={`ic-pill ${storage.persisted ? "ic-pill-ok" : "ic-pill-warn"}`}>
            {storage.persisted ? "Kalıcı" : "Yedek gerekli"}
          </span>
        </div>
        <div className="progress"><span style={{ width: `${percent}%` }} /></div>
        <button className="soft-btn" disabled={busy || storage.persisted === true} onClick={() => void requestPersistence()} type="button">
          {busy ? "Kontrol ediliyor…" : storage.persisted ? "Kalıcı depolama açık" : "Kalıcı depolama iste"}
        </button>
      </section>

      <section className="panel-card">
        <div className="panel-head">
          <div>
            <h3>Son işlemler</h3>
            <p>Fotoğraf, PDF ve içe aktarma kayıtları bu cihazda tutulur.</p>
          </div>
        </div>
        <div className="xb-queue">
          {audit.slice(0, 8).map((entry) => (
            <div key={entry.id} className="xb-queue-item">
              <span>
                <strong>{entry.action === "photo_attach" ? "Fotoğraf" : entry.action === "pdf_attach" ? "PDF evrak" : entry.action}</strong>
                <small>{entry.path} · {formatWhen(entry.time)}</small>
              </span>
            </div>
          ))}
          {!audit.length && <p className="ic-row-meta">Henüz kayıtlı işlem yok.</p>}
        </div>
      </section>

      <section className="panel-card">
        <div className="panel-head">
          <div>
            <h3>Yerel erişim</h3>
            <p>{user.name} · Bu kasa yalnız belirlediğiniz erişim kodu veya kurtarma koduyla açılır.</p>
          </div>
        </div>
        <button className="soft-btn" onClick={() => void signOut()} type="button">Kasayı kilitle</button>
      </section>
    </div>
  );
}
