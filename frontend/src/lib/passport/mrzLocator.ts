/**
 * Content-based MRZ localisation over a small grayscale raster.
 *
 * This module deliberately has no DOM dependencies. Keeping the locator on
 * Uint8Array rasters makes its geometry deterministic and unit-testable while
 * the canvas module handles image decoding and full-resolution crops.
 */

export type RasterComponent = {
  x: number;
  y: number;
  width: number;
  height: number;
  area: number;
};

export type MrzBand = {
  x: number;
  y: number;
  width: number;
  height: number;
  score: number;
  /** Baseline angle in degrees; positive slopes down from left to right. */
  angle: number;
};

export type MrzLineSlice = {
  top: number;
  bottom: number;
  score: number;
};

function assertRaster(pixels: Uint8Array, width: number, height: number): void {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new RangeError("Raster dimensions must be positive integers.");
  }
  if (pixels.length !== width * height) {
    throw new RangeError("Raster length does not match its dimensions.");
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

/**
 * Mark pixels darker than their local neighbourhood.
 *
 * An integral image keeps the local mean O(1), so page gradients and phone
 * shadows do not hide the MRZ or turn the paper background into foreground.
 */
export function inkMask(
  gray: Uint8Array,
  width: number,
  height: number,
  radius = clamp(Math.round(Math.min(width, height) / 55), 4, 18),
): Uint8Array {
  assertRaster(gray, width, height);
  const stride = width + 1;
  const integral = new Float64Array((width + 1) * (height + 1));

  for (let y = 0; y < height; y += 1) {
    let rowSum = 0;
    for (let x = 0; x < width; x += 1) {
      rowSum += gray[y * width + x];
      integral[(y + 1) * stride + x + 1] = integral[y * stride + x + 1] + rowSum;
    }
  }

  const output = new Uint8Array(gray.length);
  for (let y = 0; y < height; y += 1) {
    const top = Math.max(0, y - radius);
    const bottom = Math.min(height, y + radius + 1);
    for (let x = 0; x < width; x += 1) {
      const left = Math.max(0, x - radius);
      const right = Math.min(width, x + radius + 1);
      const sum = integral[bottom * stride + right]
        - integral[top * stride + right]
        - integral[bottom * stride + left]
        + integral[top * stride + left];
      const mean = sum / ((right - left) * (bottom - top));
      const pixel = gray[y * width + x];
      const threshold = Math.max(10, mean * 0.065);
      if (pixel < 238 && mean - pixel >= threshold) output[y * width + x] = 1;
    }
  }
  return output;
}

/**
 * Remove isolated specks while retaining the short vertical strokes common to
 * OCR-B/MRZ glyphs.
 */
export function glyphMask(ink: Uint8Array, width: number, height: number): Uint8Array {
  assertRaster(ink, width, height);
  const output = new Uint8Array(ink.length);
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x;
      if (!ink[index]) continue;
      let neighbours = 0;
      for (let yy = y - 1; yy <= y + 1; yy += 1) {
        for (let xx = x - 1; xx <= x + 1; xx += 1) {
          neighbours += ink[yy * width + xx];
        }
      }
      const vertical = ink[(y - 1) * width + x] + ink[(y + 1) * width + x];
      if (neighbours >= 3 || (neighbours >= 2 && vertical > 0)) output[index] = 1;
    }
  }
  return output;
}

/**
 * Bridge the small spaces between neighbouring fixed-pitch MRZ characters.
 * A one-pixel vertical expansion joins the different horizontal glyph strokes.
 */
export function fuseHorizontally(
  glyphs: Uint8Array,
  width: number,
  height: number,
  maximumGap = clamp(Math.round(width / 90), 3, 18),
): Uint8Array {
  assertRaster(glyphs, width, height);
  const horizontal = new Uint8Array(glyphs.length);

  for (let y = 0; y < height; y += 1) {
    let previous = -1;
    for (let x = 0; x < width; x += 1) {
      if (!glyphs[y * width + x]) continue;
      horizontal[y * width + x] = 1;
      if (previous >= 0 && x - previous - 1 <= maximumGap) {
        horizontal.fill(1, y * width + previous, y * width + x + 1);
      }
      previous = x;
    }
  }

  const output = horizontal.slice();
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!horizontal[y * width + x]) continue;
      if (y > 0) output[(y - 1) * width + x] = 1;
      if (y + 1 < height) output[(y + 1) * width + x] = 1;
    }
  }
  return output;
}

/** Return 8-connected foreground components without mutating the mask. */
export function components(mask: Uint8Array, width: number, height: number): RasterComponent[] {
  assertRaster(mask, width, height);
  const seen = new Uint8Array(mask.length);
  const queue = new Int32Array(mask.length);
  const output: RasterComponent[] = [];

  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || seen[start]) continue;
    let head = 0;
    let tail = 0;
    queue[tail] = start;
    tail += 1;
    seen[start] = 1;
    let minX = start % width;
    let maxX = minX;
    let minY = Math.floor(start / width);
    let maxY = minY;
    let area = 0;

    while (head < tail) {
      const index = queue[head];
      head += 1;
      const x = index % width;
      const y = Math.floor(index / width);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      area += 1;

      for (let yy = Math.max(0, y - 1); yy <= Math.min(height - 1, y + 1); yy += 1) {
        for (let xx = Math.max(0, x - 1); xx <= Math.min(width - 1, x + 1); xx += 1) {
          const next = yy * width + xx;
          if (!mask[next] || seen[next]) continue;
          seen[next] = 1;
          queue[tail] = next;
          tail += 1;
        }
      }
    }

    output.push({
      x: minX,
      y: minY,
      width: maxX - minX + 1,
      height: maxY - minY + 1,
      area,
    });
  }
  return output;
}

function lineCandidates(gray: Uint8Array, width: number, height: number): RasterComponent[] {
  const ink = inkMask(gray, width, height);
  const glyphs = glyphMask(ink, width, height);
  const fused = fuseHorizontally(glyphs, width, height);
  return components(fused, width, height)
    .filter((component) => (
      component.width >= width * 0.28
      && component.height >= 3
      && component.height <= height * 0.13
      && component.width / component.height >= 4
    ))
    .sort((left, right) => left.y - right.y);
}

/**
 * Find two long, fixed-pitch text components with matching geometry.
 *
 * There is intentionally no "bottom of page" prior here: tightly framed phone
 * photos can place the MRZ anywhere in the image.
 */
export function findMrzBand(gray: Uint8Array, width: number, height: number): MrzBand | null {
  assertRaster(gray, width, height);
  const lines = lineCandidates(gray, width, height);
  let best: MrzBand | null = null;

  for (let firstIndex = 0; firstIndex < lines.length; firstIndex += 1) {
    const first = lines[firstIndex];
    for (let secondIndex = firstIndex + 1; secondIndex < lines.length; secondIndex += 1) {
      const second = lines[secondIndex];
      const gap = second.y - (first.y + first.height);
      const lineHeight = Math.max(first.height, second.height);
      if (gap < -2 || gap > lineHeight * 3.2) continue;

      const overlapLeft = Math.max(first.x, second.x);
      const overlapRight = Math.min(first.x + first.width, second.x + second.width);
      const overlap = Math.max(0, overlapRight - overlapLeft);
      const overlapRatio = overlap / Math.min(first.width, second.width);
      const widthRatio = Math.min(first.width, second.width) / Math.max(first.width, second.width);
      const heightRatio = Math.min(first.height, second.height) / lineHeight;
      if (overlapRatio < 0.58 || widthRatio < 0.55 || heightRatio < 0.35) continue;

      const xPadding = Math.max(3, Math.round(width * 0.018));
      const yPadding = Math.max(3, Math.round(lineHeight * 0.7));
      const left = clamp(Math.min(first.x, second.x) - xPadding, 0, width - 1);
      const top = clamp(first.y - yPadding, 0, height - 1);
      const right = clamp(Math.max(first.x + first.width, second.x + second.width) + xPadding, left + 1, width);
      const bottom = clamp(second.y + second.height + yPadding, top + 1, height);
      const coverage = Math.min(first.width, second.width) / width;
      const score = coverage * 4 + overlapRatio * 2 + widthRatio + heightRatio;
      const candidate: MrzBand = {
        x: left,
        y: top,
        width: right - left,
        height: bottom - top,
        score,
        angle: 0,
      };
      if (!best || candidate.score > best.score) best = candidate;
    }
  }

  if (!best) return null;
  return { ...best, angle: refineSkew(gray, width, height, best) };
}

/**
 * Estimate the text baseline by maximizing the concentration of foreground
 * pixels after projection over a small angle sweep.
 */
export function refineSkew(
  gray: Uint8Array,
  width: number,
  height: number,
  band: Pick<MrzBand, "x" | "y" | "width" | "height">,
): number {
  assertRaster(gray, width, height);
  const ink = glyphMask(inkMask(gray, width, height), width, height);
  const left = clamp(Math.floor(band.x), 0, width - 1);
  const top = clamp(Math.floor(band.y), 0, height - 1);
  const right = clamp(Math.ceil(band.x + band.width), left + 1, width);
  const bottom = clamp(Math.ceil(band.y + band.height), top + 1, height);
  const centreX = (left + right) / 2;
  let bestAngle = 0;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (let angle = -7; angle <= 7.001; angle += 0.5) {
    const slope = Math.tan((angle * Math.PI) / 180);
    const bins = new Uint32Array(bottom - top + 16);
    for (let y = top; y < bottom; y += 1) {
      for (let x = left; x < right; x += 1) {
        if (!ink[y * width + x]) continue;
        const projected = Math.round(y - top - slope * (x - centreX)) + 8;
        if (projected >= 0 && projected < bins.length) bins[projected] += 1;
      }
    }
    let score = 0;
    for (const count of bins) score += count * count;
    if (score > bestScore) {
      bestScore = score;
      bestAngle = angle;
    }
  }
  return bestAngle;
}

function mergeLineRanges(
  ranges: Array<{ top: number; bottom: number; score: number }>,
  maximumGap: number,
): MrzLineSlice[] {
  const merged: MrzLineSlice[] = [];
  for (const range of ranges) {
    const previous = merged.at(-1);
    if (previous && range.top - previous.bottom <= maximumGap) {
      previous.bottom = range.bottom;
      previous.score += range.score;
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}

/** Split a deskewed MRZ crop into its two horizontal text lines. */
export function splitLines(gray: Uint8Array, width: number, height: number): MrzLineSlice[] {
  assertRaster(gray, width, height);
  const ink = glyphMask(inkMask(gray, width, height), width, height);
  const rowScores = new Float64Array(height);
  for (let y = 0; y < height; y += 1) {
    let count = 0;
    for (let x = 0; x < width; x += 1) count += ink[y * width + x];
    rowScores[y] = count;
  }

  const smoothed = new Float64Array(height);
  for (let y = 0; y < height; y += 1) {
    let sum = 0;
    let count = 0;
    for (let yy = Math.max(0, y - 1); yy <= Math.min(height - 1, y + 1); yy += 1) {
      sum += rowScores[yy];
      count += 1;
    }
    smoothed[y] = sum / count;
  }

  const peak = Math.max(...smoothed);
  if (peak <= 0) return [];
  const threshold = Math.max(2, peak * 0.2, width * 0.008);
  const rawRanges: MrzLineSlice[] = [];
  let start = -1;
  let score = 0;
  for (let y = 0; y <= height; y += 1) {
    const active = y < height && smoothed[y] >= threshold;
    if (active && start < 0) {
      start = y;
      score = 0;
    }
    if (active) score += smoothed[y];
    if (!active && start >= 0) {
      rawRanges.push({ top: start, bottom: y, score });
      start = -1;
    }
  }

  const merged = mergeLineRanges(rawRanges, Math.max(1, Math.round(height * 0.035)))
    .filter((range) => range.bottom - range.top >= 2);
  if (merged.length < 2) return [];

  const strongest = merged
    .toSorted((left, right) => right.score - left.score)
    .slice(0, 2)
    .sort((left, right) => left.top - right.top);
  const padding = Math.max(2, Math.round(height * 0.04));
  return strongest.map((line) => ({
    top: clamp(line.top - padding, 0, height - 1),
    bottom: clamp(line.bottom + padding, line.top + 1, height),
    score: line.score,
  }));
}
