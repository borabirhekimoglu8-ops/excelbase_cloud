"use client";

import { ChangeEvent, DragEvent, useMemo, useState } from "react";

import { CountryPicker } from "@/components/passport/CountryPicker";
import { PassportQueuePanel } from "@/components/passport/PassportQueuePanel";
import { PassportSourceViewer } from "@/components/passport/PassportSourceViewer";
import { EmptyState } from "@/components/ui/EmptyState";
import { saveBlob } from "@/lib/offline/exporter";
import {
  localPassportDeleteSource,
  localPassportPurgeExpiredImages,
  localPassportStorePage,
  localPassportStoreSource,
} from "@/lib/offline/localApi";
import { isSpecialNationality } from "@/lib/passport/icaoCountries";
import { createPassportOperatorXlsxBlob } from "@/lib/passport/operatorExcel";
import {
  DOCUMENT_TYPES,
  rowsFromMrzText,
  type PassportDocumentType,
  type PassportScanRow,
} from "@/lib/passport/parseMrzText";
import {
  revokePassportScanPreviews,
  scanPassportImages,
  type PassportScanProgress,
} from "@/lib/passport/scanPassportImages";
import { countryCode2ForRow, rowReady } from "@/lib/passport/passportTypes";
import { useStore } from "@/lib/store";

type PassportScanTabProps = {
  onOpenImport?: () => void;
};

function stamp(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function isPdf(file: File): boolean {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

function isSupported(file: File): boolean {
  return isPdf(file)
    || file.type.startsWith("image/")
    || /\.(?:jpe?g|png|heic|heif|webp)$/i.test(file.name);
}

export function PassportScanTab({ onOpenImport }: PassportScanTabProps) {
  const { notify } = useStore();
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [mrzText, setMrzText] = useState("");
  const [progress, setProgress] = useState<PassportScanProgress | null>(null);
  const [rows, setRows] = useState<PassportScanRow[]>([]);
  const readyCount = useMemo(() => rows.filter(rowReady).length, [rows]);

  function applyText(text: string, sourceLabel: string): PassportScanRow[] {
    const next = rowsFromMrzText(text, sourceLabel);
    if (!next.length) {
      notify("İki adet 44 karakterlik TD3 MRZ satırı bulunamadı. Metni yeniden kopyalayıp yapıştırın.", "error");
      return [];
    }
    revokePassportScanPreviews(rows);
    setRows(next);
    const verified = next.filter((row) => row.status === "ok").length;
    notify(`${verified} doğrulandı · ${next.length - verified} kontrol gerekli`, "ok");
    return next;
  }

  function processPaste() {
    applyText(mrzText, "Yapıştırılan MRZ");
  }

  async function runFiles(files: File[]) {
    if (!files.length) return;
    const unsupported = files.find((file) => !isSupported(file));
    if (unsupported) {
      notify("PDF, JPG, PNG veya HEIC pasaport görüntüsü seçin.", "error");
      return;
    }

    const batchId = `passport-${Date.now().toString(36)}`;
    setBusy(true);
    setProgress({ done: 0, total: files.length, current: "OCR hazırlanıyor…" });
    try {
      await localPassportPurgeExpiredImages();
      await localPassportStoreSource(batchId, files[0]);
      const nextRows = await scanPassportImages(files, setProgress, {
        batchId,
        onPage: async ({ batchId: pageBatchId, pageNo, blob }) => {
          await localPassportStorePage(pageBatchId, pageNo, blob);
        },
      });
      revokePassportScanPreviews(rows);
      setRows(nextRows);
      const verified = nextRows.filter((row) => row.reviewStatus === "verified").length;
      notify(`${verified} doğrulandı · ${nextRows.length - verified} operatör kontrolü gerekli`, "ok");
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : "Pasaport görüntüleri okunamadı.", "error");
    } finally {
      await localPassportDeleteSource(batchId).catch(() => undefined);
      setBusy(false);
      setProgress(null);
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

  function patchRow(id: string, patch: Partial<PassportScanRow>) {
    setRows((current) => current.map((row) => {
      if (row.id !== id) return row;
      const next = { ...row, ...patch };
      if (!("reviewStatus" in patch)) next.reviewStatus = "needs_review";
      return next;
    }));
  }

  function removeRow(id: string) {
    setRows((current) => current.filter((row) => row.id !== id));
  }

  async function downloadExcel() {
    if (!readyCount) {
      notify("Alanları tamamlayın, geçerli uyruğu seçin ve “Kontrol ettim” kutusunu işaretleyin.", "error");
      return;
    }
    const payload = rows
      .filter(rowReady)
      .map((row) => ({
        firstName: row.firstName.trim(),
        lastName: row.lastName.trim(),
        birthDate: row.birthDate.trim(),
        nationality: row.nationality,
        passportExpiry: row.expiryDate.trim(),
        passportNo: row.passportNo.trim(),
        sex: row.sex.trim(),
        tcNo: row.tcNo.trim(),
        documentType: row.documentType,
      }));
    try {
      await saveBlob(
        createPassportOperatorXlsxBlob(payload),
        `pasaport-yolcu-listesi-${stamp()}.xlsx`,
      );
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
          <h1>Pasaport → Excel</h1>
          <p>
            WhatsApp’tan gelen görüntü PDF’lerini veya pasaport fotoğraflarını seçin.
            İşlem bu cihazda, tek OCR motoruyla sırayla yapılır.
          </p>
        </div>
      </section>

      <label
        className={`xb-photo-drop${dragging ? " dragging" : ""}${busy ? " busy" : ""}`}
        onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
        onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <strong>{busy ? "Pasaportlar okunuyor…" : "PDF veya pasaport fotoğraflarını bırakın"}</strong>
        <span>WhatsApp görüntü PDF · JPG · PNG · HEIC</span>
        <em>En fazla 30 PDF sayfası · tek motor · işlem cihazda</em>
        <input
          type="file"
          accept=".pdf,application/pdf,.jpg,.jpeg,.png,.heic,.heif,image/jpeg,image/png,image/heic,image/heif"
          multiple
          aria-label="Pasaport PDF veya görüntüleri seç"
          disabled={busy}
          onChange={onPick}
        />
      </label>

      <PassportQueuePanel progress={progress} busy={busy} />

      <details className="ops-module-card xb-mrz-entry">
        <summary>Alternatif: Live Text ile MRZ yapıştır</summary>
        <div>
          <p className="ops-eyebrow">Alternatif yöntem</p>
          <h2>MRZ satırlarını yapıştır</h2>
          <p>Fotoğrafta metni seçip iki MRZ satırını buraya yapıştırabilirsiniz.</p>
        </div>
        <label>
          <span>İki adet 44 karakterlik MRZ satırı</span>
          <textarea
            aria-label="MRZ satırlarını yapıştır"
            value={mrzText}
            onChange={(event) => setMrzText(event.target.value)}
            placeholder={"P<TURYILMAZ<<ADA<<<<<<<<<<<<<<<<<<<<<<<<\nU1000001<..."}
            rows={5}
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
          />
        </label>
        <button type="button" className="primary" disabled={busy || !mrzText.trim()} onClick={processPaste}>
          Satırları işle
        </button>
        <p className="xb-mrz-help">Metin yalnızca bu cihazda işlenir; pasaport verisi sunucuya gönderilmez.</p>
      </details>

      {rows.length === 0 && !busy ? (
        <EmptyState
          title="Henüz MRZ işlenmedi"
          body="WhatsApp PDF’i veya pasaport fotoğrafı yükleyin."
        />
      ) : null}

      {rows.length > 0 && (
        <section className="ops-module-card">
          <div className="ops-section-heading">
            <div>
              <p className="ops-eyebrow">Sonuç</p>
              <h2>{readyCount}/{rows.length} satır Excel’e hazır</h2>
            </div>
            <div className="xb-passport-actions">
              <button type="button" className="primary" disabled={!readyCount || busy} onClick={() => void downloadExcel()}>
                Excel indir
              </button>
              {onOpenImport ? (
                <button type="button" onClick={onOpenImport}>Liste yükleme ekranı</button>
              ) : null}
            </div>
          </div>

          <ul className="xb-passport-rows">
            {rows.map((row) => (
              <li key={row.id} data-status={row.status}>
                <div className="xb-passport-thumb" aria-label={row.status === "ok" ? "Doğrulandı" : "Kontrol gerekli"}>
                  <strong aria-hidden="true">{row.status === "ok" ? "✓" : "!"}</strong>
                  <span>{row.status === "ok" ? "Doğrulandı" : "Kontrol"}</span>
                </div>
                <div className="xb-passport-fields">
                  <label>
                    <span>Yolcu Adı</span>
                    <input value={row.firstName} onChange={(event) => patchRow(row.id, { firstName: event.target.value })} autoCapitalize="characters" />
                  </label>
                  <label>
                    <span>Yolcu Soyadı</span>
                    <input value={row.lastName} onChange={(event) => patchRow(row.id, { lastName: event.target.value })} autoCapitalize="characters" />
                  </label>
                  <label>
                    <span>Pasaport No</span>
                    <input
                      value={row.passportNo}
                      onChange={(event) => patchRow(row.id, { passportNo: event.target.value.toLocaleUpperCase("tr-TR") })}
                      autoCapitalize="characters"
                      autoCorrect="off"
                    />
                  </label>
                  <label>
                    <span>Uyruk (MRZ satır 2)</span>
                    <CountryPicker
                      value={row.nationality}
                      onChange={(nationality) => patchRow(row.id, {
                        nationality,
                        countryCode2: countryCode2ForRow({ nationality }),
                        nationalitySpecial: isSpecialNationality(nationality),
                      })}
                    />
                  </label>
                  <label>
                    <span>Ülke Kodu 2</span>
                    <input value={countryCode2ForRow(row)} readOnly aria-label="Uyruktan türetilen ülke kodu 2" />
                  </label>
                  <label>
                    <span>Düzenleyen devlet (MRZ satır 1)</span>
                    <input value={row.issuingState} readOnly />
                  </label>
                  <label>
                    <span>TC.No</span>
                    <input
                      value={row.tcNo}
                      inputMode="numeric"
                      maxLength={11}
                      onChange={(event) => patchRow(row.id, { tcNo: event.target.value.replace(/\D/g, "").slice(0, 11) })}
                      autoComplete="off"
                    />
                  </label>
                  <label>
                    <span>Doğum Tarihi</span>
                    <input type="date" value={row.birthDate} onChange={(event) => patchRow(row.id, { birthDate: event.target.value })} />
                  </label>
                  <label>
                    <span>Pasaport Bitiş Tar.</span>
                    <input type="date" value={row.expiryDate} onChange={(event) => patchRow(row.id, { expiryDate: event.target.value })} />
                  </label>
                  <label>
                    <span>Doküman Tipi</span>
                    <select
                      value={row.documentType}
                      onChange={(event) => patchRow(row.id, { documentType: event.target.value as PassportDocumentType })}
                    >
                      {DOCUMENT_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
                    </select>
                  </label>
                  <p className="xb-passport-meta">
                    {row.filename}{row.warnings[0] ? ` · ${row.warnings[0]}` : ""}
                  </p>
                  {row.nationalitySpecial ? (
                    <p className="xb-passport-special">
                      Özel/örnek uyruk kodu otomatik çevrilmedi. Gerçek uyruğu seçip kontrol edin.
                    </p>
                  ) : null}
                  {row.previewUrl ? (
                    <details className="xb-passport-debug">
                      <summary>Kaynak sayfayı göster</summary>
                      <PassportSourceViewer
                        src={row.previewUrl}
                        alt={`Pasaport kaynak sayfası ${row.pageNo}`}
                      />
                    </details>
                  ) : null}
                  {row.status !== "ok" ? (
                    <details className="xb-passport-debug">
                      <summary>MRZ ayrıntısı</summary>
                      <div><code>{`${row.mrzLine1}\n${row.mrzLine2}`}</code></div>
                    </details>
                  ) : null}
                  <label className="xb-passport-reviewed">
                    <input
                      type="checkbox"
                      checked={row.reviewStatus === "reviewed" || row.reviewStatus === "verified"}
                      disabled={row.reviewStatus === "verified"}
                      onChange={(event) => patchRow(row.id, {
                        reviewStatus: event.target.checked ? "reviewed" : "needs_review",
                      })}
                    />
                    <span>Kontrol ettim</span>
                  </label>
                </div>
                <button type="button" className="danger" onClick={() => removeRow(row.id)} aria-label="Satırı sil">Sil</button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
