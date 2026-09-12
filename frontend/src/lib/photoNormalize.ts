/**
 * Brings a photo into the shape the rest of the app can rely on.
 *
 * Phone cameras produce 12-megapixel HEIC files. A passport-style photo does
 * not need that: the daily list, the gate visa PDF and the passenger card all
 * show it at a few hundred pixels, and storing multi-megabyte originals in the
 * encrypted vault makes exports slow and eats device storage. So, where the
 * browser can decode the picture, it is re-encoded as a JPEG no larger than
 * `MAX_EDGE` pixels on its longest side.
 *
 * Decoding is done with the platform image decoder. Safari on iPhone decodes
 * HEIC natively; other browsers cannot, and then the original file is kept
 * as-is so nothing is ever lost. Small JPEG/PNG/WEBP files are passed through
 * untouched. Outside a browser (unit tests) the original is always returned.
 */
import type { ImageFormat } from "@/lib/imageFormat";

export const MAX_EDGE = 1200;
export const PASSTHROUGH_MAX_BYTES = 2 * 1024 * 1024;
const JPEG_QUALITY = 0.86;
const JPEG: ImageFormat = { extension: "jpg", mime: "image/jpeg" };

/** Formats every browser and PDF renderer shows; kept as-is when small. */
const PASSTHROUGH_FORMATS = new Set(["jpg", "png", "webp", "gif"]);

export type NormalizedPhoto = {
  blob: Blob;
  format: ImageFormat;
  /** True when the picture was re-encoded, false when the original is kept. */
  converted: boolean;
};

type DecodedImage = {
  width: number;
  height: number;
  source: CanvasImageSource;
  release(): void;
};

function hasCanvasSupport(): boolean {
  return typeof document !== "undefined"
    && typeof HTMLCanvasElement !== "undefined"
    && typeof URL !== "undefined"
    && typeof URL.createObjectURL === "function";
}

async function decodeWithBitmap(blob: Blob): Promise<DecodedImage | null> {
  if (typeof createImageBitmap !== "function") return null;
  try {
    const bitmap = await createImageBitmap(blob);
    return { width: bitmap.width, height: bitmap.height, source: bitmap, release: () => bitmap.close() };
  } catch {
    return null;
  }
}

function decodeWithImageElement(blob: Blob): Promise<DecodedImage | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    const done = (value: DecodedImage | null) => {
      URL.revokeObjectURL(url);
      resolve(value);
    };
    image.onload = () => {
      if (!image.naturalWidth || !image.naturalHeight) return done(null);
      done({ width: image.naturalWidth, height: image.naturalHeight, source: image, release: () => { image.src = ""; } });
    };
    image.onerror = () => done(null);
    image.src = url;
  });
}

async function decodeImage(blob: Blob): Promise<DecodedImage | null> {
  return (await decodeWithBitmap(blob)) ?? (await decodeWithImageElement(blob));
}

function fitWithin(width: number, height: number, maxEdge: number): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= maxEdge) return { width, height };
  const scale = maxEdge / longest;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

function canvasToJpeg(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      canvas.toBlob((blob) => resolve(blob), JPEG.mime, JPEG_QUALITY);
    } catch {
      resolve(null);
    }
  });
}

async function encodeJpeg(decoded: DecodedImage): Promise<Blob | null> {
  const target = fitWithin(decoded.width, decoded.height, MAX_EDGE);
  const canvas = document.createElement("canvas");
  canvas.width = target.width;
  canvas.height = target.height;
  const context = canvas.getContext("2d");
  if (!context) return null;
  // Transparent PNG corners would turn black in JPEG; paint white first.
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, target.width, target.height);
  context.drawImage(decoded.source, 0, 0, target.width, target.height);
  return canvasToJpeg(canvas);
}

/** Whether the picture is already in a shape worth keeping verbatim. */
export function needsNormalization(format: ImageFormat, size: number): boolean {
  return !PASSTHROUGH_FORMATS.has(format.extension) || size > PASSTHROUGH_MAX_BYTES;
}

/**
 * Returns a JPEG at most `MAX_EDGE` px wide/high when the input is a format
 * some browsers cannot show or is bigger than a photo needs to be. Otherwise,
 * or whenever decoding fails, the original blob and format come back.
 */
export async function normalizePhoto(blob: Blob, format: ImageFormat): Promise<NormalizedPhoto> {
  const original: NormalizedPhoto = { blob, format, converted: false };
  if (!needsNormalization(format, blob.size) || !hasCanvasSupport()) return original;

  const decoded = await decodeImage(blob);
  if (!decoded) return original;
  try {
    const oversized = Math.max(decoded.width, decoded.height) > MAX_EDGE;
    // A big-but-small-dimensioned JPEG/PNG is left alone: re-encoding would
    // only trade quality for a few hundred kilobytes.
    if (PASSTHROUGH_FORMATS.has(format.extension) && !oversized) return original;
    const jpeg = await encodeJpeg(decoded);
    if (!jpeg || !jpeg.size) return original;
    return { blob: jpeg, format: JPEG, converted: true };
  } finally {
    decoded.release();
  }
}
