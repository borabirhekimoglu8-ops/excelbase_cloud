import { describe, expect, it } from "vitest";

import {
  components,
  findMrzBand,
  fuseHorizontally,
  glyphMask,
  inkMask,
  refineSkew,
  splitLines,
} from "./mrzLocator";

function page(width: number, height: number): Uint8Array {
  const pixels = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const shade = 238 + Math.round((y / height) * 12);
    pixels.fill(shade, y * width, (y + 1) * width);
  }
  return pixels;
}

function glyphLine(
  pixels: Uint8Array,
  width: number,
  startX: number,
  startY: number,
  count = 44,
  slope = 0,
): void {
  for (let glyph = 0; glyph < count; glyph += 1) {
    const x = startX + glyph * 7;
    const y = startY + Math.round((x - startX) * slope);
    for (let yy = 0; yy < 10; yy += 1) {
      for (let xx = 0; xx < 5; xx += 1) {
        if (xx === 0 || xx === 4 || yy === 0 || yy === 5 || yy === 9) {
          pixels[(y + yy) * width + x + xx] = 25;
        }
      }
    }
  }
}

describe("MRZ raster primitives", () => {
  it("uses local contrast and connects fixed-pitch glyphs", () => {
    const width = 120;
    const height = 40;
    const gray = page(width, height);
    glyphLine(gray, width, 8, 14, 14);
    const ink = inkMask(gray, width, height);
    const glyphs = glyphMask(ink, width, height);
    const fused = fuseHorizontally(glyphs, width, height, 4);
    const joined = components(fused, width, height);
    expect(ink.reduce((sum, value) => sum + value, 0)).toBeGreaterThan(100);
    expect(joined.some((component) => component.width > 80)).toBe(true);
  });
});

describe("findMrzBand", () => {
  it("finds a two-line MRZ away from fixed passport band positions", () => {
    const width = 360;
    const height = 190;
    const gray = page(width, height);
    glyphLine(gray, width, 24, 31);
    glyphLine(gray, width, 24, 49);

    const band = findMrzBand(gray, width, height);
    expect(band).not.toBeNull();
    expect(band?.x).toBeLessThanOrEqual(24);
    expect(band?.y).toBeLessThan(31);
    expect((band?.y ?? 0) + (band?.height ?? 0)).toBeGreaterThan(58);
    expect(band?.width).toBeGreaterThan(300);
  });
});

describe("refineSkew", () => {
  it("measures a sloped pair of synthetic OCR-B-style lines", () => {
    const width = 360;
    const height = 140;
    const gray = page(width, height);
    const slope = Math.tan((3 * Math.PI) / 180);
    glyphLine(gray, width, 24, 42, 44, slope);
    glyphLine(gray, width, 24, 66, 44, slope);
    const angle = refineSkew(gray, width, height, {
      x: 16,
      y: 32,
      width: 330,
      height: 72,
    });
    expect(angle).toBeGreaterThanOrEqual(2);
    expect(angle).toBeLessThanOrEqual(4);
  });
});

describe("splitLines", () => {
  it("returns the two strongest text rows in top-to-bottom order", () => {
    const width = 360;
    const height = 70;
    const gray = page(width, height);
    glyphLine(gray, width, 24, 13);
    glyphLine(gray, width, 24, 42);
    const lines = splitLines(gray, width, height);
    expect(lines).toHaveLength(2);
    expect(lines[0].top).toBeLessThan(lines[1].top);
    expect(lines[0].top).toBeLessThanOrEqual(13);
    expect(lines[1].bottom).toBeGreaterThanOrEqual(51);
  });
});
