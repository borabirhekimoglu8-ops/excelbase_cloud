import "fake-indexeddb/auto";

import { webcrypto } from "node:crypto";
import { deleteDB } from "idb";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  localPassportPage,
  localPassportStorePage,
} from "@/lib/offline/localApi";
import {
  VAULT_DATABASE_NAME,
  closeVaultDatabase,
  lockVault,
  setupVault,
} from "@/lib/offline/vault";
import { rowFromParsedMrz } from "./parseMrzText";
import {
  createPackageCode,
  exportPassportPackage,
  importPassportPackage,
} from "./resultPackage";

Object.defineProperty(globalThis, "crypto", { configurable: true, value: webcrypto });

async function reset(): Promise<void> {
  lockVault();
  await closeVaultDatabase();
  await deleteDB(VAULT_DATABASE_NAME);
}

beforeEach(reset);
afterEach(reset);

describe("passport result package serialization", () => {
  it("encrypts page bytes and rows without preview URLs or plaintext PII", async () => {
    await setupVault("Ada Yılmaz", "123456");
    const row = rowFromParsedMrz("synthetic.png", null, {
      batchId: "synthetic-batch",
      pageNo: 1,
      previewUrl: "blob:must-not-leave-browser",
    });
    row.firstName = "ADA";
    row.lastName = "YILMAZ";
    row.passportNo = "U1000001";
    row.sourceImageKey = "passport-page:synthetic-batch:1";
    await localPassportStorePage(
      row.batchId,
      row.pageNo,
      new Blob(["synthetic image bytes"], { type: "image/png" }),
    );

    const code = createPackageCode();
    const blob = await exportPassportPackage([row], code);
    const encryptedText = await blob.text();
    expect(encryptedText).not.toContain("ADA");
    expect(encryptedText).not.toContain("YILMAZ");
    expect(encryptedText).not.toContain("U1000001");
    expect(encryptedText).not.toContain("blob:must-not-leave-browser");
    await expect(importPassportPackage(blob, "WRONG-CODE-1234")).rejects.toThrow(
      /Paket açılamadı/,
    );

    const imported = await importPassportPackage(blob, code);
    expect(imported).toHaveLength(1);
    expect(imported[0].previewUrl).toBe("");
    expect(await localPassportPage("synthetic-batch", 1)).not.toBeNull();
  });
});
