/**
 * Taking the rows currently on screen back out as a file.
 *
 * A filter that cannot be exported only answers questions inside the app; the
 * operator's next step is usually to send the narrowed list to someone. What
 * leaves is exactly what is displayed -- same filter, same sort, same column
 * order -- because an export that quietly returned the unfiltered sheet would
 * be discovered by whoever received it, not here.
 */

import * as XLSX from "@e965/xlsx";

import type { ColumnTable } from "@/lib/salesAnalysis";

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/**
 * Spreadsheet programs execute cells that begin like a formula, so a value
 * arriving from someone else's file must not be handed back as one.
 */
function safeCell(value: string): string {
  return /^[=+\-@]/.test(value) ? `'${value}` : value;
}

export function createColumnTableXlsxBlob(
  table: ColumnTable,
  rows: string[][],
  sheetName = "Veri",
): Blob {
  const matrix = [
    table.headers.map(safeCell),
    ...rows.map((row) => table.headers.map((_header, index) => safeCell(row[index] ?? ""))),
  ];
  const worksheet = XLSX.utils.aoa_to_sheet(matrix);
  worksheet["!cols"] = table.headers.map((header) => ({
    wch: Math.min(40, Math.max(10, header.length + 4)),
  }));
  const workbook = XLSX.utils.book_new();
  // Excel rejects sheet names over 31 characters or containing []:*?/\
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName.replace(/[[\]:*?/\\]/g, " ").slice(0, 31) || "Veri");
  const bytes = XLSX.write(workbook, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  return new Blob([bytes], { type: XLSX_MIME });
}

/** Turns "temmuz-satis.xlsx" into "temmuz-satis-filtreli.xlsx". */
export function filteredExportName(source: string): string {
  const base = source.replace(/\.[^.]+$/, "") || "veri";
  return `${base}-filtreli.xlsx`;
}
