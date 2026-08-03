/**
 * Where uploaded passenger-list sheets live.
 *
 * This is the master roster behind the Yolcular tab: every list an operator
 * has ever uploaded, in whatever columns that file actually had (Uyruk, Yaş,
 * Gidiş/Dönüş Tarihi, or anything else), kept separately from the Gate Visa
 * working set. A subset gets sent to the gate by name -- see
 * `passengerRosterTransfer.ts` -- but the roster itself is never rewritten by
 * that transfer.
 *
 * Reuses the same generic sheet shape and IndexedDB pattern as the Sales
 * tab (`salesStore.ts`): a distinct `meta` key, not a new object store, for
 * the same reason -- a schema migration that goes wrong on a device holding
 * passport scans costs far more than the tidiness is worth.
 */

import { getMeta, setMeta } from "@/lib/offline/vault";
import { type SalesSheet } from "@/lib/sales";

const ROSTER_KEY = "passenger_roster_sheets_v1";
/** A vault holding passport scans should not also hold a year of rosters. */
export const ROSTER_MAX_SHEETS = 24;

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

export async function listPassengerRosterSheets(): Promise<SalesSheet[]> {
  const stored = await getMeta<SalesSheet[]>(ROSTER_KEY);
  if (!Array.isArray(stored)) return [];
  return stored.filter(isSheet);
}

export async function savePassengerRosterSheet(sheet: SalesSheet): Promise<SalesSheet[]> {
  const existing = await listPassengerRosterSheets();
  // Newest first, and the oldest fall off the end rather than the import being
  // refused -- an operator uploading this week's list should not have to go
  // and delete last month's first.
  const next = [sheet, ...existing].slice(0, ROSTER_MAX_SHEETS);
  await setMeta(ROSTER_KEY, next);
  return next;
}

export async function removePassengerRosterSheet(id: string): Promise<SalesSheet[]> {
  const next = (await listPassengerRosterSheets()).filter((sheet) => sheet.id !== id);
  await setMeta(ROSTER_KEY, next);
  return next;
}

export async function clearPassengerRosterSheets(): Promise<void> {
  await setMeta(ROSTER_KEY, []);
}
