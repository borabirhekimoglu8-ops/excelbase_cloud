"use client";

import { useMemo, useState } from "react";

import { formatSalesNumber } from "@/lib/sales";
import { HoloBars, HoloDonut, HoloMultiTrend } from "@/components/charts/Holo";
import {
  type ColumnTable,
  type SalesFilter,
  type TimeGrain,
  categoryBreakdown,
  categoryColumnIndexes,
  columnSummaries,
  dateColumnIndexes,
  distinctValues,
  emptySalesFilter,
  numericColumnIndexes,
  timeSeries,
} from "@/lib/salesAnalysis";

/** Beyond this the filter bar is collapsed behind a toggle by default. */
const ALWAYS_VISIBLE_FILTERS = 4;

/**
 * "No column" as an explicit choice.
 *
 * `null` alone cannot express it: the pickers fall back to a sensible default
 * when nothing has been chosen, so a null from the "Satır sayısı" option was
 * immediately replaced by that default and the option did nothing.
 */
const NONE = -1;

/** "2026-07-01" and "2026-07" both read better as Turkish dates. */
function formatTimeKey(key: string): string {
  const parts = key.split("-").map(Number);
  const date = new Date(parts[0], (parts[1] || 1) - 1, parts[2] || 1);
  if (Number.isNaN(date.getTime())) return key;
  return new Intl.DateTimeFormat("tr-TR", parts.length > 2
    ? { day: "2-digit", month: "short" }
    : { month: "short", year: "numeric" }).format(date);
}

function numberOrUndefined(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function kindLabel(kind: string): string {
  if (kind === "numeric") return "sayısal";
  if (kind === "category") return "kategori";
  return "metin";
}

/**
 * A filter control for every column in the table.
 *
 * The control follows the column's discovered role -- a dropdown of its values
 * when they repeat, a numeric range when it holds numbers, plain text
 * otherwise -- so the filters are the file's own headers rather than a fixed
 * set someone guessed in advance.
 */
export function ColumnFilterBar({
  table,
  filter,
  onChange,
  onReset,
  narrowed,
  searchLabel = "Tüm sütunlarda ara…",
}: {
  table: ColumnTable;
  filter: SalesFilter;
  onChange: (next: SalesFilter) => void;
  onReset: () => void;
  narrowed: boolean;
  searchLabel?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const numerics = useMemo(() => new Set(numericColumnIndexes(table)), [table]);
  const categories = useMemo(() => new Set(categoryColumnIndexes(table)), [table]);

  const shown = expanded ? table.headers.length : ALWAYS_VISIBLE_FILTERS;
  const hidden = Math.max(0, table.headers.length - ALWAYS_VISIBLE_FILTERS);

  function setColumnValue(index: number, value: string) {
    onChange({ ...filter, columnValues: { ...filter.columnValues, [index]: value } });
  }

  function setRange(index: number, bound: "min" | "max", value: string) {
    onChange({
      ...filter,
      numericRanges: {
        ...filter.numericRanges,
        [index]: { ...filter.numericRanges[index], [bound]: numberOrUndefined(value) },
      },
    });
  }

  return (
    <div className="ic-filter-bar">
      <input
        type="search"
        value={filter.query}
        placeholder={searchLabel}
        aria-label={searchLabel}
        onChange={(event) => onChange({ ...filter, query: event.target.value })}
      />

      {table.headers.slice(0, shown).map((header, index) => {
        const label = header || `Sütun ${index + 1}`;
        if (numerics.has(index)) {
          return (
            <label key={`f-${index}`} className="ic-filter-range">
              <span>{label}</span>
              <input
                type="number"
                inputMode="decimal"
                placeholder="en az"
                aria-label={`${label} en az`}
                value={filter.numericRanges[index]?.min ?? ""}
                onChange={(event) => setRange(index, "min", event.target.value)}
              />
              <input
                type="number"
                inputMode="decimal"
                placeholder="en çok"
                aria-label={`${label} en çok`}
                value={filter.numericRanges[index]?.max ?? ""}
                onChange={(event) => setRange(index, "max", event.target.value)}
              />
            </label>
          );
        }
        if (categories.has(index)) {
          return (
            <label key={`f-${index}`}>
              <span>{label}</span>
              <select
                value={filter.columnValues[index] ?? ""}
                onChange={(event) => setColumnValue(index, event.target.value)}
              >
                <option value="">Tümü</option>
                {distinctValues(table, index).map((value) => (
                  <option key={value} value={value}>{value}</option>
                ))}
              </select>
            </label>
          );
        }
        // A free-text column still gets a box: an exact-value dropdown of a
        // hundred passport numbers would be unusable, but searching one is not.
        return (
          <label key={`f-${index}`}>
            <span>{label}</span>
            <input
              type="text"
              value={filter.columnQueries[index] ?? ""}
              placeholder="içerir…"
              aria-label={`${label} içinde ara`}
              onChange={(event) => onChange({
                ...filter,
                columnQueries: { ...filter.columnQueries, [index]: event.target.value },
              })}
            />
          </label>
        );
      })}

      {hidden > 0 && (
        <button type="button" className="ic-filter-reset" onClick={() => setExpanded((open) => !open)}>
          {expanded ? "AZ GÖSTER" : `+${hidden} SÜTUN`}
        </button>
      )}
      {narrowed && (
        <button type="button" className="ic-filter-reset" onClick={onReset}>
          FİLTREYİ TEMİZLE
        </button>
      )}
    </div>
  );
}

/**
 * Focused statistics: trend, one breakdown, then optional column details.
 *
 * Dumping a card per column made the page unreadable; the operator now sees
 * the answers first and opens a column only when they need its numbers.
 */
export function ColumnStatsView({
  table,
  rows,
  narrowed,
}: {
  table: ColumnTable;
  rows: string[][];
  narrowed: boolean;
}) {
  const [groupIndex, setGroupIndex] = useState<number | null>(null);
  const [valueIndex, setValueIndex] = useState<number | null>(null);
  const [dateIndex, setDateIndex] = useState<number | null>(null);
  const [seriesIndex, setSeriesIndex] = useState<number | null>(null);
  const [trendValue, setTrendValue] = useState<number | null>(null);
  const [grain, setGrain] = useState<TimeGrain>("day");
  const [openColumn, setOpenColumn] = useState<number | null>(null);
  const [showColumns, setShowColumns] = useState(false);

  const categories = useMemo(() => categoryColumnIndexes(table), [table]);
  const numerics = useMemo(() => numericColumnIndexes(table), [table]);
  const summaries = useMemo(() => columnSummaries(table, rows), [table, rows]);
  const dates = useMemo(() => dateColumnIndexes(table), [table]);

  const activeDate = dateIndex ?? dates[0] ?? null;
  // Defaults to the first grouping column so the chart opens on something
  // worth seeing -- one line per route -- rather than a single flat total.
  const activeSeries = seriesIndex === NONE ? null : seriesIndex ?? categories[0] ?? null;
  const activeTrendValue = trendValue === NONE ? null : trendValue ?? numerics[0] ?? null;
  const trend = useMemo(
    () => (activeDate === null
      ? { keys: [], series: [] }
      : timeSeries(table, rows, {
        dateIndex: activeDate,
        valueIndex: activeTrendValue,
        seriesIndex: activeSeries,
        grain,
      })),
    [table, rows, activeDate, activeTrendValue, activeSeries, grain],
  );

  const activeGroup = groupIndex ?? categories[0] ?? null;
  const activeValue = valueIndex === NONE ? null : valueIndex ?? numerics[0] ?? null;
  const breakdown = useMemo(
    () => (activeGroup !== null ? categoryBreakdown(table, rows, activeGroup, activeValue) : null),
    [table, rows, activeGroup, activeValue],
  );

  // A ring with forty hairline slices cannot be read or pointed at, so the
  // long tail is folded into one labelled slice instead of being drawn.
  const donutSlices = useMemo(() => {
    if (!breakdown) return [];
    const value = (entry: { sum: number; count: number }) =>
      activeValue !== null ? entry.sum : entry.count;
    const top = breakdown.entries.slice(0, 6).map((entry) => ({
      label: entry.value,
      value: value(entry),
    }));
    const rest = breakdown.entries.slice(6).reduce((total, entry) => total + value(entry), 0);
    return rest > 0 ? [...top, { label: "Diğer", value: rest }] : top;
  }, [breakdown, activeValue]);
  const donutTotal = useMemo(
    () => donutSlices.reduce((total, slice) => total + slice.value, 0),
    [donutSlices],
  );

  const filledShare = useMemo(() => {
    if (summaries.length === 0 || rows.length === 0) return 0;
    const totalCells = summaries.reduce((sum, item) => sum + item.filled + item.empty, 0);
    const filledCells = summaries.reduce((sum, item) => sum + item.filled, 0);
    return totalCells === 0 ? 0 : Math.round((filledCells / totalCells) * 100);
  }, [summaries, rows.length]);

  return (
    <div className="ic-stats">
      <p className="ic-stats-scope">
        {narrowed
          ? `Filtreye uyan ${rows.length} satır üzerinden hesaplandı.`
          : `${rows.length} satırın tamamı üzerinden hesaplandı.`}
      </p>

      <div className="ic-stats-hero" aria-label="Özet">
        <div><span>SATIR</span><strong>{rows.length}</strong></div>
        <div><span>SÜTUN</span><strong>{table.headers.length}</strong></div>
        <div><span>DOLULUK</span><strong>%{filledShare.toLocaleString("tr-TR")}</strong></div>
        <div><span>SAYISAL</span><strong>{numerics.length}</strong></div>
      </div>

      {dates.length > 0 && (
        <section className="ic-stats-section">
          <header className="ic-stats-section-head">
            <h4>Zaman içinde</h4>
            <span>{grain === "day" ? "Günlük" : "Aylık"}</span>
          </header>
          <div className="ic-stats-pickers">
            <label>
              <span>TARİH</span>
              <select
                value={activeDate ?? ""}
                onChange={(event) => setDateIndex(Number(event.target.value))}
              >
                {dates.map((index) => (
                  <option key={index} value={index}>{table.headers[index]}</option>
                ))}
              </select>
            </label>
            <label>
              <span>KIRILIM</span>
              <select
                value={activeSeries === null ? "" : activeSeries}
                onChange={(event) => setSeriesIndex(
                  event.target.value === "" ? NONE : Number(event.target.value),
                )}
              >
                <option value="">Tümü tek çizgi</option>
                {categories.map((index) => (
                  <option key={index} value={index}>{table.headers[index]}</option>
                ))}
              </select>
            </label>
            <label>
              <span>ÖLÇÜ</span>
              <select
                value={activeTrendValue === null ? "" : activeTrendValue}
                onChange={(event) => setTrendValue(
                  event.target.value === "" ? NONE : Number(event.target.value),
                )}
              >
                <option value="">Satış adedi</option>
                {numerics.map((index) => (
                  <option key={index} value={index}>{table.headers[index]}</option>
                ))}
              </select>
            </label>
            <label>
              <span>ARALIK</span>
              <select value={grain} onChange={(event) => setGrain(event.target.value as TimeGrain)}>
                <option value="day">Gün</option>
                <option value="month">Ay</option>
              </select>
            </label>
          </div>

          <HoloMultiTrend
            keys={trend.keys}
            series={trend.series}
            formatValue={formatSalesNumber}
            formatKey={formatTimeKey}
          />
        </section>
      )}

      {breakdown && categories.length > 0 && (
        <section className="ic-stats-section">
          <header className="ic-stats-section-head">
            <h4>Dağılım</h4>
            <span>
              {activeValue !== null
                ? table.headers[activeValue]
                : table.headers[activeGroup ?? 0]}
            </span>
          </header>
          <div className="ic-stats-pickers">
            <label>
              <span>KIRILIM</span>
              <select
                value={activeGroup ?? ""}
                onChange={(event) => setGroupIndex(Number(event.target.value))}
              >
                {categories.map((index) => (
                  <option key={index} value={index}>{table.headers[index]}</option>
                ))}
              </select>
            </label>
            <label>
              <span>ÖLÇÜ</span>
              <select
                value={activeValue === null ? "" : activeValue}
                onChange={(event) => setValueIndex(
                  event.target.value === "" ? NONE : Number(event.target.value),
                )}
              >
                <option value="">Satır sayısı</option>
                {numerics.map((index) => (
                  <option key={index} value={index}>{table.headers[index]}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="ic-stats-split">
            <HoloDonut
              slices={donutSlices}
              total={donutTotal}
              centreLabel={activeValue !== null ? table.headers[activeValue] ?? "Toplam" : "Satır"}
              centreValue={formatSalesNumber(donutTotal)}
            />

            <ul className="ic-stats-breakdown">
              {breakdown.entries.slice(0, 8).map((entry) => (
                <li key={entry.value}>
                  <div>
                    <strong>{entry.value}</strong>
                    <span>
                      {activeValue !== null
                        ? `${formatSalesNumber(entry.sum)} · ${entry.count} satır`
                        : `${entry.count} satır`}
                    </span>
                  </div>
                  <div className="ic-stats-bar" aria-hidden="true">
                    <i style={{ width: `${Math.max(2, entry.share)}%` }} />
                  </div>
                  <b>%{entry.share.toLocaleString("tr-TR")}</b>
                </li>
              ))}
            </ul>
          </div>
          {breakdown.entries.length > 8 && (
            <p className="ic-stats-more">
              {`İlk 8 değer gösteriliyor · ${breakdown.entries.length - 8} değer daha var.`}
            </p>
          )}
        </section>
      )}

      {summaries.length > 0 && (
        <section className="ic-stats-section">
          <header className="ic-stats-section-head">
            <h4>Sütun detayları</h4>
            <button
              type="button"
              className="ic-stats-toggle"
              onClick={() => setShowColumns((open) => !open)}
              aria-expanded={showColumns}
            >
              {showColumns ? "Gizle" : `${summaries.length} sütunu aç`}
            </button>
          </header>

          {showColumns && (
            <ul className="ic-stats-columns">
              {summaries.map((summary) => {
                const open = openColumn === summary.index;
                return (
                  <li key={summary.index} className={open ? "open" : ""}>
                    <button
                      type="button"
                      className="ic-stats-column-toggle"
                      aria-expanded={open}
                      onClick={() => setOpenColumn(open ? null : summary.index)}
                    >
                      <span>
                        <strong>{summary.column}</strong>
                        <em>{kindLabel(summary.kind)}</em>
                      </span>
                      <b>
                        {summary.numeric
                          ? formatSalesNumber(summary.numeric.sum)
                          : `${summary.distinct} değer`}
                      </b>
                    </button>

                    {open && (
                      <div className="ic-stats-column-body">
                        {summary.numeric ? (
                          <>
                            <div className="ic-stats-grid">
                              <div><span>TOPLAM</span><strong>{formatSalesNumber(summary.numeric.sum)}</strong></div>
                              <div><span>ORTALAMA</span><strong>{formatSalesNumber(summary.numeric.average)}</strong></div>
                              <div><span>EN DÜŞÜK</span><strong>{formatSalesNumber(summary.numeric.min)}</strong></div>
                              <div><span>EN YÜKSEK</span><strong>{formatSalesNumber(summary.numeric.max)}</strong></div>
                              <div><span>DOLU</span><strong>{summary.filled}</strong></div>
                              <div><span>BOŞ</span><strong>{summary.empty}</strong></div>
                            </div>
                            {summary.histogram.length > 0 && (
                              <HoloBars
                                entries={summary.histogram.map((bucket) => ({
                                  label: bucket.label,
                                  value: bucket.count,
                                }))}
                                formatValue={(value) => `${value}`}
                              />
                            )}
                          </>
                        ) : (
                          <>
                            <div className="ic-stats-grid">
                              <div><span>DOLU</span><strong>{summary.filled}</strong></div>
                              <div><span>BOŞ</span><strong>{summary.empty}</strong></div>
                              <div><span>FARKLI</span><strong>{summary.distinct}</strong></div>
                            </div>
                            {summary.top.length > 0 && (
                              <ul className="ic-stats-breakdown compact">
                                {summary.top.map((entry) => (
                                  <li key={entry.value}>
                                    <div><strong>{entry.value}</strong></div>
                                    <div className="ic-stats-bar" aria-hidden="true">
                                      <i style={{ width: `${Math.max(2, entry.share)}%` }} />
                                    </div>
                                    <b>{entry.count}</b>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      {summaries.length === 0 && <p className="ic-sales-more">Gösterilecek sütun yok.</p>}
    </div>
  );
}

export { emptySalesFilter };
