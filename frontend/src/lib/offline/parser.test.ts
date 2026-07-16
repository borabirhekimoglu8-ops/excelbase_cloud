import * as XLSX from "@e965/xlsx";
import {
  TextReader,
  Uint8ArrayReader,
  Uint8ArrayWriter,
  ZipWriter,
} from "@zip.js/zip.js";
import { describe, expect, it } from "vitest";

import {
  normalizeDate,
  parsePassengerBytes,
  parseSelectedFile,
} from "./parser";

type ZipMember = { name: string; data: string | Uint8Array; level?: number };

async function makeZip(members: ZipMember[]): Promise<Uint8Array> {
  const writer = new ZipWriter(new Uint8ArrayWriter(), { useWebWorkers: false });
  for (const member of members) {
    const reader = typeof member.data === "string"
      ? new TextReader(member.data)
      : new Uint8ArrayReader(member.data);
    await writer.add(member.name, reader, { useWebWorkers: false, level: member.level ?? 6 });
  }
  return writer.close();
}

function makeGateWorkbook(bookType: XLSX.BookType = "xlsx"): Uint8Array {
  const serial = Math.floor((Date.UTC(2026, 6, 15) - Date.UTC(1899, 11, 30)) / 86_400_000);
  const worksheet = XLSX.utils.aoa_to_sheet([
    ["GATE VISA PAX LIST"],
    [],
    ["NO", "NAME", "SURNAME", "PASSPORT NUMBER", "VOUCHER", "DATE", "", "VISA FEE", ""],
    ["", "", "", "", "", "DEPARTURE", "ARRIVAL", "ADULT", "CHILD"],
    [1, "AYŞE", "YILMAZ", "TR 123456", "V-1", serial, "22.07.2026", 25, 0],
  ]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "PAX LIST");
  return XLSX.write(workbook, { type: "array", bookType }) as Uint8Array;
}

const passengerCsv = (number = 1) => [
  "NO;NAME;SURNAME;PASSPORT NUMBER;VOUCHER;DEPARTURE;ARRIVAL;ADULT;CHILD",
  `${number};ADA;LOVELACE;P${String(number).padStart(6, "0")};V-${number};15.07.2026;22.07.2026;25;0`,
].join("\n");

describe("offline passenger parser", () => {
  it("parses the two-row Gate Visa workbook and normalizes dates", async () => {
    const result = await parsePassengerBytes("gate.xlsx", makeGateWorkbook());

    expect(result.errors).toEqual([]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      no: "1",
      first_name: "AYŞE",
      last_name: "YILMAZ",
      full_name: "AYŞE YILMAZ",
      passport_no: "TR 123456",
      departure_date: "2026-07-15",
      arrival_date: "2026-07-22",
      adult_fee: "25",
      child_fee: "0",
      source_file: "gate.xlsx",
      sheet: "PAX LIST",
    });
  });

  it("uses Turkish fallback headers and day-first CSV dates", async () => {
    const csv = [
      "Sıra;Ad;Soyad;Pasaport No;PNR;Gidiş Tarihi;Varış Tarihi;Yetişkin;Çocuk",
      "7;İpek;Öztürk;U1234567;PNR-7;03/08/2026;10/08/2026;30;12",
    ].join("\n");
    const result = await parsePassengerBytes("yanlis-uzanti.dat", new TextEncoder().encode(csv));

    expect(result.errors).toEqual([]);
    expect(result.rows[0]).toMatchObject({
      no: "7",
      first_name: "İpek",
      last_name: "Öztürk",
      passport_no: "U1234567",
      voucher: "PNR-7",
      departure_date: "2026-08-03",
      arrival_date: "2026-08-10",
    });
  });

  it("recognizes workbook content without trusting the extension", async () => {
    const result = await parsePassengerBytes("liste.bin", makeGateWorkbook());

    expect(result.errors).toEqual([]);
    expect(result.rows).toHaveLength(1);
  });

  it.each(["xls", "xlsm", "ods"] as const)("parses %s workbook content", async (bookType) => {
    const result = await parsePassengerBytes(`liste.${bookType}`, makeGateWorkbook(bookType));

    expect(result.errors).toEqual([]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].full_name).toBe("AYŞE YILMAZ");
  });

  it("returns a file-level error for a corrupt spreadsheet", async () => {
    const result = await parsePassengerBytes("bozuk.xlsx", new Uint8Array([1, 2, 3, 0, 5]));

    expect(result.rows).toEqual([]);
    expect(result.files[0].error).toMatch(/desteklenen bir tablo biçimi değil/i);
  });

  it("keeps valid ZIP members when another member is corrupt or unsafe", async () => {
    const nested = await makeZip([{ name: "inside.csv", data: passengerCsv(9) }]);
    const archive = await makeZip([
      { name: "lists/valid.csv", data: passengerCsv(1) },
      { name: "lists/corrupt.xlsx", data: "this is not an excel workbook" },
      { name: "../escape.csv", data: passengerCsv(2) },
      { name: "/absolute.csv", data: passengerCsv(3) },
      { name: "nested.zip", data: nested },
    ]);

    const result = await parsePassengerBytes("batch.zip", archive);

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].passport_no).toBe("P000001");
    expect(result.errors.some((error) => error.includes("corrupt.xlsx"))).toBe(true);
    expect(result.errors.some((error) => error.includes("escape.csv") && error.includes("Üst dizine"))).toBe(true);
    expect(result.errors.some((error) => error.includes("absolute.csv") && error.includes("Mutlak"))).toBe(true);
    expect(result.errors.some((error) => error.includes("nested.zip") && error.includes("İç içe"))).toBe(true);
  });

  it("has no ZIP member-count cap and processes members sequentially", async () => {
    const members = Array.from({ length: 105 }, (_, index) => ({
      name: `lists/${index + 1}.csv`,
      data: passengerCsv(index + 1),
    }));
    const archive = await makeZip(members);
    const result = await parsePassengerBytes("many.zip", archive);

    expect(result.errors).toEqual([]);
    expect(result.files).toHaveLength(105);
    expect(result.rows).toHaveLength(105);
  });

  it("enforces decompressed byte and compression-ratio security limits", async () => {
    const repetitive = `${passengerCsv(1)}\n${"A".repeat(8_000)}`;
    const archive = await makeZip([{ name: "ratio.csv", data: repetitive, level: 9 }]);
    const result = await parsePassengerBytes("ratio.zip", archive, {
      minRatioCheckBytes: 100,
      maxCompressionRatio: 2,
    });

    expect(result.rows).toEqual([]);
    expect(result.errors.join(" ")).toMatch(/sıkıştırma oranı/i);
  });

  it("reports an archive that contains no passenger table", async () => {
    const archive = await makeZip([{ name: "photo.jpg", data: new Uint8Array([0xff, 0xd8, 0, 1]) }]);
    const result = await parsePassengerBytes("photos.zip", archive);

    expect(result.rows).toEqual([]);
    expect(result.errors.join(" ")).toMatch(/desteklenen yolcu tablosu bulunamadı/i);
  });

  it("reads through the File-like browser API and reports arrayBuffer failures", async () => {
    const ok = await parseSelectedFile({
      name: "list.csv",
      arrayBuffer: async () => new TextEncoder().encode(passengerCsv(4)).buffer,
    });
    expect(ok.rows).toHaveLength(1);

    const failed = await parseSelectedFile({
      name: "icloud.xlsx",
      arrayBuffer: async () => {
        throw new DOMException("not downloaded", "NotReadableError");
      },
    });
    expect(failed.files[0].error).toMatch(/Dosya okunamadı/);
  });
});

describe("date normalization", () => {
  it.each([
    ["2026-07-15", "2026-07-15"],
    ["15.07.2026", "2026-07-15"],
    ["15/07/26", "2026-07-15"],
    ["not-a-date", "not-a-date"],
  ])("normalizes %s", (input, expected) => {
    expect(normalizeDate(input)).toBe(expected);
  });
});
