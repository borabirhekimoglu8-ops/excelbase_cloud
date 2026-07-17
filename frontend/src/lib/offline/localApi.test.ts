import "fake-indexeddb/auto";

import { webcrypto } from "node:crypto";
import { deleteDB } from "idb";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPassengerXlsxBlob } from "./exporter";
import {
  localDeletePassengerDocument,
  localDeletePassenger,
  localPassengers,
  localMatchPhotos,
  localMergeDuplicates,
  localPassengerDocumentFile,
  localPassengerDocuments,
  localQueueImportFile,
  localSetPassengerPhoto,
  localSummary,
  localUploadPassengerDocuments,
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

function pdfFile(name = "pasaport.pdf", body = "Gate Visa Checklist test evrakı"): File {
  return new File([`%PDF-1.7\n${body}\n%%EOF`], name, {
    type: "application/pdf",
    lastModified: Date.now(),
  });
}

function jpegFile(name = "biyometrik.jpg"): File {
  return new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0xff, 0xd9])], name, {
    type: "image/jpeg",
    lastModified: Date.now(),
  });
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
    const passengerId = (await localPassengers())[0].id;
    const [document] = await localUploadPassengerDocuments(passengerId, [pdfFile("BACK123-pasaport.pdf")]);
    const backup = await exportEncryptedVault();
    await restoreEncryptedVault(backup);
    await unlockVault("123456");
    expect((await localPassengers()).map((row) => row.passport_no)).toEqual(["BACK123"]);
    const restored = await localPassengerDocumentFile(passengerId, document.id);
    expect(restored.metadata).toMatchObject({ filename: "BACK123-pasaport.pdf", mime: "application/pdf" });
    expect(await restored.blob.text()).toContain("Gate Visa Checklist test evrakı");
  });

  it("yolcu PDF evrakını şifreli kasada saklar, açar ve siler", async () => {
    await localQueueImportFile(workbookFile("evrak.xlsx", "Evrak Yolcu", "DOC12345"), false, "skip", "d", "dj");
    const passengerId = (await localPassengers())[0].id;

    const [document] = await localUploadPassengerDocuments(passengerId, [pdfFile("DOC12345-pasaport.pdf")]);
    expect(document).toMatchObject({ filename: "DOC12345-pasaport.pdf", mime: "application/pdf" });
    expect(document.size).toBeGreaterThan(0);
    expect(await localPassengerDocuments(passengerId)).toEqual([document]);
    expect((await localPassengers())[0].documents).toEqual([document]);
    expect((await listBinaryIds()).filter((id) => id.startsWith("document:"))).toHaveLength(1);

    const opened = await localPassengerDocumentFile(passengerId, document.id);
    expect(opened.metadata).toEqual(document);
    expect(opened.blob.type).toBe("application/pdf");
    expect(await opened.blob.text()).toContain("%PDF-1.7");

    await localDeletePassengerDocument(passengerId, document.id);
    expect(await localPassengerDocuments(passengerId)).toEqual([]);
    expect((await listBinaryIds()).filter((id) => id.startsWith("document:"))).toHaveLength(0);
  });

  it("sahte PDF içeren çoklu seçimi atomik olarak reddeder", async () => {
    await localQueueImportFile(workbookFile("evrak.xlsx", "Güvenli Yolcu", "SAFE1234"), false, "skip", "sd", "sdj");
    const passengerId = (await localPassengers())[0].id;
    const spoofedPdf = new File(["<html>PDF değil</html>"], "sahte.pdf", { type: "application/pdf" });

    await expect(localUploadPassengerDocuments(passengerId, [pdfFile("gecerli.pdf"), spoofedPdf]))
      .rejects.toThrow(/geçerli PDF imzası/i);
    expect(await localPassengerDocuments(passengerId)).toEqual([]);
    expect((await listBinaryIds()).filter((id) => id.startsWith("document:"))).toHaveLength(0);
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

  it("yolcu biyometrik alanına yalnız gerçek JPG/JPEG kabul eder", async () => {
    await localQueueImportFile(workbookFile("bio.xlsx", "Bio Yolcu", "BIO12345"), false, "skip", "bio", "bio-job");
    const passengerId = (await localPassengers())[0].id;

    const spoofedJpeg = new File(["JPG değil"], "biyometrik.jpg", { type: "image/jpeg" });
    await expect(localSetPassengerPhoto(passengerId, spoofedJpeg)).rejects.toThrow(/geçerli bir JPG\/JPEG/i);
    expect((await localPassengers())[0].photo).toBe("");
    expect((await listBinaryIds()).filter((id) => id.startsWith("photo:"))).toHaveLength(0);

    await localSetPassengerPhoto(passengerId, jpegFile());
    expect((await localPassengers())[0].photo).toMatch(/^photo:/);
    expect((await listBinaryIds()).filter((id) => id.startsWith("photo:"))).toHaveLength(1);
  });

  it("toplu biyometrik eşleştirmede sahte JPG ve farklı görsel türlerini reddeder", async () => {
    await localQueueImportFile(workbookFile("bio.xlsx", "Toplu Bio", "BULK1234"), false, "skip", "bulk", "bulk-job");
    const spoofedJpeg = new File(["sahte"], "BULK1234.jpg", { type: "image/jpeg" });
    const png = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "BULK1234.png", { type: "image/png" });

    await expect(localMatchPhotos([spoofedJpeg])).rejects.toThrow(/geçerli bir JPG\/JPEG/i);
    await expect(localMatchPhotos([png])).rejects.toThrow(/JPG\/JPEG/i);
    expect((await localPassengers())[0].photo).toBe("");
  });

  it("tekrarlı yolcular birleşirken PDF evrakları korur ve yolcu silinince ikilileri temizler", async () => {
    await localQueueImportFile(workbookFile("bir.xlsx", "Bir Yolcu", "MERGE123"), false, "add", "m1", "mj1");
    await localQueueImportFile(workbookFile("iki.xlsx", "İki Yolcu", "MERGE123"), false, "add", "m2", "mj2");
    const passengers = await localPassengers();
    await localUploadPassengerDocuments(passengers[0].id, [pdfFile("pasaport.pdf")]);
    await localUploadPassengerDocuments(passengers[1].id, [pdfFile("vize.pdf")]);

    await localMergeDuplicates();
    const [merged] = await localPassengers();
    expect(merged.documents?.map((document) => document.filename).sort()).toEqual(["pasaport.pdf", "vize.pdf"]);
    expect((await listBinaryIds()).filter((id) => id.startsWith("document:"))).toHaveLength(2);

    await localDeletePassenger(merged.id);
    expect((await listBinaryIds()).filter((id) => id.startsWith("document:"))).toHaveLength(0);
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
    const oldPassengerId = (await localPassengers())[0].id;
    await localUploadPassengerDocuments(oldPassengerId, [pdfFile("eski-evrak.pdf")]);
    const photo = Object.assign(new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: "image/jpeg" }), {
      name: "OLD12345.jpg",
      lastModified: Date.now(),
    }) as File;
    await localMatchPhotos([photo]);
    expect((await listBinaryIds()).filter((id) => id.startsWith("photo:"))).toHaveLength(1);
    expect((await listBinaryIds()).filter((id) => id.startsWith("document:"))).toHaveLength(1);

    await localQueueImportFile(workbookFile("yeni.xlsx", "Yeni Yolcu", "NEW12345"), true, "skip", "replace", "replace-job");
    expect((await listBinaryIds()).filter((id) => id.startsWith("photo:"))).toHaveLength(1);
    expect((await listBinaryIds()).filter((id) => id.startsWith("document:"))).toHaveLength(1);

    await localQueueImportFile(workbookFile("son.xlsx", "Son Yolcu", "LAST1234"), false, "skip", "next", "next-job");
    expect((await listBinaryIds()).filter((id) => id.startsWith("photo:"))).toHaveLength(0);
    expect((await listBinaryIds()).filter((id) => id.startsWith("document:"))).toHaveLength(0);
  });

  it("aynı aktarım kimliği yeniden çalışırsa add modunda bile yolcuyu çoğaltmaz", async () => {
    const file = workbookFile("idempotent.xlsx", "Tek Yolcu", "ONCE123");
    await localQueueImportFile(file, false, "add", "same-batch", "same-job");
    await localQueueImportFile(file, false, "add", "same-batch", "same-job");
    expect((await localPassengers()).map((row) => row.passport_no)).toEqual(["ONCE123"]);
  });
});
