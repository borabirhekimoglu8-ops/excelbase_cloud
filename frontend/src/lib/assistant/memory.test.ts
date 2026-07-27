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
import {
  MEMORY_MAX_ENTRIES,
  clearMemories,
  forgetFact,
  listMemories,
  memoryDigest,
  rememberFact,
} from "./memory";

if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true });
}

// Each test gets its own vault: the store is device-scoped, so leftovers from
// a previous case would look like memories the assistant actually kept.
async function resetVault(): Promise<void> {
  lockVault();
  await closeVaultDatabase();
  await deleteDB(VAULT_DATABASE_NAME);
}

describe("assistant memory", () => {
  beforeEach(async () => {
    await resetVault();
    await setupVault("Operasyon", "123456");
    await clearMemories();
  });

  afterEach(resetVault);

  it("carries a fact into the next conversation's context", async () => {
    await rememberFact("Cuma seferlerinde fotoğraf eksikleri artıyor.");
    expect(await memoryDigest()).toEqual(["Cuma seferlerinde fotoğraf eksikleri artıyor."]);
  });

  it("does not spend a slot restating the same conclusion", async () => {
    const first = await rememberFact("Voucher'lar genelde son gün geliyor.");
    const again = await rememberFact("  voucher'lar genelde son gün geliyor.  ");

    expect(again.id).toBe(first.id);
    expect(await listMemories()).toHaveLength(1);
  });

  it("keeps the newest facts instead of refusing to learn once full", async () => {
    for (let index = 0; index < MEMORY_MAX_ENTRIES + 5; index += 1) {
      await rememberFact(`gözlem ${index}`);
    }
    const stored = await memoryDigest();

    expect(stored).toHaveLength(MEMORY_MAX_ENTRIES);
    expect(stored.at(-1)).toBe(`gözlem ${MEMORY_MAX_ENTRIES + 4}`);
    expect(stored).not.toContain("gözlem 0");
  });

  it("forgets a fact that turned out to be wrong", async () => {
    const entry = await rememberFact("Yanlış çıkarım.");
    expect(await forgetFact(entry.id)).toBe(true);
    expect(await memoryDigest()).toEqual([]);
    expect(await forgetFact(entry.id)).toBe(false);
  });

  it("refuses to store an empty note", async () => {
    await expect(rememberFact("   ")).rejects.toThrow();
  });
});
