import { createCanvas, DOMMatrix, ImageData, Path2D } from "@napi-rs/canvas";
import { afterEach, describe, expect, it } from "vitest";

import { pdfRasterScale, rasterizePdfToImages } from "./pdfToImages";

function onePageBlankPdf(): ArrayBuffer {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Resources << >> >>",
  ];
  let source = "%PDF-1.4\n";
  const offsets: number[] = [];

  objects.forEach((object, index) => {
    offsets.push(new TextEncoder().encode(source).length);
    source += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });

  const xrefOffset = new TextEncoder().encode(source).length;
  source += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.forEach((offset) => {
    source += `${String(offset).padStart(10, "0")} 00000 n \n`;
  });
  source += [
    "trailer",
    `<< /Size ${objects.length + 1} /Root 1 0 R >>`,
    "startxref",
    String(xrefOffset),
    "%%EOF",
    "",
  ].join("\n");
  const bytes = new TextEncoder().encode(source);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

const originalGlobals = {
  document: globalThis.document,
  DOMMatrix: globalThis.DOMMatrix,
  ImageData: globalThis.ImageData,
  Path2D: globalThis.Path2D,
};

afterEach(() => {
  Object.assign(globalThis, originalGlobals);
});

describe("pdfRasterScale", () => {
  it("caps the raster long edge for mobile memory", () => {
    expect(pdfRasterScale({ width: 1000, height: 500 })).toBeCloseTo(2.6);
  });
});

describe("rasterizePdfToImages", () => {
  it("renders a tiny synthetic one-page PDF as a JPEG", async () => {
    Object.assign(globalThis, {
      DOMMatrix,
      ImageData,
      Path2D,
      document: {
        createElement: () => createCanvas(1, 1),
      },
    });

    const images = await rasterizePdfToImages(
      new Blob([onePageBlankPdf()], { type: "application/pdf" }),
      "scan.pdf",
    );

    expect(images).toHaveLength(1);
    expect(images[0].filename).toBe("scan-p1.jpg");
    expect(images[0].blob.type).toBe("image/jpeg");
    expect(images[0].blob.size).toBeGreaterThan(0);
  });
});
