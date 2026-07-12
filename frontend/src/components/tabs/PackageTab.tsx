"use client";

import { ChangeEvent, useState } from "react";
import { clearAll, downloadUrl, restoreBackup, scopedPath } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatAmount, useStore } from "@/lib/store";
import { EmptyState } from "@/components/tabs/shared";

export function PackageTab() {
  const { summary, notify, bump, dateScope } = useStore();
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  const isAdmin = user.role === "admin";

  if (summary.passenger_count === 0) {
    return <EmptyState title="Teslim dosyası hazır değil" subtitle="Seçili tarih aralığında paketlenecek yolcu bulunmuyor." />;
  }

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
      notify(res.message);
      bump();
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
      <a className="primary-btn wide" href={downloadUrl(scopedPath("/api/package", dateScope))}>Teslim paketini indir</a>
      <p className="section-label">Tekil çıktılar</p>
      <div className="action-grid">
        <a className="soft-btn" href={downloadUrl(scopedPath("/api/manifest", dateScope))} target="_blank" rel="noreferrer">Manifest</a>
        <a className="soft-btn" href={downloadUrl(scopedPath("/api/export?kind=excel", dateScope))}>Excel</a>
        <a className="soft-btn" href={downloadUrl(scopedPath("/api/export?kind=csv", dateScope))}>CSV</a>
        <a className="soft-btn" href={downloadUrl(scopedPath("/api/photos-zip", dateScope))}>Fotoğraf ZIP</a>
      </div>
      {isAdmin && (
        <section className="panel-card admin-zone">
          <div className="panel-head"><div><h3>Yönetici araçları</h3><p>Yedek alma ve geri yükleme işlemleri.</p></div></div>
          <div className="action-grid">
            <a className="soft-btn" href={downloadUrl("/api/backup")}>JSON yedeği indir</a>
            <label className="soft-btn">{busy ? "İşleniyor…" : "Yedekten geri yükle"}<input type="file" accept="application/json,.json" onChange={handleRestore} disabled={busy} /></label>
          </div>
          <button className="text-btn danger-text" onClick={() => void handleClear()} type="button">Tüm verileri temizle</button>
        </section>
      )}
    </div>
  );
}
