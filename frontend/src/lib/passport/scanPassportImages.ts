/**
 * Read passport biodata pages with on-device OCR and turn them into rows.
 *
 * tesseract.js is loaded lazily so the rest of the PWA does not pay for the
 * WASM download until an operator opens this tool. The MRZ band (bottom of the
 * page) is cropped and re-OCR'd first; the full page is a fallback.
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
    if (file.type.startsWith("image/") || IMAGE_EXTENSIONS.has(ext)) {
      out.push({ filename: file.name, blob: file });
    }
  }
  return out;
}

/** Crop the lower band of a passport page where the MRZ usually sits. */
async function mrzBandBlob(source: Blob): Promise<Blob | null> {
  if (typeof createImageBitmap !== "function") return null;
  try {
    const bitmap = await createImageBitmap(source);
    const bandTop = Math.floor(bitmap.height * 0.62);
    const bandHeight = Math.max(40, bitmap.height - bandTop);
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bandHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close();
      return null;
    }
    ctx.drawImage(bitmap, 0, bandTop, bitmap.width, bandHeight, 0, 0, bitmap.width, bandHeight);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((value) => resolve(value), "image/jpeg", 0.92);
    });
    return blob;
  } catch {
    return null;
  }
}

type TessWorker = {
  recognize: (image: Blob, options?: Record<string, unknown>) => Promise<{ data: { text: string } }>;
  setParameters: (params: Record<string, string>) => Promise<void>;
  terminate: () => Promise<void>;
};

let sharedWorker: TessWorker | null = null;
let sharedWorkerPromise: Promise<TessWorker> | null = null;

async function getWorker(): Promise<TessWorker> {
  if (sharedWorker) return sharedWorker;
  if (!sharedWorkerPromise) {
    sharedWorkerPromise = (async () => {
      const { createWorker } = await import("tesseract.js");
      const worker = await createWorker("eng", 1, {
        // Local copies so OCR works offline after the PWA shell is cached.
        workerPath: "/tesseract/worker.min.js",
        corePath: "/tesseract/tesseract-core-simd-lstm.wasm.js",
        langPath: "/tesseract/lang-data",
        logger: () => undefined,
      }) as unknown as TessWorker;
      await worker.setParameters({
        tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<",
        preserve_interword_spaces: "0",
      });
      sharedWorker = worker;
      return worker;
    })();
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
  const result = await worker.recognize(image);
  return result.data.text ?? "";
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

async function scanOne(image: ImageInput): Promise<PassportScanRow> {
  const previewUrl = URL.createObjectURL(image.blob);
  try {
    const band = await mrzBandBlob(image.blob);
    let mrz: MrzParseResult | null = null;
    if (band) {
      mrz = extractTd3FromOcrText(await ocrText(band));
    }
    if (!mrz?.valid) {
      const full = extractTd3FromOcrText(await ocrText(image.blob));
      if (full && (!mrz || full.valid || full.warnings.length < mrz.warnings.length)) {
        mrz = full;
      }
    }
    return rowFromMrz(image.filename, previewUrl, mrz);
  } catch (reason) {
    return rowFromMrz(
      image.filename,
      previewUrl,
      null,
      [reason instanceof Error ? reason.message : "OCR başarısız"],
    );
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
