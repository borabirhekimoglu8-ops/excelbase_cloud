/**
 * Where imported sales sheets live.
 *
 * The existing `meta` store rather than a new object store: adding one means
 * bumping the IndexedDB version, and a migration that goes wrong on a device
 * holding passport scans costs far more than the tidiness is worth. Sheets are
 * encrypted the same way everything else in the vault is.
 */

import { getMeta, setMeta } from "@/lib/offline/vault";
import { SALES_MAX_SHEETS, type SalesSheet } from "@/lib/sales";

const SALES_KEY = "sales_sheets_v1";

function isSheet(value: unknown): value is SalesSheet {
  if (!value || typeof value !== "object") return false;
  const sheet = value as Record<string, unknown>;
  return (
    typeof sheet.id === "string"
    && typeof sheet.filename === "string"
    && Array.isArray(sheet.headers)
    && Array.isArray(sheet.rows)
  );
}

export async function listSalesSheets(): Promise<SalesSheet[]> {
  const stored = await getMeta<SalesSheet[]>(SALES_KEY);
  if (!Array.isArray(stored)) return [];
  return stored.filter(isSheet);
}

export async function saveSalesSheet(sheet: SalesSheet): Promise<SalesSheet[]> {
  const existing = await listSalesSheets();
  // Newest first, and the oldest fall off the end rather than the import being
  // refused -- an operator importing this month's file should not have to go
  // and delete last year's first.
  const next = [sheet, ...existing].slice(0, SALES_MAX_SHEETS);
  await setMeta(SALES_KEY, next);
  return next;
}

export async function removeSalesSheet(id: string): Promise<SalesSheet[]> {
  const next = (await listSalesSheets()).filter((sheet) => sheet.id !== id);
  await setMeta(SALES_KEY, next);
  return next;
}

export async function clearSalesSheets(): Promise<void> {
  await setMeta(SALES_KEY, []);
}
