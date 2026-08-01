"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  type SalesSheet,
  formatSalesNumber,
  parseSalesWorkbook,
  salesSheetLabel,
} from "@/lib/sales";
import {
  type SalesFilter,
  categoryBreakdown,
  categoryColumnIndexes,
  distinctValues,
  emptySalesFilter,
  filterSalesRows,
  numericColumnIndexes,
  numericStats,
} from "@/lib/salesAnalysis";
import {
  listSalesSheets,
  removeSalesSheet,
  saveSalesSheet,
} from "@/lib/offline/salesStore";
import { useStore } from "@/lib/store";

/** How many rows are drawn before the rest are left to the row counter. */
const VISIBLE_ROWS = 200;

type View = "list" | "stats";

function numberOrUndefined(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function SalesTab() {
  const { notify } = useStore();
  const [sheets, setSheets] = useState<SalesSheet[]>([]);
  const [openId, setOpenId] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [view, setView] = useState<View>("list");
  const [filter, setFilter] = useState<SalesFilter>(emptySalesFilter);
  const [groupIndex, setGroupIndex] = useState<number | null>(null);
  const [valueIndex, setValueIndex] = useState<number | null>(null);
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

  // A filter written against one file means nothing against the next, and a
  // stale column index would silently filter on the wrong column.
  useEffect(() => {
    setFilter(emptySalesFilter());
    setGroupIndex(null);
    setValueIndex(null);
  }, [open?.id]);

  const categories = useMemo(() => (open ? categoryColumnIndexes(open) : []), [open]);
  const numerics = useMemo(() => (open ? numericColumnIndexes(open) : []), [open]);

  const activeGroup = groupIndex ?? categories[0] ?? null;
  const activeValue = valueIndex ?? numerics[0] ?? null;

  const rows = useMemo(
    () => (open ? filterSalesRows(open, filter) : []),
    [open, filter],
  );
  const stats = useMemo(() => (open ? numericStats(open, rows) : []), [open, rows]);
  const breakdown = useMemo(
    () => (open && activeGroup !== null ? categoryBreakdown(open, rows, activeGroup, activeValue) : null),
    [open, rows, activeGroup, activeValue],
  );

  const filtered = open ? rows.length !== open.rows.length : false;

  function setColumnValue(index: number, value: string) {
    setFilter((current) => ({
      ...current,
      columnValues: { ...current.columnValues, [index]: value },
    }));
  }

  function setRange(index: number, bound: "min" | "max", value: string) {
    setFilter((current) => ({
      ...current,
      numericRanges: {
        ...current.numericRanges,
        [index]: { ...current.numericRanges[index], [bound]: numberOrUndefined(value) },
      },
    }));
  }

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
                {filtered ? `${rows.length} / ${open.rows.length}` : `${open.rows.length}`} satır
                {" · "}{open.headers.length} sütun
                {open.truncated > 0 ? ` · ${open.truncated} satır sığmadı` : ""}
              </span>
            </div>
            <button type="button" onClick={() => void onRemove(open)}>SİL</button>
          </header>

          <div className="ic-subtabs" role="tablist" aria-label="Görünüm">
            <button
              type="button"
              role="tab"
              aria-selected={view === "list"}
              className={view === "list" ? "active" : ""}
              onClick={() => setView("list")}
            >
              LİSTE
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={view === "stats"}
              className={view === "stats" ? "active" : ""}
              onClick={() => setView("stats")}
            >
              İSTATİSTİK
            </button>
          </div>

          {/* Shared by both views on purpose: statistics that ignored the
              filter would answer a different question than the list shows. */}
          <div className="ic-filter-bar">
            <input
              type="search"
              value={filter.query}
              placeholder="Tüm sütunlarda ara…"
              aria-label="Satış satırlarında ara"
              onChange={(event) => setFilter((current) => ({ ...current, query: event.target.value }))}
            />
            {categories.slice(0, 3).map((index) => (
              <label key={`cat-${index}`}>
                <span>{open.headers[index]}</span>
                <select
                  value={filter.columnValues[index] ?? ""}
                  onChange={(event) => setColumnValue(index, event.target.value)}
                >
                  <option value="">Tümü</option>
                  {distinctValues(open, index).map((value) => (
                    <option key={value} value={value}>{value}</option>
                  ))}
                </select>
              </label>
            ))}
            {numerics.slice(0, 1).map((index) => (
              <label key={`num-${index}`} className="ic-filter-range">
                <span>{open.headers[index]}</span>
                <input
                  type="number"
                  inputMode="decimal"
                  placeholder="en az"
                  aria-label={`${open.headers[index]} en az`}
                  onChange={(event) => setRange(index, "min", event.target.value)}
                />
                <input
                  type="number"
                  inputMode="decimal"
                  placeholder="en çok"
                  aria-label={`${open.headers[index]} en çok`}
                  onChange={(event) => setRange(index, "max", event.target.value)}
                />
              </label>
            ))}
            {filtered && (
              <button type="button" className="ic-filter-reset" onClick={() => setFilter(emptySalesFilter())}>
                FİLTREYİ TEMİZLE
              </button>
            )}
          </div>

          {view === "list" ? (
            <>
              <div className="ic-sales-table-wrap">
                <table className="ic-sales-table">
                  <thead>
                    <tr>
                      {open.headers.map((header) => <th key={header}>{header}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, VISIBLE_ROWS).map((row, rowIndex) => (
                      <tr key={`${open.id}-${rowIndex}`}>
                        {open.headers.map((header, cellIndex) => (
                          <td key={`${header}-${cellIndex}`}>{row[cellIndex] ?? ""}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {rows.length === 0 && (
                <p className="ic-sales-more">Filtreye uyan satır yok.</p>
              )}
              {rows.length > VISIBLE_ROWS && (
                <p className="ic-sales-more">
                  {`İlk ${VISIBLE_ROWS} satır gösteriliyor; filtreye uyan ${rows.length} satır var.`}
                </p>
              )}
            </>
          ) : (
            <div className="ic-stats">
              <p className="ic-stats-scope">
                {filtered
                  ? `Filtreye uyan ${rows.length} satır üzerinden hesaplandı.`
                  : `${rows.length} satırın tamamı üzerinden hesaplandı.`}
              </p>

              {stats.length === 0 && (
                <p className="ic-sales-more">Bu dosyada sayısal sütun bulunamadı.</p>
              )}

              {stats.map((stat) => (
                <div className="ic-stats-card" key={stat.index}>
                  <h4>{stat.column}</h4>
                  <div className="ic-stats-grid">
                    <div><span>TOPLAM</span><strong>{formatSalesNumber(stat.sum)}</strong></div>
                    <div><span>ORTALAMA</span><strong>{formatSalesNumber(stat.average)}</strong></div>
                    <div><span>EN DÜŞÜK</span><strong>{formatSalesNumber(stat.min)}</strong></div>
                    <div><span>EN YÜKSEK</span><strong>{formatSalesNumber(stat.max)}</strong></div>
                    <div><span>DOLU SATIR</span><strong>{stat.count}</strong></div>
                  </div>
                </div>
              ))}

              {breakdown && categories.length > 0 && (
                <div className="ic-stats-card">
                  <div className="ic-stats-pickers">
                    <label>
                      <span>KIRILIM</span>
                      <select
                        value={activeGroup ?? ""}
                        onChange={(event) => setGroupIndex(Number(event.target.value))}
                      >
                        {categories.map((index) => (
                          <option key={index} value={index}>{open.headers[index]}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span>ÖLÇÜ</span>
                      <select
                        value={activeValue === null ? "" : activeValue}
                        onChange={(event) => setValueIndex(
                          event.target.value === "" ? null : Number(event.target.value),
                        )}
                      >
                        <option value="">Satır sayısı</option>
                        {numerics.map((index) => (
                          <option key={index} value={index}>{open.headers[index]}</option>
                        ))}
                      </select>
                    </label>
                  </div>

                  <ul className="ic-stats-breakdown">
                    {breakdown.entries.map((entry) => (
                      <li key={entry.value}>
                        <div>
                          <strong>{entry.value}</strong>
                          <span>
                            {activeValue !== null
                              ? `${formatSalesNumber(entry.sum)} · ${entry.count} satır`
                              : `${entry.count} satır`}
                          </span>
                        </div>
                        {/* The bar is the comparison; the percentage is the detail. */}
                        <div className="ic-stats-bar" aria-hidden="true">
                          <i style={{ width: `${Math.max(2, entry.share)}%` }} />
                        </div>
                        <b>%{entry.share.toLocaleString("tr-TR")}</b>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
