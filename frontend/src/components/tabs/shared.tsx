"use client";

import { ChangeEvent, useState } from "react";
import { downloadUrl, loadDemo, uploadPassengerFiles } from "@/lib/api";
import { useStore } from "@/lib/store";

export function EmptyState({
  onNavigate,
  emoji = "🛂",
  title = "Henüz operasyon yok",
  subtitle = "Excel yükleyerek başlayın, şablon indirin veya demo veriyle deneyin.",
}: {
  onNavigate?: (tab: string) => void;
  emoji?: string;
  title?: string;
  subtitle?: string;
}) {
  const { notify, bump } = useStore();
  const [busy, setBusy] = useState(false);

  async function handleUpload(event: ChangeEvent<HTMLInputElement>) {
    if (!event.target.files?.length) return;
    setBusy(true);
    try {
      const res = await uploadPassengerFiles(event.target.files, true);
      notify(`${res.imported} yolcu içe aktarıldı`);
      bump();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Import başarısız", "error");
    } finally {
      setBusy(false);
      event.target.value = "";
    }
  }

  return (
    <div className="tab-body">
      <div className="empty-hero">
        <p className="big">{emoji}</p>
        <h3>{title}</h3>
        <p className="muted">{subtitle}</p>
      </div>
      <div className="action-grid">
        <label className="primary-btn as-label">
          {busy ? "Yükleniyor..." : "Excel yükle"}
          <input type="file" accept=".xlsx,.xls,.xlsm,.ods,.csv" multiple onChange={handleUpload} />
        </label>
        <button
          className="soft-btn"
          onClick={async () => {
            setBusy(true);
            try {
              await loadDemo();
              notify("Demo veri yüklendi");
              bump();
            } finally {
              setBusy(false);
            }
          }}
        >
          Demo veri yükle
        </button>
        <a className="soft-btn" href={downloadUrl("/api/template")}>
          Şablon indir
        </a>
        {onNavigate && (
          <button className="soft-btn" onClick={() => onNavigate("import")}>
            Import sekmesi
          </button>
        )}
      </div>
    </div>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { key: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="segmented" role="tablist">
      {options.map((opt) => (
        <button
          key={opt.key}
          className={opt.key === value ? "seg active" : "seg"}
          onClick={() => onChange(opt.key)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
