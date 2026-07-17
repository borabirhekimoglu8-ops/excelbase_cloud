"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { useStore } from "@/lib/store";

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

export function ManagementTab() {
  const { user, signOut } = useAuth();
  const { summary, notify } = useStore();
  const [storage, setStorage] = useState<StorageState>({ usage: 0, quota: 0, persisted: null });
  const [busy, setBusy] = useState(false);

  const refreshStorage = useCallback(async () => {
    const estimate = await navigator.storage?.estimate?.();
    const persisted = navigator.storage?.persisted ? await navigator.storage.persisted() : null;
    setStorage({ usage: estimate?.usage ?? 0, quota: estimate?.quota ?? 0, persisted });
  }, []);

  useEffect(() => {
    void refreshStorage();
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

  const percent = storage.quota ? Math.min(100, Math.round((storage.usage / storage.quota) * 100)) : 0;

  return (
    <div className="tab-body">
      <div className="section-heading">
        <div>
          <p className="overline">YEREL KASA</p>
          <h2>Cihaz ve güvenlik</h2>
          <p>Yolcu, PDF evrak ve biyometrik fotoğraf verileri bu iPhone&apos;da şifreli tutulur; çalışma sırasında sunucuya gönderilmez.</p>
        </div>
      </div>

      <section className="panel-card">
        <div className="panel-head">
          <div>
            <h3>Çevrimdışı depolama</h3>
            <p>{formatBytes(storage.usage)} kullanılıyor{storage.quota ? ` · ${formatBytes(storage.quota)} ayrılabilir alan` : ""}</p>
          </div>
          <span className={`ic-pill ${storage.persisted ? "ic-pill-ok" : "ic-pill-warn"}`}>
            {storage.persisted ? "KALICI" : "YEDEK GEREKLİ"}
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
            <h3>Yerel erişim</h3>
            <p>{user.name} · Bu kasa yalnız belirlediğiniz erişim koduyla açılır.</p>
          </div>
        </div>
        <button className="soft-btn" onClick={() => void signOut()} type="button">Kasayı kilitle</button>
      </section>

      <div className="notice-card">
        iOS uygulama verisini nadiren temizleyebilir. “Çıktılar ve Yedek” ekranından şifreli yedeği düzenli olarak Dosyalar&apos;a kaydedin. İlk kurulum ve uygulama güncellemeleri internet ister; kurulumdan sonra yolcu işlemleri çevrimdışı yapılır.
      </div>
    </div>
  );
}
