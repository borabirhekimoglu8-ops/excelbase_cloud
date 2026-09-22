import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { rowsFromOcrResult } from "./scanPassportImages";

const directory = resolve(
  process.cwd(),
  "src/lib/passport/__fixtures__/engine-runs",
);
const resultPath = resolve(directory, "ppocrv6-synthetic.json");
const hasResult = existsSync(resultPath);

describe("PP-OCRv6 synthetic image protocol evidence", () => {
  it.skipIf(!hasResult)("consumes only an actual marked engine run", () => {
    const payload = JSON.parse(readFileSync(resultPath, "utf8")) as {
      evidence: string;
      synthetic_only: boolean;
      variants: Array<{
        variant: string;
        engine: { name: string; version: string; lang?: string };
        width: number;
        height: number;
        duration_ms: number;
        lines: Array<{ text: string; box: number[][]; score: number | null }>;
      }>;
    };
    expect(payload.evidence).toBe("actual_ppocrv6_synthetic_image_run");
    expect(payload.synthetic_only).toBe(true);
    expect(payload.variants.map((item) => item.variant)).toEqual([
      "clean_png",
      "jpeg_q35",
      "skew_plus_3_png",
      "skew_minus_3_png",
      "image_pdf_raster_250dpi_2600_jpeg90",
      "viz_only_xxa_crop_png",
    ]);
    for (const variant of payload.variants) {
      expect(variant.engine.name).toBe("paddleocr");
      expect(variant.engine.version).toContain("PP-OCRv6");
      expect(variant.lines.length).toBeGreaterThan(0);
    }

    const pdfRaster = payload.variants.find(
      (item) => item.variant === "image_pdf_raster_250dpi_2600_jpeg90",
    );
    expect(pdfRaster).toBeDefined();
    const rows = rowsFromOcrResult(
      "synthetic-pdf-raster.jpg",
      "blob:synthetic",
      "synthetic-engine-run",
      1,
      {
        pageId: pdfRaster!.variant,
        engine: pdfRaster!.engine,
        width: pdfRaster!.width,
        height: pdfRaster!.height,
        durationMs: pdfRaster!.duration_ms,
        lines: pdfRaster!.lines,
      },
    );
    expect(rows.some((row) => (
      row.status === "ok"
      && row.passportNo === "U1000001"
      && row.nationality === "UTO"
    ))).toBe(true);
  });

  it.skipIf(hasResult)("states clearly that image-engine evidence was not run", () => {
    expect(readFileSync(resolve(directory, "README.md"), "utf8")).toContain("NOT RUN");
  });
});
