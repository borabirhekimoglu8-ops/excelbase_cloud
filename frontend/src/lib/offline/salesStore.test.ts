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
import { SALES_MAX_SHEETS, type SalesSheet } from "@/lib/sales";
import {
  clearSalesSheets,
  listSalesSheets,
  removeSalesSheet,
  saveSalesSheet,
} from "./salesStore";

if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true });
}

// Each test gets its own vault: the store is device-scoped, so leftovers from a
// previous case would look like sheets the operator actually imported.
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
    headers: ["Acente", "Tutar"],
    rows: [["Mavi Tur", "1500"]],
    truncated: 0,
  };
}

describe("sales sheet store", () => {
  beforeEach(async () => {
    await resetVault();
    await setupVault("Operasyon", "123456");
    await clearSalesSheets();
  });

  afterEach(resetVault);

  it("keeps an imported sheet across a reload", async () => {
    await saveSalesSheet(sheet("a"));

    const stored = await listSalesSheets();

    expect(stored).toHaveLength(1);
    expect(stored[0].filename).toBe("a.xlsx");
    expect(stored[0].rows).toEqual([["Mavi Tur", "1500"]]);
  });

  it("puts the newest import first", async () => {
    await saveSalesSheet(sheet("eski"));
    await saveSalesSheet(sheet("yeni"));

    expect((await listSalesSheets()).map((entry) => entry.id)).toEqual(["yeni", "eski"]);
  });

  it("drops the oldest instead of refusing a new import", async () => {
    // An operator importing this month's file should not first have to go and
    // delete last year's.
    for (let i = 0; i < SALES_MAX_SHEETS + 3; i += 1) {
      await saveSalesSheet(sheet(`s${i}`));
    }

    const stored = await listSalesSheets();

    expect(stored).toHaveLength(SALES_MAX_SHEETS);
    expect(stored[0].id).toBe(`s${SALES_MAX_SHEETS + 2}`);
    expect(stored.some((entry) => entry.id === "s0")).toBe(false);
  });

  it("removes one sheet without touching the others", async () => {
    await saveSalesSheet(sheet("a"));
    await saveSalesSheet(sheet("b"));

    await removeSalesSheet("a");

    expect((await listSalesSheets()).map((entry) => entry.id)).toEqual(["b"]);
  });

  it("ignores a malformed stored entry rather than rendering it", async () => {
    const { setMeta } = await import("@/lib/offline/vault");
    await setMeta("sales_sheets_v1", [sheet("iyi"), { id: "kotu" }, null]);

    expect((await listSalesSheets()).map((entry) => entry.id)).toEqual(["iyi"]);
  });
});
