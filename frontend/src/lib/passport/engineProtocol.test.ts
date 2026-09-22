import { createHash } from "node:crypto";
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
        source_path: string;
        source_sha256: string;
        source_kind: "png" | "jpeg" | "image_pdf";
        processed_image_sha256: string;
        raster: {
          dpi: number;
          long_edge_max: number;
          jpeg_quality: number;
          processed_width: number;
          processed_height: number;
        } | null;
        engine: {
          name: string;
          version: string;
          versions: string[];
          lang: string;
          package_versions: {
            paddleocr: string | null;
            paddlepaddle: string | null;
          };
        };
        width: number;
        height: number;
        duration_ms: number;
        lines: Array<{ text: string; box: number[][]; score: number | null }>;
        parser_result: {
          pair_found: boolean;
          verified: boolean;
          status: "verified" | "checksum_failed" | "not_found";
        };
        expected_fields: {
          surname: string;
          given_names: string;
          passport_no: string;
          nationality: string;
          date_of_birth: string;
          date_of_birth_mrz: string;
          date_of_expiry: string;
          date_of_expiry_mrz: string;
        };
        critical_fields: Record<string, "correct" | "wrong" | "empty">;
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
      const source = readFileSync(resolve(process.cwd(), "..", variant.source_path));
      expect(createHash("sha256").update(source).digest("hex")).toBe(variant.source_sha256);
      expect(variant.source_sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(variant.processed_image_sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(["png", "jpeg", "image_pdf"]).toContain(variant.source_kind);
      expect(variant.engine.name).toBe("paddleocr");
      expect(variant.engine.version).toBe("PP-OCRv6");
      expect(variant.engine.versions).toEqual(["PP-OCRv6"]);
      expect(variant.engine.lang).toBe("en");
      expect(variant.engine.package_versions.paddleocr).toMatch(/^3\.7\./);
      expect(variant.engine.package_versions.paddlepaddle).toMatch(/^\d+\.\d+\.\d+/);
      expect(variant.lines.length).toBeGreaterThan(0);
      expect(Object.keys(variant.critical_fields).sort()).toEqual([
        "date_of_birth",
        "date_of_expiry",
        "given_names",
        "nationality",
        "passport_no",
        "surname",
      ]);
      expect(Object.values(variant.critical_fields).every(
        (score) => ["correct", "wrong", "empty"].includes(score),
      )).toBe(true);
      expect(variant.expected_fields).toMatchObject({
        surname: "YILMAZ",
        given_names: "ADA",
        passport_no: "U1000001",
        date_of_birth: "1990-01-01",
        date_of_birth_mrz: "900101",
        date_of_expiry: "2030-12-31",
        date_of_expiry_mrz: "301231",
      });
      if (variant.source_kind !== "image_pdf") {
        expect(variant.processed_image_sha256).toBe(variant.source_sha256);
        expect(variant.raster).toBeNull();
      }
    }

    const pdfRaster = payload.variants.find(
      (item) => item.variant === "image_pdf_raster_250dpi_2600_jpeg90",
    );
    expect(pdfRaster).toBeDefined();
    expect(pdfRaster!.source_kind).toBe("image_pdf");
    expect(readFileSync(resolve(process.cwd(), "..", pdfRaster!.source_path)).subarray(0, 4).toString()).toBe("%PDF");
    expect(pdfRaster!.processed_image_sha256).not.toBe(pdfRaster!.source_sha256);
    expect(pdfRaster!.raster).toEqual({
      dpi: 250,
      long_edge_max: 2600,
      jpeg_quality: 90,
      processed_width: 2600,
      processed_height: 1625,
    });
    expect(pdfRaster!.width).toBe(pdfRaster!.raster!.processed_width);
    expect(pdfRaster!.height).toBe(pdfRaster!.raster!.processed_height);
    expect(pdfRaster!.parser_result.verified).toBe(false);
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
    expect(pdfRaster!.lines.some((line) => line.text.includes("U1000001"))).toBe(true);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((row) => row.status === "ok")).toBe(false);
    expect(rows[0].sourceImageSize).toEqual({
      width: pdfRaster!.width,
      height: pdfRaster!.height,
    });
  });

  it.skipIf(hasResult)("states clearly that image-engine evidence was not run", () => {
    expect(readFileSync(resolve(directory, "README.md"), "utf8")).toContain("NOT RUN");
  });
});
