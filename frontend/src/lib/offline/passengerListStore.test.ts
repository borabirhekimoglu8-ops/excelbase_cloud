import "fake-indexeddb/auto";

import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { deleteDB } from "idb";

import {
  VAULT_DATABASE_NAME,
  closeVaultDatabase,
  lockVault,
  setupVault,
} from "@/lib/offline/vault";
import { type SalesSheet } from "@/lib/sales";
import {
  ROSTER_MAX_SHEETS,
  clearPassengerRosterSheets,
  listPassengerRosterSheets,
  removePassengerRosterSheet,
  savePassengerRosterSheet,
} from "./passengerListStore";

if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true });
}

// Each test gets its own vault: the store is device-scoped, so leftovers from a
// previous case would look like lists the operator actually uploaded.
async function resetVault(): Promise<void> {
  lockVault();
  await closeVaultDatabase();
  await deleteDB(VAULT_DATABASE_NAME);
}

function sheet(id: string, filename = `${id}.xlsx`): SalesSheet {
  return {
    id,
    filename,
    imported_at: new Date().toISOString(),
    headers: ["Ad Soyad", "Uyruk", "Yaş"],
    rows: [["Ali Yılmaz", "TR", "34"]],
    truncated: 0,
  };
}

describe("passenger roster sheet store", () => {
  beforeEach(async () => {
    await resetVault();
    await setupVault("Operasyon", "123456");
    await clearPassengerRosterSheets();
  });

  afterEach(resetVault);

  it("keeps an uploaded list across a reload", async () => {
    await savePassengerRosterSheet(sheet("a"));

    const stored = await listPassengerRosterSheets();

    expect(stored).toHaveLength(1);
    expect(stored[0].filename).toBe("a.xlsx");
    expect(stored[0].rows).toEqual([["Ali Yılmaz", "TR", "34"]]);
  });

  it("puts the newest upload first", async () => {
    await savePassengerRosterSheet(sheet("eski"));
    await savePassengerRosterSheet(sheet("yeni"));

    expect((await listPassengerRosterSheets()).map((entry) => entry.id)).toEqual(["yeni", "eski"]);
  });

  it("drops the oldest instead of refusing a new upload", async () => {
    for (let i = 0; i < ROSTER_MAX_SHEETS + 3; i += 1) {
      await savePassengerRosterSheet(sheet(`s${i}`));
    }

    const stored = await listPassengerRosterSheets();

    expect(stored).toHaveLength(ROSTER_MAX_SHEETS);
    expect(stored[0].id).toBe(`s${ROSTER_MAX_SHEETS + 2}`);
    expect(stored.some((entry) => entry.id === "s0")).toBe(false);
  });

  it("removes one list without touching the others, or the Gate Visa working set", async () => {
    // The roster and the transferred-in Gate Visa passengers are separate
    // stores; deleting a roster upload here must not be able to reach the
    // other one.
    await savePassengerRosterSheet(sheet("a"));
    await savePassengerRosterSheet(sheet("b"));

    await removePassengerRosterSheet("a");

    expect((await listPassengerRosterSheets()).map((entry) => entry.id)).toEqual(["b"]);
  });

  it("ignores a malformed stored entry rather than rendering it", async () => {
    const { setMeta } = await import("@/lib/offline/vault");
    await setMeta("passenger_roster_sheets_v1", [sheet("iyi"), { id: "kotu" }, null]);

    expect((await listPassengerRosterSheets()).map((entry) => entry.id)).toEqual(["iyi"]);
  });
});
