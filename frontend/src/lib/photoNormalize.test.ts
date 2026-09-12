import { afterEach, describe, expect, it, vi } from "vitest";

import { MAX_EDGE, PASSTHROUGH_MAX_BYTES, needsNormalization, normalizePhoto } from "./photoNormalize";

const JPG = { extension: "jpg", mime: "image/jpeg" };
const HEIC = { extension: "heic", mime: "image/heic" };

function blobOf(size: number, type: string): Blob {
  return new Blob([new Uint8Array(size)], { type });
}

/** Pretends to be a browser that decodes to `width`×`height` and encodes to
 * a fixed JPEG payload; records the canvas size it was asked to draw into. */
function stubBrowser(options: { width: number; height: number; decodes?: boolean; encoded?: Uint8Array<ArrayBuffer> | null }) {
  const drawn: Array<{ width: number; height: number }> = [];
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ({
      fillStyle: "",
      fillRect: () => undefined,
      drawImage: () => { drawn.push({ width: canvas.width, height: canvas.height }); },
    }),
    toBlob: (callback: (blob: Blob | null) => void, type: string) => {
      const payload = options.encoded === undefined ? new Uint8Array([0xff, 0xd8, 0xff, 0xe0]) : options.encoded;
      callback(payload ? new Blob([payload], { type }) : null);
    },
  };
  vi.stubGlobal("document", { createElement: () => canvas });
  vi.stubGlobal("HTMLCanvasElement", function HTMLCanvasElement() {});
  vi.stubGlobal("URL", { createObjectURL: () => "blob:test", revokeObjectURL: () => undefined });
  vi.stubGlobal("createImageBitmap", async () => {
    if (options.decodes === false) throw new Error("undecodable");
    return { width: options.width, height: options.height, close: () => undefined };
  });
  return { drawn };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("needsNormalization", () => {
  it("leaves small JPEG/PNG/WEBP/GIF files alone and converts everything else", () => {
    expect(needsNormalization(JPG, 100)).toBe(false);
    expect(needsNormalization({ extension: "png", mime: "image/png" }, 100)).toBe(false);
    expect(needsNormalization(JPG, PASSTHROUGH_MAX_BYTES + 1)).toBe(true);
    expect(needsNormalization(HEIC, 100)).toBe(true);
    expect(needsNormalization({ extension: "tiff", mime: "image/tiff" }, 100)).toBe(true);
  });
});

describe("normalizePhoto", () => {
  it("returns the original when there is no browser to decode with", async () => {
    const blob = blobOf(64, "image/heic");
    const result = await normalizePhoto(blob, HEIC);
    expect(result.converted).toBe(false);
    expect(result.blob).toBe(blob);
    expect(result.format).toBe(HEIC);
  });

  it("skips decoding entirely for a small JPEG", async () => {
    const decode = vi.fn();
    vi.stubGlobal("createImageBitmap", decode);
    const blob = blobOf(64, "image/jpeg");
    const result = await normalizePhoto(blob, JPG);
    expect(result.blob).toBe(blob);
    expect(decode).not.toHaveBeenCalled();
  });

  it("re-encodes HEIC as JPEG, scaled to fit the longest edge", async () => {
    const { drawn } = stubBrowser({ width: 4032, height: 3024 });
    const result = await normalizePhoto(blobOf(3_000_000, "image/heic"), HEIC);
    expect(result.converted).toBe(true);
    expect(result.format).toEqual(JPG);
    expect(result.blob.type).toBe("image/jpeg");
    expect(drawn).toEqual([{ width: MAX_EDGE, height: 900 }]);
  });

  it("keeps a large JPEG whose dimensions are already small", async () => {
    const { drawn } = stubBrowser({ width: 800, height: 1000 });
    const blob = blobOf(PASSTHROUGH_MAX_BYTES + 1, "image/jpeg");
    const result = await normalizePhoto(blob, JPG);
    expect(result.converted).toBe(false);
    expect(result.blob).toBe(blob);
    expect(drawn).toEqual([]);
  });

  it("downscales an oversized PNG to a JPEG without changing its aspect", async () => {
    const { drawn } = stubBrowser({ width: 1500, height: 3000 });
    const result = await normalizePhoto(blobOf(PASSTHROUGH_MAX_BYTES + 1, "image/png"), { extension: "png", mime: "image/png" });
    expect(result.converted).toBe(true);
    expect(drawn).toEqual([{ width: 600, height: MAX_EDGE }]);
  });

  it("falls back to the original when the browser cannot decode the picture", async () => {
    stubBrowser({ width: 0, height: 0, decodes: false });
    // createImageBitmap rejected; the <img> fallback errors out as well.
    vi.stubGlobal("Image", function Image(this: { onerror?: () => void; src: string }) {
      Object.defineProperty(this, "src", { set: () => { this.onerror?.(); } });
    });
    const blob = blobOf(64, "image/heic");
    const result = await normalizePhoto(blob, HEIC);
    expect(result.converted).toBe(false);
    expect(result.blob).toBe(blob);
  });

  it("falls back to the original when encoding yields nothing", async () => {
    stubBrowser({ width: 5000, height: 5000, encoded: null });
    const blob = blobOf(64, "image/heic");
    const result = await normalizePhoto(blob, HEIC);
    expect(result.converted).toBe(false);
    expect(result.blob).toBe(blob);
  });
});
