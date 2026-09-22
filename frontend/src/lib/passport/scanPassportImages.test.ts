import { afterEach, describe, expect, it, vi } from "vitest";

import {
  revokePassportScanPreviews,
  rowsFromOcrResult,
  type PassportScanRow,
} from "./scanPassportImages";

const LINE1 = "P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<";
const LINE2 = "L898902C36UTO7408122F1204159ZE184226B<<<<<10";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("PP-OCR line pipeline", () => {
  it("builds a verified row and keeps the service-reported source dimensions", () => {
    const rows = rowsFromOcrResult(
      "synthetic.jpg",
      "blob:synthetic",
      "synthetic-batch",
      1,
      {
        pageId: "page-1",
        engine: { name: "paddleocr", version: "PP-OCRv6", lang: "en" },
        width: 1600,
        height: 1000,
        durationMs: 25,
        lines: [
          { text: LINE1, box: [[100, 800], [1500, 800], [1500, 840], [100, 840]], score: 0.98 },
          { text: LINE2, box: [[100, 850], [1500, 850], [1500, 890], [100, 890]], score: 0.97 },
        ],
      },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      status: "ok",
      lastName: "ERIKSSON",
      passportNo: "L898902C3",
      nationality: "UTO",
      countryCode2: "",
      sourceImageSize: { width: 1600, height: 1000 },
    });
  });

  it("uses PP-OCR boxes only as visual drafts when no MRZ pair verifies", () => {
    const rows = rowsFromOcrResult(
      "viz-only.jpg",
      "blob:viz",
      "synthetic-batch",
      1,
      {
        pageId: "page-1",
        engine: { name: "paddleocr", version: "PP-OCRv6", lang: "en" },
        width: 1200,
        height: 800,
        durationMs: 20,
        lines: [
          { text: "Surname", box: [[20, 20], [120, 20], [120, 50], [20, 50]], score: 0.99 },
          { text: "YILMAZ", box: [[160, 20], [280, 20], [280, 50], [160, 50]], score: 0.96 },
        ],
      },
    );
    expect(rows[0].lastName).toBe("YILMAZ");
    expect(rows[0].provenance.lastName).toMatchObject({
      source: "viz",
      verification: "visual_draft",
      rect: { x: 160, y: 20, width: 120, height: 30 },
    });
    expect(rows[0].reviewStatus).toBe("needs_review");
  });
});

describe("revokePassportScanPreviews", () => {
  it("revokes a shared source URL only once", () => {
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const rows = [
      { previewUrl: "blob:source", mrzCropUrl: "blob:crop" },
      { previewUrl: "blob:source" },
    ] as PassportScanRow[];
    revokePassportScanPreviews(rows);
    expect(revoke).toHaveBeenCalledTimes(2);
    expect(revoke).toHaveBeenCalledWith("blob:source");
    expect(revoke).toHaveBeenCalledWith("blob:crop");
  });
});
