import "fake-indexeddb/auto";

import { webcrypto } from "node:crypto";
import { deleteDB, openDB } from "idb";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  VAULT_DATABASE_NAME,
  clearPassengers,
  closeVaultDatabase,
  deleteBinary,
  deleteJob,
  deletePassenger,
  exportEncryptedVault,
  getBinary,
  getJob,
  getMeta,
  getPassenger,
  listBinary,
  listJobs,
  listPassengers,
  lockVault,
  putBinary,
  putJob,
  putPassenger,
  putPassengers,
  removeMeta,
  replacePassengers,
  restoreEncryptedVault,
  setMeta,
  setupVault,
  unlockVault,
  vaultAuthStatus,
} from "./vault";

Object.defineProperty(globalThis, "crypto", { configurable: true, value: webcrypto });

type Person = { id: number; full_name: string; passport_no: string };
type Job = { id: string; filename: string; status: string };

async function resetDatabase(): Promise<void> {
  lockVault();
  await closeVaultDatabase();
  await deleteDB(VAULT_DATABASE_NAME);
}

beforeEach(resetDatabase);
afterEach(resetDatabase);

describe("encrypted offline vault", () => {
  it("creates, locks and unlocks the device vault without persisting the data key", async () => {
    expect(await vaultAuthStatus()).toEqual({ setup_required: true, authenticated: false, user: null });

    const setup = await setupVault("Ayşe Yılmaz", "123456");
    expect(setup).toMatchObject({
      setup_required: false,
      authenticated: true,
      user: { id: "local-admin", name: "Ayşe Yılmaz", role: "admin" },
    });

    lockVault();
    expect(await vaultAuthStatus()).toEqual({ setup_required: false, authenticated: false, user: null });
    await expect(unlockVault("000000")).rejects.toThrow("Erişim kodu yanlış");
    expect((await unlockVault("123456")).user?.name).toBe("Ayşe Yılmaz");
  });

  it("supports passenger CRUD and atomic batch replacement", async () => {
    await setupVault("Yerel Yönetici", "123456");
    await putPassenger<Person>({ id: 2, full_name: "İkinci", passport_no: "P2" });
    await putPassengers<Person>([
      { id: 1, full_name: "Birinci", passport_no: "P1" },
      { id: 3, full_name: "Üçüncü", passport_no: "P3" },
    ]);

    expect((await listPassengers<Person>()).map((row) => row.id)).toEqual([1, 2, 3]);
    expect((await getPassenger<Person>(2))?.full_name).toBe("İkinci");

    await deletePassenger(2);
    expect(await getPassenger<Person>(2)).toBeNull();

    await replacePassengers<Person>([{ id: 8, full_name: "Yeni", passport_no: "PX" }]);
    expect(await listPassengers<Person>()).toEqual([{ id: 8, full_name: "Yeni", passport_no: "PX" }]);

    await clearPassengers();
    expect(await listPassengers<Person>()).toEqual([]);
  });

  it("encrypts jobs, metadata and binary files with their own authenticated records", async () => {
    await setupVault("Yerel Yönetici", "123456");
    await putJob<Job>({ id: "job-1", filename: "liste.xlsx", status: "done" });
    await setMeta("history", { imported: 42 });
    await putBinary("photo-1", new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" }), {
      passengerId: 7,
    });

    expect(await listJobs<Job>()).toEqual([{ id: "job-1", filename: "liste.xlsx", status: "done" }]);
    expect((await getJob<Job>("job-1"))?.filename).toBe("liste.xlsx");
    expect(await getMeta("history")).toEqual({ imported: 42 });
    const binary = await getBinary("photo-1");
    expect(binary).toMatchObject({ id: "photo-1", type: "image/jpeg", size: 3, metadata: { passengerId: 7 } });
    expect([...new Uint8Array(await binary!.data.arrayBuffer())]).toEqual([1, 2, 3]);
    expect((await listBinary()).map((item) => item.id)).toEqual(["photo-1"]);

    await deleteJob("job-1");
    await removeMeta("history");
    await deleteBinary("photo-1");
    expect(await listJobs<Job>()).toEqual([]);
    expect(await getMeta("history")).toBeNull();
    expect(await getBinary("photo-1")).toBeNull();
  });

  it("does not leave passenger, profile, metadata or binary contents in plaintext", async () => {
    const secret = "VERY-UNIQUE-PASSPORT-SECRET-90817";
    await setupVault(secret, "123456");
    await putPassenger<Person>({ id: 1, full_name: secret, passport_no: secret });
    await putJob<Job>({ id: "job-1", filename: secret, status: secret });
    await setMeta("fixed-meta-key", { value: secret });
    await putBinary("fixed-binary-key", new Blob([secret]), { filename: secret });

    const db = await openDB(VAULT_DATABASE_NAME, 1);
    const rawValues = [
      await db.get("config", "vault"),
      ...(await db.getAll("passengers")),
      ...(await db.getAll("jobs")),
      ...(await db.getAll("meta")),
      ...(await db.getAll("binaries")),
    ];
    db.close();

    expect(JSON.stringify(rawValues)).not.toContain(secret);
    const needle = new TextEncoder().encode(secret);
    for (const value of rawValues) {
      const record = value as { ciphertext?: ArrayBuffer; verifier?: { ciphertext: ArrayBuffer } };
      if (record.ciphertext) expect(containsBytes(new Uint8Array(record.ciphertext), needle)).toBe(false);
      if (record.verifier) expect(containsBytes(new Uint8Array(record.verifier.ciphertext), needle)).toBe(false);
    }
  });

  it("rejects a record whose ciphertext was modified", async () => {
    await setupVault("Yerel Yönetici", "123456");
    await putPassenger<Person>({ id: 1, full_name: "Ayşe", passport_no: "TR123456" });

    const db = await openDB(VAULT_DATABASE_NAME, 1);
    const record = await db.get("passengers", 1) as {
      version: 1;
      iv: ArrayBuffer;
      ciphertext: ArrayBuffer;
    };
    const changed = new Uint8Array(record.ciphertext.slice(0));
    changed[0] ^= 0xff;
    await db.put("passengers", { ...record, ciphertext: changed.buffer }, 1);
    db.close();

    await expect(getPassenger<Person>(1)).rejects.toThrow("değiştirilmiş olabilir");
  });

  it("does not expose even empty protected stores while locked", async () => {
    await setupVault("Yerel Yönetici", "123456");
    lockVault();
    await expect(putPassenger<Person>({ id: 1, full_name: "A", passport_no: "P" })).rejects.toThrow("kasa kilitli");
    await expect(listPassengers<Person>()).rejects.toThrow("kasa kilitli");
  });

  it("rejects backup key settings that could weaken or exhaust PIN derivation", async () => {
    await setupVault("Yerel Yönetici", "123456");
    const backup = JSON.parse(await (await exportEncryptedVault()).text()) as {
      stores: { config: Array<{ key: string; value: { iterations: number } }> };
    };
    backup.stores.config[0].value.iterations = 1;
    const unsafe = new Blob([JSON.stringify(backup)], { type: "application/json" });
    await expect(restoreEncryptedVault(unsafe)).rejects.toThrow("kasa anahtarı geçersiz");
  });
});

function containsBytes(haystack: Uint8Array, needle: Uint8Array): boolean {
  outer: for (let offset = 0; offset <= haystack.length - needle.length; offset += 1) {
    for (let index = 0; index < needle.length; index += 1) {
      if (haystack[offset + index] !== needle[index]) continue outer;
    }
    return true;
  }
  return false;
}
