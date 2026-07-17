"use client";

import { ChangeEvent, useState } from "react";
import { clearAll, restoreBackup } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatAmount, useStore } from "@/lib/store";
import { LocalDownloadButton } from "@/components/LocalDownloadButton";

export function PackageTab() {
  const { summary, notify, bump, dateScope } = useStore();
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  const isAdmin = user.role === "admin";

  const checks = [
    { label: "Yolcu listesi", ok: summary.passenger_count > 0 },
    { label: `Fotoğraf (${summary.with_photo}/${summary.passenger_count})`, ok: summary.with_photo === summary.passenger_count },
    { label: `Ücret özeti (${formatAmount(summary.total_fee)})`, ok: summary.total_fee > 0 },
    { label: `Veri hazırlığı (%${summary.readiness_percent})`, ok: summary.readiness_percent >= 90 },
  ];

  async function handleRestore(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      const res = await restoreBackup(file);
      window.alert(res.message);
      window.location.reload();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Geri yükleme başarısız", "error");
    } finally {
      setBusy(false);
      event.target.value = "";
    }
  }

  async function handleClear() {
    if (!window.confirm("Tüm veriler kalıcı olarak silinsin mi?")) return;
    await clearAll();
    notify("Tüm veriler temizlendi", "warn");
    bump();
  }

  return (
    <div className="tab-body">
      <div className="section-heading">
        <div><p className="overline">TESLİM DOSYALARI</p><h2>Seçili tarih çıktıları</h2><p>Aktif tarih filtresine göre hazırlanır.</p></div>
      </div>
      {summary.passenger_count > 0 ? (
        <>
          <div className="readiness-card">
            <p>Paket hazırlığı</p><strong>%{summary.readiness_percent}</strong>
            <div className="progress"><span style={{ width: `${summary.readiness_percent}%` }} /></div>
          </div>
          <div className="check-list">
            {checks.map((item) => (
              <div key={item.label} className={`check-row ${item.ok ? "ok" : "warn"}`}>
                <span>{item.label}</span><span>{item.ok ? "Hazır" : "Kontrol"}</span>
              </div>
            ))}
          </div>
          <LocalDownloadButton className="primary-btn wide" kind="package" scope={dateScope}>Teslim paketini indir</LocalDownloadButton>
          <p className="section-label">Tekil çıktılar</p>
          <div className="action-grid">
            <LocalDownloadButton className="primary-btn" kind="daily-list" scope={dateScope}>İDO günlük liste</LocalDownloadButton>
            <LocalDownloadButton className="soft-btn" kind="manifest" scope={dateScope}>Manifest</LocalDownloadButton>
            <LocalDownloadButton className="soft-btn" kind="excel" scope={dateScope}>Excel</LocalDownloadButton>
            <LocalDownloadButton className="soft-btn" kind="csv" scope={dateScope}>CSV</LocalDownloadButton>
            <LocalDownloadButton className="soft-btn" kind="photos" scope={dateScope}>Fotoğraf ZIP</LocalDownloadButton>
            <LocalDownloadButton className="soft-btn" kind="documents" scope={dateScope}>PDF Evrak ZIP</LocalDownloadButton>
          </div>
        </>
      ) : (
        <div className="empty-card">Seçili tarih aralığında çıktı hazırlanacak yolcu yok. Şifreli bir cihaz yedeğini aşağıdan geri yükleyebilirsiniz.</div>
      )}
      {isAdmin && (
        <section className="panel-card admin-zone">
          <div className="panel-head"><div><h3>Cihaz yedeği</h3><p>Kasa şifreli biçimde Dosyalar uygulamasına kaydedilir.</p></div></div>
          <div className="action-grid">
            <LocalDownloadButton className="soft-btn" kind="backup">Şifreli yedeği kaydet</LocalDownloadButton>
            <label className="soft-btn">{busy ? "İşleniyor…" : "Şifreli yedekten dön"}<input type="file" accept=".excelbase-backup,application/vnd.excelbase.vault+json,application/json" onChange={handleRestore} disabled={busy} /></label>
          </div>
          {summary.passenger_count > 0 && (
            <button className="text-btn danger-text" onClick={() => void handleClear()} type="button">Tüm verileri temizle</button>
          )}
        </section>
      )}
    </div>
  );
}
