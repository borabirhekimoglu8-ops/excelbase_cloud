"use client";

import { ChangeEvent, DragEvent, useEffect, useMemo, useState } from "react";

import { IMAGE_ACCEPT } from "@/lib/imageFormat";
import { saveBlob } from "@/lib/offline/exporter";
import {
  createPassportOperatorXlsxBlob,
  nationalityToCountryCode2,
} from "@/lib/passport/operatorExcel";
import {
  revokePassportScanPreviews,
  scanPassportImages,
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

export function PassportScanTab({ onOpenImport }: PassportScanTabProps) {
  const { notify } = useStore();
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState<PassportScanProgress | null>(null);
  const [rows, setRows] = useState<PassportScanRow[]>([]);
  const [visaStart, setVisaStart] = useState("");
  const [visaEnd, setVisaEnd] = useState("");

  useEffect(() => () => {
    revokePassportScanPreviews(rows);
  }, [rows]);

  const readyCount = useMemo(
    () => rows.filter((row) => row.passportNo.trim() && row.lastName.trim()).length,
    [rows],
  );

  async function runScan(files: File[]) {
    if (!files.length) return;
    setBusy(true);
    setProgress({ done: 0, total: files.length, current: "Hazırlanıyor…" });
    try {
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
      notify("En az bir satırda soyad ve pasaport no olmalı.", "error");
      return;
    }
    const payload = rows
      .filter((row) => row.passportNo.trim() && row.lastName.trim())
      .map((row) => ({
        firstName: row.firstName.trim(),
        lastName: row.lastName.trim(),
        birthDate: row.birthDate.trim(),
        countryCode2: nationalityToCountryCode2(row.nationality),
        passportExpiry: row.expiryDate.trim(),
        visaStart,
        visaEnd,
        passportNo: row.passportNo.trim(),
        sex: row.sex.trim(),
        documentType: "Pasaport",
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
            Toplu pasaport fotoğraflarını bırakın. MRZ’den ad, soyad, doğum, ülke, pasaport no,
            bitiş ve cinsiyet okunur; ajans Excel şablonunuz birebir üretilir.
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
        <strong>{busy ? "Okunuyor…" : "Pasaport JPG veya ZIP bırakın"}</strong>
        <span>Biyometrik sayfa · alttaki iki MRZ satırı net görünsün · toplu seçim veya ZIP</span>
        <em>İşlem cihazda yapılır; fotoğraflar sunucuya gönderilmez</em>
        <input
          type="file"
          accept={`${IMAGE_ACCEPT},.zip,application/zip`}
          multiple
          aria-label="Pasaport fotoğrafları seç"
          disabled={busy}
          onChange={onPick}
        />
      </label>

      {progress && (
        <p className="xb-passport-progress" aria-live="polite">
          {progress.done}/{progress.total}
          {progress.current ? ` · ${progress.current}` : ""}
        </p>
      )}

      {rows.length === 0 && !busy ? (
        <EmptyState
          title="Henüz tarama yok"
          body="Pasaport biodata sayfalarını sürükleyip bırakın. Okunan satırları kontrol edip Excel indirin."
        />
      ) : null}

      {rows.length > 0 && (
        <>
          <section className="ops-module-card xb-passport-dates">
            <div className="ops-section-heading">
              <div>
                <p className="ops-eyebrow">Vize</p>
                <h2>Vize tarihlerini tüm satırlara uygula</h2>
              </div>
            </div>
            <div className="xb-passport-date-grid">
              <label>
                <span>Vize Başlangıç Tar.</span>
                <input type="date" value={visaStart} onChange={(event) => setVisaStart(event.target.value)} />
              </label>
              <label>
                <span>Vize Bitiş Tar.</span>
                <input type="date" value={visaEnd} onChange={(event) => setVisaEnd(event.target.value)} />
              </label>
            </div>
          </section>

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
                    <p className="xb-passport-meta">
                      {row.filename}
                      {row.nationality ? ` · ${nationalityToCountryCode2(row.nationality)}` : ""}
                      {row.birthDate ? ` · doğum ${row.birthDate}` : ""}
                      {row.expiryDate ? ` · bitiş ${row.expiryDate}` : ""}
                      {row.sex ? ` · ${row.sex}` : ""}
                      {row.warnings[0] ? ` · ${row.warnings[0]}` : ""}
                    </p>
                  </div>
                  <button type="button" className="danger" onClick={() => removeRow(row.id)} aria-label="Satırı sil">
                    Sil
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
