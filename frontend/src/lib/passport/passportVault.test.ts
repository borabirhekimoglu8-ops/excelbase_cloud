import "fake-indexeddb/auto";

import { webcrypto } from "node:crypto";
import { deleteDB } from "idb";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  localPassportDeleteSource,
  localPassportPage,
  localPassportStorePage,
  localPassportStoreSource,
} from "@/lib/offline/localApi";
import {
  VAULT_DATABASE_NAME,
  closeVaultDatabase,
  exportEncryptedVault,
  lockVault,
  setupVault,
} from "@/lib/offline/vault";

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

    await localPassportDeleteSource(batchId);
    const backup = await (await exportEncryptedVault()).text();
    expect(backup).toContain("passport-page:synthetic-batch:1");
    expect(backup).not.toContain("YILMAZ");
    expect(backup).not.toContain("U1000001");
  });
});
