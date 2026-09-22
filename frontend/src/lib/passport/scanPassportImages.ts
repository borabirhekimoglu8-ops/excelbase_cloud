/**
 * On-device, geometry-constrained passport OCR.
 *
 * Tesseract supplies symbol boxes; fields are decoded only after those symbols
 * are snapped to the physical 44-cell TD3 grid. No full-page/free-text fallback
 * is allowed to manufacture an MRZ.
 */

import { BlobReader, Uint8ArrayWriter, ZipReader } from "@zip.js/zip.js";

import { sha256Hex } from "@/lib/hash";
import {
  IMAGE_EXTENSIONS,
  isImageFilename,
  sniffImageFormat,
} from "@/lib/imageFormat";
import { parseTd3FromCells, type MrzParseResult } from "@/lib/passport/mrz";
import {
  fitGrid,
  mergePasses,
  snapToCells,
  type Cell,
  type OcrSymbol,
} from "@/lib/passport/mrzGrid";
import {
  binarizedLineCanvas,
  canvasGray,
  cropDeskewed,
  decodeBitmap,
  grayThumbnail,
  lineCanvases,
  rotate180,
  scaleLineCanvas,
  type GrayThumbnail,
  type QuarterTurn,
} from "@/lib/passport/mrzCanvas";
import { findMrzBand, splitLines, type MrzBand } from "@/lib/passport/mrzLocator";
import { rasterizePdfToImages } from "@/lib/passport/pdfToImages";
import { rowFromParsedMrz } from "@/lib/passport/parseMrzText";
import { PASSPORT_ENGINE_PROFILE } from "@/lib/passport/engineProfile";
import {
  MAX_OCR_WORKERS,
  passportOcrEngine,
  prewarmPassportOcrEngine,
  terminatePassportOcrEngine,
} from "@/lib/passport/ocrEngine";
import {
  DOCUMENT_TYPES,
  type PassportDocumentType,
  type PassportScanRow,
  type PassportScanStatus,
} from "@/lib/passport/passportTypes";
import { normalizePhoto } from "@/lib/photoNormalize";
import { mergeMrzViz } from "./mergeMrzViz";
import { PassportOcrQueue, transientQueueError } from "./ocrQueue";
import { matchVizFields, type VizWord } from "./vizFields";

export {
  DOCUMENT_TYPES,
  type PassportDocumentType,
  type PassportScanRow,
  type PassportScanStatus,
} from "@/lib/passport/passportTypes";

export function documentTypeFromMrzCode(code: string): PassportDocumentType {
  return code.trim().toUpperCase().startsWith("I") ? "ID CARD" : "Passport";
}

export type PassportScanProgress = {
  done: number;
  total: number;
  current: string;
};

export type PassportScanOptions = {
  batchId?: string;
  onPage?: (page: { batchId: string; pageNo: number; blob: Blob }) => void | Promise<void>;
};

type ImageInput = { filename: string; blob: Blob; pageNo?: number; sha256?: string };

function isPdfFilename(filename: string): boolean {
  return filename.toLocaleLowerCase("en-US").endsWith(".pdf");
}

async function collectImages(files: File[]): Promise<ImageInput[]> {
  const output: ImageInput[] = [];
  for (const file of files) {
    const lower = file.name.toLocaleLowerCase("en-US");
    if (lower.endsWith(".zip") || file.type === "application/zip") {
      const reader = new ZipReader(new BlobReader(file), { useWebWorkers: true });
      try {
        const entries = await reader.getEntries();
        for (const entry of entries) {
          if (
            entry.directory
            || (!isImageFilename(entry.filename) && !isPdfFilename(entry.filename))
            || !entry.getData
          ) continue;
          const leaf = entry.filename.split("/").pop() || entry.filename;
          if (leaf.startsWith(".")) continue;
          const bytes = await entry.getData(new Uint8ArrayWriter());
          const copy = new Uint8Array(bytes);
          if (isPdfFilename(entry.filename)) {
            output.push(...(await rasterizePdfToImages(
              new Blob([copy], { type: "application/pdf" }),
              leaf,
            )).map(({ filename, blob, pageNo }) => ({ filename, blob, pageNo })));
          } else {
            output.push({
              filename: leaf,
              blob: new Blob([copy], { type: "application/octet-stream" }),
            });
          }
        }
      } finally {
        await reader.close();
      }
      continue;
    }

    if (isPdfFilename(file.name) || file.type.toLocaleLowerCase("en-US") === "application/pdf") {
      output.push(...(await rasterizePdfToImages(file, file.name))
        .map(({ filename, blob, pageNo }) => ({ filename, blob, pageNo })));
      continue;
    }
    const extension = lower.split(".").pop() ?? "";
    if (file.type.startsWith("image/") || IMAGE_EXTENSIONS.has(extension)) {
      output.push({ filename: file.name, blob: file });
    }
  }
  return output;
}

const DIRECT_CANVAS_FORMATS = new Set(["jpg", "png", "webp", "gif", "bmp"]);

async function normalizePassportImage(blob: Blob): Promise<Blob> {
  const format = await sniffImageFormat(blob).catch(() => null);
  if (!format || DIRECT_CANVAS_FORMATS.has(format.extension)) return blob;
  const normalized = await normalizePhoto(blob, format);
  return normalized.blob;
}

type TessBbox = { x0: number; y0: number; x1: number; y1: number };
type TessSymbol = { text: string; confidence: number; bbox: TessBbox };
type TessWord = { text?: string; confidence?: number; bbox?: TessBbox; symbols: TessSymbol[] };
type TessBlock = { paragraphs: Array<{ lines: Array<{ words: TessWord[] }> }> };
export { MAX_OCR_WORKERS };

export async function prewarmPassportOcr(): Promise<void> {
  try {
    await prewarmPassportOcrEngine();
  } catch {
    // The scan path retries and supplies the contextual operator message.
  }
}

export async function terminatePassportOcr(): Promise<void> {
  await terminatePassportOcrEngine();
}

async function recognizeSymbols(
  image: HTMLCanvasElement,
  slotIndex: number,
  whitelist: string,
  pass: string,
): Promise<OcrSymbol[]> {
  void slotIndex;
  const result = await passportOcrEngine.recognize(image, "mrz", {
    tessedit_char_whitelist: whitelist,
    tessedit_pageseg_mode: "7",
    preserve_interword_spaces: "0",
  });
  const symbols = (result.blocks as TessBlock[] | null)?.flatMap((block) => (
      block.paragraphs.flatMap((paragraph) => (
        paragraph.lines.flatMap((line) => line.words.flatMap((word) => word.symbols))
      ))
    )) ?? [];
  return symbols
    .filter((symbol) => /^[A-Z0-9<]$/i.test(symbol.text))
    .map((symbol) => ({
      text: symbol.text.toUpperCase(),
      confidence: symbol.confidence,
      bbox: symbol.bbox,
      pass,
    }));
}

async function yieldToMainThread(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

function cellsFromSymbols(
  symbols: readonly OcrSymbol[],
  width: number,
  alphabet: string,
  pass: string,
): Cell[] | null {
  const grid = fitGrid(symbols, 44, width);
  return grid ? snapToCells(symbols, grid, alphabet, pass) : null;
}

async function recognizeLine(
  grayCanvas: HTMLCanvasElement,
  slotIndex: number,
  alphabet: string,
  lineName: string,
): Promise<Cell[] | null> {
  await yieldToMainThread();
  const graySymbols = await recognizeSymbols(grayCanvas, slotIndex, alphabet, `${lineName}-gray`);
  const binaryCanvas = binarizedLineCanvas(grayCanvas);
  await yieldToMainThread();
  const binarySymbols = binaryCanvas
    ? await recognizeSymbols(binaryCanvas, slotIndex, alphabet, `${lineName}-binary`)
    : [];

  const grayCells = cellsFromSymbols(graySymbols, grayCanvas.width, alphabet, `${lineName}-gray`);
  const binaryCells = cellsFromSymbols(
    binarySymbols,
    grayCanvas.width,
    alphabet,
    `${lineName}-binary`,
  );
  if (!grayCells && !binaryCells) return null;
  let cells = mergePasses(...[grayCells, binaryCells].filter((value): value is Cell[] => Boolean(value)));

  if (cells.some((cell) => cell.disputed)) {
    const enlarged = scaleLineCanvas(grayCanvas, 1.5);
    if (enlarged) {
      await yieldToMainThread();
      const enlargedSymbols = await recognizeSymbols(
        enlarged,
        slotIndex,
        alphabet,
        `${lineName}-1.5x`,
      );
      const enlargedCells = cellsFromSymbols(
        enlargedSymbols,
        enlarged.width,
        alphabet,
        `${lineName}-1.5x`,
      );
      if (enlargedCells) cells = mergePasses(cells, enlargedCells);
    }
  }
  return cells;
}

function valuesAt(cells: readonly Cell[], index: number): string[] {
  return cells[index]?.candidates.map((candidate) => candidate.value) ?? [];
}

function isTd1(cells: readonly Cell[]): boolean {
  return valuesAt(cells, 0).includes("I")
    && valuesAt(cells, 1).some((value) => value === "<" || /^[A-Z]$/.test(value));
}

function hasTd3UpperRole(cells: readonly Cell[]): boolean {
  return valuesAt(cells, 0).includes("P")
    && valuesAt(cells, 1).some((value) => value === "<" || /^[A-Z]$/.test(value));
}

function hasTd3LowerRole(cells: readonly Cell[]): boolean {
  const digitCount = (start: number, end: number) => {
    let count = 0;
    for (let index = start; index < end; index += 1) {
      if (valuesAt(cells, index).some((value) => /^\d$/.test(value))) count += 1;
    }
    return count;
  };
  return digitCount(13, 19) >= 4 && digitCount(21, 27) >= 4;
}

export function classifyMrzRoles(
  upper: readonly Cell[],
  lower: readonly Cell[],
): "td1" | "td3" | "invalid" {
  if (isTd1(upper)) return "td1";
  return hasTd3UpperRole(upper) && hasTd3LowerRole(lower) ? "td3" : "invalid";
}

function conciseCells(cells: readonly Cell[] | null): string {
  if (!cells) return "";
  return cells.map((cell) => cell.candidates[0]?.value ?? "·").join("");
}

type LineAttempt = {
  kind: "td3" | "td1" | "invalid";
  parsed: MrzParseResult | null;
  rawLines: string[];
};

async function scanLinePair(
  crop: HTMLCanvasElement,
  slotIndex: number,
): Promise<LineAttempt> {
  const gray = canvasGray(crop);
  if (!gray) return { kind: "invalid", parsed: null, rawLines: [] };
  const slices = splitLines(gray, crop.width, crop.height);
  const lines = lineCanvases(crop, slices);
  if (!lines) return { kind: "invalid", parsed: null, rawLines: [] };

  const upper = await recognizeLine(
    lines[0],
    slotIndex,
    "ABCDEFGHIJKLMNOPQRSTUVWXYZ<",
    "upper",
  );
  const lower = await recognizeLine(
    lines[1],
    slotIndex,
    "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<",
    "lower",
  );
  const rawLines = [conciseCells(upper), conciseCells(lower)];
  if (!upper || !lower) return { kind: "invalid", parsed: null, rawLines };
  const kind = classifyMrzRoles(upper, lower);
  if (kind === "td1") return { kind, parsed: null, rawLines };
  if (kind !== "td3") {
    return { kind: "invalid", parsed: null, rawLines };
  }
  return {
    kind: "td3",
    parsed: parseTd3FromCells(upper, lower),
    rawLines,
  };
}

type RowDebug = {
  mrzCropUrl?: string;
  rawLines?: string[];
};

export function rowFromMrz(
  filename: string,
  previewUrl: string,
  mrz: MrzParseResult | null,
  extraWarnings: string[] = [],
  debug: RowDebug = {},
): PassportScanRow {
  const row = rowFromParsedMrz(filename, mrz, { previewUrl });
  row.warnings = extraWarnings.length || !mrz
    ? [...(mrz?.warnings ?? []), ...(extraWarnings.length
      ? extraWarnings
      : ["MRZ okunamadı — alanlar güvenlik için boş bırakıldı"])]
    : mrz.warnings;
  return { ...row, ...debug };
}

function wordsFromBlocks(blocks: TessBlock[] | null): VizWord[] {
  return blocks?.flatMap((block) => block.paragraphs.flatMap((paragraph) => (
    paragraph.lines.flatMap((line) => line.words.flatMap((word) => {
      if (!word.text || !word.bbox) return [];
      return [{
        text: word.text,
        confidence: word.confidence ?? 0,
        rect: {
          x: word.bbox.x0,
          y: word.bbox.y0,
          width: word.bbox.x1 - word.bbox.x0,
          height: word.bbox.y1 - word.bbox.y0,
        },
      }];
    }))
  ))) ?? [];
}

async function withVizDraft(
  row: PassportScanRow,
  source: Blob,
  slotIndex: number,
  pageNo: number,
): Promise<PassportScanRow> {
  void slotIndex;
  try {
    const result = await passportOcrEngine.recognize(source, "eng", {
      tessedit_char_whitelist: "",
      tessedit_pageseg_mode: "3",
    });
    return mergeMrzViz(
      row,
      matchVizFields(wordsFromBlocks(result.blocks as TessBlock[] | null), pageNo),
    ).row;
  } catch {
    return row;
  }
}

type LocatedBand = {
  thumbnail: GrayThumbnail;
  band: MrzBand;
};

function locateMrz(bitmap: ImageBitmap): LocatedBand | null {
  let best: LocatedBand | null = null;
  const orientations: QuarterTurn[] = [0, 1, 3, 2];
  for (const orientation of orientations) {
    const thumbnail = grayThumbnail(bitmap, orientation);
    if (!thumbnail) continue;
    const band = findMrzBand(thumbnail.gray, thumbnail.width, thumbnail.height);
    if (band && (!best || band.score > best.band.score)) best = { thumbnail, band };
  }
  return best;
}

function canvasObjectUrl(canvas: HTMLCanvasElement): Promise<string | undefined> {
  return new Promise((resolve) => {
    try {
      canvas.toBlob(
        (blob) => resolve(blob ? URL.createObjectURL(blob) : undefined),
        "image/jpeg",
        0.82,
      );
    } catch {
      resolve(undefined);
    }
  });
}

async function scanOne(image: ImageInput, slotIndex: number): Promise<PassportScanRow> {
  const source = await normalizePassportImage(image.blob);
  const previewUrl = URL.createObjectURL(source);
  const pageNo = image.pageNo ?? 1;
  let debugCropUrl: string | undefined;
  try {
    const bitmap = await decodeBitmap(source);
    if (!bitmap) {
      const row = rowFromMrz(
        image.filename,
        previewUrl,
        null,
        ["Görüntü işlenemedi — MRZ alanları boş bırakıldı"],
      );
      row.failureStage = "text_detection";
      return row;
    }

    try {
      const located = locateMrz(bitmap);
      if (!located) {
        const row = rowFromMrz(
          image.filename,
          previewUrl,
          null,
          ["MRZ alanı bulunamadı — alanlar boş bırakıldı"],
        );
        row.failureStage = "text_detection";
        return withVizDraft(row, source, slotIndex, pageNo);
      }
      const crop = cropDeskewed(bitmap, located.band, located.thumbnail);
      if (!crop) {
        const row = rowFromMrz(
          image.filename,
          previewUrl,
          null,
          ["MRZ kırpımı oluşturulamadı — alanlar boş bırakıldı"],
        );
        row.failureStage = "text_detection";
        return withVizDraft(row, source, slotIndex, pageNo);
      }

      debugCropUrl = await canvasObjectUrl(crop);
      let selectedCrop = crop;
      let attempt = await scanLinePair(crop, slotIndex);
      if (attempt.kind === "invalid") {
        const flipped = rotate180(crop);
        if (flipped) {
          selectedCrop = flipped;
          attempt = await scanLinePair(flipped, slotIndex);
          if (debugCropUrl?.startsWith("blob:")) URL.revokeObjectURL(debugCropUrl);
          debugCropUrl = await canvasObjectUrl(selectedCrop);
        }
      }

      if (attempt.kind === "td1") {
        const row = rowFromMrz(
          image.filename,
          previewUrl,
          null,
          ["Kimlik kartı (TD1) MRZ formatı desteklenmiyor; pasaport yükleyin"],
          { mrzCropUrl: debugCropUrl, rawLines: attempt.rawLines },
        );
        row.failureStage = "mrz_parser";
        return withVizDraft(row, source, slotIndex, pageNo);
      }
      if (attempt.kind !== "td3" || !attempt.parsed) {
        const row = rowFromMrz(
          image.filename,
          previewUrl,
          null,
          ["TD3 pasaport MRZ satırları doğrulanamadı — alanlar boş bırakıldı"],
          { mrzCropUrl: debugCropUrl, rawLines: attempt.rawLines },
        );
        row.failureStage = attempt.rawLines.some(Boolean) ? "mrz_parser" : "character_recognition";
        return withVizDraft(row, source, slotIndex, pageNo);
      }
      const parsedRow = rowFromMrz(image.filename, previewUrl, attempt.parsed, [], {
        mrzCropUrl: debugCropUrl,
        rawLines: attempt.rawLines,
      });
      parsedRow.pageNo = pageNo;
      if (!attempt.parsed.verified) {
        parsedRow.failureStage = "field_matching";
        return withVizDraft(parsedRow, source, slotIndex, pageNo);
      }
      return parsedRow;
    } finally {
      bitmap.close();
    }
  } catch (reason) {
    if (debugCropUrl?.startsWith("blob:")) URL.revokeObjectURL(debugCropUrl);
    const message = reason instanceof Error ? reason.message : "";
    const transient = /fetch|network|load|wasm|worker|terminated|crash/i.test(message);
    if (transient) throw transientQueueError("engine_crashed");
    const friendly = transient
      ? "OCR motoru yüklenemedi — sayfayı yenileyip tekrar deneyin"
      : "OCR başarısız — alanlar boş bırakıldı";
    const row = rowFromMrz(image.filename, previewUrl, null, [friendly]);
    row.failureStage = /yüklenemedi/.test(friendly) ? "character_recognition" : "field_matching";
    return row;
  }
}

export async function scanPassportImages(
  files: File[],
  onProgress?: (progress: PassportScanProgress) => void,
  options: PassportScanOptions = {},
): Promise<PassportScanRow[]> {
  const collected = await collectImages(files);
  const seenHashes = new Set<string>();
  const images: ImageInput[] = [];
  for (const image of collected) {
    const hash = await sha256Hex(image.blob);
    if (seenHashes.has(hash)) continue;
    seenHashes.add(hash);
    images.push({ ...image, sha256: hash });
  }
  if (!images.length) {
    throw new Error(
      "Pasaport görüntüsü bulunamadı. JPG/PNG/WEBP/HEIC, PDF veya bunları içeren ZIP seçin.",
    );
  }
  onProgress?.({ done: 0, total: images.length, current: "OCR hazırlanıyor…" });

  const rows = new Array<PassportScanRow>(images.length);
  const batchId = options.batchId ?? `passport-${Date.now().toString(36)}`;
  let nextIndex = 0;
  let done = 0;
  const activeFilenames = new Map<number, string>();
  const imageByHash = new Map(images.map((image) => [image.sha256 as string, image]));
  const queue = new PassportOcrQueue<PassportScanRow>(async (blob, job) => {
    const image = imageByHash.get(job.pageSha256);
    if (!image) throw new Error("Kuyruktaki görüntü bulunamadı.");
    return scanOne({ ...image, blob }, 0);
  });

  const emitProgress = (preferredSlot?: number): void => {
    const current = preferredSlot === undefined
      ? activeFilenames.values().next().value ?? ""
      : activeFilenames.get(preferredSlot) ?? activeFilenames.values().next().value ?? "";
    onProgress?.({ done, total: images.length, current });
  };

  const runLane = async (slotIndex: number): Promise<void> => {
    while (nextIndex < images.length) {
      const index = nextIndex;
      nextIndex += 1;
      const image = images[index];
      activeFilenames.set(slotIndex, image.filename);
      emitProgress(slotIndex);
      await yieldToMainThread();
      const pageNo = index + 1;
      await options.onPage?.({ batchId, pageNo, blob: image.blob });
      try {
        rows[index] = await queue.enqueue(
          image.blob,
          image.sha256 as string,
          PASSPORT_ENGINE_PROFILE.id,
        );
      } catch {
        rows[index] = rowFromMrz(
          image.filename,
          URL.createObjectURL(image.blob),
          null,
          ["OCR motoru geçici hatalardan sonra çalıştırılamadı; sayfayı yeniden deneyin"],
        );
        rows[index].failureStage = "character_recognition";
      }
      rows[index].batchId = batchId;
      rows[index].pageNo = pageNo;
      rows[index].sourceImageKey = `passport-page:${batchId}:${pageNo}`;
      done += 1;
      activeFilenames.delete(slotIndex);
      emitProgress();
    }
  };

  await runLane(0);
  return rows;
}

export function revokePassportScanPreviews(rows: readonly PassportScanRow[]): void {
  for (const row of rows) {
    if (row.previewUrl.startsWith("blob:")) URL.revokeObjectURL(row.previewUrl);
    if (row.mrzCropUrl?.startsWith("blob:")) URL.revokeObjectURL(row.mrzCropUrl);
  }
}
