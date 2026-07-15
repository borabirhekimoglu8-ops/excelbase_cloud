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
  fetchPassengerPage,
  fetchPassengers,
  fetchUnmatchedPhotos,
  importMail,
  isRetryableTransportError,
  matchPhotos,
  queueImportFile,
  retryImportJob,
  undoImport,
} from "@/lib/api";
import { newId } from "@/lib/id";
import { useStore } from "@/lib/store";
import { materializeUploadFile, purgeLegacyUploadQueue } from "@/lib/uploadQueue";

type Step = "files" | "mapping" | "result";
type DeliveryStage = "waiting" | "sending" | "retrying" | "delivered" | "failed";
type DeliveryItem = {
  uploadId: string;
  filename: string;
  stage: DeliveryStage;
  message: string;
};

const DELIVERY_LABELS: Record<DeliveryStage, string> = {
  waiting: "SIRADA",
  sending: "GÖNDERİLİYOR",
  retrying: "TEKRAR DENENİYOR",
  delivered: "TESLİM EDİLDİ",
  failed: "HATA",
};

const STATUS_LABELS: Record<ImportJob["status"], string> = {
  waiting: "DOSYALAR İŞLENİYOR",
  pending: "SIRADA",
  processing: "İŞLENİYOR",
  done: "HAZIR",
  error: "HATA",
};

function importJobMessage(job: ImportJob): string {
  const progress = typeof job.total_files === "number" && job.total_files > 0
    ? `${job.processed_files ?? 0}/${job.total_files} dosya · `
    : "";
  return `${progress}${job.message || job.stage || "Sırada"}`;
}

function importJobBadge(job: ImportJob): string {
  if (job.filename.toLowerCase().endsWith(".zip")) return "ZIP";
  const extension = job.filename.split(".").pop()?.toUpperCase() ?? "XLS";
  return extension.slice(0, 4);
}

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
  const [deliveryProgress, setDeliveryProgress] = useState<
    {
      processed: number;
      delivered: number;
      failed: number;
      total: number;
      currentFilename: string;
      currentStage: DeliveryStage;
    } | null
  >(null);
  const [deliveryItems, setDeliveryItems] = useState<DeliveryItem[]>([]);
  const [queueLoadError, setQueueLoadError] = useState("");
  const [unmatched, setUnmatched] = useState<UnmatchedPhoto[]>([]);
  const [previewPassengers, setPreviewPassengers] = useState<Passenger[]>([]);
  const [assignmentPassengers, setAssignmentPassengers] = useState<Passenger[]>([]);
  const [assignmentPassengersLoading, setAssignmentPassengersLoading] = useState(false);
  const [assignments, setAssignments] = useState<Record<string, string>>({});
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoLog, setPhotoLog] = useState<string[]>([]);
  const doneCountRef = useRef(-1);
  const queueRefreshBusyRef = useRef(false);
  const queueWasActiveRef = useRef(false);
  const trackedJobIdsRef = useRef<Set<string>>(new Set());
  const previewPassengerTotalRef = useRef(0);
  const assignmentPassengerCountRef = useRef(-1);
  const assignmentLoadPromiseRef = useRef<Promise<void> | null>(null);
  const assignmentAutoLoadAttemptedRef = useRef(false);

  // Adım değiştiğinde önceki adımdan kalan kaydırma konumu yeni adımın
  // başlığını/adım göstergesini görünür alanın dışına itebiliyordu.
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [step]);

  const ensureAssignmentPassengers = useCallback(async (expectedTotal = previewPassengerTotalRef.current) => {
    if (assignmentPassengerCountRef.current === expectedTotal) return;
    if (assignmentLoadPromiseRef.current) return assignmentLoadPromiseRef.current;

    setAssignmentPassengersLoading(true);
    const request = fetchPassengers({ sort: "name" })
      .then((rows) => {
        setAssignmentPassengers(rows);
        assignmentPassengerCountRef.current = rows.length;
      })
      .catch((error) => {
        notify(error instanceof Error ? error.message : "Yolcu seçim listesi yüklenemedi.", "error");
      })
      .finally(() => {
        assignmentLoadPromiseRef.current = null;
        setAssignmentPassengersLoading(false);
      });
    assignmentLoadPromiseRef.current = request;
    return request;
  }, [notify]);

  const refreshUnmatched = useCallback(async () => {
    const [photos, page] = await Promise.all([
      fetchUnmatchedPhotos(),
      fetchPassengerPage({ sort: "name", offset: 0, limit: 3 }),
    ]);
    setUnmatched(photos);
    setPreviewPassengers(page.items);
    previewPassengerTotalRef.current = page.total;
    // Tam yolcu listesi normal aktarım/polling akışında indirilmez. Yalnızca
    // eşleşmemiş fotoğraf atama arayüzü gerçekten görünürse bir defa hazırlanır.
    if (photos.length > 0 && !assignmentAutoLoadAttemptedRef.current) {
      assignmentAutoLoadAttemptedRef.current = true;
      void ensureAssignmentPassengers(page.total);
    }
  }, [ensureAssignmentPassengers]);

  const refreshQueue = useCallback(async () => {
    // Render/PostgreSQL kısa süreli yavaşladığında önceki sorgu bitmeden yeni
    // polling isteği açmayız. Bu hem mobilde yanlış sırada UI güncellemesini
    // hem de aynı oturumun DB'yi üst üste isteklerle boğmasını engeller.
    if (queueRefreshBusyRef.current) return;
    queueRefreshBusyRef.current = true;
    try {
      const state = await fetchImportQueue();
      setQueueLoadError("");
      setJobs(state.jobs);
      const nextActive = (
        state.active
        || state.jobs.some((job) => job.status === "waiting" || job.status === "pending" || job.status === "processing")
      );
      setQueueActive(nextActive);
      const doneCount = state.jobs.filter((job) => job.status === "done" || job.status === "error").length;
      const trackedIds = trackedJobIdsRef.current;
      const trackedJobs = state.jobs.filter((job) => trackedIds.has(job.id));
      const trackedFinished = (
        trackedIds.size > 0
        && trackedJobs.length === trackedIds.size
        && trackedJobs.every((job) => job.status === "done" || job.status === "error")
      );
      const becameIdle = queueWasActiveRef.current && !nextActive;
      const terminalCountChanged = doneCountRef.current !== -1 && doneCount !== doneCountRef.current;
      if (terminalCountChanged || trackedFinished || becameIdle) bump();
      if (trackedFinished || becameIdle) trackedJobIdsRef.current.clear();
      doneCountRef.current = doneCount;
      queueWasActiveRef.current = nextActive;
    } catch (error) {
      setQueueLoadError(error instanceof Error ? error.message : String(error));
    } finally {
      queueRefreshBusyRef.current = false;
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
    const timer = window.setInterval(() => void refreshQueue(), 4000);
    return () => window.clearInterval(timer);
  }, [queueActive, refreshQueue]);

  useEffect(() => {
    void refreshUnmatched();
  }, [refreshUnmatched, summary.passenger_count]);

  // ZIP parent satırı child toplamlarını zaten taşır. Sonuç toplamlarında
  // parent ve child'ları birlikte toplamak yolcu sayısını iki kez sayardı.
  const topLevelJobs = jobs.filter((job) => !job.parent_id);
  const finishedJobs = topLevelJobs.filter((j) => j.status === "done" || j.status === "error");
  const failedJobs = jobs.filter((j) => j.status === "error");
  const okJobs = topLevelJobs.filter((j) => j.status === "done");
  const totals = okJobs.reduce(
    (acc, j) => ({ imported: acc.imported + j.imported, duplicates: acc.duplicates + j.duplicates, invalid: acc.invalid + j.invalid }),
    { imported: 0, duplicates: 0, invalid: 0 },
  );
  const combinedMessage = jobs.map((j) => j.message).join(" ").toLowerCase();
  const canReview = topLevelJobs.length > 0 && !queueActive;

  async function handleExcel(event: ChangeEvent<HTMLInputElement>) {
    const input = event.target;
    const sourceFiles = Array.from(input.files ?? []);
    if (!sourceFiles.length) {
      input.value = "";
      return;
    }

    setUploading(true);
    const batchId = newId();
    const selected = sourceFiles.map((file) => ({ file, uploadId: newId() }));
    let processed = 0;
    let delivered = 0;
    let failed = 0;
    const failedDetails: string[] = [];
    setDeliveryItems(
      selected.map(({ file, uploadId }) => ({
        uploadId,
        filename: file.name,
        stage: "waiting",
        message: "Gönderim sırasını bekliyor.",
      })),
    );
    setDeliveryProgress({
      processed,
      delivered,
      failed,
      total: selected.length,
      currentFilename: selected[0]?.file.name ?? "",
      currentStage: "waiting",
    });

    const setDelivery = (uploadId: string, stage: DeliveryStage, message: string) => {
      setDeliveryItems((current) =>
        current.map((item) => (item.uploadId === uploadId ? { ...item, stage, message } : item)),
      );
    };

    try {
      // File nesneleri input üzerinde tutulur; input ancak bütün sıra bittikten
      // sonra temizlenir. Böylece iOS/iCloud dosya sağlayıcısı, ikinci dosyada
      // geçersizleşen bir tutamaç yerine özgün File'ı doğrudan fetch'e verir.
      for (const [uploadIndex, { file: source, uploadId }] of selected.entries()) {
        // Batch replace niyetini her dosya taşır; backend bunu yalnız ilk
        // başarıyla ayrıştırılan dosyada tüketir. İlk dosyanın bozuk olması
        // sonraki sağlam dosyanın eski listeyi değiştirmesini engellemez.
        const applyReplace = replace;
        let finalError: unknown;
        let result: Awaited<ReturnType<typeof queueImportFile>> | null = null;
        let retried = false;
        let accepted = false;

        setDelivery(uploadId, "sending", "Sunucuya gönderiliyor…");
        setDeliveryProgress({
          processed,
          delivered,
          failed,
          total: selected.length,
          currentFilename: source.name,
          currentStage: "sending",
        });

        try {
          result = await queueImportFile(source, applyReplace, dupStrategy, batchId, uploadId, uploadIndex);
        } catch (error) {
          finalError = error;
          if (isRetryableTransportError(error)) {
            retried = true;
            setDelivery(
              uploadId,
              "retrying",
              `${error.message} · Aynı güvenli aktarım kimliğiyle bir kez daha deneniyor…`,
            );
            setDeliveryProgress({
              processed,
              delivered,
              failed,
              total: selected.length,
              currentFilename: source.name,
              currentStage: "retrying",
            });
            await new Promise((resolve) => globalThis.setTimeout(resolve, 1_000));
            try {
              // Yanıt kaybolmuş olsa bile aynı upload_id ikinci iş oluşturmaz.
              result = await queueImportFile(source, applyReplace, dupStrategy, batchId, uploadId, uploadIndex);
              finalError = undefined;
            } catch (retryError) {
              finalError = retryError;
            }
          }
        }

        try {
          if (!result) throw finalError ?? new Error("Sunucudan aktarım kaydı dönmedi.");
          if (!result.jobs.length) throw new Error("Sunucu dosyayı kabul etti ancak aktarım işi kimliği döndürmedi.");
          const acceptedResult = result;

          delivered += 1;
          accepted = true;
          setDelivery(
            uploadId,
            "delivered",
            retried ? "Güvenli yeniden denemeyle sunucuya teslim edildi." : "Sunucuya teslim edildi; arka plan kuyruğuna alındı.",
          );
          setJobs((current) => {
            const known = new Set(current.map((job) => job.id));
            return [...current, ...acceptedResult.jobs.filter((job) => !known.has(job.id))];
          });
          for (const job of acceptedResult.jobs) trackedJobIdsRef.current.add(job.id);
          queueWasActiveRef.current = true;
          if (
            acceptedResult.active
            || acceptedResult.jobs.some((job) => job.status === "waiting" || job.status === "pending" || job.status === "processing")
          ) setQueueActive(true);
          doneCountRef.current = -1;
        } catch (error) {
          finalError = error;
          failed += 1;
          const exactMessage = error instanceof Error ? error.message : String(error);
          failedDetails.push(`${source.name}: ${exactMessage}`);
          setDelivery(uploadId, "failed", exactMessage);
        } finally {
          processed += 1;
          setDeliveryProgress({
            processed,
            delivered,
            failed,
            total: selected.length,
            currentFilename: source.name,
            currentStage: accepted ? "delivered" : "failed",
          });
        }
      }

      if (delivered) notify(`${delivered} dosya sunucuya teslim edildi`);
      if (failed) {
        notify(`${failed} dosya teslim edilemedi · ${failedDetails[0]}`, "error");
      }
      void refreshQueue();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Dosya aktarımı beklenmedik biçimde durdu.", "error");
      void refreshQueue();
    } finally {
      // iPhone dosya tutamaçlarını yükleme boyunca canlı tutan kritik sıra:
      // input yalnızca bütün özgün File nesneleri gönderildikten sonra sıfırlanır.
      input.value = "";
      setDeliveryProgress(null);
      setUploading(false);
    }
  }

  async function handleRetry(job: ImportJob) {
    try {
      await retryImportJob(job.id);
      trackedJobIdsRef.current.add(job.id);
      queueWasActiveRef.current = true;
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
    trackedJobIdsRef.current.clear();
    queueWasActiveRef.current = false;
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

      {queueLoadError && (
        <div className="ic-callout amber" role="alert">
          <div className="ic-callout-copy">
            <p className="ic-callout-title">Aktarım kuyruğu okunamadı</p>
            <p className="ic-callout-detail" style={{ whiteSpace: "normal", wordBreak: "break-word" }}>
              {queueLoadError}
            </p>
          </div>
        </div>
      )}

      {step === "files" && (
        <>
          <label className="ic-upload-zone">
            <span className="ic-upload-icon">ZIP / EXCEL SEÇ</span>
            <p className="ic-upload-title">Toplu Liste Yükleme</p>
            <p className="ic-upload-hint">
              {deliveryProgress
                ? `${deliveryProgress.processed}/${deliveryProgress.total} işlendi · ${deliveryProgress.delivered} teslim · ${deliveryProgress.failed} hata · ${deliveryProgress.currentFilename}: ${DELIVERY_LABELS[deliveryProgress.currentStage]}`
                : "Önerilen: Excel dosyalarını tek ZIP yapıp yükleyin"}
            </p>
            <p className="ic-upload-formats">ZIP (önerilen) · XLSX · XLS · XLSM · CSV · ODS</p>
            <p className="ic-upload-formats">iPhone: Dosyalar → Seç → (…) → Sıkıştır</p>
            <input
              className="ic-upload-input"
              type="file"
              accept=".zip,.xlsx,.xls,.xlsm,.ods,.csv"
              multiple
              onChange={handleExcel}
              disabled={uploadLocked}
              aria-label="ZIP veya Excel listelerini seç"
            />
          </label>

          {deliveryItems.length > 0 && (
            <>
              <div className="ic-section-head">
                <p className="ic-section-title">Sunucuya Teslim Durumu</p>
                <span style={{ color: "var(--ido-muted)", fontWeight: 500, fontSize: 10 }}>
                  {deliveryItems.filter((item) => item.stage === "delivered").length} teslim · {deliveryItems.filter((item) => item.stage === "failed").length} hata
                </span>
              </div>
              <div style={{ display: "grid", gap: 8 }} aria-live="polite">
                {deliveryItems.map((item) => (
                  <div className="ic-row compact" key={item.uploadId} style={{ alignItems: "flex-start" }}>
                    <div className="ic-row-id">
                      <span className={`ic-filetype ${item.filename.toLowerCase().endsWith(".zip") ? "" : "xls"}`}>
                        {item.filename.toLowerCase().endsWith(".zip") ? "ZIP" : "XLS"}
                      </span>
                      <div className="ic-row-copy">
                        <p className="ic-row-title">{item.filename}</p>
                        <p
                          className="ic-row-meta"
                          style={{ whiteSpace: "normal", overflow: "visible", textOverflow: "clip", wordBreak: "break-word" }}
                        >
                          {item.message}
                        </p>
                      </div>
                    </div>
                    <span
                      className={`ic-pill ${
                        item.stage === "delivered"
                          ? "ic-pill-ok"
                          : item.stage === "failed"
                            ? "ic-pill-bad"
                            : "ic-pill-info"
                      }`}
                    >
                      {DELIVERY_LABELS[item.stage]}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}

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
                      <span className={`ic-filetype ${job.filename.toLowerCase().endsWith(".zip") ? "" : "xls"}`}>
                        {importJobBadge(job)}
                      </span>
                      <div className="ic-row-copy">
                        <p className="ic-row-title">{job.filename}</p>
                        <p className="ic-row-meta">{importJobMessage(job)}</p>
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

          {previewPassengers.length > 0 && (
            <div className="ic-preview-dark">
              <div className="ic-preview-head">
                <strong>KAYIT ÖNİZLEMESİ</strong>
                <span>İlk {previewPassengers.length} yolcu</span>
              </div>
              {previewPassengers.map((p) => (
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
                        onFocus={() => void ensureAssignmentPassengers()}
                        disabled={assignmentPassengersLoading}
                        style={{ border: "1px solid var(--ido-border)", borderRadius: 4, fontSize: 10, padding: "2px 4px", marginTop: 2 }}
                      >
                        <option value="">{assignmentPassengersLoading ? "Yolcular yükleniyor…" : "Yolcu seçin"}</option>
                        {assignmentPassengers.map((p) => (
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
