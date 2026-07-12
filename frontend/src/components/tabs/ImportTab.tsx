"use client";

import { ChangeEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  Passenger,
  UnmatchedPhoto,
  assignUnmatchedPhoto,
  deleteUnmatchedPhoto,
  downloadUrl,
  fetchPassengers,
  fetchUnmatchedPhotos,
  importMail,
  matchPhotos,
  previewPassengerFile,
  undoImport,
  uploadPassengerFile,
} from "@/lib/api";
import { useStore } from "@/lib/store";
import { loadQueueFiles, persistQueueFile, removeQueueFile } from "@/lib/uploadQueue";

type QueueStatus = "checking" | "ready" | "uploading" | "success" | "error";
type QueueItem = {
  id: string;
  file: File;
  status: QueueStatus;
  rows: number;
  duplicates: number;
  invalid: number;
  message: string;
};

export function ImportTab() {
  const { summary, notify, bump, version } = useStore();
  const [replace, setReplace] = useState(false);
  const [dupStrategy, setDupStrategy] = useState("skip");
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [unmatched, setUnmatched] = useState<UnmatchedPhoto[]>([]);
  const [passengers, setPassengers] = useState<Passenger[]>([]);
  const [assignments, setAssignments] = useState<Record<string, string>>({});

  const refreshUnmatched = useCallback(async () => {
    const [photos, rows] = await Promise.all([fetchUnmatchedPhotos(), fetchPassengers({ sort: "name" })]);
    setUnmatched(photos);
    setPassengers(rows);
  }, []);

  async function checkItem(item: QueueItem) {
    try {
      const preview = await previewPassengerFile(item.file);
      setQueue((current) =>
        current.map((row) =>
          row.id === item.id
            ? {
                ...row,
                status: "ready",
                rows: preview.rows,
                duplicates: preview.duplicate_count,
                invalid: preview.invalid_count,
                message: preview.warnings.join(" "),
              }
            : row,
        ),
      );
    } catch (err) {
      setQueue((current) =>
        current.map((row) =>
          row.id === item.id
            ? { ...row, status: "error", message: err instanceof Error ? err.message : "Dosya okunamadı" }
            : row,
        ),
      );
    }
  }

  useEffect(() => {
    void loadQueueFiles().then((stored) => {
      const restored = stored.map<QueueItem>((item) => ({
        id: item.id,
        file: item.file,
        status: "checking",
        rows: 0,
        duplicates: 0,
        invalid: 0,
        message: "Kaldığı yerden devam etmek için kontrol ediliyor.",
      }));
      if (restored.length) {
        setQueue(restored);
        restored.forEach((item) => void checkItem(item));
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void refreshUnmatched();
  }, [refreshUnmatched, version]);

  const readyCount = queue.filter((item) => item.status === "ready" || item.status === "error").length;
  const successCount = queue.filter((item) => item.status === "success").length;
  const progress = queue.length ? Math.round(((readyCount + successCount) / queue.length) * 100) : 0;
  const canStart = queue.some((item) => item.status === "ready") && !busy;

  async function handleExcel(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!files.length) return;
    const items = files.map<QueueItem>((file) => ({
      id: crypto.randomUUID(),
      file,
      status: "checking",
      rows: 0,
      duplicates: 0,
      invalid: 0,
      message: "Ön kontrol yapılıyor…",
    }));
    setQueue((current) => [...current.filter((row) => row.status !== "success"), ...items]);
    for (const item of items) {
      await persistQueueFile({ id: item.id, file: item.file, createdAt: Date.now() });
      await checkItem(item);
    }
  }

  async function startImport() {
    const pending = queue.filter((item) => item.status === "ready");
    if (!pending.length) return;
    setBusy(true);
    const batchId = crypto.randomUUID();
    let imported = 0;
    let failed = 0;
    let shouldReplace = replace;
    for (const item of pending) {
      setQueue((current) => current.map((row) => (row.id === item.id ? { ...row, status: "uploading" } : row)));
      try {
        const result = await uploadPassengerFile(item.file, shouldReplace, dupStrategy, batchId);
        shouldReplace = false;
        imported += result.imported;
        setQueue((current) =>
          current.map((row) =>
            row.id === item.id
              ? { ...row, status: "success", message: `${result.imported} yolcu aktarıldı.` }
              : row,
          ),
        );
        await removeQueueFile(item.id);
      } catch (err) {
        failed += 1;
        setQueue((current) =>
          current.map((row) =>
            row.id === item.id
              ? { ...row, status: "error", message: err instanceof Error ? err.message : "Aktarım başarısız" }
              : row,
          ),
        );
      }
    }
    setLog([`${pending.length - failed}/${pending.length} dosya işlendi.`, `${imported} yolcu aktarıldı.`]);
    notify(failed ? `${failed} dosya yeniden denenmeli` : `${imported} yolcu aktarıldı`, failed ? "warn" : "ok");
    setBusy(false);
    bump();
  }

  async function handlePhotos(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!files.length) return;
    setBusy(true);
    try {
      const result = await matchPhotos(files);
      const notes = [`${result.matched} fotoğraf eşleşti.`];
      for (const match of result.matches.slice(0, 12)) {
        notes.push(`${match.filename} / ${match.passenger_name} · %${match.confidence}`);
      }
      if (result.unmatched.length) notes.push(`${result.unmatched.length} fotoğraf eşleşme kutusuna alındı.`);
      setLog(notes);
      notify(`${result.matched} fotoğraf eşleşti`);
      bump();
      await refreshUnmatched();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Fotoğraf yükleme başarısız", "error");
    } finally {
      setBusy(false);
    }
  }

  async function handleMail(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!files.length) return;
    setBusy(true);
    const batchId = crypto.randomUUID();
    const notes: string[] = [];
    for (const file of files) {
      try {
        const result = await importMail(file, batchId);
        notes.push(`${result.subject || file.name}: ${result.imported_rows} yolcu, ${result.matched_photos} fotoğraf.`);
      } catch (err) {
        notes.push(`${file.name}: ${err instanceof Error ? err.message : "işlenemedi"}`);
      }
    }
    setLog(notes);
    setBusy(false);
    bump();
  }

  async function handleUndo() {
    if (!window.confirm("Son toplu liste aktarımı geri alınsın mı?")) return;
    const result = await undoImport(summary.last_batch_id);
    notify(result.message, "warn");
    setQueue([]);
    bump();
  }

  async function handleAssign(item: UnmatchedPhoto) {
    const selected = Number(assignments[item.id]);
    if (!Number.isInteger(selected)) return;
    await assignUnmatchedPhoto(item.id, selected);
    notify("Fotoğraf yolcuya atandı");
    bump();
    await refreshUnmatched();
  }

  async function retryItem(item: QueueItem) {
    setQueue((current) => current.map((row) => row.id === item.id ? { ...row, status: "checking", message: "Yeniden kontrol ediliyor…" } : row));
    await checkItem(item);
  }

  async function discardItem(item: QueueItem) {
    await removeQueueFile(item.id);
    setQueue((current) => current.filter((row) => row.id !== item.id));
  }

  const statusLabels = useMemo<Record<QueueStatus, string>>(
    () => ({ checking: "Kontrol", ready: "Hazır", uploading: "Aktarılıyor", success: "Tamamlandı", error: "Hata" }),
    [],
  );

  return (
    <div className="tab-body">
      <div className="section-heading">
        <div>
          <p className="overline">VERİ AKTARIMI</p>
          <h2>Toplu liste merkezi</h2>
          <p>Dosya adedi sınırı olmadan, kontrollü ve sıralı aktarım.</p>
        </div>
        {summary.can_undo && (
          <button className="text-btn danger-text" onClick={() => void handleUndo()} type="button">
            Son aktarımı geri al
          </button>
        )}
      </div>

      <section className="panel-card upload-panel">
        <div className="panel-head">
          <div>
            <span className="step-index">01</span>
            <h3>Yolcu listelerini seçin</h3>
            <p>Excel, CSV ve ODS dosyaları. Seçim adedi sınırsızdır.</p>
          </div>
          <label className="primary-btn compact-btn">
            Dosya seç
            <input type="file" accept=".xlsx,.xls,.xlsm,.ods,.csv" multiple onChange={handleExcel} />
          </label>
        </div>

        {queue.length > 0 && (
          <>
            <div className="queue-summary">
              <span>{queue.length} dosya</span>
              <span>{queue.reduce((sum, item) => sum + item.rows, 0)} satır</span>
              <span>%{progress} kontrol edildi</span>
            </div>
            <div className="queue-list">
              {queue.map((item) => (
                <div className={`queue-row status-${item.status}`} key={item.id}>
                  <div>
                    <strong>{item.file.name}</strong>
                    <small>
                      {item.rows} satır · {item.duplicates} tekrar · {item.invalid} kritik kontrol
                    </small>
                    {item.message && <small className="queue-message">{item.message}</small>}
                  </div>
                  <div className="queue-actions">
                    <span className="status-label">{statusLabels[item.status]}</span>
                    {item.status === "error" && <button className="text-btn" onClick={() => void retryItem(item)}>Yeniden dene</button>}
                    {item.status !== "uploading" && <button className="text-btn danger-text" onClick={() => void discardItem(item)}>Kaldır</button>}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        <div className="import-options">
          <label className="switch-row">
            <input type="checkbox" checked={replace} onChange={(event) => setReplace(event.target.checked)} />
            <span>Mevcut listeyi ilk dosyayla değiştir</span>
          </label>
          {!replace && (
            <label className="field">
              <span>Aynı pasaport + gidiş tarihi</span>
              <select value={dupStrategy} onChange={(event) => setDupStrategy(event.target.value)}>
                <option value="skip">Mevcut kaydı koru</option>
                <option value="overwrite">Yeni kayıtla güncelle</option>
                <option value="add">İkisini de ekle</option>
              </select>
            </label>
          )}
        </div>
        <button className="primary-btn wide" disabled={!canStart} onClick={() => void startImport()} type="button">
          {busy ? "İşlem sürüyor…" : "Kontrol edilen dosyaları aktar"}
        </button>
      </section>

      <section className="panel-card">
        <div className="panel-head">
          <div>
            <span className="step-index">02</span>
            <h3>Fotoğrafları eşleştirin</h3>
            <p>Dosya adı, pasaport ve ad-soyad üzerinden güven puanlı eşleştirme.</p>
          </div>
          <label className={`secondary-btn compact-btn ${summary.passenger_count === 0 ? "disabled" : ""}`}>
            Fotoğraf / ZIP seç
            <input type="file" accept="image/*,.zip,.heic,.heif" multiple onChange={handlePhotos} disabled={summary.passenger_count === 0 || busy} />
          </label>
        </div>
      </section>

      <section className="panel-card">
        <div className="panel-head">
          <div>
            <span className="step-index">03</span>
            <h3>E-posta dosyalarını işleyin</h3>
            <p>.eml içindeki Excel, fotoğraf ve PDF ekleri ayrıştırılır.</p>
          </div>
          <label className="secondary-btn compact-btn">
            E-posta seç
            <input type="file" accept="message/rfc822,.eml" multiple onChange={handleMail} disabled={busy} />
          </label>
        </div>
      </section>

      {unmatched.length > 0 && (
        <section className="panel-card">
          <div className="panel-head">
            <div>
              <h3>Eşleşme bekleyen fotoğraflar</h3>
              <p>{unmatched.length} fotoğraf manuel kontrol bekliyor.</p>
            </div>
          </div>
          <div className="unmatched-grid">
            {unmatched.map((item) => (
              <article className="unmatched-card" key={item.id}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={item.photo_url} alt={item.filename} />
                <strong>{item.filename}</strong>
                <select value={assignments[item.id] ?? ""} onChange={(event) => setAssignments((current) => ({ ...current, [item.id]: event.target.value }))}>
                  <option value="">Yolcu seçin</option>
                  {passengers.map((passenger) => (
                    <option key={passenger.id} value={passenger.id}>{passenger.full_name} · {passenger.passport_no}</option>
                  ))}
                </select>
                <div className="inline-actions">
                  <button className="primary-btn" disabled={!assignments[item.id]} onClick={() => void handleAssign(item)}>Ata</button>
                  <button className="text-btn danger-text" onClick={async () => { await deleteUnmatchedPhoto(item.id); await refreshUnmatched(); }}>Kaldır</button>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      <div className="utility-row">
        <a className="text-link" href={downloadUrl("/api/template")}>Standart şablonu indir</a>
      </div>

      {log.length > 0 && (
        <div className="activity-log">{log.map((line, index) => <p key={index}>{line}</p>)}</div>
      )}
    </div>
  );
}
