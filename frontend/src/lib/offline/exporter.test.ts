import * as XLSX from "@e965/xlsx";
import {
  BlobReader,
  TextWriter,
  Uint8ArrayWriter,
  ZipReader,
} from "@zip.js/zip.js";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  PASSENGER_EXPORT_COLUMNS,
  createDeliveryZipBlob,
  createDocumentsZipBlob,
  createGateVisaTemplateXlsxBlob,
  createIdoDailyPassengerListHtmlBlob,
  createManifestHtmlBlob,
  createPassengerCsvBlob,
  createPassengerXlsxBlob,
  createPhotosZipBlob,
  sanitizeZipFilename,
  saveBlob,
  type ExportPassengerRow,
} from "./exporter";

const passenger: ExportPassengerRow = {
  no: "1",
  first_name: "AYŞE",
  last_name: "YILMAZ",
  full_name: "AYŞE YILMAZ",
  passport_no: "TR123456",
  voucher: "V-1",
  departure_date: "2026-07-15",
  arrival_date: "2026-07-22",
  adult_fee: "25",
  child_fee: "0",
  source_file: "liste.xlsx",
  sheet: "PAX LIST",
  photo: "ayse.jpg",
};

async function zipContents(blob: Blob): Promise<Map<string, string>> {
  const reader = new ZipReader(new BlobReader(blob), { useWebWorkers: false });
  const contents = new Map<string, string>();
  try {
    for await (const entry of reader.getEntriesGenerator()) {
      if (!entry.directory) {
        contents.set(entry.filename, await entry.getData(new TextWriter(), {
          checkSignature: true,
          useWebWorkers: false,
        }));
      }
    }
  } finally {
    await reader.close();
  }
  return contents;
}

async function zipEntryBytes(blob: Blob, filename: string): Promise<Uint8Array> {
  const reader = new ZipReader(new BlobReader(blob), { useWebWorkers: false });
  try {
    for await (const entry of reader.getEntriesGenerator()) {
      if (!entry.directory && entry.filename === filename) {
        return entry.getData(new Uint8ArrayWriter(), { checkSignature: true, useWebWorkers: false });
      }
    }
  } finally {
    await reader.close();
  }
  throw new Error(`${filename} bulunamadı`);
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("passenger exports", () => {
  it("creates an XLSX with the exact 13-column schema", async () => {
    const blob = createPassengerXlsxBlob([passenger]);
    const workbook = XLSX.read(await blob.arrayBuffer(), { type: "array" });
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets.Yolcular, {
      header: 1,
      defval: "",
      raw: true,
    });

    expect(blob.type).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(matrix[0]).toEqual(PASSENGER_EXPORT_COLUMNS);
    expect(matrix[1]).toEqual([
      "1",
      "AYŞE",
      "YILMAZ",
      "AYŞE YILMAZ",
      "TR123456",
      "V-1",
      "2026-07-15",
      "2026-07-22",
      "25",
      "0",
      "liste.xlsx",
      "PAX LIST",
      "ayse.jpg",
    ]);
  });

  it("creates UTF-8 BOM CSV and neutralizes formula-looking cells", async () => {
    const blob = createPassengerCsvBlob([{ ...passenger, first_name: "=2+2", full_name: "=2+2 YILMAZ" }]);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const csv = await blob.text();

    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(csv).toContain(PASSENGER_EXPORT_COLUMNS.join(","));
    expect(csv).toContain("1,'=2+2,YILMAZ,'=2+2 YILMAZ");
    expect(csv.endsWith("\r\n")).toBe(true);
  });

  it("creates the standard two-row Gate Visa XLSX template", async () => {
    const blob = createGateVisaTemplateXlsxBlob();
    const workbook = XLSX.read(await blob.arrayBuffer(), { type: "array" });
    const worksheet = workbook.Sheets["PAX LIST"];

    expect(worksheet.A1.v).toBe("GATE VISA PAX LIST");
    expect(worksheet.A3.v).toBe("NO");
    expect(worksheet.F3.v).toBe("DATE");
    expect(worksheet.F4.v).toBe("DEPARTURE");
    expect(worksheet.G4.v).toBe("ARRIVAL");
    expect(worksheet.H3.v).toBe("VISA FEE");
    expect(worksheet.H4.v).toBe("ADULT");
    expect(worksheet.I4.v).toBe("CHILD");
    expect(worksheet["!merges"]).toHaveLength(8);
  });

  it("creates a self-contained escaped HTML manifest", async () => {
    const blob = createManifestHtmlBlob(
      [{ ...passenger, full_name: '<img src=x onerror="alert(1)">' }],
      { title: "Temmuz <Teslim>", generatedAt: new Date("2026-07-17T01:00:00.000Z"), photoCount: 4 },
    );
    const html = await blob.text();

    expect(blob.type).toBe("text/html;charset=utf-8");
    expect(html).toContain("Temmuz &lt;Teslim&gt;");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("2026-07-17T01:00:00.000Z");
    expect(html).toContain("<b>4</b><span>Fotoğraf dosyası</span>");
  });

  it("creates a self-contained IDO-branded printable daily passenger list", async () => {
    const logo = "data:image/jpeg;base64,aWRvLWxvZ28=";
    const blob = createIdoDailyPassengerListHtmlBlob(
      [
        { ...passenger, no: "2", full_name: "ZEYNEP ÖZTÜRK", documents: [{ id: "doc-1", filename: "evrak.pdf" }] },
        { ...passenger, no: "1", full_name: '<img src=x onerror="alert(1)">', passport_no: "TR000001" },
      ],
      {
        operationLabel: "2026-07-15",
        generatedAt: new Date("2026-07-17T01:00:00.000Z"),
        logoDataUrl: logo,
      },
    );
    const html = await blob.text();

    expect(blob.type).toBe("text/html;charset=utf-8");
    expect(html).toContain(`src="${logo}"`);
    expect(html).toContain("İDO Günlük Yolcu Listesi");
    expect(html).toContain("2026-07-15");
    expect(html).toContain("YAZDIR / PDF KAYDET");
    expect(html).toContain("@page{size:A4 landscape");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(html).not.toContain("<img src=x");
    expect(html.indexOf("TR000001")).toBeLessThan(html.indexOf("ZEYNEP ÖZTÜRK"));
    expect(html).not.toContain('src="/brand/ido-logo.jpg"');
  });
});

describe("ZIP exports", () => {
  it("sanitizes unsafe and reserved filenames", () => {
    expect(sanitizeZipFilename("../../passport.jpg")).toBe("passport.jpg");
    expect(sanitizeZipFilename("C:\\temp\\bad:*?.jpg")).toBe("bad___.jpg");
    expect(sanitizeZipFilename("CON")).toBe("_CON");
    expect(sanitizeZipFilename("..", "yedek")).toBe("yedek");
  });

  it("creates a photo ZIP with safe, de-duplicated names and no count cap", async () => {
    const photos = [
      { filename: "../face.jpg", blob: new Blob(["first"], { type: "image/jpeg" }) },
      { filename: "face.jpg", blob: new Blob(["second"], { type: "image/jpeg" }) },
      ...Array.from({ length: 101 }, (_, index) => ({
        filename: `photo-${index}.jpg`,
        blob: new Blob([String(index)], { type: "image/jpeg" }),
      })),
    ];
    const contents = await zipContents(await createPhotosZipBlob(photos));

    expect(contents.size).toBe(103);
    expect(contents.get("fotograflar/face.jpg")).toBe("first");
    expect(contents.get("fotograflar/face (2).jpg")).toBe("second");
    expect([...contents.keys()].some((name) => name.includes(".."))).toBe(false);
  });

  it("creates one delivery ZIP with lists, manifest, optional template and photos", async () => {
    const delivery = await createDeliveryZipBlob(
      [passenger],
      [{ filename: "ayse.jpg", blob: new Blob(["jpeg"], { type: "image/jpeg" }) }],
      { includeTemplate: true, generatedAt: new Date("2026-07-17T01:00:00.000Z") },
    );
    const contents = await zipContents(delivery);

    expect(delivery.type).toBe("application/zip");
    expect([...contents.keys()].sort()).toEqual([
      "fotograflar/ayse.jpg",
      "standart-gate-visa-sablonu.xlsx",
      "teslim-manifestosu.html",
      "yolcu-listesi.csv",
      "yolcu-listesi.xlsx",
    ]);
    expect(contents.get("teslim-manifestosu.html")).toContain("AYŞE YILMAZ");
    expect([...(await zipEntryBytes(delivery, "yolcu-listesi.csv")).slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  });

  it("adds passenger PDF documents under isolated safe folders", async () => {
    const documents = [
      {
        passengerId: 7,
        passengerName: "AYŞE YILMAZ",
        passportNo: "TR123456",
        filename: "../pasaport.pdf",
        blob: new Blob(["%PDF-1.7\npassport\n%%EOF"], { type: "application/pdf" }),
      },
      {
        passengerId: 7,
        passengerName: "AYŞE YILMAZ",
        passportNo: "TR123456",
        filename: "pasaport.pdf",
        blob: new Blob(["%PDF-1.7\nvisa\n%%EOF"], { type: "application/pdf" }),
      },
    ];
    const documentZip = await zipContents(await createDocumentsZipBlob(documents));
    expect([...documentZip.keys()].sort()).toEqual([
      "evraklar/TR123456-7/pasaport (2).pdf",
      "evraklar/TR123456-7/pasaport.pdf",
    ]);

    const delivery = await zipContents(await createDeliveryZipBlob(
      [{ ...passenger, documents: [{ id: "doc-1", filename: "pasaport.pdf" }] }],
      [],
      { documents },
    ));
    expect(delivery.get("evraklar/TR123456-7/pasaport.pdf")).toContain("passport");
    expect(delivery.get("teslim-manifestosu.html")).toContain("<b>2</b><span>PDF evrak</span>");
  });
});

describe("saveBlob", () => {
  it("uses file sharing when the browser supports it", async () => {
    class TestFile extends Blob {
      readonly name: string;
      readonly lastModified = 0;
      constructor(parts: BlobPart[], name: string, options?: FilePropertyBag) {
        super(parts, options);
        this.name = name;
      }
    }
    const share = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("File", TestFile);
    vi.stubGlobal("navigator", { share, canShare: () => true });

    await expect(saveBlob(new Blob(["data"], { type: "text/plain" }), "../rapor.csv")).resolves.toBe("shared");
    expect(share).toHaveBeenCalledOnce();
    expect(share.mock.calls[0][0].files[0].name).toBe("rapor.csv");
  });

  it("falls back to a temporary download anchor and revokes its URL", async () => {
    vi.useFakeTimers();
    const click = vi.fn();
    const remove = vi.fn();
    const appendChild = vi.fn();
    const anchor = { href: "", download: "", rel: "", style: { display: "" }, click, remove };
    const createObjectURL = vi.fn(() => "blob:offline-export");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("navigator", {});
    vi.stubGlobal("document", {
      createElement: () => anchor,
      body: { appendChild },
      documentElement: { appendChild },
    });
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });

    await expect(saveBlob(new Blob(["data"]), "rapor.csv")).resolves.toBe("downloaded");
    expect(anchor.download).toBe("rapor.csv");
    expect(appendChild).toHaveBeenCalledWith(anchor);
    expect(click).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledOnce();
    vi.runAllTimers();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:offline-export");
  });
});
