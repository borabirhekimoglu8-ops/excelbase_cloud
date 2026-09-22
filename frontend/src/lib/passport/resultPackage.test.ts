import "fake-indexeddb/auto";

import { webcrypto } from "node:crypto";
import { deleteDB } from "idb";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { closeVaultDatabase, lockVault, setupVault, VAULT_DATABASE_NAME } from "@/lib/offline/vault";

import { persistPasteMrz } from "./batch";
import { createPackageCode, exportPassportPackage, importPassportPackage } from "./resultPackage";
import { clearPassportVaultRecords, listPassportCandidates } from "./store";

Object.defineProperty(globalThis, "crypto", { configurable: true, value: webcrypto });

const LINE1 = "P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<";
const LINE2 = "L898902C36UTO7408122F1204159ZE184226B<<<<<10";

async function reset(): Promise<void> {
  lockVault();
  await closeVaultDatabase();
  await deleteDB(VAULT_DATABASE_NAME);
}

beforeEach(reset);
afterEach(reset);

describe("passport result package", () => {
  it("round-trips approved rows and rejects a wrong code", async () => {
    await setupVault("Ada Yılmaz", "123456");
    await persistPasteMrz(`${LINE1}\n${LINE2}`);
    const rows = await listPassportCandidates();
    const code = createPackageCode();
    const blob = await exportPassportPackage(rows, code);
    await expect(importPassportPackage(blob, "WRONGCODE")).rejects.toThrow(/Paket açılamadı/);
    await clearPassportVaultRecords();
    expect(await importPassportPackage(blob, code)).toBe(1);
    expect(await importPassportPackage(blob, code)).toBe(0);
  });
});
