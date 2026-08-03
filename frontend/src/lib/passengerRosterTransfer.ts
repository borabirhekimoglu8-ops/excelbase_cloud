/**
 * Sending selected roster rows to the gate.
 *
 * The master roster (Yolcular) and the Gate Visa working set (Kapı) are
 * deliberately separate stores: a list an operator uploads for reference
 * should not silently become passengers with PDFs and photos attached. This
 * is the one bridge between them, and it reuses the same import pipeline the
 * Excel/ZIP uploader already uses -- the header-alias matching, the
 * duplicate handling, the undo -- rather than writing a second path into the
 * same passenger store.
 *
 * What crosses the bridge is a plain Excel file built from exactly the
 * selected rows, with the roster's own column headers. Nothing about the
 * transfer looks at cell contents beyond that; it is the same file format an
 * operator could have built by hand and uploaded themselves.
 */

import type { ColumnTable } from "@/lib/salesAnalysis";
import { createColumnTableXlsxBlob } from "@/lib/salesExport";
import { type ImportJob, queueImportFile } from "@/lib/api";
import { newId } from "@/lib/id";

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export type RosterTransferResult = {
  job: ImportJob;
  imported: number;
  duplicates: number;
  invalid: number;
};

function transferFilename(sourceFilename: string): string {
  const base = sourceFilename.replace(/\.[^.]+$/, "").trim() || "yolcu-listesi";
  return `${base.slice(0, 120)}-kapiya-aktar.xlsx`;
}

export async function transferRosterRowsToGate(
  table: ColumnTable,
  rows: string[][],
  sourceFilename: string,
  dupStrategy: "skip" | "overwrite" | "add" = "skip",
): Promise<RosterTransferResult> {
  if (!rows.length) throw new Error("Aktarılacak yolcu seçilmedi.");

  const blob = createColumnTableXlsxBlob(table, rows, "Yolcular");
  const file = new File([blob], transferFilename(sourceFilename), { type: XLSX_MIME });

  const batchId = newId();
  const response = await queueImportFile(file, false, dupStrategy, batchId, newId(), 0);
  const job = response.jobs[0];
  if (!job) throw new Error("Aktarım kaydı oluşturulamadı.");
  if (job.status === "error") {
    throw new Error(
      job.message
        || "Bu satırlar kapıya aktarılamadı. Listede yolcu adı/soyadı veya pasaport sütunu olduğundan emin olun.",
    );
  }
  return { job, imported: job.imported, duplicates: job.duplicates, invalid: job.invalid };
}
