/**
 * Reading an arbitrary sales spreadsheet into something the app can show.
 *
 * Unlike the passenger importer, this makes no assumptions about columns:
 * sales exports differ per agency and per month, and a fixed template would
 * reject most real files. The sheet is read as a table -- first non-empty row
 * is the header, the rest are rows -- and the numeric columns are discovered
 * rather than declared.
 *
 * The bounds are the point of this module. A spreadsheet goes into the same
 * encrypted vault as passenger data, on a phone, so an unbounded import would
 * be a device-filling operation dressed up as a convenience.
 */

import * as XLSX from "@e965/xlsx";

/**
 * Rows are no longer capped.
 *
 * A 5.000-row ceiling silently truncated real exports, and every statistic
 * below it was then computed over a sample the operator had not chosen while
 * being presented as the total -- a wrong number is worse than a slow one.
 * The whole sheet is kept and every figure is computed over all of it.
 *
 * What still bounds the work: the table draws a page at a time rather than
 * every row, and the sheet count below limits how much a device accumulates.
 */
export const SALES_MAX_COLUMNS = 40;
export const SALES_MAX_CELL_CHARS = 200;
/** A vault holding passport scans should not also hold a year of spreadsheets. */
export const SALES_MAX_SHEETS = 24;

export type SalesSheet = {
  id: string;
  filename: string;
  imported_at: string;
  headers: string[];
  rows: string[][];
  /** Always 0 now that nothing is dropped; kept so stored sheets still load. */
  truncated: number;
};

export type SalesColumnTotal = {
  column: string;
  total: number;
  /** How many cells actually parsed as numbers, so a mostly-text column is recognisable. */
  counted: number;
};

function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? "" : value.toISOString().slice(0, 10);
  }
  return String(value).trim().slice(0, SALES_MAX_CELL_CHARS);
}

function isEmptyRow(row: string[]): boolean {
  return row.every((cell) => cell === "");
}

/**
 * Turkish exports write "1.234,56"; English ones write "1,234.56". Guessing
 * wrong turns 1.234 into 1234, so the separators are resolved by position
 * rather than by locale assumption.
 */
/**
 * Reads a cell as a calendar day, or null.
 *
 * Turkish exports write 01.07.2026, ISO ones 2026-07-01, and the reader hands
 * back a Date for real date cells. Returning a sortable yyyy-mm-dd key means
 * the series orders correctly by string compare, which Turkish d.m.y does not.
 */
export function parseSalesDate(value: string): string | null {
  const text = value.trim();
  if (!text) return null;

  const iso = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(text);
  if (iso) return isoKey(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const dmy = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/.exec(text);
  if (dmy) return isoKey(Number(dmy[3]), Number(dmy[2]), Number(dmy[1]));

  return null;
}

function isoKey(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (year < 1900 || year > 2200) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}


export function parseSalesNumber(value: string): number | null {
  // Currency decoration is dropped, but anything else non-numeric disqualifies
  // the cell. Stripping every letter instead turned reference codes into
  // numbers -- "F1000" became 1000 -- so an invoice-number column was detected
  // as money and handed a meaningless total.
  const text = value
    .trim()
    .replace(/₺|\$|€|£|¥|TL|TRY|USD|EUR|GBP/gi, "")
    .replace(/[\s ]/g, "");
  if (!text || !/\d/.test(text) || /[^\d.,+-]/.test(text)) return null;
  // A Turkish date is all digits and dots, so it survives the check above and
  // "01.07.2026" was read as 1.072.026 -- which made the date column look
  // numeric and let a chart sum dates together.
  if (parseSalesDate(value) !== null) return null;

  const lastComma = text.lastIndexOf(",");
  const lastDot = text.lastIndexOf(".");
  let normalized = text;
  if (lastComma >= 0 && lastDot >= 0) {
    // Whichever comes last is the decimal separator; the other groups digits.
    normalized = lastComma > lastDot
      ? text.replace(/\./g, "").replace(",", ".")
      : text.replace(/,/g, "");
  } else if (lastComma >= 0) {
    // "1,234" is a thousands group; "1,23" is a decimal.
    normalized = text.length - lastComma - 1 === 3 && text.split(",").length === 2
      ? text.replace(/,/g, "")
      : text.replace(",", ".");
  } else if (lastDot >= 0) {
    // Same rule mirrored. Turkish exports write thousands as "1.234", and
    // "1.234.567" has no decimal reading at all -- treating every dot as a
    // decimal point made that one Number("1.234.567") === NaN, i.e. dropped.
    const groups = text.split(".");
    const thousands = groups.length > 2 || text.length - lastDot - 1 === 3;
    normalized = thousands ? text.replace(/\./g, "") : text;
  }
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function uniqueHeaders(raw: string[]): string[] {
  const seen = new Map<string, number>();
  return raw.map((header, index) => {
    const base = header || `Sütun ${index + 1}`;
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base} (${count + 1})`;
  });
}

/** Reads the first sheet of a workbook into a bounded table. */
export function parseSalesWorkbook(bytes: Uint8Array, filename: string): SalesSheet {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(bytes, { type: "array", cellDates: true });
  } catch {
    throw new Error("Dosya okunamadı. Excel (.xlsx/.xls) veya CSV olmalı.");
  }
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error("Dosyada sayfa bulunamadı.");

  const matrix = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], {
    header: 1,
    blankrows: false,
    defval: "",
  });

  const table = matrix
    .map((row) => (Array.isArray(row) ? row : []).slice(0, SALES_MAX_COLUMNS).map(cellText))
    .filter((row) => !isEmptyRow(row));
  if (table.length === 0) throw new Error("Dosya boş görünüyor.");

  const width = table.reduce((widest, row) => Math.max(widest, row.length), 0);
  const padded = table.map((row) => {
    const next = row.slice();
    while (next.length < width) next.push("");
    return next;
  });

  const headers = uniqueHeaders(padded[0]);
  const body = padded.slice(1);
  // A header row on its own is not an import. This also catches a file that is
  // not a spreadsheet at all: the reader will happily treat arbitrary bytes as
  // a one-cell CSV, which would otherwise be stored as an empty sheet.
  if (body.length === 0) throw new Error("Dosyada veri satırı bulunamadı.");
  return {
    id: globalThis.crypto?.randomUUID?.() ?? `sales-${Date.now()}-${Math.random()}`,
    filename: filename.slice(0, 160),
    imported_at: new Date().toISOString(),
    headers,
    rows: body,
    truncated: 0,
  };
}

/**
 * Sums the columns that actually hold numbers.
 *
 * A column counts as numeric only when most of its filled cells parse, so a
 * text column with a stray "2024" in it is not presented as a total.
 */
export function salesColumnTotals(sheet: SalesSheet): SalesColumnTotal[] {
  return sheet.headers.flatMap((column, index) => {
    let total = 0;
    let counted = 0;
    let filled = 0;
    for (const row of sheet.rows) {
      const raw = row[index] ?? "";
      if (!raw) continue;
      filled += 1;
      const value = parseSalesNumber(raw);
      if (value !== null) {
        total += value;
        counted += 1;
      }
    }
    if (filled === 0 || counted * 2 <= filled) return [];
    return [{ column, total: Math.round(total * 100) / 100, counted }];
  });
}

export function formatSalesNumber(value: number): string {
  return new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 2 }).format(value);
}

export function salesSheetLabel(sheet: SalesSheet): string {
  const date = new Date(sheet.imported_at);
  if (Number.isNaN(date.getTime())) return sheet.filename;
  return `${sheet.filename} · ${new Intl.DateTimeFormat("tr-TR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date)}`;
}
