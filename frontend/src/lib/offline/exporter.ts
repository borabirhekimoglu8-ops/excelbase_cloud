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
  documents?: ReadonlyArray<{ id: string; filename: string }>;
};

export type ExportPhoto = {
  filename: string;
  blob: Blob;
};

export type ExportDocument = ExportPhoto & {
  passengerId: number;
  passengerName: string;
  passportNo: string;
};

export type ManifestOptions = {
  title?: string;
  generatedAt?: Date;
  photoCount?: number;
  documentCount?: number;
};

export type DailyPassengerListOptions = {
  title?: string;
  operationLabel?: string;
  generatedAt?: Date;
  logoDataUrl?: string;
};

export type DeliveryZipOptions = ManifestOptions & {
  includeTemplate?: boolean;
  documents?: readonly ExportDocument[];
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
    Title: "Gate Visa Checklist Yolcu Listesi",
    Subject: "Çevrimdışı yolcu verisi dışa aktarımı",
    Company: "İDO",
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
  workbook.Props = { Title: "GATE VISA PAX LIST", Company: "İDO" };
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
  const title = options.title ?? "Gate Visa Checklist Teslim Manifestosu";
  const withPhoto = rows.filter((row) => text(row.photo)).length;
  const photoCount = options.photoCount ?? withPhoto;
  const documentCount = options.documentCount
    ?? rows.reduce((count, row) => count + (row.documents?.length ?? 0), 0);
  const tableRows = rows.map((row, index) => {
    const record = exportRecord(row);
    return `<tr><td>${index + 1}</td><td>${escapeHtml(record["Yolcu Adı Soyadı"])}</td><td>${escapeHtml(record["Pasaport No"])}</td><td>${escapeHtml(record.Voucher)}</td><td>${escapeHtml(record["Gidiş Tarihi"])}</td><td>${escapeHtml(record["Varış Tarihi"])}</td><td>${record.Foto ? "Var" : "Yok"}</td><td>${row.documents?.length ?? 0}</td></tr>`;
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
    .stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:18px 0}.stat{background:var(--paper);border:1px solid var(--line);border-radius:12px;padding:16px}.stat b{display:block;font-size:24px}.stat span{color:var(--muted)}
    .table{overflow:auto;background:var(--paper);border:1px solid var(--line);border-radius:12px}table{width:100%;border-collapse:collapse}th,td{padding:11px 13px;text-align:left;border-bottom:1px solid var(--line);white-space:nowrap}th{background:#eaf3f7;font-size:12px;letter-spacing:.04em;text-transform:uppercase}tr:last-child td{border-bottom:0}
    footer{margin-top:16px;color:var(--muted);font-size:12px}@media(max-width:700px){main{margin:20px auto;padding:0 14px}.head{display:block}.date{margin-top:8px}.stats{grid-template-columns:1fr}}
  </style>
</head>
<body><main>
  <div class="head"><div><div class="eyebrow">Teslim kaydı</div><h1>${escapeHtml(title)}</h1></div><div class="date">${escapeHtml(generatedAt.toISOString())}</div></div>
  <section class="stats"><div class="stat"><b>${rows.length}</b><span>Yolcu</span></div><div class="stat"><b>${photoCount}</b><span>Fotoğraf dosyası</span></div><div class="stat"><b>${withPhoto}</b><span>Fotoğrafı eşleşmiş yolcu</span></div><div class="stat"><b>${documentCount}</b><span>PDF evrak</span></div></section>
  <div class="table"><table><thead><tr><th>No</th><th>Yolcu</th><th>Pasaport</th><th>Voucher</th><th>Gidiş</th><th>Varış</th><th>Foto</th><th>PDF</th></tr></thead><tbody>${tableRows}</tbody></table></div>
  <footer>Bu belge Gate Visa Checklist çevrimdışı teslim paketiyle birlikte oluşturulmuştur.</footer>
</main></body></html>`;
  return new Blob([html], { type: "text/html;charset=utf-8" });
}

function passengerDisplayName(row: ExportPassengerRow): string {
  return text(row.full_name) || [text(row.first_name), text(row.last_name)].filter(Boolean).join(" ");
}

function passengerListStatus(row: ExportPassengerRow): "HAZIR" | "KONTROL" {
  return passengerDisplayName(row)
    && text(row.passport_no)
    && text(row.voucher)
    && (text(row.adult_fee) || text(row.child_fee))
    && text(row.photo)
    ? "HAZIR"
    : "KONTROL";
}

function passengerListOrder(left: ExportPassengerRow, right: ExportPassengerRow): number {
  const leftNo = Number.parseInt(text(left.no), 10);
  const rightNo = Number.parseInt(text(right.no), 10);
  if (Number.isFinite(leftNo) && Number.isFinite(rightNo) && leftNo !== rightNo) return leftNo - rightNo;
  const dateOrder = text(left.departure_date).localeCompare(text(right.departure_date), "tr");
  if (dateOrder !== 0) return dateOrder;
  return passengerDisplayName(left).localeCompare(passengerDisplayName(right), "tr");
}

/**
 * Creates a self-contained, print-ready daily list. The logo is embedded as a
 * data URL so the document remains branded after it leaves the offline PWA.
 */
export function createIdoDailyPassengerListHtmlBlob(
  rows: readonly ExportPassengerRow[],
  options: DailyPassengerListOptions = {},
): Blob {
  const generatedAt = options.generatedAt ?? new Date();
  const orderedRows = [...rows].sort(passengerListOrder);
  const departureDates = [...new Set(orderedRows.map((row) => text(row.departure_date)).filter(Boolean))];
  const operationLabel = options.operationLabel
    ?? (departureDates.length === 1 ? departureDates[0] : departureDates.length > 1 ? `${departureDates[0]} – ${departureDates.at(-1)}` : "Tarihsiz");
  const title = options.title ?? "İDO Günlük Yolcu Listesi";
  const photoCount = orderedRows.filter((row) => text(row.photo)).length;
  const documentCount = orderedRows.reduce((count, row) => count + (row.documents?.length ?? 0), 0);
  const readyCount = orderedRows.filter((row) => passengerListStatus(row) === "HAZIR").length;
  const logoDataUrl = /^data:image\/(?:jpeg|jpg|png|webp);base64,[a-z0-9+/=]+$/i.test(options.logoDataUrl ?? "")
    ? options.logoDataUrl ?? ""
    : "";
  const logo = logoDataUrl
    ? `<img class="logo" src="${escapeHtml(logoDataUrl)}" alt="İDO">`
    : `<div class="logo-fallback" aria-label="İDO">ido<span>↗</span></div>`;
  const tableRows = orderedRows.map((row, index) => {
    const status = passengerListStatus(row);
    return `<tr>
      <td class="num">${index + 1}</td>
      <td class="passenger"><strong>${escapeHtml(passengerDisplayName(row) || "İsimsiz yolcu")}</strong><small>${escapeHtml(text(row.source_file))}</small></td>
      <td>${escapeHtml(text(row.passport_no) || "—")}</td>
      <td>${escapeHtml(text(row.voucher) || "—")}</td>
      <td>${escapeHtml(text(row.departure_date) || "—")}</td>
      <td>${escapeHtml(text(row.arrival_date) || "—")}</td>
      <td class="money">${escapeHtml(text(row.adult_fee) || "—")}</td>
      <td class="money">${escapeHtml(text(row.child_fee) || "—")}</td>
      <td class="center"><span class="dot ${text(row.photo) ? "ok" : "missing"}">${text(row.photo) ? "VAR" : "YOK"}</span></td>
      <td class="center"><span class="count">${row.documents?.length ?? 0}</span></td>
      <td class="center"><span class="status ${status === "HAZIR" ? "ok" : "review"}">${status}</span></td>
    </tr>`;
  }).join("");

  const html = `<!doctype html>
<html lang="tr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(title)} · ${escapeHtml(operationLabel)}</title>
  <style>
    :root{color-scheme:light;--navy:#092a43;--teal:#0783a8;--teal-deep:#006f91;--orange:#f58232;--ink:#102b3d;--muted:#637687;--line:#d8e4ea;--wash:#f4f8fa;--ok:#0f7a61;--warn:#b35c16;--red:#bd363d}
    *{box-sizing:border-box}html,body{margin:0;background:var(--wash);color:var(--ink);font:12px/1.35 -apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    .toolbar{position:sticky;top:0;z-index:3;display:flex;justify-content:flex-end;padding:12px 18px;background:rgba(244,248,250,.94);border-bottom:1px solid var(--line);backdrop-filter:blur(10px)}
    .print{border:0;border-radius:8px;background:var(--teal);color:#fff;font-weight:800;letter-spacing:.04em;padding:11px 18px;cursor:pointer}
    .sheet{width:min(1380px,calc(100% - 32px));margin:20px auto 36px;background:#fff;border:1px solid var(--line);box-shadow:0 18px 48px rgba(9,42,67,.08);overflow:hidden}
    .accent{height:7px;background:linear-gradient(90deg,var(--teal) 0 78%,var(--orange) 78%)}
    header{display:grid;grid-template-columns:170px 1fr auto;gap:26px;align-items:center;padding:24px 28px 20px;border-bottom:1px solid var(--line)}
    .logo{display:block;width:132px;height:72px;object-fit:contain;object-position:left center}.logo-fallback{font-size:46px;font-weight:900;font-style:italic;color:var(--teal);letter-spacing:-.09em}.logo-fallback span{color:var(--orange);font-size:24px;margin-left:4px}
    .eyebrow{margin:0 0 4px;color:var(--teal);font-size:10px;font-weight:800;letter-spacing:.16em;text-transform:uppercase}h1{margin:0;color:var(--navy);font-size:27px;letter-spacing:-.025em}header p{margin:5px 0 0;color:var(--muted)}
    .operation{text-align:right}.operation span{display:block;color:var(--muted);font-size:9px;font-weight:800;letter-spacing:.12em;text-transform:uppercase}.operation strong{display:block;margin-top:4px;color:var(--navy);font-size:17px}.operation small{display:block;margin-top:4px;color:var(--muted)}
    .stats{display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:var(--line);border-bottom:1px solid var(--line)}.stat{background:#f9fbfc;padding:13px 18px}.stat b{display:block;color:var(--navy);font-size:20px}.stat span{color:var(--muted);font-size:9px;font-weight:700;letter-spacing:.05em;text-transform:uppercase}
    .table-wrap{padding:18px 22px 8px;overflow:auto}table{width:100%;border-collapse:separate;border-spacing:0;border:1px solid var(--line);border-radius:8px;overflow:hidden}th{background:var(--navy);color:#fff;padding:10px 8px;text-align:left;font-size:8px;letter-spacing:.06em;text-transform:uppercase;white-space:nowrap}td{padding:9px 8px;border-bottom:1px solid var(--line);vertical-align:middle;white-space:nowrap}tbody tr:nth-child(even){background:#f8fbfc}tbody tr:last-child td{border-bottom:0}.num,.center{text-align:center}.money{text-align:right}.passenger{min-width:175px}.passenger strong{display:block}.passenger small{display:block;max-width:190px;margin-top:2px;color:var(--muted);font-size:8px;overflow:hidden;text-overflow:ellipsis}
    .dot,.status{display:inline-flex;align-items:center;justify-content:center;border-radius:999px;padding:3px 7px;font-size:8px;font-weight:800}.dot.ok,.status.ok{background:#e2f4ee;color:var(--ok)}.dot.missing{background:#fbe8e8;color:var(--red)}.status.review{background:#fff0df;color:var(--warn)}.count{display:inline-grid;place-items:center;min-width:24px;height:24px;border-radius:6px;background:#e7f4f8;color:var(--teal-deep);font-weight:800}
    footer{display:grid;grid-template-columns:1fr 1fr;gap:50px;padding:18px 28px 24px;color:var(--muted)}.sign{padding-top:26px;border-top:1px solid var(--line);font-size:9px}.footnote{grid-column:1/-1;color:#80909d;font-size:8px}
    @page{size:A4 landscape;margin:9mm}@media print{html,body{background:#fff}.toolbar{display:none}.sheet{width:100%;margin:0;border:0;box-shadow:none}.table-wrap{overflow:visible}header{padding-top:12px}thead{display:table-header-group}tr{break-inside:avoid}footer{break-inside:avoid}}
    @media(max-width:760px){.sheet{width:calc(100% - 16px);margin:8px auto 24px}header{grid-template-columns:100px 1fr;padding:18px 16px}.logo{width:90px;height:54px}.operation{grid-column:1/-1;text-align:left;display:flex;gap:8px;align-items:baseline}.stats{grid-template-columns:repeat(2,1fr)}.table-wrap{padding:12px 10px}footer{grid-template-columns:1fr;padding:14px 16px}.footnote{grid-column:auto}}
  </style>
</head>
<body>
  <div class="toolbar"><button class="print" type="button" onclick="window.print()">YAZDIR / PDF KAYDET</button></div>
  <main class="sheet">
    <div class="accent"></div>
    <header>${logo}<div><p class="eyebrow">Gate Visa Checklist</p><h1>${escapeHtml(title)}</h1><p>Kapı vizesi operasyon ve evrak kontrol listesi</p></div><div class="operation"><span>Operasyon tarihi</span><strong>${escapeHtml(operationLabel)}</strong><small>${escapeHtml(new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short" }).format(generatedAt))}</small></div></header>
    <section class="stats"><div class="stat"><b>${orderedRows.length}</b><span>Toplam yolcu</span></div><div class="stat"><b>${readyCount}</b><span>Hazır kayıt</span></div><div class="stat"><b>${photoCount}</b><span>JPG fotoğraf</span></div><div class="stat"><b>${documentCount}</b><span>PDF evrak</span></div></section>
    <div class="table-wrap"><table><thead><tr><th class="num">Sıra</th><th>Ad Soyad</th><th>Pasaport No</th><th>Voucher</th><th>Gidiş</th><th>Varış</th><th>Yetişkin</th><th>Çocuk</th><th class="center">JPG</th><th class="center">PDF</th><th class="center">Durum</th></tr></thead><tbody>${tableRows}</tbody></table></div>
    <footer><div class="sign">Hazırlayan / Operasyon Sorumlusu</div><div class="sign">Kontrol Eden / Teslim Alan</div><div class="footnote">Gate Visa Checklist tarafından cihaz içinde hazırlanmıştır. Yolcu verileri yalnızca yetkili operasyon kullanımı içindir.</div></footer>
  </main>
</body>
</html>`;
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

async function addDocuments(
  writer: ZipWriter<Uint8Array>,
  documents: readonly ExportDocument[],
): Promise<void> {
  const usedByFolder = new Map<string, Set<string>>();
  for (const document of documents) {
    const label = document.passportNo || document.passengerName || `yolcu-${document.passengerId}`;
    const folder = sanitizeZipFilename(
      document.passengerId ? `${label}-${document.passengerId}` : label,
      `yolcu-${document.passengerId || "evrak"}`,
    );
    const used = usedByFolder.get(folder) ?? new Set<string>();
    usedByFolder.set(folder, used);
    const filename = uniqueFilename(document.filename, used);
    await writer.add(`evraklar/${folder}/${filename}`, new BlobReader(document.blob), {
      useWebWorkers: false,
      level: 0,
    });
  }
}

export async function createDocumentsZipBlob(documents: readonly ExportDocument[]): Promise<Blob> {
  const writer = new ZipWriter(new Uint8ArrayWriter(), { useWebWorkers: false });
  await addDocuments(writer, documents);
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
  const documents = options.documents ?? [];
  const manifest = createManifestHtmlBlob(rows, {
    ...options,
    photoCount: options.photoCount ?? photos.length,
    documentCount: options.documentCount ?? documents.length,
  });

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
  await addDocuments(writer, documents);

  const bytes = await writer.close();
  return blobFromBytes(bytes, ZIP_MIME);
}

export async function saveBlob(blob: Blob, filename: string): Promise<SaveBlobResult> {
  const safeFilename = sanitizeZipFilename(filename, "gate-visa-checklist-dosya");
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
