"use client";

import { ChangeEvent, DragEvent, useMemo, useState } from "react";

import { EmptyState } from "@/components/ui/EmptyState";
import { saveBlob } from "@/lib/offline/exporter";
import { icaoCountryToIso2 } from "@/lib/passport/icaoCountries";
import { createPassportOperatorXlsxBlob } from "@/lib/passport/operatorExcel";
import {
  DOCUMENT_TYPES,
  rowsFromMrzText,
  type PassportDocumentType,
  type PassportScanRow,
} from "@/lib/passport/parseMrzText";
import { extractTextFromPdf } from "@/lib/passport/pdfExtractText";
import { useStore } from "@/lib/store";

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
    && icaoCountryToIso2(row.countryCode2).length === 2
    && row.birthDate.trim()
    && row.expiryDate.trim()
    && row.documentType,
  );
}

function isPdf(file: File): boolean {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

function isText(file: File): boolean {
  return file.type === "text/plain" || file.name.toLowerCase().endsWith(".txt");
}

export function PassportScanTab({ onOpenImport }: PassportScanTabProps) {
  const { notify } = useStore();
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [mrzText, setMrzText] = useState("");
  const [progress, setProgress] = useState("");
  const [rows, setRows] = useState<PassportScanRow[]>([]);
  const readyCount = useMemo(() => rows.filter(rowReady).length, [rows]);

  function applyText(text: string, sourceLabel: string): PassportScanRow[] {
    const next = rowsFromMrzText(text, sourceLabel);
    if (!next.length) {
      notify("İki adet 44 karakterlik TD3 MRZ satırı bulunamadı. Metni yeniden kopyalayıp yapıştırın.", "error");
      return [];
    }
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
    const unsupported = files.find((file) => !isPdf(file) && !isText(file));
    if (unsupported) {
      notify("JPG ve görseller okunmaz. iPhone Live Text ile MRZ’yi kopyalayıp yukarıya yapıştırın.", "error");
      return;
    }

    setBusy(true);
    setProgress("Metin katmanı okunuyor…");
    try {
      const extracted: string[] = [];
      const nextRows: PassportScanRow[] = [];
      for (const file of files) {
        setProgress(`${file.name} · metin katmanı okunuyor…`);
        const text = isPdf(file) ? await extractTextFromPdf(file) : await file.text();
        extracted.push(text);
        nextRows.push(...rowsFromMrzText(text, file.name));
      }
      setMrzText(extracted.filter(Boolean).join("\n\n"));
      if (!nextRows.length) {
        notify(
          "PDF’de seçilebilir MRZ metni bulunamadı. Fotoğrafta Live Text ile MRZ’yi kopyalayıp yapıştırın.",
          "error",
        );
        return;
      }
      setRows(nextRows);
      const verified = nextRows.filter((row) => row.status === "ok").length;
      notify(`${verified} doğrulandı · ${nextRows.length - verified} kontrol gerekli`, "ok");
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : "PDF metni okunamadı.", "error");
    } finally {
      setBusy(false);
      setProgress("");
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
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }

  function removeRow(id: string) {
    setRows((current) => current.filter((row) => row.id !== id));
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
        countryCode2: icaoCountryToIso2(row.countryCode2),
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
          <h1>Pasaport MRZ → Excel</h1>
          <p>
            Pasaportun altındaki iki MRZ satırını yapıştırın veya metin katmanlı PDF seçin.
            Doğrulanan alanları kontrol edip Gate Visa Excel’ini indirin.
          </p>
        </div>
      </section>

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
        <button type="button" className="primary" disabled={busy || !mrzText.trim()} onClick={processPaste}>
          Satırları işle
        </button>
        <p className="xb-mrz-help">
          OCR yoktur. Metin ve PDF metin katmanı yalnızca bu cihazda işlenir; pasaport verisi sunucuya gönderilmez.
        </p>
      </section>

      <label
        className={`xb-photo-drop${dragging ? " dragging" : ""}${busy ? " busy" : ""}`}
        onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
        onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <strong>{busy ? "Metin okunuyor…" : "Metin katmanlı PDF veya TXT"}</strong>
        <span>PDF taranmış görüntü ise Live Text ile kopyalayıp yukarıya yapıştırın</span>
        <em>En fazla 30 PDF sayfası · işlem cihazda</em>
        <input
          type="file"
          accept=".pdf,application/pdf,.txt,text/plain"
          multiple
          aria-label="Pasaport PDF veya metin dosyaları seç"
          disabled={busy}
          onChange={onPick}
        />
      </label>

      {progress ? <p className="xb-passport-progress" aria-live="polite">{progress}</p> : null}

      {rows.length === 0 && !busy ? (
        <EmptyState
          title="Henüz MRZ işlenmedi"
          body="İki MRZ satırını yapıştırın veya seçilebilir metin içeren PDF yükleyin."
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
                  {row.status !== "ok" ? (
                    <details className="xb-passport-debug">
                      <summary>MRZ ayrıntısı</summary>
                      <div><code>{`${row.mrzLine1}\n${row.mrzLine2}`}</code></div>
                    </details>
                  ) : null}
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
