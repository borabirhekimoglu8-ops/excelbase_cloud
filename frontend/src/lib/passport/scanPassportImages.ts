/**
 * On-device, geometry-constrained passport OCR.
 *
 * Tesseract supplies symbol boxes; fields are decoded only after those symbols
 * are snapped to the physical 44-cell TD3 grid. No full-page/free-text fallback
 * is allowed to manufacture an MRZ.
 */

import { BlobReader, Uint8ArrayWriter, ZipReader } from "@zip.js/zip.js";

import {
  IMAGE_EXTENSIONS,
  isImageFilename,
  sniffImageFormat,
} from "@/lib/imageFormat";
import { icaoCountryToIso2 } from "@/lib/passport/icaoCountries";
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
import { normalizePhoto } from "@/lib/photoNormalize";

export type PassportScanStatus = "ok" | "weak" | "failed";

export const DOCUMENT_TYPES = ["Passport", "ID CARD"] as const;
export type PassportDocumentType = (typeof DOCUMENT_TYPES)[number];

export type PassportScanRow = {
  id: string;
  filename: string;
  previewUrl: string;
  firstName: string;
  lastName: string;
  passportNo: string;
  countryCode2: string;
  nationality: string;
  birthDate: string;
  sex: string;
  expiryDate: string;
  tcNo: string;
  documentType: PassportDocumentType;
  status: PassportScanStatus;
  warnings: string[];
  mrzLine1: string;
  mrzLine2: string;
  mrzCropUrl?: string;
  rawLines?: string[];
};

export function documentTypeFromMrzCode(code: string): PassportDocumentType {
  return code.trim().toUpperCase().startsWith("I") ? "ID CARD" : "Passport";
}

export type PassportScanProgress = {
  done: number;
  total: number;
  current: string;
};

type ImageInput = { filename: string; blob: Blob };

function newId(): string {
  return `ps-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

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
            output.push(...await rasterizePdfToImages(
              new Blob([copy], { type: "application/pdf" }),
              leaf,
            ));
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
      output.push(...await rasterizePdfToImages(file, file.name));
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
type TessWord = { symbols: TessSymbol[] };
type TessBlock = { paragraphs: Array<{ lines: Array<{ words: TessWord[] }> }> };
type TessWorker = {
  recognize: (
    image: Blob | File | string | HTMLCanvasElement,
    options?: Record<string, never>,
    output?: { blocks: boolean },
  ) => Promise<{ data: { text: string; blocks: TessBlock[] | null } }>;
  setParameters: (params: Record<string, string>) => Promise<void>;
  terminate: () => Promise<void>;
};

type WorkerSlot = {
  worker: TessWorker | null;
  promise: Promise<TessWorker> | null;
};

const MAX_OCR_WORKERS = 2;
const workerSlots: WorkerSlot[] = Array.from(
  { length: MAX_OCR_WORKERS },
  () => ({ worker: null, promise: null }),
);

async function getWorker(slotIndex: number): Promise<TessWorker> {
  const slot = workerSlots[slotIndex];
  if (slot.worker) return slot.worker;
  if (!slot.promise) {
    slot.promise = (async () => {
      const { createWorker, OEM, PSM } = await import("tesseract.js");
      const worker = await createWorker("mrz", OEM.LSTM_ONLY, {
        corePath: "/tesseract",
        langPath: "/tesseract/lang-data",
        workerPath: "/tesseract/worker.min.js",
        logger: () => undefined,
        errorHandler: () => {
          slot.worker = null;
          slot.promise = null;
        },
      }) as unknown as TessWorker;
      await worker.setParameters({
        tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<",
        tessedit_pageseg_mode: String(PSM.SINGLE_LINE),
        user_defined_dpi: "300",
        preserve_interword_spaces: "0",
      });
      slot.worker = worker;
      return worker;
    })().catch((reason) => {
      slot.worker = null;
      slot.promise = null;
      throw reason;
    });
  }
  return slot.promise;
}

export async function prewarmPassportOcr(): Promise<void> {
  try {
    await getWorker(0);
  } catch {
    // The scan path retries and supplies the contextual operator message.
  }
}

export async function terminatePassportOcr(): Promise<void> {
  const pending = workerSlots.map((slot) => (
    slot.worker
      ? Promise.resolve(slot.worker)
      : slot.promise?.catch(() => null) ?? Promise.resolve(null)
  ));
  for (const slot of workerSlots) {
    slot.worker = null;
    slot.promise = null;
  }
  const workers = await Promise.all(pending);
  await Promise.all(workers.map((worker) => worker?.terminate().catch(() => undefined)));
}

async function recognizeSymbols(
  image: HTMLCanvasElement,
  slotIndex: number,
  whitelist: string,
  pass: string,
): Promise<OcrSymbol[]> {
  const worker = await getWorker(slotIndex);
  try {
    await worker.setParameters({ tessedit_char_whitelist: whitelist });
    const result = await worker.recognize(image, {}, { blocks: true });
    const symbols = result.data.blocks?.flatMap((block) => (
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
  } catch (reason) {
    const slot = workerSlots[slotIndex];
    if (slot.worker === worker) {
      slot.worker = null;
      slot.promise = null;
    }
    await worker.terminate().catch(() => undefined);
    throw reason;
  }
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
  if (!mrz) {
    return {
      id: newId(),
      filename,
      previewUrl,
      firstName: "",
      lastName: "",
      passportNo: "",
      countryCode2: "",
      nationality: "",
      birthDate: "",
      sex: "",
      expiryDate: "",
      tcNo: "",
      documentType: "Passport",
      status: "failed",
      warnings: extraWarnings.length
        ? extraWarnings
        : ["MRZ okunamadı — alanlar güvenlik için boş bırakıldı"],
      mrzLine1: "",
      mrzLine2: "",
      ...debug,
    };
  }

  return {
    id: newId(),
    filename,
    previewUrl,
    firstName: mrz.givenNames,
    lastName: mrz.surname,
    passportNo: mrz.passportNumber,
    countryCode2: icaoCountryToIso2(mrz.nationality),
    nationality: mrz.nationality,
    birthDate: mrz.birthDate,
    sex: mrz.sex,
    expiryDate: mrz.expiryDate,
    tcNo: mrz.nationality === "TUR" ? mrz.nationalId : "",
    documentType: "Passport",
    status: mrz.verified ? "ok" : "weak",
    warnings: [...mrz.warnings, ...extraWarnings],
    mrzLine1: mrz.line1,
    mrzLine2: mrz.line2,
    ...debug,
  };
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
  let debugCropUrl: string | undefined;
  try {
    const bitmap = await decodeBitmap(source);
    if (!bitmap) {
      return rowFromMrz(
        image.filename,
        previewUrl,
        null,
        ["Görüntü işlenemedi — MRZ alanları boş bırakıldı"],
      );
    }

    try {
      const located = locateMrz(bitmap);
      if (!located) {
        return rowFromMrz(
          image.filename,
          previewUrl,
          null,
          ["MRZ alanı bulunamadı — alanlar boş bırakıldı"],
        );
      }
      const crop = cropDeskewed(bitmap, located.band, located.thumbnail);
      if (!crop) {
        return rowFromMrz(
          image.filename,
          previewUrl,
          null,
          ["MRZ kırpımı oluşturulamadı — alanlar boş bırakıldı"],
        );
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
        return rowFromMrz(
          image.filename,
          previewUrl,
          null,
          ["Kimlik kartı (TD1) MRZ formatı desteklenmiyor; pasaport yükleyin"],
          { mrzCropUrl: debugCropUrl, rawLines: attempt.rawLines },
        );
      }
      if (attempt.kind !== "td3" || !attempt.parsed) {
        return rowFromMrz(
          image.filename,
          previewUrl,
          null,
          ["TD3 pasaport MRZ satırları doğrulanamadı — alanlar boş bırakıldı"],
          { mrzCropUrl: debugCropUrl, rawLines: attempt.rawLines },
        );
      }
      return rowFromMrz(image.filename, previewUrl, attempt.parsed, [], {
        mrzCropUrl: debugCropUrl,
        rawLines: attempt.rawLines,
      });
    } finally {
      bitmap.close();
    }
  } catch (reason) {
    if (debugCropUrl?.startsWith("blob:")) URL.revokeObjectURL(debugCropUrl);
    const message = reason instanceof Error ? reason.message : "";
    const friendly = /fetch|network|load|wasm|worker/i.test(message)
      ? "OCR motoru yüklenemedi — sayfayı yenileyip tekrar deneyin"
      : "OCR başarısız — alanlar boş bırakıldı";
    return rowFromMrz(image.filename, previewUrl, null, [friendly]);
  }
}

export async function scanPassportImages(
  files: File[],
  onProgress?: (progress: PassportScanProgress) => void,
): Promise<PassportScanRow[]> {
  const images = await collectImages(files);
  if (!images.length) {
    throw new Error(
      "Pasaport görüntüsü bulunamadı. JPG/PNG/WEBP/HEIC, PDF veya bunları içeren ZIP seçin.",
    );
  }
  onProgress?.({ done: 0, total: images.length, current: "OCR hazırlanıyor…" });
  const wantsSecondWorker = images.length > 1;
  try {
    await getWorker(0);
  } catch (reason) {
    await terminatePassportOcr();
    const detail = reason instanceof Error ? reason.message : "bilinmeyen hata";
    throw new Error(`OCR motoru başlatılamadı (${detail}). Sayfayı yenileyip tekrar deneyin.`);
  }

  const rows = new Array<PassportScanRow>(images.length);
  let nextIndex = 0;
  let done = 0;
  const activeFilenames = new Map<number, string>();

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
      rows[index] = await scanOne(image, slotIndex);
      done += 1;
      activeFilenames.delete(slotIndex);
      emitProgress();
    }
  };

  const lanes: Promise<void>[] = [runLane(0)];
  if (wantsSecondWorker) {
    lanes.push(getWorker(1).then(() => runLane(1)).catch(() => undefined));
  }
  await Promise.all(lanes);
  return rows;
}

export function revokePassportScanPreviews(rows: readonly PassportScanRow[]): void {
  for (const row of rows) {
    if (row.previewUrl.startsWith("blob:")) URL.revokeObjectURL(row.previewUrl);
    if (row.mrzCropUrl?.startsWith("blob:")) URL.revokeObjectURL(row.mrzCropUrl);
  }
}
