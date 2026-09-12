/**
 * Photo formats are recognised from the bytes, not the filename.
 *
 * Operators hand the app whatever their phone or scanner produced: iPhone
 * HEIC, WhatsApp JPEG, a PNG screenshot, sometimes a file with no extension at
 * all. Trusting the extension would reject real photos and accept renamed
 * junk, so the file is opened and its signature read instead. The extension
 * the app stores and exports is derived from what was actually found.
 */
export type ImageFormat = {
  /** Canonical lowercase extension without the dot, e.g. "jpg". */
  extension: string;
  mime: string;
};

/** Every extension the app treats as a photo. Used to pre-filter ZIP entries
 * and e-mail attachments before their bytes are read. */
export const IMAGE_EXTENSIONS: ReadonlySet<string> = new Set([
  "jpg", "jpeg", "jpe", "jfif", "png", "webp", "gif", "bmp", "tif", "tiff", "heic", "heif", "avif",
]);

/** `accept` attribute for photo pickers: any image, plus the extensions
 * desktop file dialogs need spelled out. */
export const IMAGE_ACCEPT = "image/*,.jpg,.jpeg,.png,.webp,.heic,.heif,.gif,.bmp,.tif,.tiff,.avif";

export const IMAGE_FORMAT_LABEL = "JPG, PNG, HEIC, WEBP veya diğer görüntü dosyaları";

const MIME_BY_EXTENSION: Record<string, string> = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  bmp: "image/bmp",
  tiff: "image/tiff",
  heic: "image/heic",
  avif: "image/avif",
};

const HEIF_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"]);
const AVIF_BRANDS = new Set(["avif", "avis"]);

export function normalizeImageExtension(extension: string): string {
  const lower = extension.toLocaleLowerCase("en-US").replace(/^\./, "");
  if (lower === "jpeg" || lower === "jpe" || lower === "jfif") return "jpg";
  if (lower === "tif") return "tiff";
  if (lower === "heif") return "heic";
  return lower;
}

export function isImageFilename(filename: string): boolean {
  const extension = filename.split(".").pop()?.toLocaleLowerCase("en-US") ?? "";
  return filename.includes(".") && IMAGE_EXTENSIONS.has(extension);
}

/** MIME type for an image filename, or the fallback when the extension is
 * not one of ours. */
export function imageMimeFromFilename(filename: string, fallback = "application/octet-stream"): string {
  if (!isImageFilename(filename)) return fallback;
  const extension = normalizeImageExtension(filename.split(".").pop() ?? "");
  return MIME_BY_EXTENSION[extension] ?? fallback;
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.subarray(start, end));
}

/** Recognises an image from its leading bytes. */
export function detectImageFormat(head: Uint8Array): ImageFormat | null {
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) {
    return { extension: "jpg", mime: "image/jpeg" };
  }
  if (head.length >= 8 && ascii(head, 1, 4) === "PNG" && head[0] === 0x89 && head[4] === 0x0d && head[5] === 0x0a) {
    return { extension: "png", mime: "image/png" };
  }
  if (head.length >= 12 && ascii(head, 0, 4) === "RIFF" && ascii(head, 8, 12) === "WEBP") {
    return { extension: "webp", mime: "image/webp" };
  }
  if (head.length >= 6 && (ascii(head, 0, 6) === "GIF87a" || ascii(head, 0, 6) === "GIF89a")) {
    return { extension: "gif", mime: "image/gif" };
  }
  if (head.length >= 2 && ascii(head, 0, 2) === "BM") {
    return { extension: "bmp", mime: "image/bmp" };
  }
  if (head.length >= 4 && (
    (head[0] === 0x49 && head[1] === 0x49 && head[2] === 0x2a && head[3] === 0x00)
    || (head[0] === 0x4d && head[1] === 0x4d && head[2] === 0x00 && head[3] === 0x2a)
  )) {
    return { extension: "tiff", mime: "image/tiff" };
  }
  // ISO base media: [size:4]["ftyp"][major brand:4]. HEIC/HEIF and AVIF live
  // here, so the brand decides.
  if (head.length >= 12 && ascii(head, 4, 8) === "ftyp") {
    const brand = ascii(head, 8, 12).toLocaleLowerCase("en-US");
    if (AVIF_BRANDS.has(brand)) return { extension: "avif", mime: "image/avif" };
    if (HEIF_BRANDS.has(brand)) return { extension: "heic", mime: "image/heic" };
  }
  return null;
}

export async function sniffImageFormat(blob: Blob): Promise<ImageFormat | null> {
  if (!blob.size) return null;
  const head = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
  return detectImageFormat(head);
}

/**
 * Filename to store a photo under: the original leaf name, with its extension
 * replaced by the one the bytes say it is. "IMG_0042" becomes "IMG_0042.jpg";
 * "scan.jpeg" becomes "scan.jpg"; a PNG mislabelled ".jpg" becomes ".png".
 */
export function withImageExtension(filename: string, format: ImageFormat, fallbackStem = "fotograf"): string {
  const leaf = filename.replaceAll("\\", "/").split("/").pop()?.trim() ?? "";
  const dot = leaf.lastIndexOf(".");
  const currentExtension = dot > 0 ? leaf.slice(dot + 1) : "";
  const stem = dot > 0 && IMAGE_EXTENSIONS.has(currentExtension.toLocaleLowerCase("en-US"))
    ? leaf.slice(0, dot)
    : leaf;
  return `${stem || fallbackStem}.${format.extension}`;
}
