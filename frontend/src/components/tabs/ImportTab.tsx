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
  undoImport,
  uploadPassengerFile,
} from "@/lib/api";
import { newId } from "@/lib/id";
import { useStore } from "@/lib/store";
import { materializeUploadFile, purgeLegacyUploadQueue } from "@/lib/uploadQueue";

type QueueStatus = "ready" | "uploading" | "success" | "error";
type QueueItem = {
  id: string;
  file: File;
  status: QueueStatus;
  rows: number;
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

  useEffect(() => {
    purgeLegacyUploadQueue();
  }, []);

  useEffect(() => {
    void refreshUnmatched();
  }, [refreshUnmatched, version]);

  const processedCount = queue.filter((item) => item.status === "success" || item.status === "error").length;
  const progress = queue.length ? Math.round((processedCount / queue.length) * 100) : 0;
  const importedRows = queue.reduce((sum, item) => sum + item.rows, 0);
  const failedItems = queue.filter((item) => item.status === "error");

  async function startImport(items: QueueItem[]) {
    if (busy || !items.length) return;
    setBusy(true);
    const batchId = newId();
    let imported = 0;
    let failed = 0;
    let shouldReplace = replace;
    const serverWarnings: string[] = [];
    try {
      for (const item of items) {
        setQueue((current) =>
          current.map((row) =>
            row.id === item.id ? { ...row, status: "uploading", message: "Sunucuya gönderiliyor…" } : row,
          ),
        );
        try {
          const result = await uploadPassengerFile(item.file, shouldReplace, dupStrategy, batchId);
          shouldReplace = false;
          imported += result.imported;
          serverWarnings.push(...result.warnings);
          const detail = [
            `${result.imported} yolcu aktarıldı`,
            result.duplicate_count ? `${result.duplicate_count} tekrar` : "",
            result.invalid_count ? `${result.invalid_count} kritik kontrol` : "",
          ]
            .filter(Boolean)
            .join(" · ");
          setQueue((current) =>
            current.map((row) =>
              row.id === item.id
                ? { ...row, status: "success", rows: result.imported, message: `${detail}.` }
                : row,
            ),
          );
          bump();
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
      setLog([
        `${items.length - failed}/${items.length} dosya işlendi, ${imported} yolcu aktarıldı.`,
        ...serverWarnings.slice(0, 8),
      ]);
      notify(failed ? `${failed} dosya aktarılamadı` : `${imported} yolcu aktarıldı`, failed ? "warn" : "ok");
      bump();
    } finally {
      setBusy(false);
    }
  }

  async function handleExcel(event: ChangeEvent<HTMLInputElement>) {
    const input = event.target;
    const sourceFiles = Array.from(input.files ?? []);
    if (!sourceFiles.length) {
      input.value = "";
      return;
    }
    const items: QueueItem[] = [];
    const unreadable: string[] = [];
    for (const source of sourceFiles) {
      try {
        // Baytlar input temizlenmeden ÖNCE kopyalanmalı (iOS Safari).
        const file = await materializeUploadFile(source);
        items.push({ id: newId(), file, status: "ready", rows: 0, message: "Sırada." });
      } catch (error) {
        unreadable.push(error instanceof Error ? error.message : `${source.name}: dosya okunamadı.`);
      }
    }
    input.value = "";
    if (unreadable.length) {
      setLog(unreadable);
      notify(`${unreadable.length} dosya okunamadı; yeniden seçin.`, "warn");
    }
    if (!items.length) return;
    setQueue((current) => [...current.filter((row) => row.status !== "success"), ...items]);
    await startImport(items);
  }

  async function retryFailed() {
    const retryItems = failedItems.map<QueueItem>((row) => ({ ...row, status: "ready", message: "Yeniden sırada." }));
    setQueue((current) => current.map((row) => retryItems.find((item) => item.id === row.id) ?? row));
    await startImport(retryItems);
  }

  function discardItem(item: QueueItem) {
    setQueue((current) => current.filter((row) => row.id !== item.id));
  }

  function discardAllQueue() {
    setQueue([]);
    setLog([]);
  }

  async function handlePhotos(event: ChangeEvent<HTMLInputElement>) {
    const sourceFiles = Array.from(event.target.files ?? []);
    if (!sourceFiles.length) {
      event.target.value = "";
      return;
    }
    setBusy(true);
    try {
      const files: File[] = [];
      for (const source of sourceFiles) files.push(await materializeUploadFile(source));
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
      event.target.value = "";
      setBusy(false);
    }
  }

  async function handleMail(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    if (!files.length) {
      event.target.value = "";
      return;
    }
    setBusy(true);
    const batchId = newId();
    const notes: string[] = [];
    for (const source of files) {
      try {
        const file = await materializeUploadFile(source);
        const result = await importMail(file, batchId);
        notes.push(`${result.subject || file.name}: ${result.imported_rows} yolcu, ${result.matched_photos} fotoğraf.`);
      } catch (err) {
        notes.push(`${source.name}: ${err instanceof Error ? err.message : "işlenemedi"}`);
      }
    }
    event.target.value = "";
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

  const statusLabels = useMemo<Record<QueueStatus, string>>(
    () => ({ ready: "Sırada", uploading: "Gönderiliyor", success: "Tamamlandı", error: "Hata" }),
    [],
  );

  return (
    <div className="tab-body">
      <div className="section-heading">
        <div>
          <p className="overline">VERİ AKTARIMI</p>
          <h2>Toplu liste merkezi</h2>
          <p>Dosyayı seçin, gerisi otomatik: her dosya sırayla aktarılır ve sonucu satırında görünür.</p>
        </div>
        {summary.can_undo && (
          <button className="text-btn danger-text" onClick={() => void handleUndo()} type="button">
            Son aktarımı geri al
          </button>
        )}
      </div>

      {summary.persistence === "local-fallback" && (
        <div className="banner warn">
          <strong>Veritabanı bağlantısı yok.</strong> Aktarılan veriler geçici bellekte tutuluyor ve uygulama
          yeniden başladığında silinebilir. Sorun sürerse sunucu loglarını ve <code>DATABASE_URL</code> ayarını
          kontrol edin.
        </div>
      )}

      <section className="panel-card upload-panel">
        <div className="panel-head">
          <div>
            <span className="step-index">01</span>
            <h3>Yolcu listelerini seçin</h3>
            <p>Excel, CSV ve ODS dosyaları. Seçim adedi sınırsızdır.</p>
          </div>
          <label className="primary-btn compact-btn">
            {busy ? "Aktarılıyor…" : "Dosya seç"}
            <input type="file" accept=".xlsx,.xls,.xlsm,.ods,.csv" multiple onChange={handleExcel} disabled={busy} />
          </label>
        </div>

        {queue.length > 0 && (
          <>
            <div className="queue-summary">
              <span>{queue.length} dosya</span>
              <span>{importedRows} yolcu aktarıldı</span>
              <span>%{progress} tamamlandı</span>
              <button className="text-btn danger-text" disabled={busy} onClick={discardAllQueue} type="button">
                Listeyi temizle
              </button>
            </div>
            <div className="queue-list">
              {queue.map((item) => (
                <div className={`queue-row status-${item.status}`} key={item.id}>
                  <div>
                    <strong>{item.file.name}</strong>
                    {item.message && <small className="queue-message">{item.message}</small>}
                  </div>
                  <div className="queue-actions">
                    <span className="status-label">{statusLabels[item.status]}</span>
                    {item.status !== "uploading" && (
                      <button className="text-btn danger-text" disabled={busy} onClick={() => discardItem(item)}>
                        Kaldır
                      </button>
                    )}
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
        {busy && (
          <button className="primary-btn wide" disabled type="button">
            Dosyalar sırayla aktarılıyor… %{progress}
          </button>
        )}
        {!busy && failedItems.length > 0 && (
          <button className="primary-btn wide" onClick={() => void retryFailed()} type="button">
            Hatalı {failedItems.length} dosyayı yeniden dene
          </button>
        )}
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
