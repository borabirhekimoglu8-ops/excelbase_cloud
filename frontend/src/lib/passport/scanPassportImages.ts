/**
 * Read passport biodata pages with on-device OCR and turn them into rows.
 *
 * A small grayscale thumbnail locates the two MRZ lines by their geometry.
 * OCR then runs on deskewed full-resolution line crops with the purpose-built
 * MRZ model; no image or recognised text leaves the browser.
 */

import { BlobReader, Uint8ArrayWriter, ZipReader } from "@zip.js/zip.js";

import {
  IMAGE_EXTENSIONS,
  isImageFilename,
  sniffImageFormat,
} from "@/lib/imageFormat";
import { nationalityToCountryCode2 } from "@/lib/passport/operatorExcel";
import {
  extractTd3FromOcrText,
  parseTd3WithRepair,
  type MrzParseResult,
} from "@/lib/passport/mrz";
import {
  canvasGray,
  cropDeskewed,
  decodeBitmap,
  grayThumbnail,
  lineCanvas,
  rotate180,
  type GrayThumbnail,
  type QuarterTurn,
} from "@/lib/passport/mrzCanvas";
import { findMrzBand, splitLines, type MrzBand } from "@/lib/passport/mrzLocator";
import { rasterizePdfToImages } from "@/lib/passport/pdfToImages";
import { normalizePhoto } from "@/lib/photoNormalize";

export type PassportScanStatus = "ok" | "weak" | "failed";

/** Values written to the agency "Doküman Tipi" column. */
export const DOCUMENT_TYPES = ["Passport", "ID CARD"] as const;
export type PassportDocumentType = (typeof DOCUMENT_TYPES)[number];

export type PassportScanRow = {
  id: string;
  filename: string;
  previewUrl: string;
  firstName: string;
  lastName: string;
  passportNo: string;
  /** ISO 3166-1 alpha-2 (Ülke Kodu 2). */
  countryCode2: string;
  nationality: string;
  birthDate: string;
  sex: string;
  expiryDate: string;
  documentType: PassportDocumentType;
  status: PassportScanStatus;
  warnings: string[];
  mrzLine1: string;
  mrzLine2: string;
  /** Local object URL for operator-only diagnostics. */
  mrzCropUrl?: string;
  /** Raw, line-oriented OCR shown only for weak/failed rows. */
  rawLines?: string[];
};

/** MRZ document code → agency document type label. */
export function documentTypeFromMrzCode(code: string): PassportDocumentType {
  const raw = code.trim().toUpperCase();
  return raw.startsWith("I") ? "ID CARD" : "Passport";
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
            continue;
          }
          output.push({ filename: leaf, blob: new Blob([copy], { type: "application/octet-stream" }) });
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
    // Android browsers can send an empty MIME type for camera files.
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
  // In particular, Safari can decode HEIC and photoNormalize converts it to a
  // portable JPEG before ImageBitmap/Tesseract use it.
  const normalized = await normalizePhoto(blob, format);
  return normalized.blob;
}

type TessWorker = {
  recognize: (
    image: Blob | File | string | HTMLCanvasElement,
  ) => Promise<{ data: { text: string } }>;
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

/** Begin loading the local OCR engine without delaying the first scan render. */
export async function prewarmPassportOcr(): Promise<void> {
  try {
    await getWorker(0);
  } catch {
    // scanPassportImages retries and presents a contextual operator message.
  }
}

export async function terminatePassportOcr(): Promise<void> {
  const pendingWorkers = workerSlots.map((slot) => (
    slot.worker
      ? Promise.resolve(slot.worker)
      : slot.promise?.catch(() => null) ?? Promise.resolve(null)
  ));
  for (const slot of workerSlots) {
    slot.worker = null;
    slot.promise = null;
  }
  const workers = await Promise.all(pendingWorkers);
  await Promise.all(workers.map((worker) => worker?.terminate().catch(() => undefined)));
}

async function ocrText(
  image: Blob | HTMLCanvasElement,
  slotIndex: number,
  pageSegmentationMode: number | string,
): Promise<string> {
  const worker = await getWorker(slotIndex);
  try {
    await worker.setParameters({ tessedit_pageseg_mode: String(pageSegmentationMode) });
    const result = await worker.recognize(image);
    return result.data.text ?? "";
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

export function betterMrz(
  current: MrzParseResult | null,
  next: MrzParseResult | null,
): MrzParseResult | null {
  if (!next) return current;
  if (!current) return next;
  if (next.valid && !current.valid) return next;
  if (current.valid && !next.valid) return current;
  const meaningfulFieldCount = (parsed: MrzParseResult): number => [
    parsed.surname.trim().length >= 2,
    parsed.givenNames.trim().length >= 2,
    parsed.passportNumber.trim().length >= 6,
    Boolean(parsed.birthDate),
    Boolean(parsed.expiryDate),
  ].filter(Boolean).length;
  const currentFields = meaningfulFieldCount(current);
  const nextFields = meaningfulFieldCount(next);
  if (nextFields > currentFields) return next;
  if (currentFields > nextFields) return current;
  if (next.warnings.length < current.warnings.length) return next;
  return current;
}

/** Let React paint progress and pointer events run between OCR attempts. */
async function yieldToMainThread(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

type RowDebug = {
  mrzCropUrl?: string;
  rawLines?: string[];
};

function rowFromMrz(
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
      documentType: "Passport",
      status: "failed",
      warnings: [...extraWarnings, "MRZ okunamadı — alanları elle doldurun"],
      mrzLine1: "",
      mrzLine2: "",
      ...debug,
    };
  }
  return {
    id: newId(),
    filename,
    previewUrl,
    firstName: mrz.givenNames.trim(),
    lastName: mrz.surname,
    passportNo: mrz.passportNumber,
    countryCode2: nationalityToCountryCode2(mrz.nationality),
    nationality: mrz.nationality,
    birthDate: mrz.birthDate,
    sex: mrz.sex,
    expiryDate: mrz.expiryDate,
    documentType: documentTypeFromMrzCode(mrz.documentCode),
    status: mrz.valid ? "ok" : "weak",
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
  // 0/180 and 90/270 have identical line geometry, but checking all four
  // protects the local thresholding step from directional lighting/shadows.
  const orientations: QuarterTurn[] = [0, 1, 3, 2];
  for (const orientation of orientations) {
    const thumbnail = grayThumbnail(bitmap, orientation);
    if (!thumbnail) continue;
    const band = findMrzBand(thumbnail.gray, thumbnail.width, thumbnail.height);
    if (band && (!best || band.score > best.band.score)) best = { thumbnail, band };
  }
  return best;
}

function fallbackThumbnail(bitmap: ImageBitmap): GrayThumbnail | null {
  // An upright passport page is landscape; a portrait bitmap is commonly a
  // phone held sideways.
  const orientation: QuarterTurn = bitmap.width >= bitmap.height ? 0 : 1;
  return grayThumbnail(bitmap, orientation);
}

function conciseRawLine(text: string): string {
  return text.toUpperCase().replace(/[^A-Z0-9<]/g, "").slice(0, 80);
}

type LineAttempt = {
  parsed: MrzParseResult | null;
  rawLines: string[];
};

async function scanLinePair(
  crop: HTMLCanvasElement,
  slotIndex: number,
  psmSingleLine: number | string,
): Promise<LineAttempt> {
  const gray = canvasGray(crop);
  if (!gray) return { parsed: null, rawLines: [] };
  const slices = splitLines(gray, crop.width, crop.height);
  if (slices.length !== 2) return { parsed: null, rawLines: [] };
  const first = lineCanvas(crop, slices[0]);
  const second = lineCanvas(crop, slices[1]);
  if (!first || !second) return { parsed: null, rawLines: [] };
  await yieldToMainThread();
  const firstText = await ocrText(first, slotIndex, psmSingleLine);
  await yieldToMainThread();
  const secondText = await ocrText(second, slotIndex, psmSingleLine);
  return {
    parsed: parseTd3WithRepair(firstText, secondText),
    rawLines: [conciseRawLine(firstText), conciseRawLine(secondText)],
  };
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

type ScanOneResult = {
  row: PassportScanRow;
};

async function scanOne(image: ImageInput, slotIndex: number): Promise<ScanOneResult> {
  const source = await normalizePassportImage(image.blob);
  const previewUrl = URL.createObjectURL(source);
  let debugCropUrl: string | undefined;
  try {
    const { PSM } = await import("tesseract.js");
    const bitmap = await decodeBitmap(source);
    if (!bitmap) {
      await yieldToMainThread();
      const raw = extractTd3FromOcrText(await ocrText(source, slotIndex, PSM.SINGLE_BLOCK));
      return {
        row: rowFromMrz(
          image.filename,
          previewUrl,
          raw,
          raw ? [] : ["Görüntü işlenemedi; ham OCR denendi"],
        ),
      };
    }

    try {
      const located = locateMrz(bitmap);
      const fallback = located?.thumbnail ?? fallbackThumbnail(bitmap);
      let best: MrzParseResult | null = null;
      let rawLines: string[] = [];
      let debugCrop: HTMLCanvasElement | null = null;
      let selectedCrop: HTMLCanvasElement | null = null;

      if (located) {
        const crop = cropDeskewed(bitmap, located.band, located.thumbnail);
        if (crop) {
          selectedCrop = crop;
          debugCrop = crop;
          const upright = await scanLinePair(crop, slotIndex, PSM.SINGLE_LINE);
          best = betterMrz(best, upright.parsed);
          if (best === upright.parsed) rawLines = upright.rawLines;

          if (!best?.valid) {
            const flipped = rotate180(crop);
            if (flipped) {
              const reverse = await scanLinePair(flipped, slotIndex, PSM.SINGLE_LINE);
              const next = betterMrz(best, reverse.parsed);
              if (next === reverse.parsed) {
                rawLines = reverse.rawLines;
                selectedCrop = flipped;
                debugCrop = flipped;
              }
              best = next;
            }
          }

          if (!best?.valid && selectedCrop) {
            await yieldToMainThread();
            const blockText = await ocrText(selectedCrop, slotIndex, PSM.SINGLE_BLOCK);
            best = betterMrz(best, extractTd3FromOcrText(blockText));
          }
        }
      }

      // Exactly one downscaled full-page attempt is the final fallback.
      if (!best?.valid && fallback) {
        const fullPage = cropDeskewed(bitmap, {
          x: 0,
          y: 0,
          width: fallback.width,
          height: fallback.height,
          angle: 0,
        }, fallback, 1600);
        if (fullPage) {
          await yieldToMainThread();
          const fullText = await ocrText(fullPage, slotIndex, PSM.SINGLE_BLOCK);
          best = betterMrz(best, extractTd3FromOcrText(fullText));
        }
      }

      if (debugCrop) debugCropUrl = await canvasObjectUrl(debugCrop);
      return {
        row: rowFromMrz(image.filename, previewUrl, best, [], {
          mrzCropUrl: debugCropUrl,
          rawLines: rawLines.some(Boolean) ? rawLines : undefined,
        }),
      };
    } finally {
      bitmap.close();
    }
  } catch (reason) {
    if (debugCropUrl?.startsWith("blob:")) URL.revokeObjectURL(debugCropUrl);
    const message = reason instanceof Error ? reason.message : "";
    const friendly = /fetch|network|load|wasm|worker/i.test(message)
      ? "OCR motoru yüklenemedi — sayfayı yenileyip tekrar deneyin"
      : "OCR başarısız — fotoğrafı kontrol edip tekrar deneyin";
    return {
      row: rowFromMrz(image.filename, previewUrl, null, [friendly]),
    };
  }
}

/**
 * OCR every passport image (or ZIP of images) and return editable rows.
 *
 * Preview object URLs must be revoked by the caller when the screen unmounts.
 */
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

  // Each lane owns one worker; images overlap while attempts for one image stay serial.
  const runLane = async (slotIndex: number): Promise<void> => {
    while (nextIndex < images.length) {
      const index = nextIndex;
      nextIndex += 1;
      const image = images[index];
      activeFilenames.set(slotIndex, image.filename);
      emitProgress(slotIndex);
      await yieldToMainThread();
      const result = await scanOne(image, slotIndex);
      rows[index] = result.row;
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
