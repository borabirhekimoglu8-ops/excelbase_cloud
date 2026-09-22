const JPEG = [0xff, 0xd8, 0xff];
const PNG = [0x89, 0x50, 0x4e, 0x47];

export function isPdfFile(file: File): boolean {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

export function isTextFile(file: File): boolean {
  return file.type === "text/plain" || file.name.toLowerCase().endsWith(".txt");
}

export function isImageFile(file: File): boolean {
  const name = file.name.toLowerCase();
  return (
    file.type.startsWith("image/")
    || name.endsWith(".jpg")
    || name.endsWith(".jpeg")
    || name.endsWith(".png")
    || name.endsWith(".heic")
  );
}

export async function sniffImageKind(file: Blob): Promise<"jpeg" | "png" | "heif" | ""> {
  const header = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  if (header.length >= 3 && header[0] === JPEG[0] && header[1] === JPEG[1] && header[2] === JPEG[2]) return "jpeg";
  if (header.length >= 4 && header[0] === PNG[0] && header[1] === PNG[1] && header[2] === PNG[2] && header[3] === PNG[3]) {
    return "png";
  }
  const ascii = String.fromCharCode(...header.slice(4, 12));
  if (ascii.startsWith("ftyp")) return "heif";
  return "";
}

/** Downscale only when the browser can decode and the long side is huge. Never below 1800. */
export async function prepareImageForOcr(file: Blob): Promise<Blob> {
  if (typeof createImageBitmap !== "function") return file;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return file;
  }
  try {
    const longSide = Math.max(bitmap.width, bitmap.height);
    if (longSide <= 3000) return file;
    const scale = 2600 / longSide;
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return file;
    context.drawImage(bitmap, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
    return blob ?? file;
  } finally {
    bitmap.close();
  }
}
