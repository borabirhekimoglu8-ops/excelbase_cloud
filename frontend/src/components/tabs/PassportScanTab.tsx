"use client";

import { ChangeEvent, DragEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { OcrCapabilityCard } from "@/components/passport/OcrCapabilityCard";
import { PassportBatchProgress } from "@/components/passport/PassportBatchProgress";
import { PassportReviewPanel } from "@/components/passport/PassportReviewPanel";
import { ResultPackageDialog } from "@/components/passport/ResultPackageDialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { saveBlob } from "@/lib/offline/exporter";
import { fileKindSupported, persistPasteMrz, retryPassportPage, runPassportBatch, type BatchPageView } from "@/lib/passport/batch";
import { exportExclusionReason, type PassportCandidate, type PassportFieldName } from "@/lib/passport/candidates";
import { detectOcrCapability, fileAcceptForCapability } from "@/lib/passport/ocr/capability";
import { createLocalFastApiEngine } from "@/lib/passport/ocr/localFastApiEngine";
import type { OcrCapability } from "@/lib/passport/ocr/types";
import { createPassportOperatorXlsxBlob } from "@/lib/passport/operatorExcel";
import {
  listPassportCandidates,
  listPassportPages,
  markInterruptedPages,
  patchCandidateField,
  readPageImage,
  readSourceFile,
  setCandidateStatus,
  vaultIsUnlocked,
} from "@/lib/passport/store";
import { useStore } from "@/lib/store";

type PassportScanTabProps = {
  onOpenImport?: () => void;
};

function stamp(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function fallbackCapability(): OcrCapability {
  if (typeof window === "undefined") {
    return detectOcrCapability({ hostname: "", protocol: "http:", isSecureContext: false, probeState: "unreachable" });
  }
  return detectOcrCapability({
    hostname: window.location.hostname,
    protocol: window.location.protocol,
    isSecureContext: window.isSecureContext,
    maxTouchPoints: navigator.maxTouchPoints ?? 0,
  });
}

export function PassportScanTab({ onOpenImport }: PassportScanTabProps) {
  const { notify } = useStore();
  const engine = useMemo(() => createLocalFastApiEngine(), []);
  const [capability, setCapability] = useState<OcrCapability>(fallbackCapability);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [mrzText, setMrzText] = useState("");
  const [candidates, setCandidates] = useState<PassportCandidate[]>([]);
  const [pages, setPages] = useState<BatchPageView[]>([]);
  const [focusId, setFocusId] = useState("");
  const [focusField, setFocusField] = useState<PassportFieldName | null>(null);
  const [pageImage, setPageImage] = useState("");
  const [pageSize, setPageSize] = useState<{ width: number; height: number } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const filesRef = useRef<Map<string, File>>(new Map());

  const approvedReady = useMemo(
    () => candidates.filter((row) => row.status === "user-approved" && !exportExclusionReason(row)),
    [candidates],
  );
  const excluded = useMemo(
    () => candidates.map((row) => ({ id: row.id, reason: exportExclusionReason(row) })).filter((row) => row.reason),
    [candidates],
  );

  const reload = useCallback(async () => {
    if (!(await vaultIsUnlocked())) {
      setCandidates([]);
      return;
    }
    const [rows, storedPages] = await Promise.all([listPassportCandidates(), listPassportPages()]);
    setCandidates(rows);
    setPages((current) => {
      if (current.some((page) => page.status === "processing" || page.status === "queued")) return current;
      return storedPages.map((page) => ({
        pageId: page.id,
        jobId: page.job_id,
        label: `sayfa ${page.page_index + 1}`,
        status: page.status,
        error: page.error,
        attempt: page.attempt,
        candidateCount: page.candidate_ids.length,
      }));
    });
    setFocusId((current) => current || rows[0]?.id || "");
  }, []);

  const probe = useCallback(async () => {
    const next = await engine.probe();
    setCapability(next);
    if (next.state === "engine_loading") void engine.warmup().then(setCapability);
  }, [engine]);

  useEffect(() => {
    void probe();
    const recover = async () => {
      if (await vaultIsUnlocked()) {
        await markInterruptedPages();
        await reload();
      }
    };
    void recover();
    const onVault = () => { void recover(); };
    window.addEventListener("excelbase:vault-change", onVault);
    return () => window.removeEventListener("excelbase:vault-change", onVault);
  }, [probe, reload]);

  useEffect(() => {
    let revoked = "";
    const active = candidates.find((item) => item.id === focusId);
    if (!active?.page_id) {
      setPageImage("");
      return;
    }
    void readPageImage(active.page_id).then((blob) => {
      if (!blob) {
        setPageImage("");
        return;
      }
      const url = URL.createObjectURL(blob);
      revoked = url;
      setPageImage(url);
    });
    void listPassportPages().then((stored) => {
      const page = stored.find((item) => item.id === active.page_id);
      setPageSize(page?.image_size ?? null);
    });
    return () => {
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [candidates, focusId]);

  async function processPaste() {
    setBusy(true);
    try {
      if (!(await vaultIsUnlocked())) {
        notify("Kasa kilitliyken kayıt yazılmaz. Önce kasayı açın.", "error");
        return;
      }
      const result = await persistPasteMrz(mrzText);
      notify(`${result.added} satır eklendi.`, result.added ? "ok" : "error");
      if (!result.added) notify("İki adet 44 karakterlik TD3 MRZ satırı bulunamadı. Metni yeniden kopyalayıp yapıştırın.", "error");
      await reload();
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : "MRZ işlenemedi.", "error");
    } finally {
      setBusy(false);
    }
  }

  async function runFiles(files: File[]) {
    if (!files.length) return;
    const unsupported = files.find((file) => !fileKindSupported(file, capability.acceptImages));
    if (unsupported) {
      notify(
        capability.acceptImages
          ? "Yalnız PDF, TXT, JPG, PNG veya HEIC yükleyin."
          : "Bu cihazda görüntü OCR’si yok. PDF/TXT veya Live Text ile MRZ yapıştırın.",
        "error",
      );
      return;
    }
    if (!(await vaultIsUnlocked())) {
      notify("Kasa kilitliyken kayıt yazılmaz. Önce kasayı açın.", "error");
      return;
    }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    try {
      const result = await runPassportBatch({
        files,
        canOcr: capability.canOcr,
        recognize: capability.canOcr ? (image, pageId, signal) => engine.recognizePage(image, pageId, signal) : null,
        concurrency: 1,
        signal: controller.signal,
        onProgress: setPages,
      });
      result.job.sources.forEach((source, index) => {
        filesRef.current.set(source.fileId, files[index] ?? files[0]);
      });
      notify(`${result.pages.length} sayfa işlendi.`, "ok");
      await reload();
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : "Dosyalar işlenemedi.", "error");
    } finally {
      setBusy(false);
    }
  }

  function onPick(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    void runFiles(files);
  }

  function onDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragging(false);
    void runFiles(Array.from(event.dataTransfer.files ?? []));
  }

  async function onPatch(id: string, field: PassportFieldName, value: string) {
    await patchCandidateField(id, field, value);
    await reload();
  }

  async function onApprove(id: string) {
    await setCandidateStatus(id, "user-approved", "operator");
    await reload();
  }

  async function onReject(id: string) {
    await setCandidateStatus(id, "rejected", "");
    await reload();
  }

  function onNextIssue() {
    const order: PassportFieldName[] = ["surname", "givenNames", "passportNo", "countryCode2", "birthDate", "expiryDate"];
    const start = Math.max(0, candidates.findIndex((item) => item.id === focusId));
    for (let offset = 0; offset < candidates.length; offset += 1) {
      const row = candidates[(start + offset) % candidates.length];
      if (row.status === "user-approved") continue;
      for (const field of order) {
        if (!row.fields[field].normalized || row.fields[field].validation !== "verified") {
          setFocusId(row.id);
          setFocusField(field);
          return;
        }
      }
    }
  }

  async function onRetry(pageId: string) {
    const stored = (await listPassportPages()).find((page) => page.id === pageId);
    let file = stored ? filesRef.current.get(stored.file_id) : undefined;
    if (!file && stored) {
      const blob = await readSourceFile(stored.file_id);
      if (blob) {
        const name = stored.file_id.endsWith(".txt") ? "kaynak.txt" : "kaynak.pdf";
        file = new File([blob], name, { type: blob.type || "application/pdf" });
        filesRef.current.set(stored.file_id, file);
      }
    }
    if (!stored || !file) {
      notify("Yeniden deneme için kaynak dosya bu oturumda yok.", "error");
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    await retryPassportPage(stored, file, capability.canOcr, capability.canOcr ? engine.recognizePage.bind(engine) : null, controller.signal);
    await reload();
  }

  async function downloadExcel() {
    if (!approvedReady.length) {
      notify("Excel’e yalnız onaylı ve zorunlu alanları tamam kayıtlar girer.", "error");
      return;
    }
    const payload = approvedReady.map((row) => ({
      firstName: row.fields.givenNames.normalized,
      lastName: row.fields.surname.normalized,
      birthDate: row.fields.birthDate.normalized,
      countryCode2: row.fields.countryCode2.normalized,
      passportExpiry: row.fields.expiryDate.normalized,
      passportNo: row.fields.passportNo.normalized,
      sex: row.fields.sex.normalized,
      tcNo: row.fields.tcNo.normalized,
      documentType: row.fields.documentType.normalized,
    }));
    try {
      await saveBlob(createPassportOperatorXlsxBlob(payload), `pasaport-yolcu-listesi-${stamp()}.xlsx`);
      notify(`${payload.length} satırlık Excel indirildi.`, "ok");
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : "Excel oluşturulamadı.", "error");
    }
  }

  return (
    <div className="ops-page xb-passport-scan">
      <section className="ops-page-heading">
        <div>
          <p className="ops-eyebrow">Pasaport</p>
          <h1>Pasaport MRZ → Excel</h1>
          <p>
            Ofis PC’de çok sayfalı PDF veya görüntü yükleyin; MRZ önce okunur, gerekirse yerel PP-OCRv6 çalışır.
            Canlı HTTPS adreste OCR yoktur — şifreli paket aktarın.
          </p>
        </div>
      </section>

      <OcrCapabilityCard capability={capability} onRefresh={() => void probe()} />

      <section className="ops-module-card xb-mrz-entry">
        <div>
          <p className="ops-eyebrow">Birincil yöntem</p>
          <h2>MRZ satırlarını yapıştır</h2>
          <p>iPhone: fotoğrafta metni seç → iki MRZ satırını kopyala → buraya yapıştır.</p>
        </div>
        <label>
          <span>İki adet 44 karakterlik MRZ satırı</span>
          <textarea
            aria-label="MRZ satırlarını yapıştır"
            value={mrzText}
            onChange={(event) => setMrzText(event.target.value)}
            placeholder={"P<TURSOYAD<<AD<<<<<<<<<<<<<<<<<<<<<<<<<<<\nU1000001<..."}
            rows={5}
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
          />
        </label>
        <button type="button" className="primary" disabled={busy || !mrzText.trim()} onClick={() => void processPaste()}>
          Satırları işle
        </button>
        <p className="xb-mrz-help">
          Yeni yükleme önceki satırları silmez. Kayıtlar kasa açıkken şifreli saklanır.
        </p>
      </section>

      <label
        className={`xb-photo-drop${dragging ? " dragging" : ""}${busy ? " busy" : ""}`}
        onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
        onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
        onDrop={onDrop}
        onDragLeave={() => setDragging(false)}
      >
        <strong>{busy ? "İşleniyor…" : capability.acceptImages ? "PDF, TXT veya pasaport görüntüsü" : "Metin katmanlı PDF veya TXT"}</strong>
        <span>
          {capability.canOcr
            ? "Metin yoksa sayfa bu bilgisayarda OCR edilir"
            : "Taranmış görüntü için ofis PC’de yerel OCR veya Live Text"}
        </span>
        <em>En fazla 80 PDF sayfası · ekleme (öncekiler silinmez)</em>
        <input
          type="file"
          accept={fileAcceptForCapability(capability)}
          multiple
          aria-label="Pasaport PDF veya metin dosyaları seç"
          disabled={busy}
          onChange={onPick}
        />
      </label>

      <PassportBatchProgress
        pages={pages}
        onRetry={(pageId) => void onRetry(pageId)}
        onCancel={() => abortRef.current?.abort()}
      />

      <ResultPackageDialog candidates={candidates} onImported={() => void reload()} notify={notify} />

      {candidates.length === 0 && !busy ? (
        <EmptyState
          title="Henüz MRZ işlenmedi"
          body="İki MRZ satırını yapıştırın, metin katmanlı PDF yükleyin veya ofis PC’de yerel OCR kullanın."
        />
      ) : null}

      {candidates.length > 0 && (
        <section className="ops-module-card">
          <div className="ops-section-heading">
            <div>
              <p className="ops-eyebrow">Kontrol</p>
              <h2>{approvedReady.length}/{candidates.length} satır Excel’e hazır</h2>
              {excluded.length ? (
                <p>{excluded.length} kayıt dışarıda: {Array.from(new Set(excluded.map((item) => item.reason))).join(", ")}</p>
              ) : null}
            </div>
            <div className="xb-passport-actions">
              <button type="button" className="primary" disabled={!approvedReady.length || busy} onClick={() => void downloadExcel()}>
                Excel indir
              </button>
              {onOpenImport ? (
                <button type="button" onClick={onOpenImport}>Liste yükleme ekranı</button>
              ) : null}
            </div>
          </div>
          <PassportReviewPanel
            candidates={candidates.filter((row) => row.status !== "rejected")}
            focusId={focusId}
            focusField={focusField}
            pageImage={pageImage}
            pageSize={pageSize}
            onFocus={(id, field) => { setFocusId(id); setFocusField(field); }}
            onPatch={(id, field, value) => void onPatch(id, field, value)}
            onApprove={(id) => void onApprove(id)}
            onReject={(id) => void onReject(id)}
            onNextIssue={onNextIssue}
          />
        </section>
      )}
    </div>
  );
}
