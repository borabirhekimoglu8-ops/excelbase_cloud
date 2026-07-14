"use client";

import { ChangeEvent, useCallback, useEffect, useRef, useState } from "react";
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

type Step = "files" | "mapping" | "result";

const STATUS_LABELS: Record<ImportJob["status"], string> = {
  pending: "SIRADA",
  processing: "İŞLENİYOR",
  done: "HAZIR",
  error: "HATA",
};

const TEMPLATE_FIELDS: { excel: string; app: string; keyword: string | null }[] = [
  { excel: "NAME SURNAME", app: "Ad Soyad", keyword: "yolcu adı" },
  { excel: "PASSPORT NUMBER", app: "Pasaport No", keyword: "pasaport no" },
  { excel: "VOUCHER", app: "Voucher", keyword: "voucher" },
  { excel: "DEPARTURE", app: "Gidiş Tarihi", keyword: "gidiş" },
  { excel: "ARRIVAL", app: "Varış Tarihi", keyword: "varış" },
  { excel: "ADULT / CHILD", app: "Vize Ücreti", keyword: "ücret" },
];

export function ImportTab({ onNavigate }: { onNavigate: (tab: string) => void }) {
  const { summary, notify, bump } = useStore();
  const [step, setStep] = useState<Step>("files");
  const [replace, setReplace] = useState(false);
  const [dupStrategy, setDupStrategy] = useState("skip");
  const [jobs, setJobs] = useState<ImportJob[]>([]);
  const [queueActive, setQueueActive] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [unmatched, setUnmatched] = useState<UnmatchedPhoto[]>([]);
  const [passengers, setPassengers] = useState<Passenger[]>([]);
  const [assignments, setAssignments] = useState<Record<string, string>>({});
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoLog, setPhotoLog] = useState<string[]>([]);
  const doneCountRef = useRef(-1);

  // Adım değiştiğinde önceki adımdan kalan kaydırma konumu yeni adımın
  // başlığını/adım göstergesini görünür alanın dışına itebiliyordu.
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [step]);

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
      if (doneCountRef.current !== -1 && doneCount !== doneCountRef.current) bump();
      doneCountRef.current = doneCount;
    } catch {
      // Bağlantı yoksa mevcut görünüm korunur.
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
  }, [refreshUnmatched, summary.passenger_count]);

  const finishedJobs = jobs.filter((j) => j.status === "done" || j.status === "error");
  const failedJobs = jobs.filter((j) => j.status === "error");
  const okJobs = jobs.filter((j) => j.status === "done");
  const totals = okJobs.reduce(
    (acc, j) => ({ imported: acc.imported + j.imported, duplicates: acc.duplicates + j.duplicates, invalid: acc.invalid + j.invalid }),
    { imported: 0, duplicates: 0, invalid: 0 },
  );
  const combinedMessage = jobs.map((j) => j.message).join(" ").toLowerCase();
  const canReview = jobs.length > 0 && !queueActive;

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
          files.push(await materializeUploadFile(source));
        } catch (error) {
          unreadable.push(error instanceof Error ? error.message : `${source.name}: dosya okunamadı.`);
        }
      }
      input.value = "";
      if (unreadable.length) notify(`${unreadable.length} dosya okunamadı; yeniden seçin.`, "warn");
      if (!files.length) return;
      const result = await queueImportFiles(files, replace, dupStrategy);
      setJobs((current) => {
        const known = new Set(current.map((job) => job.id));
        return [...current, ...result.jobs.filter((job) => !known.has(job.id))];
      });
      setQueueActive(true);
      doneCountRef.current = -1;
      notify(`${result.jobs.length} dosya kuyruğa alındı`);
      void refreshQueue();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Dosyalar sunucuya teslim edilemedi.", "error");
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

  function startNewUpload() {
    setJobs([]);
    doneCountRef.current = -1;
    setStep("files");
  }

  async function handlePhotos(event: ChangeEvent<HTMLInputElement>) {
    const sourceFiles = Array.from(event.target.files ?? []);
    if (!sourceFiles.length) {
      event.target.value = "";
      return;
    }
    setPhotoBusy(true);
    try {
      const files: File[] = [];
      for (const source of sourceFiles) files.push(await materializeUploadFile(source));
      const result = await matchPhotos(files);
      setPhotoLog([`${result.matched} fotoğraf eşleşti.`, ...(result.unmatched.length ? [`${result.unmatched.length} fotoğraf eşleşme kutusuna alındı.`] : [])]);
      notify(`${result.matched} fotoğraf eşleşti`);
      bump();
      await refreshUnmatched();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Fotoğraf yükleme başarısız", "error");
    } finally {
      event.target.value = "";
      setPhotoBusy(false);
    }
  }

  async function handleMail(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    if (!files.length) {
      event.target.value = "";
      return;
    }
    setPhotoBusy(true);
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
    setPhotoLog(notes);
    setPhotoBusy(false);
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

  async function handleUndo() {
    if (!window.confirm("Son toplu liste aktarımı geri alınsın mı?")) return;
    const result = await undoImport(summary.last_batch_id);
    notify(result.message, "warn");
    bump();
    await refreshQueue();
  }

  // Sunucuda işleme sürerken yeni dosyalar eklenebilmelidir. Yalnızca mevcut
  // multipart teslimi devam ederken ikinci bir seçim başlatılmasını engelleriz.
  const uploadLocked = uploading;

  return (
    <>
      <div className="ic-steps">
        <span className={`ic-step${step === "files" ? " active" : jobs.length > 0 ? " done" : ""}`}>
          {jobs.length > 0 && step !== "files" ? "✓ " : "1  "}DOSYALAR
        </span>
        <span className={`ic-step${step === "mapping" ? " active" : step === "result" ? " done" : ""}`}>
          {step === "result" ? "✓ " : "2  "}ALANLAR
        </span>
        <span className={`ic-step${step === "result" ? " active" : ""}`}>3  TAMAMLA</span>
      </div>

      {summary.persistence === "local-fallback" && (
        <div className="ic-callout amber">
          <div className="ic-callout-copy">
            <p className="ic-callout-title">Veritabanı bağlantısı yok</p>
            <p className="ic-callout-detail">Aktarılan veriler geçici bellekte, yeniden başlatmada silinebilir.</p>
          </div>
        </div>
      )}

      {step === "files" && (
        <>
          <label className="ic-upload-zone">
            <span className="ic-upload-icon">DOSYA SEÇ</span>
            <p className="ic-upload-title">Dosya Alım Modülü</p>
            <p className="ic-upload-hint">Sınırsız çoklu seçim · işlem sürerken yeni dosya eklenebilir</p>
            <p className="ic-upload-formats">XLSX, XLS, CSV, ODS ve ZIP</p>
            <input
              className="ic-upload-input"
              type="file"
              accept=".xlsx,.xls,.xlsm,.ods,.csv"
              multiple
              onChange={handleExcel}
              disabled={uploadLocked}
              aria-label="Dosya seç"
            />
          </label>

          {jobs.length > 0 && (
            <>
              <div className="ic-section-head">
                <p className="ic-section-title">Aktarıma Hazır Dosyalar</p>
                <span style={{ color: "var(--ido-muted)", fontWeight: 500, fontSize: 10 }}>{jobs.length} dosya</span>
              </div>
              <div style={{ display: "grid", gap: 8 }}>
                {jobs.map((job) => (
                  <div className="ic-row compact" key={job.id}>
                    <div className="ic-row-id">
                      <span className="ic-filetype xls">XLS</span>
                      <div className="ic-row-copy">
                        <p className="ic-row-title">{job.filename}</p>
                        <p className="ic-row-meta">{job.message || "Sırada"}</p>
                      </div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flex: "0 0 auto" }}>
                      <span
                        className={`ic-pill ${job.status === "done" ? "ic-pill-ok" : job.status === "error" ? "ic-pill-bad" : "ic-pill-info"}`}
                      >
                        {STATUS_LABELS[job.status]}
                      </span>
                      {job.status === "error" && (
                        <button className="ic-section-link" onClick={() => void handleRetry(job)} type="button">
                          Tekrar
                        </button>
                      )}
                      {job.status !== "processing" && (
                        <button className="ic-section-link" style={{ color: "var(--ido-red)" }} onClick={() => void handleDiscard(job)} type="button">
                          Kaldır
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          <div className="ic-info-note">
            <span className="ic-info-mark">i</span>
            <div className="ic-info-note-copy">
              <p className="ic-info-note-title">Aktarım arka planda güvenle sürdürülür.</p>
              <p className="ic-info-note-detail">Bu ekrandan çıksanız bile işlem sunucuda devam eder.</p>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, color: "var(--ido-muted)", fontWeight: 600 }}>
              <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} disabled={uploadLocked} />
              Listeyi değiştir
            </label>
            <label style={{ display: "grid", gap: 4, fontSize: 10, color: "var(--ido-muted)", fontWeight: 700 }}>
              Tekrar durumunda
              <select
                value={dupStrategy}
                onChange={(e) => setDupStrategy(e.target.value)}
                disabled={uploadLocked}
                style={{ border: "1px solid var(--ido-border)", borderRadius: 4, padding: "6px 8px", fontSize: 11 }}
              >
                <option value="skip">Mevcut kaydı koru</option>
                <option value="overwrite">Yeni kayıtla güncelle</option>
                <option value="add">İkisini de ekle</option>
              </select>
            </label>
          </div>
        </>
      )}

      {step === "mapping" && (
        <>
          <div className="ic-section-head" style={{ alignItems: "flex-start" }}>
            <div>
              <p className="ic-section-title">Alan Eşleştirme Kontrolü</p>
              <p style={{ margin: 0, color: "var(--ido-muted)", fontWeight: 500, fontSize: 9 }}>
                Gate Visa PAX LIST şablonu sistem tarafından eşleştirildi
              </p>
            </div>
          </div>

          {TEMPLATE_FIELDS.map((field) => {
            const missing = field.keyword ? combinedMessage.includes(field.keyword) : false;
            return (
              <div className={`ic-map-row${missing ? " missing" : ""}`} key={field.excel}>
                <div className="ic-map-col source">
                  <p className="ic-map-label">EXCEL SÜTUNU</p>
                  <p className="ic-map-value">{field.excel}</p>
                </div>
                <span className="ic-map-arrow">→</span>
                <div className="ic-map-col target">
                  <p className="ic-map-label">EXCELBASE ALANI</p>
                  <p className={`ic-map-value${missing ? " warn" : ""}`}>{field.app}</p>
                </div>
                <span className={`ic-map-state${missing ? " warn" : ""}`}>{missing ? "!" : "✓"}</span>
              </div>
            );
          })}

          {passengers.length > 0 && (
            <div className="ic-preview-dark">
              <div className="ic-preview-head">
                <strong>KAYIT ÖNİZLEMESİ</strong>
                <span>İlk {Math.min(3, passengers.length)} yolcu</span>
              </div>
              {passengers.slice(0, 3).map((p) => (
                <p className="ic-preview-row" key={p.id}>
                  {p.full_name || "İsimsiz"} · {p.passport_no || "—"}
                </p>
              ))}
            </div>
          )}
        </>
      )}

      {step === "result" && (
        <>
          <div className="ic-result-summary">
            <span className={`ic-pill ${totals.invalid > 0 ? "ic-pill-warn" : "ic-pill-ok"}`}>
              {totals.invalid > 0 ? "KONTROL" : "TAMAMLANDI"}
            </span>
            <p className="ic-result-title">
              {totals.invalid > 0 ? "Dosya aktarımı kontrolle tamamlandı" : "Dosya aktarımı başarıyla tamamlandı"}
            </p>
            <p className="ic-result-subtitle">
              {totals.imported} kayıt aktarıldı{totals.invalid > 0 ? `; ${totals.invalid} kayıt inceleme bekliyor.` : "."}
            </p>
          </div>

          <div className="ic-card ic-metrics">
            <div className="ic-metric">
              <p className="ic-metric-value" style={{ color: "var(--ido-success)" }}>{totals.imported}</p>
              <p className="ic-metric-label">Başarılı</p>
            </div>
            <span className="ic-metric-divider" />
            <div className="ic-metric">
              <p className="ic-metric-value" style={{ color: "var(--ido-amber)" }}>{totals.duplicates}</p>
              <p className="ic-metric-label">Mükerrer</p>
            </div>
            <span className="ic-metric-divider" />
            <div className="ic-metric">
              <p className="ic-metric-value" style={{ color: "var(--ido-red)" }}>{totals.invalid}</p>
              <p className="ic-metric-label">Eksik Alan</p>
            </div>
          </div>

          {failedJobs.length > 0 && (
            <>
              <div className="ic-section-head">
                <p className="ic-section-title">Hatalı Dosyalar</p>
                <span style={{ color: "var(--ido-red)", fontWeight: 500, fontSize: 10 }}>{failedJobs.length} dosya</span>
              </div>
              {failedJobs.map((job) => (
                <div className="ic-row compact" key={job.id} style={{ borderColor: "var(--ido-red-tint)" }}>
                  <div className="ic-row-id">
                    <span className="ic-filetype" style={{ background: "var(--ido-red-tint)", color: "var(--ido-red)" }}>!</span>
                    <div className="ic-row-copy">
                      <p className="ic-row-title">{job.filename}</p>
                      <p className="ic-row-meta">{job.message}</p>
                    </div>
                  </div>
                  <button className="ic-section-link" onClick={() => void handleRetry(job)} type="button">
                    Yeniden dene
                  </button>
                </div>
              ))}
            </>
          )}

          {totals.invalid > 0 && (
            <div className="ic-callout amber">
              <div className="ic-callout-copy">
                <p className="ic-callout-title">{totals.invalid} kayıt eksik alanla aktarıldı</p>
                <p className="ic-callout-detail">Yolcular listesinden filtreleyip düzeltin</p>
              </div>
              <button className="ic-callout-action" onClick={() => onNavigate("passengers-eksik")} type="button">
                Görüntüle
              </button>
            </div>
          )}

          <div className="ic-actions-row">
            <a href={downloadUrl("/api/export?kind=excel")}>Excel indir</a>
            <button onClick={startNewUpload} type="button">Yeni yükleme</button>
          </div>

          {summary.can_undo && (
            <div className="ic-actions-row">
              <span style={{ color: "var(--ido-muted)", fontWeight: 500, fontSize: 10 }}>Son aktarımdan memnun değil misiniz?</span>
              <button onClick={() => void handleUndo()} style={{ color: "var(--ido-red)" }} type="button">
                Geri al
              </button>
            </div>
          )}

          <div className="ic-info-note">
            <span className="ic-info-mark">i</span>
            <div className="ic-info-note-copy">
              <p className="ic-info-note-title">Başarılı kayıtlar sisteme kaydedildi.</p>
              <p className="ic-info-note-detail">Eksikleri istediğiniz zaman Yolcular listesinden tamamlayabilirsiniz.</p>
            </div>
          </div>
        </>
      )}

      {step === "files" && (
        <>
          <div className="ic-section-head">
            <p className="ic-section-title">Fotoğrafları Eşleştirin</p>
          </div>
          <label className="ic-btn-outline" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer", position: "relative" }}>
            Fotoğraf / ZIP Seç
            <input
              type="file"
              accept="image/*,.zip,.heic,.heif"
              multiple
              onChange={handlePhotos}
              disabled={summary.passenger_count === 0 || photoBusy}
              style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer" }}
            />
          </label>

          <div className="ic-section-head">
            <p className="ic-section-title">E-posta Ekleri</p>
          </div>
          <label className="ic-btn-outline" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer", position: "relative" }}>
            E-posta (.eml) Seç
            <input
              type="file"
              accept="message/rfc822,.eml"
              multiple
              onChange={handleMail}
              disabled={photoBusy}
              style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer" }}
            />
          </label>

          {photoLog.length > 0 && (
            <div className="ic-card ic-card-pad" style={{ fontSize: 11, color: "var(--ido-muted)", display: "grid", gap: 4 }}>
              {photoLog.map((line, i) => <p key={i} style={{ margin: 0 }}>{line}</p>)}
            </div>
          )}

          {unmatched.length > 0 && (
            <>
              <div className="ic-section-head">
                <p className="ic-section-title">Eşleşme Bekleyen Fotoğraflar</p>
                <span style={{ color: "var(--ido-muted)", fontWeight: 500, fontSize: 10 }}>{unmatched.length}</span>
              </div>
              {unmatched.map((item) => (
                <div className="ic-row compact" key={item.id}>
                  <div className="ic-row-id">
                    <span className="ic-avatar">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={item.photo_url} alt={item.filename} />
                    </span>
                    <div className="ic-row-copy">
                      <p className="ic-row-title">{item.filename}</p>
                      <select
                        value={assignments[item.id] ?? ""}
                        onChange={(e) => setAssignments((cur) => ({ ...cur, [item.id]: e.target.value }))}
                        style={{ border: "1px solid var(--ido-border)", borderRadius: 4, fontSize: 10, padding: "2px 4px", marginTop: 2 }}
                      >
                        <option value="">Yolcu seçin</option>
                        {passengers.map((p) => (
                          <option key={p.id} value={p.id}>{p.full_name} · {p.passport_no}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8, flex: "0 0 auto" }}>
                    <button className="ic-section-link" disabled={!assignments[item.id]} onClick={() => void handleAssign(item)} type="button">
                      Ata
                    </button>
                    <button
                      className="ic-section-link"
                      style={{ color: "var(--ido-red)" }}
                      onClick={async () => { await deleteUnmatchedPhoto(item.id); await refreshUnmatched(); }}
                      type="button"
                    >
                      Kaldır
                    </button>
                  </div>
                </div>
              ))}
            </>
          )}

          <div className="ic-actions-row">
            <a href={downloadUrl("/api/template")}>Standart şablonu indir</a>
          </div>
        </>
      )}

      <div className="ic-sticky">
        {step === "files" && (
          <button
            className="ic-btn-primary"
            disabled={!canReview}
            onClick={() => setStep("mapping")}
            type="button"
          >
            {queueActive ? "DOSYALAR İŞLENİYOR…" : canReview ? `SONUÇLARI GÖR · ${totals.imported || finishedJobs.length} DOSYA` : "DOSYA SEÇİN"}
          </button>
        )}
        {step === "mapping" && (
          <button className="ic-btn-primary" onClick={() => setStep("result")} type="button">
            EŞLEŞTİRMEYİ ONAYLA · {totals.imported} KAYIT
          </button>
        )}
        {step === "result" && (
          <button className="ic-btn-primary" onClick={() => onNavigate("passengers")} type="button">
            YOLCULAR LİSTESİNE GİT
          </button>
        )}
      </div>
    </>
  );
}
