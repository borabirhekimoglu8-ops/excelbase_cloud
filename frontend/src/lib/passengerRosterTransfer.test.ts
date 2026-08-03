import "fake-indexeddb/auto";

import { webcrypto } from "node:crypto";
import { deleteDB } from "idb";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { localPassengers } from "@/lib/offline/localApi";
import {
  VAULT_DATABASE_NAME,
  closeVaultDatabase,
  lockVault,
  setupVault,
} from "@/lib/offline/vault";
import { transferRosterRowsToGate } from "./passengerRosterTransfer";

Object.defineProperty(globalThis, "crypto", { configurable: true, value: webcrypto });

async function resetDatabase(): Promise<void> {
  lockVault();
  await closeVaultDatabase();
  await deleteDB(VAULT_DATABASE_NAME);
}

describe("transferRosterRowsToGate", () => {
  beforeEach(async () => {
    await resetDatabase();
    await setupVault("Operasyon", "123456");
  });
  afterEach(resetDatabase);

  it("turns selected roster rows into Gate Visa passengers", async () => {
    const table = {
      headers: ["Ad Soyad", "Pasaport No", "Uyruk", "Yaş", "Gidiş Tarihi", "Dönüş Tarihi"],
      rows: [
        ["Ali Yılmaz", "U1234567", "TR", "34", "2026-08-10", "2026-08-20"],
        ["Anna Müller", "C0X23456", "DE", "29", "2026-08-11", "2026-08-21"],
      ],
    };

    const result = await transferRosterRowsToGate(table, table.rows, "agustos-listesi.xlsx");

    expect(result.imported).toBe(2);
    const passengers = await localPassengers();
    expect(passengers.map((row) => row.full_name).sort()).toEqual(["Ali Yılmaz", "Anna Müller"]);
    expect(passengers.map((row) => row.passport_no).sort()).toEqual(["C0X23456", "U1234567"]);
  });

  it("only transfers the rows actually selected, not the whole sheet", async () => {
    const table = {
      headers: ["Ad Soyad", "Pasaport No"],
      rows: [
        ["Ali Yılmaz", "U1234567"],
        ["Anna Müller", "C0X23456"],
      ],
    };

    await transferRosterRowsToGate(table, [table.rows[1]], "liste.xlsx");

    const passengers = await localPassengers();
    expect(passengers).toHaveLength(1);
    expect(passengers[0].full_name).toBe("Anna Müller");
  });

  it("refuses an empty selection instead of silently doing nothing", async () => {
    const table = { headers: ["Ad Soyad"], rows: [] };
    await expect(transferRosterRowsToGate(table, [], "bos.xlsx")).rejects.toThrow(/seçilmedi/);
  });

  it("reports a sheet with no recognisable passenger columns instead of pretending to succeed", async () => {
    const table = {
      headers: ["Hat", "Adet", "Tutar"],
      rows: [["IST-AMS", "3", "150"]],
    };

    await expect(transferRosterRowsToGate(table, table.rows, "satis.xlsx")).rejects.toThrow(/yolcu verisi bulunamadı/i);
    expect(await localPassengers()).toHaveLength(0);
  });
});
