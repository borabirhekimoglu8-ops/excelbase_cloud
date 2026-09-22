import "fake-indexeddb/auto";

import { webcrypto } from "node:crypto";
import { deleteDB } from "idb";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  localPassportDeleteSource,
  localPassportPage,
  localPassportPutRow,
  localPassportRow,
  localPassportStorePage,
  localPassportStoreSource,
} from "@/lib/offline/localApi";
import {
  VAULT_DATABASE_NAME,
  closeVaultDatabase,
  exportEncryptedVault,
  lockVault,
  restoreEncryptedVault,
  setupVault,
  unlockVault,
} from "@/lib/offline/vault";
import { rowFromParsedMrz } from "@/lib/passport/parseMrzText";

Object.defineProperty(globalThis, "crypto", { configurable: true, value: webcrypto });

async function reset(): Promise<void> {
  lockVault();
  await closeVaultDatabase();
  await deleteDB(VAULT_DATABASE_NAME);
}

beforeEach(reset);
afterEach(reset);

describe("passport source vault", () => {
  it("exports the encrypted page key without plaintext passport fields", async () => {
    await setupVault("Ada Yılmaz", "123456");
    const batchId = "synthetic-batch";
    await localPassportStoreSource(
      batchId,
      new File(["temporary"], "whatsapp.pdf", { type: "application/pdf" }),
    );
    const key = await localPassportStorePage(
      batchId,
      1,
      new Blob(["YILMAZ U1000001"], { type: "image/jpeg" }),
    );
    expect(key).toBe("passport-page:synthetic-batch:1");
    expect(await localPassportPage(batchId, 1)).not.toBeNull();

    const row = rowFromParsedMrz("whatsapp.pdf · s.1", null, { batchId, pageNo: 1 });
    row.sourceImageKey = key;
    row.firstName = "";
    row.lastName = "";
    row.passportNo = "";
    row.provenance.passportNo = {
      source: "viz",
      verification: "visual_draft",
      pageNo: 1,
      rect: { x: 120, y: 80, width: 160, height: 24 },
    };
    await localPassportPutRow(row);

    await localPassportDeleteSource(batchId);
    const backupBlob = await exportEncryptedVault();
    const backup = await backupBlob.text();
    expect(backup).toContain("passport-page:synthetic-batch:1");
    expect(backup).toContain("passport_row:");
    expect(backup).not.toContain("YILMAZ");
    expect(backup).not.toContain("U1000001");

    lockVault();
    await closeVaultDatabase();
    await deleteDB(VAULT_DATABASE_NAME);
    await restoreEncryptedVault(new File([backupBlob], "kasa.excelbase-backup"));
    await unlockVault("123456");
    expect(await localPassportPage(batchId, 1)).not.toBeNull();
    const restored = await localPassportRow(row.id);
    expect(restored?.sourceImageKey).toBe(key);
    expect(restored?.provenance.passportNo?.rect).toEqual({ x: 120, y: 80, width: 160, height: 24 });
  });
});
