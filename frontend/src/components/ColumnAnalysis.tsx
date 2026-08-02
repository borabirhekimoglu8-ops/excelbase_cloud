"use client";

import { useMemo, useState } from "react";

import { formatSalesNumber } from "@/lib/sales";
import { HoloBars, HoloDonut } from "@/components/charts/Holo";
import {
  type ColumnTable,
  type SalesFilter,
  categoryBreakdown,
  categoryColumnIndexes,
  columnSummaries,
  distinctValues,
  emptySalesFilter,
  numericColumnIndexes,
} from "@/lib/salesAnalysis";

/** Beyond this the filter bar is collapsed behind a toggle by default. */
const ALWAYS_VISIBLE_FILTERS = 4;

function numberOrUndefined(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : undefined;
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
 * A statistics card for every column, plus a breakdown the operator picks.
 *
 * Showing only the numeric columns left most of a spreadsheet unaccounted for;
 * every header now reports at least how full it is and what its commonest
 * values are.
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

  const categories = useMemo(() => categoryColumnIndexes(table), [table]);
  const numerics = useMemo(() => numericColumnIndexes(table), [table]);
  const summaries = useMemo(() => columnSummaries(table, rows), [table, rows]);

  const activeGroup = groupIndex ?? categories[0] ?? null;
  const activeValue = valueIndex ?? numerics[0] ?? null;
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

  return (
    <div className="ic-stats">
      <p className="ic-stats-scope">
        {narrowed
          ? `Filtreye uyan ${rows.length} satır üzerinden hesaplandı.`
          : `${rows.length} satırın tamamı üzerinden hesaplandı.`}
      </p>

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
                  <option key={index} value={index}>{table.headers[index]}</option>
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
                  <option key={index} value={index}>{table.headers[index]}</option>
                ))}
              </select>
            </label>
          </div>

          <HoloDonut
            slices={donutSlices}
            total={donutTotal}
            centreLabel={activeValue !== null ? table.headers[activeValue] ?? "Toplam" : "Satır"}
            centreValue={formatSalesNumber(donutTotal)}
          />

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
                <div className="ic-stats-bar" aria-hidden="true">
                  <i style={{ width: `${Math.max(2, entry.share)}%` }} />
                </div>
                <b>%{entry.share.toLocaleString("tr-TR")}</b>
              </li>
            ))}
          </ul>
        </div>
      )}

      {summaries.map((summary) => (
        <div className="ic-stats-card" key={summary.index}>
          <h4>
            {summary.column}
            <em>
              {summary.kind === "numeric" ? "sayısal" : summary.kind === "category" ? "kategori" : "metin"}
            </em>
          </h4>

          {summary.numeric ? (
            <>
              <div className="ic-stats-grid">
                <div><span>TOPLAM</span><strong>{formatSalesNumber(summary.numeric.sum)}</strong></div>
                <div><span>ORTALAMA</span><strong>{formatSalesNumber(summary.numeric.average)}</strong></div>
                <div><span>ORTANCA</span><strong>{formatSalesNumber(summary.numeric.median)}</strong></div>
                <div><span>EN DÜŞÜK</span><strong>{formatSalesNumber(summary.numeric.min)}</strong></div>
                <div><span>EN YÜKSEK</span><strong>{formatSalesNumber(summary.numeric.max)}</strong></div>
                <div><span>ALT ÇEYREK</span><strong>{formatSalesNumber(summary.numeric.p25)}</strong></div>
                <div><span>ÜST ÇEYREK</span><strong>{formatSalesNumber(summary.numeric.p75)}</strong></div>
                <div><span>SAPMA</span><strong>{formatSalesNumber(summary.numeric.stdDev)}</strong></div>
                <div><span>DOLU</span><strong>{summary.filled}</strong></div>
                <div><span>BOŞ</span><strong>{summary.empty}</strong></div>
              </div>
              {/* Where the rows actually fall. The five-number summary above is
                  exact; this says whether the column is bunched or spread. */}
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
                <div><span>FARKLI DEĞER</span><strong>{summary.distinct}</strong></div>
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
      ))}

      {summaries.length === 0 && <p className="ic-sales-more">Gösterilecek sütun yok.</p>}
    </div>
  );
}

export { emptySalesFilter };
