import { describe, expect, it } from "vitest";

import {
  detectImageFormat,
  imageMimeFromFilename,
  isImageFilename,
  sniffImageFormat,
  withImageExtension,
} from "./imageFormat";

function bytes(...values: Array<number | string>): Uint8Array<ArrayBuffer> {
  const out: number[] = [];
  for (const value of values) {
    if (typeof value === "number") out.push(value);
    else for (const char of value) out.push(char.charCodeAt(0));
  }
  return new Uint8Array(out);
}

describe("detectImageFormat", () => {
  it("recognises every common photo container from its signature", () => {
    expect(detectImageFormat(bytes(0xff, 0xd8, 0xff, 0xe0))).toEqual({ extension: "jpg", mime: "image/jpeg" });
    expect(detectImageFormat(bytes(0x89, "PNG", 0x0d, 0x0a, 0x1a, 0x0a))).toEqual({ extension: "png", mime: "image/png" });
    expect(detectImageFormat(bytes("RIFF", 0, 0, 0, 0, "WEBPVP8 "))).toEqual({ extension: "webp", mime: "image/webp" });
    expect(detectImageFormat(bytes("GIF89a", 0, 0))).toEqual({ extension: "gif", mime: "image/gif" });
    expect(detectImageFormat(bytes("BM", 0, 0, 0, 0))).toEqual({ extension: "bmp", mime: "image/bmp" });
    expect(detectImageFormat(bytes(0x49, 0x49, 0x2a, 0x00))).toEqual({ extension: "tiff", mime: "image/tiff" });
    expect(detectImageFormat(bytes(0x4d, 0x4d, 0x00, 0x2a))).toEqual({ extension: "tiff", mime: "image/tiff" });
  });

  it("recognises iPhone HEIC and AVIF through the ftyp brand", () => {
    expect(detectImageFormat(bytes(0, 0, 0, 0x18, "ftyp", "heic", 0, 0, 0, 0))).toEqual({ extension: "heic", mime: "image/heic" });
    expect(detectImageFormat(bytes(0, 0, 0, 0x18, "ftyp", "mif1", 0, 0, 0, 0))).toEqual({ extension: "heic", mime: "image/heic" });
    expect(detectImageFormat(bytes(0, 0, 0, 0x18, "ftyp", "avif", 0, 0, 0, 0))).toEqual({ extension: "avif", mime: "image/avif" });
    // An MP4 is also ISO base media but is not a picture.
    expect(detectImageFormat(bytes(0, 0, 0, 0x18, "ftyp", "isom", 0, 0, 0, 0))).toBeNull();
  });

  it("rejects text, PDFs and empty input", async () => {
    expect(detectImageFormat(bytes("JPG degil"))).toBeNull();
    expect(detectImageFormat(bytes("%PDF-1.7"))).toBeNull();
    expect(detectImageFormat(new Uint8Array())).toBeNull();
    expect(await sniffImageFormat(new Blob([]))).toBeNull();
  });

  it("sniffs a Blob regardless of its declared type or name", async () => {
    const png = new File([bytes(0x89, "PNG", 0x0d, 0x0a, 0x1a, 0x0a)], "renamed.jpg", { type: "image/jpeg" });
    expect(await sniffImageFormat(png)).toEqual({ extension: "png", mime: "image/png" });
  });
});

describe("filename helpers", () => {
  it("knows which filenames are photos", () => {
    expect(isImageFilename("a.JPG")).toBe(true);
    expect(isImageFilename("a.heic")).toBe(true);
    expect(isImageFilename("a.pdf")).toBe(false);
    expect(isImageFilename("noext")).toBe(false);
    expect(imageMimeFromFilename("x.jpeg")).toBe("image/jpeg");
    expect(imageMimeFromFilename("x.HEIF")).toBe("image/heic");
    expect(imageMimeFromFilename("x.xlsx")).toBe("application/octet-stream");
  });

  it("rewrites the stored extension to match the bytes", () => {
    const jpg = { extension: "jpg", mime: "image/jpeg" };
    const png = { extension: "png", mime: "image/png" };
    expect(withImageExtension("IMG_0042", jpg)).toBe("IMG_0042.jpg");
    expect(withImageExtension("scan.jpeg", jpg)).toBe("scan.jpg");
    expect(withImageExtension("photo.jpg", png)).toBe("photo.png");
    expect(withImageExtension("dir/sub/Ali.Veli.HEIC", { extension: "heic", mime: "image/heic" })).toBe("Ali.Veli.heic");
    expect(withImageExtension("", jpg)).toBe("fotograf.jpg");
  });
});
