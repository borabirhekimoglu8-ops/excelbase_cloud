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

import { parseSalesNumber } from "@/lib/sales";

/**
 * Any table with named columns.
 *
 * Deliberately not `SalesSheet`: the Gate Visa passenger list is the same
 * shape and asks the same questions, and one engine over both means a filter
 * or a statistic cannot behave differently depending on which page it is on.
 */
export type ColumnTable = { headers: string[]; rows: string[][] };

/** Above this many distinct values a column is an identifier, not a category. */
export const MAX_CATEGORY_VALUES = 30;

export type SalesFilter = {
  /** Matched against every cell of a row. */
  query: string;
  /** Column index → exact value that must match. Absent or "" means any. */
  columnValues: Record<number, string>;
  /**
   * Column index → substring the cell must contain.
   *
   * Separate from `columnValues` because the two come from different controls
   * and mean different things: a dropdown offers values that exist, so exact
   * is right, while a free-text box over a hundred passport numbers is only
   * usable as a partial match.
   */
  columnQueries: Record<number, string>;
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
  /**
   * The middle value. Worth showing next to the average because they disagree
   * exactly when it matters: one large sale drags the average away from what a
   * typical row looks like, and only the median says so.
   */
  median: number;
  /** Quartiles, so the bulk of the rows can be separated from the tails. */
  p25: number;
  p75: number;
  /** Population standard deviation: how spread out the column is. */
  stdDev: number;
};

function quantile(sorted: number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  // Linear interpolation between the two neighbouring samples, so a quartile
  // of an even-length column is not silently rounded to one side.
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

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
  columnQueries: {},
  numericRanges: {},
});

function columnCells(sheet: ColumnTable, index: number): string[] {
  return sheet.rows.map((row) => row[index] ?? "");
}

/**
 * Columns whose filled cells are mostly numbers.
 *
 * Same majority rule the totals use: one stray year in a notes column must not
 * turn it into a money column.
 */
export function numericColumnIndexes(sheet: ColumnTable): number[] {
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

export function distinctValues(sheet: ColumnTable, index: number): string[] {
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
export function categoryColumnIndexes(sheet: ColumnTable): number[] {
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

export type SortDirection = "asc" | "desc";

export type SortState = { index: number; direction: SortDirection } | null;

/**
 * Sorts rows by one column, comparing numbers as numbers.
 *
 * Sorting "1.500,00" as text puts it before "900,00", which is the kind of
 * wrong that looks plausible enough to act on. Cells that do not parse fall to
 * the end in both directions: an empty cell is not the smallest amount, it is
 * the absence of one, and burying it at the top of a descending sort would be
 * just as misleading.
 */
export function sortRows(
  sheet: ColumnTable,
  rows: string[][],
  sort: SortState,
): string[][] {
  if (!sort) return rows;
  const { index, direction } = sort;
  const numeric = numericColumnIndexes(sheet).includes(index);
  const sign = direction === "asc" ? 1 : -1;

  return [...rows].sort((left, right) => {
    const a = left[index] ?? "";
    const b = right[index] ?? "";
    if (a === "" && b === "") return 0;
    if (a === "") return 1;
    if (b === "") return -1;
    if (numeric) {
      const x = parseSalesNumber(a);
      const y = parseSalesNumber(b);
      if (x === null && y === null) return 0;
      if (x === null) return 1;
      if (y === null) return -1;
      return (x - y) * sign;
    }
    return a.localeCompare(b, "tr", { numeric: true }) * sign;
  });
}

export type ColumnKind = "numeric" | "category" | "text";

export type HistogramBucket = { label: string; from: number; to: number; count: number };

export type ColumnSummary = {
  index: number;
  column: string;
  kind: ColumnKind;
  filled: number;
  empty: number;
  distinct: number;
  /** Present for numeric columns. */
  numeric: NumericColumnStats | null;
  /** Most frequent values, for anything that is not numeric. */
  top: CategoryEntry[];
  /** Where the values fall, for numeric columns; empty otherwise. */
  histogram: HistogramBucket[];
};

function shortNumber(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  if (Math.abs(rounded) >= 1_000_000) return `${Math.round(rounded / 100_000) / 10}M`;
  if (Math.abs(rounded) >= 1_000) return `${Math.round(rounded / 100) / 10}B`;
  return `${rounded}`;
}

/**
 * Buckets numeric values into equal-width ranges.
 *
 * The five-number summary is exact but says nothing about shape: two columns
 * with the same min, median and max can be bunched at one end or split in two,
 * and only the distribution shows which.
 */
export function numericHistogram(values: number[], buckets = 8): HistogramBucket[] {
  if (values.length === 0) return [];
  let low = values[0];
  let high = values[0];
  for (const value of values) {
    if (value < low) low = value;
    if (value > high) high = value;
  }
  // Every row identical: one bucket is the honest answer, not eight empty ones.
  if (low === high) {
    return [{ label: shortNumber(low), from: low, to: high, count: values.length }];
  }

  const width = (high - low) / buckets;
  const counts = new Array<number>(buckets).fill(0);
  for (const value of values) {
    // The top value belongs to the last bucket rather than to a ninth one.
    const slot = Math.min(buckets - 1, Math.floor((value - low) / width));
    counts[slot] += 1;
  }
  return counts.map((count, index) => {
    const from = low + width * index;
    const to = index === buckets - 1 ? high : low + width * (index + 1);
    return { label: `${shortNumber(from)}–${shortNumber(to)}`, from, to, count };
  });
}

/**
 * One summary per column, whatever the column holds.
 *
 * Every header in the file gets a line: showing statistics only for the money
 * columns left most of a spreadsheet unaccounted for, and the operator with no
 * way to tell an empty column from one that was simply not summarised.
 */
export function columnSummaries(
  sheet: ColumnTable,
  rows: string[][],
  topValues = 5,
): ColumnSummary[] {
  const numericSet = new Set(numericColumnIndexes(sheet));
  const categorySet = new Set(categoryColumnIndexes(sheet));
  const stats = new Map(numericStats(sheet, rows).map((entry) => [entry.index, entry]));

  return sheet.headers.map((header, index) => {
    const cells = rows.map((row) => row[index] ?? "");
    const filled = cells.filter((cell) => cell !== "").length;
    const distinct = new Set(cells.filter((cell) => cell !== "")).size;
    const kind: ColumnKind = numericSet.has(index)
      ? "numeric"
      : categorySet.has(index)
        ? "category"
        : "text";
    const breakdown = kind === "numeric"
      ? []
      : categoryBreakdown(sheet, rows.filter((row) => (row[index] ?? "") !== ""), index, null)
        .entries.slice(0, topValues);

    const numericValues = kind !== "numeric" ? [] : cells.flatMap((cell) => {
      const parsed = parseSalesNumber(cell);
      return parsed === null ? [] : [parsed];
    });

    return {
      index,
      column: header || `Sütun ${index + 1}`,
      kind,
      filled,
      empty: rows.length - filled,
      distinct,
      numeric: stats.get(index) ?? null,
      top: breakdown,
      histogram: numericHistogram(numericValues),
    };
  });
}

export function filterSalesRows(sheet: ColumnTable, filter: SalesFilter): string[][] {
  const query = filter.query.trim().toLocaleLowerCase("tr");
  const valueEntries = Object.entries(filter.columnValues)
    .filter(([, value]) => value !== "")
    .map(([index, value]) => [Number(index), value] as const);
  const queryEntries = Object.entries(filter.columnQueries ?? {})
    .filter(([, value]) => value.trim() !== "")
    .map(([index, value]) => [Number(index), value.trim().toLocaleLowerCase("tr")] as const);
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
    for (const [index, needle] of queryEntries) {
      if (!(row[index] ?? "").toLocaleLowerCase("tr").includes(needle)) return false;
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

export function numericStats(sheet: ColumnTable, rows: string[][]): NumericColumnStats[] {
  return numericColumnIndexes(sheet).flatMap((index) => {
    const values: number[] = [];
    for (const row of rows) {
      const parsed = parseSalesNumber(row[index] ?? "");
      if (parsed !== null) values.push(parsed);
    }
    if (values.length === 0) return [];
    const sum = values.reduce((total, value) => total + value, 0);
    const average = sum / values.length;
    const round = (value: number) => Math.round(value * 100) / 100;
    // Sorted once and reused: Math.min/max spread a large column across the
    // argument list, which throws on a big enough sheet now that rows are
    // uncapped.
    const sorted = [...values].sort((a, b) => a - b);
    const variance = values.reduce(
      (total, value) => total + (value - average) ** 2,
      0,
    ) / values.length;
    return [{
      index,
      column: sheet.headers[index] ?? `Sütun ${index + 1}`,
      count: values.length,
      sum: round(sum),
      average: round(average),
      min: round(sorted[0]),
      max: round(sorted[sorted.length - 1]),
      median: round(quantile(sorted, 0.5)),
      p25: round(quantile(sorted, 0.25)),
      p75: round(quantile(sorted, 0.75)),
      stdDev: round(Math.sqrt(variance)),
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
  sheet: ColumnTable,
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
