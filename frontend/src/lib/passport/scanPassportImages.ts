/**
 * Read passport biodata pages with on-device OCR and turn them into rows.
 *
 * tesseract.js is loaded lazily so the rest of the PWA does not pay for the
 * WASM download until an operator opens this tool. Phone JPGs are normalized
 * (EXIF orientation, contrast, multi-band MRZ crops) before OCR.
 */

import { BlobReader, Uint8ArrayWriter, ZipReader } from "@zip.js/zip.js";

import { IMAGE_EXTENSIONS, isImageFilename } from "@/lib/imageFormat";
import { nationalityToCountryCode2 } from "@/lib/passport/operatorExcel";
import { extractTd3FromOcrText, type MrzParseResult } from "@/lib/passport/mrz";

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
};

/** MRZ document code → agency document type label. */
export function documentTypeFromMrzCode(code: string): PassportDocumentType {
  const raw = code.trim().toUpperCase();
  if (raw.startsWith("I")) return "ID CARD";
  return "Passport";
}

export type PassportScanProgress = {
  done: number;
  total: number;
  current: string;
};

type ImageInput = { filename: string; blob: Blob };

/** Vertical start ratios for MRZ band crops (passport layout varies by phone framing). */
const MRZ_BAND_TOPS = [0.72, 0.68, 0.75, 0.62, 0.55, 0.48] as const;

/** Put the band that worked most recently first without changing the fallback order. */
export function orderedMrzBandTops(preferred: number | null): readonly number[] {
  if (preferred === null || !MRZ_BAND_TOPS.includes(preferred as (typeof MRZ_BAND_TOPS)[number])) {
    return MRZ_BAND_TOPS;
  }
  return [preferred, ...MRZ_BAND_TOPS.filter((top) => top !== preferred)];
}

/** A long, filler-heavy line is enough evidence that the page is already upright. */
export function hasMrzLikeSignal(text: string): boolean {
  return text.split(/\r?\n/).some((rawLine) => {
    const line = rawLine.toUpperCase().replace(/[^A-Z0-9<]/g, "");
    if (line.length < 30) return false;
    const fillers = line.match(/</g)?.length ?? 0;
    return fillers >= 3 && fillers / line.length >= 0.08;
  });
}

/** Do not rotate a weak-but-useful passport parse into a worse result. */
export function shouldTryPassportRotations(best: MrzParseResult | null, sawMrzSignal: boolean): boolean {
  if (best?.passportNumber) return false;
  return best === null || !sawMrzSignal;
}

function newId(): string {
  return `ps-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

async function collectImages(files: File[]): Promise<ImageInput[]> {
  const out: ImageInput[] = [];
  for (const file of files) {
    const lower = file.name.toLocaleLowerCase("en-US");
    if (lower.endsWith(".zip") || file.type === "application/zip") {
      const reader = new ZipReader(new BlobReader(file), { useWebWorkers: true });
      try {
        const entries = await reader.getEntries();
        for (const entry of entries) {
          if (entry.directory || !isImageFilename(entry.filename)) continue;
          const leaf = entry.filename.split("/").pop() || entry.filename;
          if (leaf.startsWith(".")) continue;
          if (!entry.getData) continue;
          const bytes = await entry.getData(new Uint8ArrayWriter());
          const copy = new Uint8Array(bytes);
          out.push({ filename: leaf, blob: new Blob([copy], { type: "application/octet-stream" }) });
        }
      } finally {
        await reader.close();
      }
      continue;
    }
    const ext = lower.split(".").pop() ?? "";
    // Some Android browsers send empty MIME for camera JPGs — trust the extension.
    if (file.type.startsWith("image/") || IMAGE_EXTENSIONS.has(ext) || lower.endsWith(".jpg") || lower.endsWith(".jpeg")) {
      out.push({ filename: file.name, blob: file });
    }
  }
  return out;
}

type BitmapOpts = { imageOrientation?: "from-image" | "none" };

async function decodeBitmap(source: Blob): Promise<ImageBitmap | null> {
  if (typeof createImageBitmap !== "function") return null;
  try {
    return await createImageBitmap(source, { imageOrientation: "from-image" } as BitmapOpts);
  } catch {
    try {
      return await createImageBitmap(source);
    } catch {
      return null;
    }
  }
}

/**
 * Decode with EXIF orientation and only upscale genuinely small phone crops.
 * Contrast work is delayed until a much smaller MRZ band is needed.
 */
async function preparePassportCanvas(source: Blob): Promise<HTMLCanvasElement | null> {
  const bitmap = await decodeBitmap(source);
  if (!bitmap) return null;
  try {
    const minWidth = 1200;
    const scale = bitmap.width < minWidth ? minWidth / bitmap.width : 1;
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, 0, 0, width, height);
    return canvas;
  } finally {
    bitmap.close();
  }
}

function boostOcrContrast(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  const image = ctx.getImageData(0, 0, width, height);
  const { data } = image;
  let min = 255;
  let max = 0;
  for (let i = 0; i < data.length; i += 4) {
    const gray = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
    data[i] = gray;
    data[i + 1] = gray;
    data[i + 2] = gray;
    if (gray < min) min = gray;
    if (gray > max) max = gray;
  }
  const range = Math.max(1, max - min);
  for (let i = 0; i < data.length; i += 4) {
    const stretched = Math.round(((data[i] - min) / range) * 255);
    // Soft threshold toward black/white without fully binarizing thin strokes.
    const boosted = stretched < 140 ? Math.max(0, stretched - 25) : Math.min(255, stretched + 20);
    data[i] = boosted;
    data[i + 1] = boosted;
    data[i + 2] = boosted;
  }
  ctx.putImageData(image, 0, 0);
}

function cropBand(
  canvas: HTMLCanvasElement,
  topRatio: number,
  band: HTMLCanvasElement,
): HTMLCanvasElement | null {
  const bandTop = Math.floor(canvas.height * topRatio);
  const bandHeight = Math.max(48, canvas.height - bandTop);
  band.width = canvas.width;
  band.height = bandHeight;
  const ctx = band.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(canvas, 0, bandTop, canvas.width, bandHeight, 0, 0, canvas.width, bandHeight);
  boostOcrContrast(ctx, band.width, band.height);
  return band;
}

function prepareFullPageFallback(canvas: HTMLCanvasElement): HTMLCanvasElement | null {
  const full = document.createElement("canvas");
  full.width = canvas.width;
  full.height = canvas.height;
  const ctx = full.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(canvas, 0, 0);
  boostOcrContrast(ctx, full.width, full.height);
  return full;
}

async function rotateCanvas(source: HTMLCanvasElement, quarterTurns: 1 | 3): Promise<HTMLCanvasElement> {
  const rotated = document.createElement("canvas");
  const width = source.width;
  const height = source.height;
  rotated.width = height;
  rotated.height = width;
  const ctx = rotated.getContext("2d");
  if (!ctx) return source;
  ctx.translate(rotated.width / 2, rotated.height / 2);
  ctx.rotate((quarterTurns * Math.PI) / 2);
  ctx.drawImage(source, -width / 2, -height / 2);
  return rotated;
}

type TessWorker = {
  recognize: (
    image: Blob | File | string | HTMLCanvasElement,
    options?: Record<string, unknown>,
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
      const { createWorker, PSM } = await import("tesseract.js");
      const worker = await createWorker("eng", 1, {
        // Local copies so OCR works offline after the PWA shell is cached.
        workerPath: "/tesseract/worker.min.js",
        corePath: "/tesseract/tesseract-core-simd-lstm.wasm.js",
        langPath: "/tesseract/lang-data",
        logger: () => undefined,
        errorHandler: (error: unknown) => {
          // Reset sticky failure so the next scan can retry WASM load.
          slot.worker = null;
          slot.promise = null;
          console.error("passport OCR worker error", error);
        },
      }) as unknown as TessWorker;
      await worker.setParameters({
        tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<",
        preserve_interword_spaces: "0",
        // MRZ is two dense lines — treat the crop as one text block.
        tessedit_pageseg_mode: String(PSM.SINGLE_BLOCK),
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

async function ocrText(image: Blob | HTMLCanvasElement, slotIndex: number): Promise<string> {
  const worker = await getWorker(slotIndex);
  try {
    const result = await worker.recognize(image);
    return result.data.text ?? "";
  } catch (reason) {
    // Reset only this lane; the other image can keep making progress.
    const slot = workerSlots[slotIndex];
    if (slot.worker === worker) {
      slot.worker = null;
      slot.promise = null;
    }
    await worker.terminate().catch(() => undefined);
    throw reason;
  }
}

export function betterMrz(current: MrzParseResult | null, next: MrzParseResult | null): MrzParseResult | null {
  if (!next) return current;
  if (!current) return next;
  if (next.valid && !current.valid) return next;
  if (current.valid && !next.valid) return current;
  if (next.passportNumber && !current.passportNumber) return next;
  if (current.passportNumber && !next.passportNumber) return current;
  if (next.warnings.length < current.warnings.length) return next;
  return current;
}

function rowFromMrz(
  filename: string,
  previewUrl: string,
  mrz: MrzParseResult | null,
  extraWarnings: string[] = [],
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
    };
  }
  const given = mrz.givenNames.trim();
  // Gate Visa NAME column is the first given name; keep the rest with it.
  const firstName = given;
  return {
    id: newId(),
    filename,
    previewUrl,
    firstName,
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
  };
}

type CanvasScanResult = {
  best: MrzParseResult | null;
  sawMrzSignal: boolean;
  successfulTopRatio: number | null;
};

async function scanCanvas(
  canvas: HTMLCanvasElement,
  slotIndex: number,
  preferredTopRatio: number | null,
): Promise<CanvasScanResult> {
  let best: MrzParseResult | null = null;
  let sawMrzSignal = false;
  let successfulTopRatio: number | null = null;
  const bandCanvas = document.createElement("canvas");

  for (const top of orderedMrzBandTops(preferredTopRatio)) {
    const band = cropBand(canvas, top, bandCanvas);
    if (!band) continue;
    const text = await ocrText(band, slotIndex);
    sawMrzSignal ||= hasMrzLikeSignal(text);
    const parsed = extractTd3FromOcrText(text);
    const nextBest = betterMrz(best, parsed);
    if (nextBest === parsed && parsed?.passportNumber) successfulTopRatio = top;
    best = nextBest;
    if (best?.valid) return { best, sawMrzSignal, successfulTopRatio };
  }

  // A weak band parse is still more useful than paying for another full-page OCR.
  if (!best?.passportNumber) {
    const fullPage = prepareFullPageFallback(canvas);
    if (fullPage) {
      const text = await ocrText(fullPage, slotIndex);
      sawMrzSignal ||= hasMrzLikeSignal(text);
      best = betterMrz(best, extractTd3FromOcrText(text));
    }
  }
  return { best, sawMrzSignal, successfulTopRatio };
}

type ScanOneResult = {
  row: PassportScanRow;
  successfulTopRatio: number | null;
};

async function scanOne(
  image: ImageInput,
  slotIndex: number,
  preferredTopRatio: number | null,
): Promise<ScanOneResult> {
  const previewUrl = URL.createObjectURL(image.blob);
  try {
    const prepared = await preparePassportCanvas(image.blob);
    if (!prepared) {
      // Canvas unavailable (rare) — fall back to raw blob OCR.
      const raw = extractTd3FromOcrText(await ocrText(image.blob, slotIndex));
      return {
        row: rowFromMrz(image.filename, previewUrl, raw, raw ? [] : ["Görüntü işlenemedi; ham OCR denendi"]),
        successfulTopRatio: null,
      };
    }

    const upright = await scanCanvas(prepared, slotIndex, preferredTopRatio);
    let best = upright.best;
    let successfulTopRatio = upright.successfulTopRatio;

    // Sideways phone photos: rotate only when upright OCR had essentially no MRZ signal.
    if (shouldTryPassportRotations(best, upright.sawMrzSignal)) {
      for (const turns of [1, 3] as const) {
        const rotated = await rotateCanvas(prepared, turns);
        const rotatedResult = await scanCanvas(rotated, slotIndex, preferredTopRatio);
        best = betterMrz(best, rotatedResult.best);
        successfulTopRatio = rotatedResult.successfulTopRatio ?? successfulTopRatio;
        if (best?.valid || best?.passportNumber) break;
      }
    }

    return {
      row: rowFromMrz(image.filename, previewUrl, best),
      successfulTopRatio,
    };
  } catch (reason) {
    const message = reason instanceof Error ? reason.message : "OCR başarısız";
    const friendly = /fetch|network|load|wasm|worker/i.test(message)
      ? "OCR motoru yüklenemedi — sayfayı yenileyip tekrar deneyin"
      : message;
    return {
      row: rowFromMrz(image.filename, previewUrl, null, [friendly]),
      successfulTopRatio: null,
    };
  }
}

/**
 * OCR every passport image (or ZIP of images) and return editable rows.
 *
 * Preview object URLs must be revoked by the caller when the screen unmounts
 * (`revokePassportScanPreviews`).
 */
export async function scanPassportImages(
  files: File[],
  onProgress?: (progress: PassportScanProgress) => void,
): Promise<PassportScanRow[]> {
  const images = await collectImages(files);
  if (!images.length) {
    throw new Error("Pasaport görüntüsü bulunamadı. JPG/PNG veya bunları içeren ZIP seçin.");
  }
  const workerCount = Math.min(MAX_OCR_WORKERS, images.length);
  // Warm the bounded pool so the first photos do not stall on WASM download
  // while progress still shows "Hazırlanıyor…".
  try {
    await Promise.all(Array.from({ length: workerCount }, (_, index) => getWorker(index)));
  } catch (reason) {
    await terminatePassportOcr();
    const detail = reason instanceof Error ? reason.message : "bilinmeyen hata";
    throw new Error(`OCR motoru başlatılamadı (${detail}). Sayfayı yenileyip tekrar deneyin.`);
  }

  const rows = new Array<PassportScanRow>(images.length);
  let nextIndex = 0;
  let done = 0;
  let preferredTopRatio: number | null = null;

  // Each lane owns one worker: images overlap, but crops for one image stay serial.
  await Promise.all(Array.from({ length: workerCount }, async (_, slotIndex) => {
    while (nextIndex < images.length) {
      const index = nextIndex;
      nextIndex += 1;
      const image = images[index];
      onProgress?.({ done, total: images.length, current: image.filename });
      const result = await scanOne(image, slotIndex, preferredTopRatio);
      rows[index] = result.row;
      if (result.successfulTopRatio !== null) preferredTopRatio = result.successfulTopRatio;
      done += 1;
      onProgress?.({
        done,
        total: images.length,
        current: done === images.length ? "" : image.filename,
      });
    }
  }));
  return rows;
}

export function revokePassportScanPreviews(rows: readonly PassportScanRow[]): void {
  for (const row of rows) {
    if (row.previewUrl.startsWith("blob:")) URL.revokeObjectURL(row.previewUrl);
  }
}
