"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  type SalesSheet,
  formatSalesNumber,
  parseSalesWorkbook,
  salesColumnTotals,
  salesSheetLabel,
} from "@/lib/sales";
import {
  listSalesSheets,
  removeSalesSheet,
  saveSalesSheet,
} from "@/lib/offline/salesStore";
import { useStore } from "@/lib/store";

/** How many rows are drawn before the rest are left to the row counter. */
const VISIBLE_ROWS = 200;

export function SalesTab() {
  const { notify } = useStore();
  const [sheets, setSheets] = useState<SalesSheet[]>([]);
  const [openId, setOpenId] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let active = true;
    listSalesSheets()
      .then((stored) => {
        if (!active) return;
        setSheets(stored);
        setOpenId((current) => current || stored[0]?.id || "");
      })
      .catch(() => active && setError("Satış verileri açılamadı."))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, []);

  const onFile = useCallback(async (file: File) => {
    setBusy(true);
    setError("");
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const sheet = parseSalesWorkbook(bytes, file.name);
      const next = await saveSalesSheet(sheet);
      setSheets(next);
      setOpenId(sheet.id);
      notify(
        sheet.truncated > 0
          ? `${sheet.rows.length} satır alındı, ${sheet.truncated} satır sığmadı.`
          : `${sheet.rows.length} satır alındı.`,
        sheet.truncated > 0 ? "warn" : "ok",
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Dosya alınamadı.");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }, [notify]);

  const onRemove = useCallback(async (sheet: SalesSheet) => {
    if (!window.confirm(`"${sheet.filename}" silinsin mi?`)) return;
    const next = await removeSalesSheet(sheet.id);
    setSheets(next);
    setOpenId((current) => (current === sheet.id ? next[0]?.id ?? "" : current));
  }, []);

  const open = sheets.find((sheet) => sheet.id === openId) ?? sheets[0] ?? null;
  const totals = open ? salesColumnTotals(open) : [];

  return (
    <div className="ic-sales-page">
      <section className="ic-sales-hero">
        <div>
          <p>SATIŞ VERİLERİ</p>
          <h2>Excel ile satış listesi yükleyin</h2>
          <span>
            Dosya bu cihazın şifreli kasasında saklanır, sunucuya gönderilmez.
            Sütunlar dosyanızdan okunur; sabit bir şablon gerekmez.
          </span>
        </div>
        <label className={`ic-sales-upload${busy ? " busy" : ""}`}>
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,.xls,.xlsm,.csv"
            disabled={busy}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void onFile(file);
            }}
          />
          <span>{busy ? "OKUNUYOR…" : "+ EXCEL YÜKLE"}</span>
        </label>
      </section>

      {error && <div className="ic-record-error" role="alert">{error}</div>}
      {loading && <div className="ic-records-loading">Satış verileri açılıyor…</div>}

      {!loading && sheets.length === 0 && !error && (
        <div className="ic-records-empty">
          <span className="ic-records-empty-mark">+</span>
          <h3>Henüz satış dosyası yok</h3>
          <p>Yukarıdaki düğmeden bir Excel veya CSV dosyası yükleyin.</p>
        </div>
      )}

      {sheets.length > 1 && (
        <div className="ic-sales-tabs" role="tablist" aria-label="Yüklenen satış dosyaları">
          {sheets.map((sheet) => (
            <button
              key={sheet.id}
              type="button"
              role="tab"
              aria-selected={sheet.id === open?.id}
              className={sheet.id === open?.id ? "active" : ""}
              onClick={() => setOpenId(sheet.id)}
            >
              {sheet.filename}
            </button>
          ))}
        </div>
      )}

      {open && (
        <section className="ic-sales-sheet">
          <header>
            <div>
              <strong>{salesSheetLabel(open)}</strong>
              <span>
                {open.rows.length} satır · {open.headers.length} sütun
                {open.truncated > 0 ? ` · ${open.truncated} satır sığmadı` : ""}
              </span>
            </div>
            <button type="button" onClick={() => void onRemove(open)}>SİL</button>
          </header>

          {totals.length > 0 && (
            <div className="ic-sales-totals">
              {totals.map((total) => (
                <div key={total.column}>
                  <span>{total.column}</span>
                  <strong>{formatSalesNumber(total.total)}</strong>
                </div>
              ))}
            </div>
          )}

          <div className="ic-sales-table-wrap">
            <table className="ic-sales-table">
              <thead>
                <tr>
                  {open.headers.map((header) => <th key={header}>{header}</th>)}
                </tr>
              </thead>
              <tbody>
                {open.rows.slice(0, VISIBLE_ROWS).map((row, rowIndex) => (
                  <tr key={`${open.id}-${rowIndex}`}>
                    {open.headers.map((header, cellIndex) => (
                      <td key={`${header}-${cellIndex}`}>{row[cellIndex] ?? ""}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {open.rows.length > VISIBLE_ROWS && (
            <p className="ic-sales-more">
              {`İlk ${VISIBLE_ROWS} satır gösteriliyor; dosyada ${open.rows.length} satır var.`}
            </p>
          )}
        </section>
      )}
    </div>
  );
}
