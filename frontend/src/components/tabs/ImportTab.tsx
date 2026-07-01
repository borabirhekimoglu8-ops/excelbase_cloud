"use client";

import { ChangeEvent, useState } from "react";
import { downloadUrl, matchPhotos, uploadPassengerFiles } from "@/lib/api";
import { useStore } from "@/lib/store";

export function ImportTab() {
  const { summary, notify, bump } = useStore();
  const [replace, setReplace] = useState(false);
  const [dupStrategy, setDupStrategy] = useState("add");
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);

  async function handleExcel(event: ChangeEvent<HTMLInputElement>) {
    if (!event.target.files?.length) return;
    setBusy(true);
    try {
      const res = await uploadPassengerFiles(event.target.files, replace, dupStrategy);
      setLog([`✓ ${res.imported} yolcu içe aktarıldı (toplam ${res.passenger_count}).`, ...res.warnings]);
      notify(`${res.imported} yolcu içe aktarıldı`);
      bump();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Import başarısız", "error");
    } finally {
      setBusy(false);
      event.target.value = "";
    }
  }

  async function handlePhotos(event: ChangeEvent<HTMLInputElement>) {
    if (!event.target.files?.length) return;
    setBusy(true);
    try {
      const res = await matchPhotos(event.target.files);
      const notes = [`✓ ${res.matched} foto eşleşti · toplam ${res.with_photo} fotolu yolcu.`];
      if (res.unmatched.length) {
        notes.push(`✕ ${res.unmatched.length} dosya eşleşmedi: ${res.unmatched.slice(0, 6).join(", ")}`);
      }
      setLog(notes);
      notify(`${res.matched} foto eşleşti`);
      bump();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Foto yükleme başarısız", "error");
    } finally {
      setBusy(false);
      event.target.value = "";
    }
  }

  return (
    <div className="tab-body">
      <div className="upload-card">
        <div>
          <p className="eyebrow">Adım 1</p>
          <h2>Excel / CSV yükle</h2>
          <p className="muted">GATE VISA PAX LIST formatı otomatik ayrıştırılır.</p>
        </div>
        <label className="upload-button">
          {busy ? "..." : "Dosya seç"}
          <input type="file" accept=".xlsx,.xls,.xlsm,.ods,.csv" multiple onChange={handleExcel} />
        </label>
      </div>

      <div className="option-row">
        <label className="switch">
          <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} />
          <span>Mevcut listeyi değiştir (baştan)</span>
        </label>
        {!replace && (
          <label className="field">
            <span>Tekrar eden pasaport</span>
            <select value={dupStrategy} onChange={(e) => setDupStrategy(e.target.value)}>
              <option value="add">Hepsini ekle</option>
              <option value="skip">Atla</option>
              <option value="overwrite">Üzerine yaz</option>
            </select>
          </label>
        )}
      </div>

      <div className="upload-card">
        <div>
          <p className="eyebrow">Adım 2</p>
          <h2>Fotoğraf / ZIP yükle</h2>
          <p className="muted">
            {summary.passenger_count === 0
              ? "Önce yolcu ekleyin, sonra foto yükleyin."
              : "Dosya adındaki pasaport/ad-soyad ile otomatik eşleşir."}
          </p>
        </div>
        <label className={`upload-button ${summary.passenger_count === 0 ? "disabled" : ""}`}>
          {busy ? "..." : "Foto seç"}
          <input
            type="file"
            accept="image/*,.zip"
            multiple
            disabled={summary.passenger_count === 0}
            onChange={handlePhotos}
          />
        </label>
      </div>

      <div className="action-grid">
        <a className="soft-btn" href={downloadUrl("/api/template")}>
          Şablon indir
        </a>
      </div>

      {log.length > 0 && (
        <div className="log-box">
          {log.map((line, i) => (
            <p key={i}>{line}</p>
          ))}
        </div>
      )}

      {summary.import_history.length > 0 && (
        <>
          <p className="section-label">Import geçmişi</p>
          <div className="timeline">
            {summary.import_history.map((item, i) => (
              <div key={i} className="timeline-item">
                <strong>{item.time}</strong> · {item.files} · {item.rows} yolcu · {item.mode}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
