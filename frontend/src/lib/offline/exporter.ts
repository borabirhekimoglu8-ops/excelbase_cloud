import * as XLSX from "@e965/xlsx";
import {
  BlobReader,
  Uint8ArrayWriter,
  ZipWriter,
} from "@zip.js/zip.js";

import type { ParsedPassengerRow } from "./parser";

export const PASSENGER_EXPORT_COLUMNS = [
  "No",
  "Ad",
  "Soyad",
  "Yolcu Adı Soyadı",
  "Pasaport No",
  "Voucher",
  "Gidiş Tarihi",
  "Varış Tarihi",
  "Vize Ücreti Yetişkin",
  "Vize Ücreti Çocuk",
  "Kaynak Dosya",
  "Sayfa",
  "Foto",
] as const;

export type ExportPassengerRow = ParsedPassengerRow & {
  photo?: string;
};

export type ExportPhoto = {
  filename: string;
  blob: Blob;
};

export type ManifestOptions = {
  title?: string;
  generatedAt?: Date;
  photoCount?: number;
};

export type DeliveryZipOptions = ManifestOptions & {
  includeTemplate?: boolean;
};

export type SaveBlobResult = "shared" | "downloaded" | "cancelled";

type ExportRecord = Record<(typeof PASSENGER_EXPORT_COLUMNS)[number], string>;

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const ZIP_MIME = "application/zip";

function text(value: unknown): string {
  if (value === null || value === undefined) return "";
  const output = String(value).trim();
  return output.toLocaleLowerCase("en-US") === "nan" ? "" : output;
}

function exportRecord(row: ExportPassengerRow): ExportRecord {
  return {
    No: text(row.no),
    Ad: text(row.first_name),
    Soyad: text(row.last_name),
    "Yolcu Adı Soyadı": text(row.full_name) || [text(row.first_name), text(row.last_name)].filter(Boolean).join(" "),
    "Pasaport No": text(row.passport_no),
    Voucher: text(row.voucher),
    "Gidiş Tarihi": text(row.departure_date),
    "Varış Tarihi": text(row.arrival_date),
    "Vize Ücreti Yetişkin": text(row.adult_fee),
    "Vize Ücreti Çocuk": text(row.child_fee),
    "Kaynak Dosya": text(row.source_file),
    Sayfa: text(row.sheet),
    Foto: text(row.photo),
  };
}

function workbookBytes(workbook: XLSX.WorkBook): Uint8Array {
  const output = XLSX.write(workbook, {
    type: "array",
    bookType: "xlsx",
    compression: true,
  }) as ArrayBuffer | Uint8Array;
  return output instanceof Uint8Array ? output : new Uint8Array(output);
}

function copyBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function blobFromBytes(bytes: Uint8Array, type: string): Blob {
  return new Blob([copyBuffer(bytes)], { type });
}

export function createPassengerXlsxBlob(rows: readonly ExportPassengerRow[]): Blob {
  const records = rows.map(exportRecord);
  const worksheet = XLSX.utils.json_to_sheet(records, {
    header: [...PASSENGER_EXPORT_COLUMNS],
    skipHeader: false,
  });
  worksheet["!cols"] = [
    { wch: 8 },
    { wch: 18 },
    { wch: 18 },
    { wch: 32 },
    { wch: 20 },
    { wch: 18 },
    { wch: 15 },
    { wch: 15 },
    { wch: 22 },
    { wch: 20 },
    { wch: 28 },
    { wch: 18 },
    { wch: 28 },
  ];
  const lastRow = Math.max(rows.length + 1, 1);
  worksheet["!autofilter"] = { ref: `A1:M${lastRow}` };

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Yolcular");
  workbook.Props = {
    Title: "Excelbase Yolcu Listesi",
    Subject: "Çevrimdışı yolcu verisi dışa aktarımı",
    Company: "Excelbase",
  };
  return blobFromBytes(workbookBytes(workbook), XLSX_MIME);
}

function csvCell(value: unknown): string {
  let output = text(value);
  // Spreadsheet programs may execute formula-looking CSV cells. An apostrophe
  // keeps user-provided values as text without changing the stored source data.
  if (/^[=+\-@]/.test(output)) output = `'${output}`;
  return /[",\r\n]/.test(output) ? `"${output.replaceAll('"', '""')}"` : output;
}

export function createPassengerCsvBlob(rows: readonly ExportPassengerRow[]): Blob {
  const lines: string[] = [PASSENGER_EXPORT_COLUMNS.map(csvCell).join(",")];
  for (const row of rows) {
    const record = exportRecord(row);
    lines.push(PASSENGER_EXPORT_COLUMNS.map((column) => csvCell(record[column])).join(","));
  }
  return new Blob([`\uFEFF${lines.join("\r\n")}\r\n`], { type: "text/csv;charset=utf-8" });
}

export function createGateVisaTemplateXlsxBlob(): Blob {
  const worksheet = XLSX.utils.aoa_to_sheet([
    ["GATE VISA PAX LIST", "", "", "", "", "", "", "", ""],
    ["", "", "", "", "", "", "", "", ""],
    ["NO", "NAME", "SURNAME", "PASSPORT NUMBER", "VOUCHER", "DATE", "", "VISA FEE", ""],
    ["", "", "", "", "", "DEPARTURE", "ARRIVAL", "ADULT", "CHILD"],
  ]);
  worksheet["!merges"] = [
    XLSX.utils.decode_range("A1:I1"),
    XLSX.utils.decode_range("A3:A4"),
    XLSX.utils.decode_range("B3:B4"),
    XLSX.utils.decode_range("C3:C4"),
    XLSX.utils.decode_range("D3:D4"),
    XLSX.utils.decode_range("E3:E4"),
    XLSX.utils.decode_range("F3:G3"),
    XLSX.utils.decode_range("H3:I3"),
  ];
  worksheet["!cols"] = [
    { wch: 8 },
    { wch: 18 },
    { wch: 18 },
    { wch: 22 },
    { wch: 18 },
    { wch: 16 },
    { wch: 16 },
    { wch: 13 },
    { wch: 13 },
  ];
  worksheet["!rows"] = [{ hpt: 24 }, { hpt: 8 }, { hpt: 20 }, { hpt: 20 }];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "PAX LIST");
  workbook.Props = { Title: "GATE VISA PAX LIST", Company: "Excelbase" };
  return blobFromBytes(workbookBytes(workbook), XLSX_MIME);
}

function escapeHtml(value: unknown): string {
  return text(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function createManifestHtmlBlob(
  rows: readonly ExportPassengerRow[],
  options: ManifestOptions = {},
): Blob {
  const generatedAt = options.generatedAt ?? new Date();
  const title = options.title ?? "Excelbase Teslim Manifestosu";
  const withPhoto = rows.filter((row) => text(row.photo)).length;
  const photoCount = options.photoCount ?? withPhoto;
  const tableRows = rows.map((row, index) => {
    const record = exportRecord(row);
    return `<tr><td>${index + 1}</td><td>${escapeHtml(record["Yolcu Adı Soyadı"])}</td><td>${escapeHtml(record["Pasaport No"])}</td><td>${escapeHtml(record.Voucher)}</td><td>${escapeHtml(record["Gidiş Tarihi"])}</td><td>${escapeHtml(record["Varış Tarihi"])}</td><td>${record.Foto ? "Var" : "Yok"}</td></tr>`;
  }).join("");

  const html = `<!doctype html>
<html lang="tr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    :root{color-scheme:light;--ink:#0b2942;--muted:#64748b;--line:#d7e1e8;--accent:#087fa5;--paper:#fff;--wash:#f3f7f9}
    *{box-sizing:border-box}body{margin:0;background:var(--wash);color:var(--ink);font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    main{max-width:1120px;margin:32px auto;padding:0 24px}.head{display:flex;justify-content:space-between;gap:24px;align-items:end;margin-bottom:22px}
    h1{margin:0;font-size:28px;letter-spacing:-.02em}.eyebrow{color:var(--accent);font-weight:800;letter-spacing:.14em;text-transform:uppercase}.date{color:var(--muted)}
    .stats{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:18px 0}.stat{background:var(--paper);border:1px solid var(--line);border-radius:12px;padding:16px}.stat b{display:block;font-size:24px}.stat span{color:var(--muted)}
    .table{overflow:auto;background:var(--paper);border:1px solid var(--line);border-radius:12px}table{width:100%;border-collapse:collapse}th,td{padding:11px 13px;text-align:left;border-bottom:1px solid var(--line);white-space:nowrap}th{background:#eaf3f7;font-size:12px;letter-spacing:.04em;text-transform:uppercase}tr:last-child td{border-bottom:0}
    footer{margin-top:16px;color:var(--muted);font-size:12px}@media(max-width:700px){main{margin:20px auto;padding:0 14px}.head{display:block}.date{margin-top:8px}.stats{grid-template-columns:1fr}}
  </style>
</head>
<body><main>
  <div class="head"><div><div class="eyebrow">Teslim kaydı</div><h1>${escapeHtml(title)}</h1></div><div class="date">${escapeHtml(generatedAt.toISOString())}</div></div>
  <section class="stats"><div class="stat"><b>${rows.length}</b><span>Yolcu</span></div><div class="stat"><b>${photoCount}</b><span>Fotoğraf dosyası</span></div><div class="stat"><b>${withPhoto}</b><span>Fotoğrafı eşleşmiş yolcu</span></div></section>
  <div class="table"><table><thead><tr><th>No</th><th>Yolcu</th><th>Pasaport</th><th>Voucher</th><th>Gidiş</th><th>Varış</th><th>Foto</th></tr></thead><tbody>${tableRows}</tbody></table></div>
  <footer>Bu belge Excelbase çevrimdışı teslim paketiyle birlikte oluşturulmuştur.</footer>
</main></body></html>`;
  return new Blob([html], { type: "text/html;charset=utf-8" });
}

export function sanitizeZipFilename(filename: string, fallback = "dosya"): string {
  const leaf = text(filename).replaceAll("\\", "/").split("/").pop() ?? "";
  const cleaned = leaf
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, "_")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .slice(0, 180)
    .trim();
  if (!cleaned || cleaned === "." || cleaned === "..") return fallback;

  const stem = cleaned.split(".", 1)[0].toLocaleUpperCase("en-US");
  if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/.test(stem)) return `_${cleaned}`;
  return cleaned;
}

function uniqueFilename(filename: string, used: Set<string>): string {
  const sanitized = sanitizeZipFilename(filename);
  const dot = sanitized.lastIndexOf(".");
  const stem = dot > 0 ? sanitized.slice(0, dot) : sanitized;
  const suffix = dot > 0 ? sanitized.slice(dot) : "";
  let candidate = sanitized;
  let number = 2;
  while (used.has(candidate.toLocaleLowerCase("en-US"))) {
    candidate = `${stem} (${number})${suffix}`;
    number += 1;
  }
  used.add(candidate.toLocaleLowerCase("en-US"));
  return candidate;
}

async function addPhotos(
  writer: ZipWriter<Uint8Array>,
  photos: readonly ExportPhoto[],
  prefix: string,
): Promise<void> {
  const used = new Set<string>();
  for (const photo of photos) {
    const filename = uniqueFilename(photo.filename, used);
    await writer.add(`${prefix}${filename}`, new BlobReader(photo.blob), { useWebWorkers: false, level: 6 });
  }
}

export async function createPhotosZipBlob(photos: readonly ExportPhoto[]): Promise<Blob> {
  const writer = new ZipWriter(new Uint8ArrayWriter(), { useWebWorkers: false });
  await addPhotos(writer, photos, "fotograflar/");
  const bytes = await writer.close();
  return blobFromBytes(bytes, ZIP_MIME);
}

export async function createDeliveryZipBlob(
  rows: readonly ExportPassengerRow[],
  photos: readonly ExportPhoto[] = [],
  options: DeliveryZipOptions = {},
): Promise<Blob> {
  const writer = new ZipWriter(new Uint8ArrayWriter(), { useWebWorkers: false });
  const xlsx = createPassengerXlsxBlob(rows);
  const csv = createPassengerCsvBlob(rows);
  const manifest = createManifestHtmlBlob(rows, { ...options, photoCount: options.photoCount ?? photos.length });

  await writer.add("yolcu-listesi.xlsx", new BlobReader(xlsx), { useWebWorkers: false, level: 6 });
  await writer.add("yolcu-listesi.csv", new BlobReader(csv), { useWebWorkers: false, level: 6 });
  await writer.add("teslim-manifestosu.html", new BlobReader(manifest), { useWebWorkers: false, level: 6 });
  if (options.includeTemplate) {
    await writer.add("standart-gate-visa-sablonu.xlsx", new BlobReader(createGateVisaTemplateXlsxBlob()), {
      useWebWorkers: false,
      level: 6,
    });
  }
  await addPhotos(writer, photos, "fotograflar/");

  const bytes = await writer.close();
  return blobFromBytes(bytes, ZIP_MIME);
}

export async function saveBlob(blob: Blob, filename: string): Promise<SaveBlobResult> {
  const safeFilename = sanitizeZipFilename(filename, "excelbase-dosya");
  if (typeof navigator !== "undefined" && typeof navigator.share === "function" && typeof File !== "undefined") {
    const file = new File([blob], safeFilename, { type: blob.type || "application/octet-stream" });
    const shareData: ShareData = { files: [file], title: safeFilename };
    let canShare = typeof navigator.canShare !== "function";
    if (typeof navigator.canShare === "function") {
      try {
        canShare = navigator.canShare(shareData);
      } catch {
        canShare = false;
      }
    }
    if (canShare) {
      try {
        await navigator.share(shareData);
        return "shared";
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return "cancelled";
        // A browser may expose share() but reject file sharing. Fall through to download.
      }
    }
  }

  if (typeof document === "undefined" || typeof URL.createObjectURL !== "function") {
    throw new Error("Dosya kaydetme yalnızca tarayıcıda kullanılabilir.");
  }
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = safeFilename;
  anchor.rel = "noopener";
  anchor.style.display = "none";
  const parent = document.body ?? document.documentElement;
  parent.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
  return "downloaded";
}
