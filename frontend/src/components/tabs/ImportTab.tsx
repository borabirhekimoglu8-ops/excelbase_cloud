"use client";

import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ImportJob,
  Passenger,
  UnmatchedPhoto,
  assignUnmatchedPhoto,
  deleteImportJob,
  deleteUnmatchedPhoto,
  downloadUrl,
  fetchImportQueue,
  fetchPassengers,
  fetchUnmatchedPhotos,
  importMail,
  matchPhotos,
  queueImportFiles,
  retryImportJob,
  undoImport,
} from "@/lib/api";
import { newId } from "@/lib/id";
import { useStore } from "@/lib/store";
import { materializeUploadFile, purgeLegacyUploadQueue } from "@/lib/uploadQueue";

const STATUS_LABELS: Record<ImportJob["status"], string> = {
  pending: "Sırada",
  processing: "İşleniyor",
  done: "Tamamlandı",
  error: "Hata",
};

export function ImportTab() {
  const { summary, notify, bump, version } = useStore();
  const [replace, setReplace] = useState(false);
  const [dupStrategy, setDupStrategy] = useState("skip");
  const [jobs, setJobs] = useState<ImportJob[]>([]);
  const [queueActive, setQueueActive] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [unmatched, setUnmatched] = useState<UnmatchedPhoto[]>([]);
  const [passengers, setPassengers] = useState<Passenger[]>([]);
  const [assignments, setAssignments] = useState<Record<string, string>>({});
  const doneCountRef = useRef(-1);

  const refreshUnmatched = useCallback(async () => {
    const [photos, rows] = await Promise.all([fetchUnmatchedPhotos(), fetchPassengers({ sort: "name" })]);
    setUnmatched(photos);
    setPassengers(rows);
  }, []);

  const refreshQueue = useCallback(async () => {
    try {
      const state = await fetchImportQueue();
      setJobs(state.jobs);
      setQueueActive(state.active);
      const doneCount = state.jobs.filter((job) => job.status === "done" || job.status === "error").length;
      if (doneCountRef.current !== -1 && doneCount !== doneCountRef.current) {
        bump();
      }
      doneCountRef.current = doneCount;
    } catch {
      // Bağlantı yoksa mevcut görünüm korunur; sonraki turda yeniden denenir.
    }
  }, [bump]);

  useEffect(() => {
    purgeLegacyUploadQueue();
    void refreshQueue();
    const onVisible = () => {
      if (document.visibilityState === "visible") void refreshQueue();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!queueActive) return;
    const timer = window.setInterval(() => void refreshQueue(), 2500);
    return () => window.clearInterval(timer);
  }, [queueActive, refreshQueue]);

  useEffect(() => {
    void refreshUnmatched();
  }, [refreshUnmatched, version]);

  const processedCount = jobs.filter((job) => job.status === "done" || job.status === "error").length;
  const progress = jobs.length ? Math.round((processedCount / jobs.length) * 100) : 0;
  const importedRows = jobs.reduce((sum, job) => sum + job.imported, 0);
  const failedJobs = jobs.filter((job) => job.status === "error");
  const finishedJobs = jobs.filter((job) => job.status === "done" || job.status === "error");

  async function handleExcel(event: ChangeEvent<HTMLInputElement>) {
    const input = event.target;
    const sourceFiles = Array.from(input.files ?? []);
    if (!sourceFiles.length) {
      input.value = "";
      return;
    }
    setUploading(true);
    try {
      const files: File[] = [];
      const unreadable: string[] = [];
      for (const source of sourceFiles) {
        try {
          // Baytlar input temizlenmeden ÖNCE kopyalanmalı (iOS Safari).
          files.push(await materializeUploadFile(source));
        } catch (error) {
          unreadable.push(error instanceof Error ? error.message : `${source.name}: dosya okunamadı.`);
        }
      }
      input.value = "";
      if (unreadable.length) {
        setLog(unreadable);
        notify(`${unreadable.length} dosya okunamadı; yeniden seçin.`, "warn");
      }
      if (!files.length) return;
      const result = await queueImportFiles(files, replace, dupStrategy);
      setJobs((current) => {
        const known = new Set(current.map((job) => job.id));
        return [...current, ...result.jobs.filter((job) => !known.has(job.id))];
      });
      setQueueActive(true);
      setLog([
        `${result.jobs.length} dosya sunucuya teslim edildi.`,
        "İşleme sunucuda sürüyor — uygulamadan çıksanız bile devam eder.",
      ]);
      notify(`${result.jobs.length} dosya kuyruğa alındı`);
      void refreshQueue();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Dosyalar sunucuya teslim edilemedi.";
      setLog([message]);
      notify(message, "error");
    } finally {
      input.value = "";
      setUploading(false);
    }
  }

  async function handleRetry(job: ImportJob) {
    try {
      await retryImportJob(job.id);
      setQueueActive(true);
      await refreshQueue();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Yeniden deneme başlatılamadı.", "error");
    }
  }

  async function handleDiscard(job: ImportJob) {
    try {
      await deleteImportJob(job.id);
      await refreshQueue();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Kayıt kaldırılamadı.", "error");
    }
  }

  async function clearFinished() {
    for (const job of finishedJobs) {
      try {
        await deleteImportJob(job.id);
      } catch {
        // Tek kayıt kaldırılamazsa diğerlerine devam edilir.
      }
    }
    await refreshQueue();
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
    bump();
    await refreshQueue();
  }

  async function handleAssign(item: UnmatchedPhoto) {
    const selected = Number(assignments[item.id]);
    if (!Number.isInteger(selected)) return;
    await assignUnmatchedPhoto(item.id, selected);
    notify("Fotoğraf yolcuya atandı");
    bump();
    await refreshUnmatched();
  }

  const uploadLocked = uploading || busy;
  const summaryLine = useMemo(() => {
    if (!jobs.length) return "";
    return `${jobs.length} dosya · ${importedRows} yolcu aktarıldı · %${progress} tamamlandı`;
  }, [jobs.length, importedRows, progress]);

  return (
    <div className="tab-body">
      <div className="section-heading">
        <div>
          <p className="overline">VERİ AKTARIMI</p>
          <h2>Toplu liste merkezi</h2>
          <p>Dosyalar tek seferde sunucuya teslim edilir ve arka planda işlenir — uygulamadan çıksanız bile aktarım sürer.</p>
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
            {uploading ? "Sunucuya teslim ediliyor…" : "Dosya seç"}
            <input type="file" accept=".xlsx,.xls,.xlsm,.ods,.csv" multiple onChange={handleExcel} disabled={uploadLocked} />
          </label>
        </div>

        {jobs.length > 0 && (
          <>
            <div className="queue-summary">
              <span>{summaryLine}</span>
              {queueActive && <span className="status-label">Sunucu işliyor…</span>}
              {finishedJobs.length > 0 && !queueActive && (
                <button className="text-btn danger-text" onClick={() => void clearFinished()} type="button">
                  Listeyi temizle
                </button>
              )}
            </div>
            <div className="queue-list">
              {jobs.map((job) => (
                <div className={`queue-row status-${job.status === "pending" ? "ready" : job.status === "processing" ? "uploading" : job.status === "done" ? "success" : "error"}`} key={job.id}>
                  <div>
                    <strong>{job.filename}</strong>
                    {job.message && <small className="queue-message">{job.message}</small>}
                  </div>
                  <div className="queue-actions">
                    <span className="status-label">{STATUS_LABELS[job.status]}</span>
                    {job.status === "error" && (
                      <button className="text-btn" onClick={() => void handleRetry(job)} type="button">
                        Yeniden dene
                      </button>
                    )}
                    {job.status !== "processing" && (
                      <button className="text-btn danger-text" onClick={() => void handleDiscard(job)} type="button">
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
        {queueActive && (
          <div className="banner">
            Aktarım sunucuda sürüyor (%{progress}). Bu ekranı kapatabilirsiniz; geri döndüğünüzde sonuçlar burada olacak.
          </div>
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
            <input type="file" accept="image/*,.zip,.heic,.heif" multiple onChange={handlePhotos} disabled={summary.passenger_count === 0 || uploadLocked} />
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
            <input type="file" accept="message/rfc822,.eml" multiple onChange={handleMail} disabled={uploadLocked} />
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
