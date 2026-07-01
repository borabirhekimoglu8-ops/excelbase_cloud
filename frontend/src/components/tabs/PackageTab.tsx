"use client";

import { ChangeEvent, useState } from "react";
import { clearAll, downloadUrl, restoreBackup } from "@/lib/api";
import { formatAmount, useStore } from "@/lib/store";
import { EmptyState } from "@/components/tabs/shared";

export function PackageTab() {
  const { summary, notify, bump } = useStore();
  const [busy, setBusy] = useState(false);

  if (summary.passenger_count === 0) {
    return (
      <EmptyState
        emoji="📦"
        title="Teslim paketi hazırlanamaz"
        subtitle="Önce yolcu ekleyin, ardından operasyon dosyasını paketleyin."
      />
    );
  }

  const checks = [
    { label: "Yolcu Excel / CSV", ok: true },
    {
      label: `Fotoğraf (${summary.with_photo}/${summary.passenger_count})`,
      ok: summary.with_photo === summary.passenger_count && summary.passenger_count > 0,
    },
    { label: `Ücret özeti (${formatAmount(summary.total_fee)})`, ok: summary.total_fee > 0 },
    { label: `Hazırlık raporu (%${summary.readiness_percent})`, ok: summary.readiness_percent >= 90 },
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
    if (!window.confirm("Tüm veriler silinsin mi? Bu işlem geri alınamaz.")) return;
    await clearAll();
    notify("Tüm veriler temizlendi", "warn");
    bump();
  }

  return (
    <div className="tab-body">
      <div className="readiness-card">
        <p>Teslim paketi hazırlığı</p>
        <strong>%{summary.readiness_percent}</strong>
        <div className="progress">
          <span style={{ width: `${summary.readiness_percent}%` }} />
        </div>
      </div>

      <div className="check-list">
        {checks.map((c) => (
          <div key={c.label} className={`check-row ${c.ok ? "ok" : "warn"}`}>
            <span>{c.label}</span>
            <span>{c.ok ? "✓" : "!"}</span>
          </div>
        ))}
      </div>

      <a className="primary-btn wide" href={downloadUrl("/api/package")}>
        Teslim paketini oluştur (ZIP)
      </a>

      <p className="section-label">Çıktılar</p>
      <div className="action-grid">
        <a className="soft-btn" href={downloadUrl("/api/manifest")} target="_blank" rel="noreferrer">
          Yazdırılabilir manifest
        </a>
        <a className="soft-btn" href={downloadUrl("/api/export?kind=excel")}>
          Tüm Excel
        </a>
        <a className="soft-btn" href={downloadUrl("/api/export?kind=csv")}>
          Tüm CSV
        </a>
        <a className="soft-btn" href={downloadUrl("/api/photos-zip?range=Tümü")}>
          Foto ZIP
        </a>
      </div>

      <p className="section-label">Yedekleme</p>
      <div className="action-grid">
        <a className="soft-btn" href={downloadUrl("/api/backup")}>
          Yedek indir (JSON)
        </a>
        <label className="soft-btn">
          {busy ? "..." : "Yedekten geri yükle"}
          <input type="file" accept="application/json,.json" onChange={handleRestore} disabled={busy} />
        </label>
      </div>

      <button className="soft-btn danger wide" onClick={handleClear}>
        Tüm verileri temizle
      </button>
    </div>
  );
}
