/**
 * Read passport biodata pages with on-device OCR and turn them into rows.
 *
 * tesseract.js is loaded lazily so the rest of the PWA does not pay for the
 * WASM download until an operator opens this tool. Phone JPGs are normalized
 * (EXIF orientation, contrast, multi-band MRZ crops) before OCR.
 */

import { BlobReader, Uint8ArrayWriter, ZipReader } from "@zip.js/zip.js";

import { IMAGE_EXTENSIONS, isImageFilename } from "@/lib/imageFormat";
import { extractTd3FromOcrText, type MrzParseResult } from "@/lib/passport/mrz";

export type PassportScanStatus = "ok" | "weak" | "failed";

export type PassportScanRow = {
  id: string;
  filename: string;
  previewUrl: string;
  firstName: string;
  lastName: string;
  passportNo: string;
  nationality: string;
  birthDate: string;
  sex: string;
  expiryDate: string;
  status: PassportScanStatus;
  warnings: string[];
  mrzLine1: string;
  mrzLine2: string;
};

export type PassportScanProgress = {
  done: number;
  total: number;
  current: string;
};

type ImageInput = { filename: string; blob: Blob };

/** Vertical start ratios for MRZ band crops (passport layout varies by phone framing). */
const MRZ_BAND_TOPS = [0.55, 0.62, 0.68, 0.72, 0.48] as const;

function newId(): string {
  return `ps-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

async function collectImages(files: File[]): Promise<ImageInput[]> {
  const out: ImageInput[] = [];
  for (const file of files) {
    const lower = file.name.toLocaleLowerCase("en-US");
    if (lower.endsWith(".zip") || file.type === "application/zip") {
      const reader = new ZipReader(new BlobReader(file), { useWebWorkers: false });
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

function canvasToJpeg(canvas: HTMLCanvasElement, quality = 0.92): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((value) => resolve(value), "image/jpeg", quality);
  });
}

/**
 * Decode with EXIF orientation, upscale small phone crops, and boost contrast
 * so OCR can lock onto the MRZ OCR-B glyphs.
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
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, 0, 0, width, height);

    // Grayscale + contrast stretch for OCR-B readability.
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
    return canvas;
  } finally {
    bitmap.close();
  }
}

async function cropBand(canvas: HTMLCanvasElement, topRatio: number): Promise<Blob | null> {
  const bandTop = Math.floor(canvas.height * topRatio);
  const bandHeight = Math.max(48, canvas.height - bandTop);
  const band = document.createElement("canvas");
  band.width = canvas.width;
  band.height = bandHeight;
  const ctx = band.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(canvas, 0, bandTop, canvas.width, bandHeight, 0, 0, canvas.width, bandHeight);
  return canvasToJpeg(band, 0.95);
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
  recognize: (image: Blob | File | string, options?: Record<string, unknown>) => Promise<{ data: { text: string } }>;
  setParameters: (params: Record<string, string>) => Promise<void>;
  terminate: () => Promise<void>;
};

let sharedWorker: TessWorker | null = null;
let sharedWorkerPromise: Promise<TessWorker> | null = null;

async function getWorker(): Promise<TessWorker> {
  if (sharedWorker) return sharedWorker;
  if (!sharedWorkerPromise) {
    sharedWorkerPromise = (async () => {
      const { createWorker, PSM } = await import("tesseract.js");
      const worker = await createWorker("eng", 1, {
        // Local copies so OCR works offline after the PWA shell is cached.
        workerPath: "/tesseract/worker.min.js",
        corePath: "/tesseract/tesseract-core-simd-lstm.wasm.js",
        langPath: "/tesseract/lang-data",
        logger: () => undefined,
        errorHandler: (error: unknown) => {
          // Reset sticky failure so the next scan can retry WASM load.
          sharedWorker = null;
          sharedWorkerPromise = null;
          console.error("passport OCR worker error", error);
        },
      }) as unknown as TessWorker;
      await worker.setParameters({
        tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<",
        preserve_interword_spaces: "0",
        // MRZ is two dense lines — treat the crop as one text block.
        tessedit_pageseg_mode: String(PSM.SINGLE_BLOCK),
      });
      sharedWorker = worker;
      return worker;
    })().catch((reason) => {
      sharedWorker = null;
      sharedWorkerPromise = null;
      throw reason;
    });
  }
  return sharedWorkerPromise;
}

export async function terminatePassportOcr(): Promise<void> {
  if (sharedWorker) {
    await sharedWorker.terminate().catch(() => undefined);
  }
  sharedWorker = null;
  sharedWorkerPromise = null;
}

async function ocrText(image: Blob): Promise<string> {
  const worker = await getWorker();
  try {
    const result = await worker.recognize(image);
    return result.data.text ?? "";
  } catch (reason) {
    // Worker may be dead after a WASM/network blip — force a fresh one next call.
    await terminatePassportOcr();
    throw reason;
  }
}

function betterMrz(current: MrzParseResult | null, next: MrzParseResult | null): MrzParseResult | null {
  if (!next) return current;
  if (!current) return next;
  if (next.valid && !current.valid) return next;
  if (current.valid && !next.valid) return current;
  if (next.warnings.length < current.warnings.length) return next;
  if (next.passportNumber && !current.passportNumber) return next;
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
      nationality: "",
      birthDate: "",
      sex: "",
      expiryDate: "",
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
    nationality: mrz.nationality,
    birthDate: mrz.birthDate,
    sex: mrz.sex,
    expiryDate: mrz.expiryDate,
    status: mrz.valid ? "ok" : "weak",
    warnings: [...mrz.warnings, ...extraWarnings],
    mrzLine1: mrz.line1,
    mrzLine2: mrz.line2,
  };
}

async function scanCanvas(canvas: HTMLCanvasElement): Promise<MrzParseResult | null> {
  let best: MrzParseResult | null = null;

  for (const top of MRZ_BAND_TOPS) {
    const band = await cropBand(canvas, top);
    if (!band) continue;
    const parsed = extractTd3FromOcrText(await ocrText(band));
    best = betterMrz(best, parsed);
    if (best?.valid) return best;
  }

  // Full prepared page as last resort for this orientation.
  const fullBlob = await canvasToJpeg(canvas, 0.9);
  if (fullBlob) {
    best = betterMrz(best, extractTd3FromOcrText(await ocrText(fullBlob)));
  }
  return best;
}

async function scanOne(image: ImageInput): Promise<PassportScanRow> {
  const previewUrl = URL.createObjectURL(image.blob);
  try {
    const prepared = await preparePassportCanvas(image.blob);
    if (!prepared) {
      // Canvas unavailable (rare) — fall back to raw blob OCR.
      const raw = extractTd3FromOcrText(await ocrText(image.blob));
      return rowFromMrz(image.filename, previewUrl, raw, raw ? [] : ["Görüntü işlenemedi; ham OCR denendi"]);
    }

    let best = await scanCanvas(prepared);

    // Sideways phone photos: try 90° and 270° if upright failed.
    if (!best?.valid) {
      for (const turns of [1, 3] as const) {
        const rotated = await rotateCanvas(prepared, turns);
        best = betterMrz(best, await scanCanvas(rotated));
        if (best?.valid) break;
      }
    }

    return rowFromMrz(image.filename, previewUrl, best);
  } catch (reason) {
    const message = reason instanceof Error ? reason.message : "OCR başarısız";
    const friendly = /fetch|network|load|wasm|worker/i.test(message)
      ? "OCR motoru yüklenemedi — sayfayı yenileyip tekrar deneyin"
      : message;
    return rowFromMrz(image.filename, previewUrl, null, [friendly]);
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
  // Warm the worker once so the first photo does not stall on WASM download
  // while progress still shows "Hazırlanıyor…".
  try {
    await getWorker();
  } catch (reason) {
    const detail = reason instanceof Error ? reason.message : "bilinmeyen hata";
    throw new Error(`OCR motoru başlatılamadı (${detail}). Sayfayı yenileyip tekrar deneyin.`);
  }
  const rows: PassportScanRow[] = [];
  for (let index = 0; index < images.length; index += 1) {
    const image = images[index];
    onProgress?.({ done: index, total: images.length, current: image.filename });
    rows.push(await scanOne(image));
  }
  onProgress?.({ done: images.length, total: images.length, current: "" });
  return rows;
}

export function revokePassportScanPreviews(rows: readonly PassportScanRow[]): void {
  for (const row of rows) {
    if (row.previewUrl.startsWith("blob:")) URL.revokeObjectURL(row.previewUrl);
  }
}
