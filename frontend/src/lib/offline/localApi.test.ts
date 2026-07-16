import "fake-indexeddb/auto";

import { webcrypto } from "node:crypto";
import { deleteDB } from "idb";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPassengerXlsxBlob } from "./exporter";
import {
  localPassengers,
  localMatchPhotos,
  localQueueImportFile,
  localSummary,
} from "./localApi";
import {
  VAULT_DATABASE_NAME,
  closeVaultDatabase,
  exportEncryptedVault,
  listBinaryIds,
  lockVault,
  restoreEncryptedVault,
  setupVault,
  unlockVault,
} from "./vault";

Object.defineProperty(globalThis, "crypto", { configurable: true, value: webcrypto });

async function resetDatabase(): Promise<void> {
  lockVault();
  await closeVaultDatabase();
  await deleteDB(VAULT_DATABASE_NAME);
}

function workbookFile(name: string, passengerName: string, passport: string): File {
  const [firstName, ...surnameParts] = passengerName.split(" ");
  const blob = createPassengerXlsxBlob([{
    no: "1",
    first_name: firstName,
    last_name: surnameParts.join(" "),
    full_name: passengerName,
    passport_no: passport,
    voucher: "V-1",
    departure_date: "2026-07-16",
    arrival_date: "2026-07-20",
    adult_fee: "25",
    child_fee: "0",
    source_file: name,
    sheet: "Yolcular",
  }]);
  return Object.assign(blob, { name, lastModified: Date.now() }) as File;
}

beforeEach(async () => {
  await resetDatabase();
  await setupVault("Yerel Yönetici", "123456");
});
afterEach(resetDatabase);

describe("local offline API", () => {
  it("işlenen Excel yolcularını beklemeden yerel listede gösterir", async () => {
    const result = await localQueueImportFile(
      workbookFile("16.07.xlsx", "Ayşe Yılmaz", "TR123456"),
      false,
      "skip",
      "batch-1",
      "job-1",
    );
    expect(result.jobs[0]).toMatchObject({ status: "done", imported: 1 });
    expect((await localPassengers()).map((row) => row.full_name)).toEqual(["Ayşe Yılmaz"]);
    expect((await localSummary()).passenger_count).toBe(1);
  });

  it("değiştirme niyetini ilk bozuk dosyada tüketmez", async () => {
    await localQueueImportFile(workbookFile("eski.xlsx", "Eski Yolcu", "OLD123"), false, "skip", "seed", "seed-job");

    const empty = Object.assign(new Blob([]), { name: "bos.xlsx", lastModified: Date.now() }) as File;
    const failed = await localQueueImportFile(empty, true, "skip", "replace-batch", "bad-job", 0);
    expect(failed.jobs[0].status).toBe("error");
    expect((await localPassengers()).map((row) => row.full_name)).toEqual(["Eski Yolcu"]);

    await localQueueImportFile(
      workbookFile("yeni.xlsx", "Yeni Yolcu", "NEW123"),
      true,
      "skip",
      "replace-batch",
      "good-job",
      1,
    );
    expect((await localPassengers()).map((row) => row.full_name)).toEqual(["Yeni Yolcu"]);
  });

  it("şifreli yedeği geri yükleyip aynı kodla açar", async () => {
    await localQueueImportFile(workbookFile("yedek.xlsx", "Yedek Yolcu", "BACK123"), false, "skip", "b", "j");
    const backup = await exportEncryptedVault();
    await restoreEncryptedVault(backup);
    await unlockVault("123456");
    expect((await localPassengers()).map((row) => row.passport_no)).toEqual(["BACK123"]);
  });

  it("pasaport numaralı fotoğrafı doğru yolcuya yerel olarak bağlar", async () => {
    await localQueueImportFile(workbookFile("foto.xlsx", "Foto Yolcu", "PIC12345"), false, "skip", "p", "pj");
    const photo = Object.assign(new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: "image/jpeg" }), {
      name: "PIC12345.jpg",
      lastModified: Date.now(),
    }) as File;
    const result = await localMatchPhotos([photo]);
    expect(result).toMatchObject({ matched: 1, unmatched: [] });
    const passenger = (await localPassengers())[0];
    expect(passenger.photo).toMatch(/^photo:/);
    expect(passenger.photo_url).toMatch(/^blob:/);
  });

  it("kısa pasaport parçalarıyla fotoğrafı yanlış yolcuya otomatik bağlamaz", async () => {
    await localQueueImportFile(workbookFile("kisa.xlsx", "Kısa Numara", "1"), false, "skip", "s", "sj");
    const photo = Object.assign(new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: "image/jpeg" }), {
      name: "portrait-1.jpg",
      lastModified: Date.now(),
    }) as File;
    const result = await localMatchPhotos([photo]);
    expect(result).toMatchObject({ matched: 0, unmatched: ["portrait-1.jpg"] });
    expect((await localPassengers())[0].photo).toBe("");
  });

  it("geri alma kapsamından çıkan eski fotoğraf ikililerini temizler", async () => {
    await localQueueImportFile(workbookFile("eski.xlsx", "Foto Eski", "OLD12345"), false, "skip", "old", "old-job");
    const photo = Object.assign(new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: "image/jpeg" }), {
      name: "OLD12345.jpg",
      lastModified: Date.now(),
    }) as File;
    await localMatchPhotos([photo]);
    expect((await listBinaryIds()).filter((id) => id.startsWith("photo:"))).toHaveLength(1);

    await localQueueImportFile(workbookFile("yeni.xlsx", "Yeni Yolcu", "NEW12345"), true, "skip", "replace", "replace-job");
    expect((await listBinaryIds()).filter((id) => id.startsWith("photo:"))).toHaveLength(1);

    await localQueueImportFile(workbookFile("son.xlsx", "Son Yolcu", "LAST1234"), false, "skip", "next", "next-job");
    expect((await listBinaryIds()).filter((id) => id.startsWith("photo:"))).toHaveLength(0);
  });

  it("aynı aktarım kimliği yeniden çalışırsa add modunda bile yolcuyu çoğaltmaz", async () => {
    const file = workbookFile("idempotent.xlsx", "Tek Yolcu", "ONCE123");
    await localQueueImportFile(file, false, "add", "same-batch", "same-job");
    await localQueueImportFile(file, false, "add", "same-batch", "same-job");
    expect((await localPassengers()).map((row) => row.passport_no)).toEqual(["ONCE123"]);
  });
});
