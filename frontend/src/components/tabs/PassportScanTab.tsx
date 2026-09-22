"use client";

import { ChangeEvent, DragEvent, useEffect, useMemo, useRef, useState } from "react";

import { IMAGE_ACCEPT } from "@/lib/imageFormat";
import { saveBlob } from "@/lib/offline/exporter";
import { createPassportOperatorXlsxBlob } from "@/lib/passport/operatorExcel";
import {
  DOCUMENT_TYPES,
  prewarmPassportOcr,
  revokePassportScanPreviews,
  scanPassportImages,
  type PassportDocumentType,
  type PassportScanProgress,
  type PassportScanRow,
} from "@/lib/passport/scanPassportImages";
import { useStore } from "@/lib/store";
import { EmptyState } from "@/components/ui/EmptyState";

type PassportScanTabProps = {
  onOpenImport?: () => void;
};

function stamp(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function rowReady(row: PassportScanRow): boolean {
  return Boolean(
    row.firstName.trim()
    && row.lastName.trim()
    && row.passportNo.trim()
    && row.countryCode2.trim().length === 2
    && row.birthDate.trim()
    && row.expiryDate.trim()
    && row.documentType,
  );
}

async function yieldForProgressPaint(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

export function PassportScanTab({ onOpenImport }: PassportScanTabProps) {
  const { notify } = useStore();
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState<PassportScanProgress | null>(null);
  const [rows, setRows] = useState<PassportScanRow[]>([]);
  const rowsRef = useRef<PassportScanRow[]>([]);

  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);

  useEffect(() => {
    void prewarmPassportOcr();
    return () => revokePassportScanPreviews(rowsRef.current);
  }, []);

  const readyCount = useMemo(() => rows.filter(rowReady).length, [rows]);

  async function runScan(files: File[]) {
    if (!files.length) return;
    setBusy(true);
    setProgress({ done: 0, total: 0, current: "Dosyalar açılıyor…" });
    try {
      await yieldForProgressPaint();
      const next = await scanPassportImages(files, setProgress);
      revokePassportScanPreviews(rows);
      setRows(next);
      const ok = next.filter((row) => row.status === "ok").length;
      const weak = next.filter((row) => row.status === "weak").length;
      const failed = next.filter((row) => row.status === "failed").length;
      if (ok + weak === 0) {
        notify("MRZ okunamadı. Fotoğrafları net çekip tekrar deneyin veya alanları elle doldurun.", "error");
      } else {
        notify(
          `${ok} net · ${weak} kontrol gerekli · ${failed} okunamadı`,
          failed && !ok ? "error" : "ok",
        );
      }
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : "Pasaportlar okunamadı.", "error");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  function onPick(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    void runScan(files);
  }

  function onDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragging(false);
    void runScan(Array.from(event.dataTransfer.files ?? []));
  }

  function patchRow(id: string, patch: Partial<PassportScanRow>) {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }

  function removeRow(id: string) {
    setRows((current) => {
      const target = current.find((row) => row.id === id);
      if (target) revokePassportScanPreviews([target]);
      return current.filter((row) => row.id !== id);
    });
  }

  async function downloadExcel() {
    if (!readyCount) {
      notify("Her satırda ad, soyad, pasaport no, ülke kodu (2), doğum, bitiş ve doküman tipi olmalı.", "error");
      return;
    }
    const payload = rows
      .filter(rowReady)
      .map((row) => ({
        firstName: row.firstName.trim(),
        lastName: row.lastName.trim(),
        birthDate: row.birthDate.trim(),
        countryCode2: row.countryCode2.trim().toUpperCase(),
        passportExpiry: row.expiryDate.trim(),
        passportNo: row.passportNo.trim(),
        sex: row.sex.trim(),
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
          <h1>Pasaport JPG → Excel</h1>
          <p>
            Toplu pasaport / kimlik fotoğraflarını bırakın. Kritik alanlar doldurulur;
            Excel şablonunun tüm başlıkları (vize, araç, GSM, TC dahil) birebir korunur —
            kullanılmayan kolonlar boş bırakılır.
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
        <strong>{busy ? "Okunuyor…" : "Pasaport JPG, PDF veya ZIP"}</strong>
        <span>Biyometrik sayfa · alttaki iki MRZ satırı net görünsün · toplu seçim veya ZIP bırakın</span>
        <em>İşlem cihazda yapılır; pasaport sayfaları sunucuya gönderilmez</em>
        <input
          type="file"
          accept={`${IMAGE_ACCEPT},.pdf,application/pdf,.zip,application/zip`}
          multiple
          aria-label="Pasaport dosyaları seç"
          disabled={busy}
          onChange={onPick}
        />
      </label>

      {progress && (
        <p className="xb-passport-progress" aria-live="polite">
          {progress.total > 0 ? `${progress.done}/${progress.total}` : ""}
          {progress.current ? `${progress.total > 0 ? " · " : ""}${progress.current}` : ""}
        </p>
      )}

      {rows.length === 0 && !busy ? (
        <EmptyState
          title="Henüz tarama yok"
          body="Pasaport biodata sayfalarını sürükleyip bırakın. Okunan satırları kontrol edip Excel indirin."
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
                <button type="button" onClick={onOpenImport}>
                  Liste yükleme ekranı
                </button>
              ) : null}
            </div>
          </div>

          <ul className="xb-passport-rows">
            {rows.map((row) => (
              <li key={row.id} data-status={row.status}>
                <div className="xb-passport-thumb">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={row.previewUrl} alt={row.filename} />
                  <span>{row.status === "ok" ? "Net" : row.status === "weak" ? "Kontrol" : "Elle"}</span>
                </div>
                <div className="xb-passport-fields">
                  <label>
                    <span>Yolcu Adı</span>
                    <input
                      value={row.firstName}
                      onChange={(event) => patchRow(row.id, { firstName: event.target.value })}
                      autoCapitalize="characters"
                    />
                  </label>
                  <label>
                    <span>Yolcu Soyadı</span>
                    <input
                      value={row.lastName}
                      onChange={(event) => patchRow(row.id, { lastName: event.target.value })}
                      autoCapitalize="characters"
                    />
                  </label>
                  <label>
                    <span>Pasaport No</span>
                    <input
                      value={row.passportNo}
                      onChange={(event) => patchRow(row.id, {
                        passportNo: event.target.value.toLocaleUpperCase("tr-TR"),
                      })}
                      autoCapitalize="characters"
                      autoCorrect="off"
                    />
                  </label>
                  <label>
                    <span>Ülke Kodu 2</span>
                    <input
                      value={row.countryCode2}
                      maxLength={2}
                      onChange={(event) => patchRow(row.id, {
                        countryCode2: event.target.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 2),
                      })}
                      autoCapitalize="characters"
                      autoCorrect="off"
                      spellCheck={false}
                    />
                  </label>
                  <label>
                    <span>Doğum Tarihi</span>
                    <input
                      type="date"
                      value={row.birthDate}
                      onChange={(event) => patchRow(row.id, { birthDate: event.target.value })}
                    />
                  </label>
                  <label>
                    <span>Pasaport Bitiş Tar.</span>
                    <input
                      type="date"
                      value={row.expiryDate}
                      onChange={(event) => patchRow(row.id, { expiryDate: event.target.value })}
                    />
                  </label>
                  <label>
                    <span>Doküman Tipi</span>
                    <select
                      value={row.documentType}
                      onChange={(event) => patchRow(row.id, {
                        documentType: event.target.value as PassportDocumentType,
                      })}
                    >
                      {DOCUMENT_TYPES.map((type) => (
                        <option key={type} value={type}>{type}</option>
                      ))}
                    </select>
                  </label>
                  <p className="xb-passport-meta">
                    {row.filename}
                    {row.warnings[0] ? ` · ${row.warnings[0]}` : ""}
                  </p>
                  {row.status !== "ok" && (row.mrzCropUrl || row.rawLines?.some(Boolean)) ? (
                    <details className="xb-passport-debug">
                      <summary>MRZ ayrıntısı</summary>
                      <div>
                        {row.mrzCropUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={row.mrzCropUrl} alt={`${row.filename} MRZ kırpımı`} />
                        ) : null}
                        {row.rawLines?.some(Boolean) ? (
                          <code>{row.rawLines.filter(Boolean).join("\n")}</code>
                        ) : null}
                      </div>
                    </details>
                  ) : null}
                </div>
                <button type="button" className="danger" onClick={() => removeRow(row.id)} aria-label="Satırı sil">
                  Sil
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
