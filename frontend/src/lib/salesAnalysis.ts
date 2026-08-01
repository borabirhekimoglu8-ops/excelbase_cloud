/**
 * Filtering and summarising an imported sales sheet.
 *
 * Kept separate from the reader in `sales.ts` because it answers a different
 * question: not "what is in this file" but "what does it say". Everything here
 * is pure over an already-parsed sheet, so the numbers can be tested without a
 * browser, a vault or a file picker.
 *
 * The column roles are discovered, never declared. A sales export names its
 * columns differently every month, so anything that hard-coded "Tutar" would
 * work once and then quietly stop finding the money.
 */

import { parseSalesNumber, type SalesSheet } from "@/lib/sales";

/** Above this many distinct values a column is an identifier, not a category. */
export const MAX_CATEGORY_VALUES = 30;

export type SalesFilter = {
  /** Matched against every cell of a row. */
  query: string;
  /** Column index → exact value that must match. Absent or "" means any. */
  columnValues: Record<number, string>;
  /** Column index → inclusive numeric bounds. */
  numericRanges: Record<number, { min?: number; max?: number }>;
};

export type NumericColumnStats = {
  index: number;
  column: string;
  /** Cells that parsed as numbers; the rest are ignored rather than counted as 0. */
  count: number;
  sum: number;
  average: number;
  min: number;
  max: number;
};

export type CategoryEntry = {
  value: string;
  count: number;
  sum: number;
  /** Share of the total, 0..100. Of `sum` when a value column is given, else of `count`. */
  share: number;
};

export type CategoryBreakdown = {
  index: number;
  column: string;
  valueColumn: string;
  entries: CategoryEntry[];
};

export const emptySalesFilter = (): SalesFilter => ({
  query: "",
  columnValues: {},
  numericRanges: {},
});

function columnCells(sheet: SalesSheet, index: number): string[] {
  return sheet.rows.map((row) => row[index] ?? "");
}

/**
 * Columns whose filled cells are mostly numbers.
 *
 * Same majority rule the totals use: one stray year in a notes column must not
 * turn it into a money column.
 */
export function numericColumnIndexes(sheet: SalesSheet): number[] {
  return sheet.headers.flatMap((_header, index) => {
    let filled = 0;
    let numeric = 0;
    for (const cell of columnCells(sheet, index)) {
      if (!cell) continue;
      filled += 1;
      if (parseSalesNumber(cell) !== null) numeric += 1;
    }
    return filled > 0 && numeric * 2 > filled ? [index] : [];
  });
}

export function distinctValues(sheet: SalesSheet, index: number): string[] {
  const seen = new Set<string>();
  for (const cell of columnCells(sheet, index)) {
    if (cell) seen.add(cell);
    if (seen.size > MAX_CATEGORY_VALUES) break;
  }
  return [...seen].sort((a, b) => a.localeCompare(b, "tr"));
}

/**
 * Columns worth grouping by: repeated values, and not the money column.
 *
 * A column where every row differs (an invoice number, a passenger name) makes
 * a breakdown with one row per row, which tells the operator nothing.
 */
export function categoryColumnIndexes(sheet: SalesSheet): number[] {
  const numeric = new Set(numericColumnIndexes(sheet));
  return sheet.headers.flatMap((_header, index) => {
    if (numeric.has(index)) return [];
    const values = distinctValues(sheet, index);
    if (values.length === 0 || values.length > MAX_CATEGORY_VALUES) return [];
    // At least one value must repeat, otherwise it is an identifier column.
    const filled = columnCells(sheet, index).filter(Boolean).length;
    return values.length < filled ? [index] : [];
  });
}

export function filterSalesRows(sheet: SalesSheet, filter: SalesFilter): string[][] {
  const query = filter.query.trim().toLocaleLowerCase("tr");
  const valueEntries = Object.entries(filter.columnValues)
    .filter(([, value]) => value !== "")
    .map(([index, value]) => [Number(index), value] as const);
  const rangeEntries = Object.entries(filter.numericRanges)
    .map(([index, bounds]) => [Number(index), bounds] as const)
    .filter(([, bounds]) => bounds.min !== undefined || bounds.max !== undefined);

  return sheet.rows.filter((row) => {
    if (query && !row.some((cell) => cell.toLocaleLowerCase("tr").includes(query))) {
      return false;
    }
    for (const [index, value] of valueEntries) {
      if ((row[index] ?? "") !== value) return false;
    }
    for (const [index, bounds] of rangeEntries) {
      const parsed = parseSalesNumber(row[index] ?? "");
      // A row with nothing numeric there cannot satisfy a numeric bound.
      if (parsed === null) return false;
      if (bounds.min !== undefined && parsed < bounds.min) return false;
      if (bounds.max !== undefined && parsed > bounds.max) return false;
    }
    return true;
  });
}

export function numericStats(sheet: SalesSheet, rows: string[][]): NumericColumnStats[] {
  return numericColumnIndexes(sheet).flatMap((index) => {
    const values: number[] = [];
    for (const row of rows) {
      const parsed = parseSalesNumber(row[index] ?? "");
      if (parsed !== null) values.push(parsed);
    }
    if (values.length === 0) return [];
    const sum = values.reduce((total, value) => total + value, 0);
    const round = (value: number) => Math.round(value * 100) / 100;
    return [{
      index,
      column: sheet.headers[index] ?? `Sütun ${index + 1}`,
      count: values.length,
      sum: round(sum),
      average: round(sum / values.length),
      min: round(Math.min(...values)),
      max: round(Math.max(...values)),
    }];
  });
}

/**
 * Groups rows by one column, optionally summing another.
 *
 * Sorted by whichever number is being shown, so the largest lines are first --
 * a breakdown of forty agencies in alphabetical order buries the answer.
 */
export function categoryBreakdown(
  sheet: SalesSheet,
  rows: string[][],
  groupIndex: number,
  valueIndex: number | null,
): CategoryBreakdown {
  const buckets = new Map<string, { count: number; sum: number }>();
  for (const row of rows) {
    const key = (row[groupIndex] ?? "").trim() || "(boş)";
    const bucket = buckets.get(key) ?? { count: 0, sum: 0 };
    bucket.count += 1;
    if (valueIndex !== null) {
      const parsed = parseSalesNumber(row[valueIndex] ?? "");
      if (parsed !== null) bucket.sum += parsed;
    }
    buckets.set(key, bucket);
  }

  const entries = [...buckets.entries()].map(([value, bucket]) => ({
    value,
    count: bucket.count,
    sum: Math.round(bucket.sum * 100) / 100,
    share: 0,
  }));
  const total = valueIndex !== null
    ? entries.reduce((sum, entry) => sum + entry.sum, 0)
    : entries.reduce((sum, entry) => sum + entry.count, 0);
  for (const entry of entries) {
    const part = valueIndex !== null ? entry.sum : entry.count;
    entry.share = total === 0 ? 0 : Math.round((part / total) * 1000) / 10;
  }
  entries.sort((a, b) => (
    valueIndex !== null ? b.sum - a.sum || b.count - a.count : b.count - a.count
  ));

  return {
    index: groupIndex,
    column: sheet.headers[groupIndex] ?? `Sütun ${groupIndex + 1}`,
    valueColumn: valueIndex !== null ? sheet.headers[valueIndex] ?? "" : "",
    entries,
  };
}
