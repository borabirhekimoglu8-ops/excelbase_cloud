"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  type SalesSheet,
  parseSalesWorkbook,
  salesSheetLabel,
} from "@/lib/sales";
import {
  type SalesFilter,
  type SortState,
  emptySalesFilter,
  filterSalesRows,
  sortRows,
} from "@/lib/salesAnalysis";
import { createColumnTableXlsxBlob, filteredExportName } from "@/lib/salesExport";
import { saveBlob } from "@/lib/offline/exporter";
import { ColumnFilterBar, ColumnStatsView } from "@/components/ColumnAnalysis";
import {
  listPassengerRosterSheets,
  removePassengerRosterSheet,
  savePassengerRosterSheet,
} from "@/lib/offline/passengerListStore";
import { transferRosterRowsToGate } from "@/lib/passengerRosterTransfer";
import { useStore } from "@/lib/store";

/** How many rows are drawn before the rest are left to the row counter. */
const VISIBLE_ROWS = 200;

type View = "list" | "stats";

export function PassengerRosterTab() {
  const { notify, bump } = useStore();
  const [sheets, setSheets] = useState<SalesSheet[]>([]);
  const [openId, setOpenId] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [view, setView] = useState<View>("list");
  const [filter, setFilter] = useState<SalesFilter>(emptySalesFilter);
  const [sort, setSort] = useState<SortState>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [transferring, setTransferring] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let active = true;
    listPassengerRosterSheets()
      .then((stored) => {
        if (!active) return;
        setSheets(stored);
        setOpenId((current) => current || stored[0]?.id || "");
      })
      .catch(() => active && setError("Yolcu listeleri açılamadı."))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, []);

  const onFile = useCallback(async (file: File) => {
    setBusy(true);
    setError("");
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const sheet = parseSalesWorkbook(bytes, file.name);
      const next = await savePassengerRosterSheet(sheet);
      setSheets(next);
      setOpenId(sheet.id);
      notify(`${sheet.rows.length} yolcu satırı alındı.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Dosya alınamadı.");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }, [notify]);

  const onRemove = useCallback(async (sheet: SalesSheet) => {
    if (!window.confirm(`"${sheet.filename}" listesi silinsin mi? Bu, daha önce kapıya aktarılmış yolcuları etkilemez.`)) return;
    const next = await removePassengerRosterSheet(sheet.id);
    setSheets(next);
    setOpenId((current) => (current === sheet.id ? next[0]?.id ?? "" : current));
  }, []);

  const open = sheets.find((sheet) => sheet.id === openId) ?? sheets[0] ?? null;

  // A row's position in this map is the index the transfer and the selection
  // set both key on. Built once per sheet rather than looked up by value,
  // since two passengers can share every visible cell.
  const rowIndex = useMemo(() => {
    const map = new Map<string[], number>();
    open?.rows.forEach((row, index) => map.set(row, index));
    return map;
  }, [open]);

  // A filter or selection written against one file means nothing against the
  // next, and a stale column index would silently filter on the wrong column.
  useEffect(() => {
    setFilter(emptySalesFilter());
    setSort(null);
    setSelected(new Set());
  }, [open?.id]);

  const rows = useMemo(
    () => (open ? sortRows(open, filterSalesRows(open, filter), sort) : []),
    [open, filter, sort],
  );
  const filtered = open ? rows.length !== open.rows.length : false;

  function toggleSort(index: number) {
    setSort((current) => {
      if (!current || current.index !== index) return { index, direction: "asc" };
      if (current.direction === "asc") return { index, direction: "desc" };
      return null;
    });
  }

  function toggleRow(row: string[]) {
    const index = rowIndex.get(row);
    if (index === undefined) return;
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  function selectAllFiltered() {
    setSelected(new Set(rows.map((row) => rowIndex.get(row)).filter((value): value is number => value !== undefined)));
  }

  const exportRows = useCallback(async () => {
    if (!open) return;
    try {
      const blob = createColumnTableXlsxBlob(open, rows, "Filtreli");
      await saveBlob(blob, filteredExportName(open.filename));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Dosya indirilemedi.");
    }
  }, [open, rows]);

  const transferSelected = useCallback(async () => {
    if (!open || selected.size === 0) return;
    setTransferring(true);
    try {
      const selectedRows = open.rows.filter((_row, index) => selected.has(index));
      const result = await transferRosterRowsToGate(open, selectedRows, open.filename);
      const parts = [`${result.imported} yolcu kapıya aktarıldı`];
      if (result.duplicates) parts.push(`${result.duplicates} zaten kapıda vardı`);
      if (result.invalid) parts.push(`${result.invalid} kayıt eksik alanla aktarıldı`);
      notify(parts.join(", ") + ".", result.invalid ? "warn" : "ok");
      setSelected(new Set());
      bump();
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : "Yolcular kapıya aktarılamadı.", "error");
    } finally {
      setTransferring(false);
    }
  }, [open, selected, notify, bump]);

  return (
    <div className="ic-sales-page ic-roster-page">
      <section className="ic-sales-hero">
        <div>
          <p>YOLCU LİSTELERİM</p>
          <h2>Bütün yolcu listelerinizi buraya yükleyin</h2>
          <span>
            Dosya bu cihazın şifreli kasasında saklanır, sunucuya gönderilmez.
            Uyruk, yaş, gidiş/dönüş tarihi gibi sütunlarınız otomatik olarak
            filtreye ve istatistiğe dönüşür — sabit bir şablon gerekmez.
            İçlerinden kapı vizesi hazırlanacakları seçip <strong>KAPIYA AKTAR</strong>ın.
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
      {loading && <div className="ic-records-loading">Yolcu listeleri açılıyor…</div>}

      {!loading && sheets.length === 0 && !error && (
        <div className="ic-records-empty">
          <span className="ic-records-empty-mark">+</span>
          <h3>Henüz yolcu listesi yok</h3>
          <p>Yukarıdaki düğmeden bir Excel veya CSV dosyası yükleyin.</p>
        </div>
      )}

      {sheets.length > 1 && (
        <div className="ic-sales-tabs" role="tablist" aria-label="Yüklenen yolcu listeleri">
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
                {filtered ? `${rows.length} / ${open.rows.length}` : `${open.rows.length}`} yolcu
                {" · "}{open.headers.length} sütun
              </span>
            </div>
            <div className="ic-sales-sheet-actions">
              <button
                type="button"
                onClick={() => void exportRows()}
                disabled={rows.length === 0}
                title="Ekranda görünen satırları Excel olarak indir"
              >
                {filtered ? "FİLTRELİYİ İNDİR" : "EXCEL İNDİR"}
              </button>
              <button type="button" className="danger" onClick={() => void onRemove(open)}>SİL</button>
            </div>
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
          <ColumnFilterBar
            table={open}
            filter={filter}
            onChange={setFilter}
            onReset={() => setFilter(emptySalesFilter())}
            narrowed={filtered}
            searchLabel="Yolcu listesinde ara…"
          />

          {view === "list" ? (
            <>
              <div className="ic-roster-transfer-bar">
                <div className="ic-roster-transfer-copy">
                  <strong>{selected.size} yolcu seçili</strong>
                  <span>Seçilenler kapıdaki çalışma listesine aktarılır; bu liste değişmez.</span>
                </div>
                <div className="ic-roster-transfer-actions">
                  <button type="button" onClick={selectAllFiltered} disabled={rows.length === 0}>
                    {filtered ? `Filtrelenen ${rows.length} satırı seç` : "Tümünü seç"}
                  </button>
                  {selected.size > 0 && (
                    <button type="button" onClick={() => setSelected(new Set())}>
                      Seçimi temizle
                    </button>
                  )}
                  <button
                    type="button"
                    className="primary"
                    onClick={() => void transferSelected()}
                    disabled={selected.size === 0 || transferring}
                  >
                    {transferring ? "AKTARILIYOR…" : `KAPIYA AKTAR · ${selected.size}`}
                  </button>
                </div>
              </div>

              <div className="ic-sales-table-wrap">
                <table className="ic-sales-table">
                  <thead>
                    <tr>
                      <th className="ic-roster-select-col" aria-label="Seç" />
                      {open.headers.map((header, index) => (
                        <th key={header}>
                          <button
                            type="button"
                            className="ic-sales-sort"
                            onClick={() => toggleSort(index)}
                            aria-label={`${header} sütununa göre sırala`}
                          >
                            {header}
                            <i aria-hidden="true">
                              {sort?.index === index ? (sort.direction === "asc" ? "▲" : "▼") : "↕"}
                            </i>
                          </button>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, VISIBLE_ROWS).map((row, rowPosition) => {
                      const index = rowIndex.get(row);
                      const isSelected = index !== undefined && selected.has(index);
                      return (
                        <tr key={`${open.id}-${rowPosition}`} className={isSelected ? "selected" : ""}>
                          <td className="ic-roster-select-col">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleRow(row)}
                              aria-label={`${row[0] || `Satır ${rowPosition + 1}`} seç`}
                            />
                          </td>
                          {open.headers.map((header, cellIndex) => (
                            <td key={`${header}-${cellIndex}`}>{row[cellIndex] ?? ""}</td>
                          ))}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {rows.length === 0 && (
                <p className="ic-sales-more">Filtreye uyan satır yok.</p>
              )}
              {rows.length > VISIBLE_ROWS && (
                <p className="ic-sales-more">
                  {`İlk ${VISIBLE_ROWS} satır gösteriliyor; filtreye uyan ${rows.length} satır var. Seçim tüm satırlar için "Tümünü seç" ile yapılabilir.`}
                </p>
              )}
            </>
          ) : (
            <ColumnStatsView table={open} rows={rows} narrowed={filtered} />
          )}
        </section>
      )}
    </div>
  );
}
