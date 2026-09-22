/**
 * Passport scanning pipeline backed only by the loopback PP-OCR service.
 * PDF text layers and pasted MRZ stay browser-local; raster pages are sent
 * only to the same-origin /api/passport-ocr/v1/ endpoint.
 */

import { BlobReader, Uint8ArrayWriter, ZipReader } from "@zip.js/zip.js";

import { sha256Hex } from "@/lib/hash";
import { sniffImageFormat } from "@/lib/imageFormat";
import { normalizePhoto } from "@/lib/photoNormalize";

import { passportEngineProfileId } from "./engineProfile";
import { mrzLikeLineCount, pairsFromOcrLines } from "./mrzFromOcrLines";
import { createLocalFastApiEngine } from "./ocr/localFastApiEngine";
import type { OcrPageResult, PassportOcrEngine } from "./ocr/types";
import { PassportOcrQueue, transientQueueError } from "./ocrQueue";
import { extractTextFromPdf } from "./pdfExtractText";
import { rasterizePdfToImages } from "./pdfToImages";
import { mergeMrzViz } from "./mergeMrzViz";
import { rowFromParsedMrz, rowsFromMrzText } from "./parseMrzText";
import {
  DOCUMENT_TYPES,
  type PassportDocumentType,
  type PassportScanRow,
  type PassportScanStatus,
} from "./passportTypes";
import { matchVizFields } from "./vizFields";
import { vizWordsFromOcrLines } from "./vizWordsFromOcrLines";

export {
  DOCUMENT_TYPES,
  type PassportDocumentType,
  type PassportScanRow,
  type PassportScanStatus,
} from "./passportTypes";

export type PassportScanProgress = {
  done: number;
  total: number;
  current: string;
};

export type PassportScanOptions = {
  batchId?: string;
  engine?: PassportOcrEngine;
  onPage?: (page: { batchId: string; pageNo: number; blob: Blob }) => void | Promise<void>;
};

type SourceInput = {
  filename: string;
  blob: Blob;
  kind: "image" | "pdf";
};

type ImageInput = {
  filename: string;
  blob: Blob;
};

function isPdfFilename(filename: string): boolean {
  return filename.toLocaleLowerCase("en-US").endsWith(".pdf");
}

function isPassportImageFilename(filename: string): boolean {
  return /\.(?:jpe?g|png|heic|heif)$/i.test(filename);
}

async function collectSources(files: File[]): Promise<SourceInput[]> {
  const output: SourceInput[] = [];
  for (const file of files) {
    const lower = file.name.toLocaleLowerCase("en-US");
    if (lower.endsWith(".zip") || file.type === "application/zip") {
      const reader = new ZipReader(new BlobReader(file), { useWebWorkers: true });
      try {
        for (const entry of await reader.getEntries()) {
          if (
            entry.directory
            || (!isPassportImageFilename(entry.filename) && !isPdfFilename(entry.filename))
            || !entry.getData
          ) continue;
          const leaf = entry.filename.split("/").pop() || entry.filename;
          if (leaf.startsWith(".")) continue;
          const bytes = new Uint8Array(await entry.getData(new Uint8ArrayWriter()));
          const pdf = isPdfFilename(entry.filename);
          output.push({
            filename: leaf,
            blob: new Blob([bytes], { type: pdf ? "application/pdf" : "application/octet-stream" }),
            kind: pdf ? "pdf" : "image",
          });
        }
      } finally {
        await reader.close();
      }
      continue;
    }
    if (isPdfFilename(file.name) || file.type.toLocaleLowerCase("en-US") === "application/pdf") {
      output.push({ filename: file.name, blob: file, kind: "pdf" });
      continue;
    }
    if (
      isPassportImageFilename(file.name)
      || ["image/jpeg", "image/png", "image/heic", "image/heif"].includes(
        file.type.toLocaleLowerCase("en-US"),
      )
    ) {
      output.push({ filename: file.name, blob: file, kind: "image" });
    }
  }
  return output;
}

const DIRECT_CANVAS_FORMATS = new Set(["jpg", "png"]);

async function normalizePassportImage(blob: Blob): Promise<Blob> {
  const format = await sniffImageFormat(blob).catch(() => null);
  if (!format || DIRECT_CANVAS_FORMATS.has(format.extension)) return blob;
  return (await normalizePhoto(blob, format)).blob;
}

function remapRowPage(
  row: PassportScanRow,
  batchId: string,
  pageNo: number,
): PassportScanRow {
  return {
    ...row,
    batchId,
    pageNo,
    provenance: Object.fromEntries(
      Object.entries(row.provenance).map(([field, value]) => [
        field,
        value ? { ...value, pageNo } : value,
      ]),
    ),
  };
}

export function rowsFromOcrResult(
  filename: string,
  previewUrl: string,
  batchId: string,
  pageNo: number,
  result: OcrPageResult,
): PassportScanRow[] {
  const pairs = pairsFromOcrLines(result.lines);
  const viz = matchVizFields(vizWordsFromOcrLines(result.lines), pageNo);
  const imageSize = { width: result.width, height: result.height };

  if (!pairs.length) {
    const empty = rowFromParsedMrz(filename, null, { previewUrl, batchId, pageNo });
    const merged = mergeMrzViz(empty, viz).row;
    merged.sourceImageSize = imageSize;
    merged.rawLines = [];
    merged.failureStage = Object.keys(viz).length
      ? "field_matching"
      : mrzLikeLineCount(result.lines)
        ? "mrz_parser"
        : "text_detection";
    return [merged];
  }

  return pairs.map((pair, index) => {
    const label = pairs.length > 1 ? `${filename} · ${index + 1}` : filename;
    const base = rowFromParsedMrz(label, pair.parsed, { previewUrl, batchId, pageNo });
    base.rawLines = [pair.rawLine1, pair.rawLine2];
    base.sourceImageSize = imageSize;
    if (pair.parsed.verified) return base;
    const merged = mergeMrzViz(base, viz).row;
    merged.failureStage = "field_matching";
    return merged;
  });
}

async function recognizedRows(
  image: ImageInput,
  batchId: string,
  pageNo: number,
  queue: PassportOcrQueue<OcrPageResult>,
  profileId: string,
): Promise<PassportScanRow[]> {
  const source = await normalizePassportImage(image.blob);
  const previewUrl = URL.createObjectURL(source);
  const hash = await sha256Hex(source);
  try {
    const result = await queue.enqueue(source, hash, profileId);
    return rowsFromOcrResult(image.filename, previewUrl, batchId, pageNo, result);
  } catch (reason) {
    if (/fetch|network|timeout|unreachable/i.test(reason instanceof Error ? reason.message : "")) {
      throw transientQueueError("engine_crashed");
    }
    throw reason;
  }
}

export async function scanPassportImages(
  files: File[],
  onProgress?: (progress: PassportScanProgress) => void,
  options: PassportScanOptions = {},
): Promise<PassportScanRow[]> {
  const sources = await collectSources(files);
  if (!sources.length) {
    throw new Error(
      "Pasaport görüntüsü bulunamadı. JPG/PNG/WEBP/HEIC, PDF veya bunları içeren ZIP seçin.",
    );
  }

  const batchId = options.batchId ?? `passport-${Date.now().toString(36)}`;
  const engine = options.engine ?? createLocalFastApiEngine();
  const rows: PassportScanRow[] = [];
  const images: ImageInput[] = [];
  let nextPageNo = 1;

  for (const source of sources) {
    if (source.kind === "image") {
      images.push({ filename: source.filename, blob: source.blob });
      continue;
    }
    const text = await extractTextFromPdf(source.blob);
    if (text.trim()) {
      const parsed = rowsFromMrzText(text, source.filename);
      if (parsed.length) {
        for (const row of parsed) {
          rows.push(remapRowPage(row, batchId, nextPageNo));
          nextPageNo += 1;
        }
      } else {
        const row = rowFromParsedMrz(source.filename, null, { batchId, pageNo: nextPageNo });
        row.warnings = ["PDF metin katmanında doğrulanabilir TD3 MRZ bulunamadı."];
        row.failureStage = "mrz_parser";
        rows.push(row);
        nextPageNo += 1;
      }
      continue;
    }
    const pages = await rasterizePdfToImages(source.blob, source.filename);
    images.push(...pages.map((page) => ({ filename: page.filename, blob: page.blob })));
  }

  if (!images.length) {
    onProgress?.({ done: rows.length, total: rows.length, current: "" });
    return rows;
  }

  const capability = await engine.probe();
  if (!capability.canOcr || !capability.engine) {
    throw new Error(
      `Görüntü OCR’si hazır değil: ${capability.title}. ${capability.message}`,
    );
  }
  const profileId = passportEngineProfileId(capability.engine);
  const queue = new PassportOcrQueue<OcrPageResult>(async (blob, job) => (
    engine.recognizePage(blob, job.id)
  ));
  const seen = new Set<string>();
  const uniqueImages: ImageInput[] = [];
  for (const image of images) {
    const hash = await sha256Hex(image.blob);
    if (seen.has(hash)) continue;
    seen.add(hash);
    uniqueImages.push(image);
  }

  const total = rows.length + uniqueImages.length;
  let done = rows.length;
  onProgress?.({ done, total, current: "Yerel OCR hazırlanıyor…" });
  for (const image of uniqueImages) {
    const pageNo = nextPageNo;
    nextPageNo += 1;
    onProgress?.({ done, total, current: image.filename });
    const source = await normalizePassportImage(image.blob);
    await options.onPage?.({ batchId, pageNo, blob: source });
    try {
      const pageRows = await recognizedRows(
        { ...image, blob: source },
        batchId,
        pageNo,
        queue,
        profileId,
      );
      for (const row of pageRows) {
        row.sourceImageKey = `passport-page:${batchId}:${pageNo}`;
        rows.push(row);
      }
    } catch {
      const failed = rowFromParsedMrz(image.filename, null, {
        previewUrl: URL.createObjectURL(source),
        batchId,
        pageNo,
      });
      failed.warnings = ["Yerel OCR geçici hatalardan sonra sayfayı okuyamadı."];
      failed.failureStage = "character_recognition";
      failed.sourceImageKey = `passport-page:${batchId}:${pageNo}`;
      rows.push(failed);
    }
    done += 1;
    onProgress?.({ done, total, current: "" });
  }
  return rows;
}

export function revokePassportScanPreviews(rows: readonly PassportScanRow[]): void {
  const urls = new Set<string>();
  for (const row of rows) {
    if (row.previewUrl.startsWith("blob:")) urls.add(row.previewUrl);
    if (row.mrzCropUrl?.startsWith("blob:")) urls.add(row.mrzCropUrl);
  }
  for (const url of urls) URL.revokeObjectURL(url);
}
