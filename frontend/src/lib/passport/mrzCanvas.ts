import type { MrzBand, MrzLineSlice } from "./mrzLocator";

export type QuarterTurn = 0 | 1 | 2 | 3;

export type GrayThumbnail = {
  gray: Uint8Array;
  width: number;
  height: number;
  orientation: QuarterTurn;
  /** Scale from full-resolution oriented pixels to thumbnail pixels. */
  scale: number;
};

type BitmapOptions = {
  imageOrientation?: "from-image" | "none";
};

/** Decode a browser image while asking the platform to apply EXIF orientation. */
export async function decodeBitmap(source: Blob): Promise<ImageBitmap | null> {
  if (typeof createImageBitmap !== "function") return null;
  try {
    return await createImageBitmap(source, { imageOrientation: "from-image" } as BitmapOptions);
  } catch {
    try {
      return await createImageBitmap(source);
    } catch {
      return null;
    }
  }
}

function orientedDimensions(
  width: number,
  height: number,
  orientation: QuarterTurn,
): { width: number; height: number } {
  return orientation % 2 === 0 ? { width, height } : { width: height, height: width };
}

function drawOriented(
  context: CanvasRenderingContext2D,
  bitmap: ImageBitmap,
  orientation: QuarterTurn,
  scale: number,
): void {
  const sourceWidth = bitmap.width * scale;
  const sourceHeight = bitmap.height * scale;
  if (orientation === 0) {
    context.drawImage(bitmap, 0, 0, sourceWidth, sourceHeight);
    return;
  }
  if (orientation === 1) {
    context.translate(sourceHeight, 0);
    context.rotate(Math.PI / 2);
  } else if (orientation === 2) {
    context.translate(sourceWidth, sourceHeight);
    context.rotate(Math.PI);
  } else {
    context.translate(0, sourceWidth);
    context.rotate(-Math.PI / 2);
  }
  context.drawImage(bitmap, 0, 0, sourceWidth, sourceHeight);
}

function renderOriented(
  bitmap: ImageBitmap,
  orientation: QuarterTurn,
  scale: number,
): HTMLCanvasElement | null {
  const dimensions = orientedDimensions(bitmap.width, bitmap.height, orientation);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(dimensions.width * scale));
  canvas.height = Math.max(1, Math.round(dimensions.height * scale));
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  drawOriented(context, bitmap, orientation, scale);
  return canvas;
}

/** Convert a canvas to an 8-bit luminance raster. */
export function canvasGray(canvas: HTMLCanvasElement): Uint8Array | null {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;
  const rgba = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const gray = new Uint8Array(canvas.width * canvas.height);
  for (let source = 0, target = 0; source < rgba.length; source += 4, target += 1) {
    gray[target] = Math.round(0.299 * rgba[source] + 0.587 * rgba[source + 1] + 0.114 * rgba[source + 2]);
  }
  return gray;
}

/**
 * Draw one of four page orientations at localisation resolution and return a
 * grayscale raster. Full-resolution pixels are retained in the ImageBitmap.
 */
export function grayThumbnail(
  bitmap: ImageBitmap,
  orientation: QuarterTurn,
  maximumEdge = 900,
): GrayThumbnail | null {
  const scale = Math.min(1, maximumEdge / Math.max(bitmap.width, bitmap.height));
  const canvas = renderOriented(bitmap, orientation, scale);
  if (!canvas) return null;
  const gray = canvasGray(canvas);
  if (!gray) return null;
  return {
    gray,
    width: canvas.width,
    height: canvas.height,
    orientation,
    scale,
  };
}

/**
 * Re-render the located band from the original bitmap and deskew it.
 *
 * The intermediate oriented page is scaled so the MRZ crop does not exceed
 * maxCropWidth. This avoids allocating a second full 12-megapixel phone image.
 */
export function cropDeskewed(
  bitmap: ImageBitmap,
  band: Pick<MrzBand, "x" | "y" | "width" | "height" | "angle">,
  thumbnail: Pick<GrayThumbnail, "orientation" | "scale">,
  maxCropWidth = 2000,
): HTMLCanvasElement | null {
  const fullBandWidth = band.width / thumbnail.scale;
  const renderScale = Math.min(1, maxCropWidth / Math.max(1, fullBandWidth));
  const oriented = renderOriented(bitmap, thumbnail.orientation, renderScale);
  if (!oriented) return null;

  const ratio = renderScale / thumbnail.scale;
  const x = band.x * ratio;
  const y = band.y * ratio;
  const width = Math.max(1, Math.round(band.width * ratio));
  const height = Math.max(1, Math.round(band.height * ratio));
  const crop = document.createElement("canvas");
  crop.width = width;
  crop.height = height;
  const context = crop.getContext("2d");
  if (!context) return null;
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.translate(width / 2, height / 2);
  context.rotate((-band.angle * Math.PI) / 180);
  context.drawImage(oriented, -(x + width / 2), -(y + height / 2));
  return crop;
}

/** Extract and, when useful, upscale one line for Tesseract PSM 7. */
export function lineCanvas(
  source: HTMLCanvasElement,
  slice: Pick<MrzLineSlice, "top" | "bottom">,
): HTMLCanvasElement | null {
  const top = Math.max(0, Math.floor(slice.top));
  const bottom = Math.min(source.height, Math.ceil(slice.bottom));
  const sourceHeight = bottom - top;
  if (sourceHeight < 1) return null;
  const targetHeight = Math.max(sourceHeight, 96);
  const scale = Math.min(targetHeight / sourceHeight, 3, 2400 / source.width);
  const horizontalPadding = Math.max(8, Math.round(source.width * 0.012 * scale));
  const verticalPadding = Math.max(5, Math.round(sourceHeight * 0.12 * scale));
  const output = document.createElement("canvas");
  output.width = Math.max(1, Math.round(source.width * scale) + horizontalPadding * 2);
  output.height = Math.max(1, Math.round(sourceHeight * scale) + verticalPadding * 2);
  const context = output.getContext("2d");
  if (!context) return null;
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, output.width, output.height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(
    source,
    0,
    top,
    source.width,
    sourceHeight,
    horizontalPadding,
    verticalPadding,
    Math.round(source.width * scale),
    Math.round(sourceHeight * scale),
  );
  return output;
}

/** Return a new canvas rotated by 180 degrees. */
export function rotate180(source: HTMLCanvasElement): HTMLCanvasElement | null {
  const output = document.createElement("canvas");
  output.width = source.width;
  output.height = source.height;
  const context = output.getContext("2d");
  if (!context) return null;
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, output.width, output.height);
  context.translate(output.width, output.height);
  context.rotate(Math.PI);
  context.drawImage(source, 0, 0);
  return output;
}
