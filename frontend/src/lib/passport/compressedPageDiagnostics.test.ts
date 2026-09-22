import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { COMPRESSED_PAGE_DIAGNOSTICS } from "./__fixtures__/compressedPages";
import { PASSPORT_ENGINE_PROFILE } from "./engineProfile";
import { parseTd3FromCells } from "./mrz";
import type { Cell } from "./td3Schema";

const FIXTURE_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "__fixtures__/compressed-pages",
);

function cells(line: string): Cell[] {
  return [...line].map((value, index) => ({
    index,
    x0: index,
    x1: index + 1,
    candidates: [{ value, confidence: 99, passes: ["synthetic"] }],
    disputed: false,
  }));
}

describe("fixed compressed-page diagnostic", () => {
  it("records exactly 2/5 successes with committed file hashes and engine settings", () => {
    expect(COMPRESSED_PAGE_DIAGNOSTICS).toHaveLength(5);
    expect(COMPRESSED_PAGE_DIAGNOSTICS.filter((page) => page.success)).toHaveLength(2);
    expect(PASSPORT_ENGINE_PROFILE).toMatchObject({
      id: "tesseract-6-mrz-eng-lstm-300dpi-v1",
      dpi: 300,
      maxWorkers: 1,
      oem: "lstm-only",
    });
    for (const page of COMPRESSED_PAGE_DIAGNOSTICS) {
      const bytes = readFileSync(resolve(FIXTURE_DIR, page.filename));
      const digest = createHash("sha256").update(bytes).digest("hex");
      expect(digest).toBe(page.sha256);
      expect(page.profileId).toBe(PASSPORT_ENGINE_PROFILE.id);
    }
    expect(COMPRESSED_PAGE_DIAGNOSTICS.filter((page) => !page.success).map((page) => page.finalStage))
      .toEqual(["field_matching", "text_detection", "character_recognition"]);
  });

  it("reproduces the name-line failure on the same page-3 fixture", () => {
    const page = COMPRESSED_PAGE_DIAGNOSTICS.find((item) => item.pageNo === 3);
    const fixture = readFileSync(resolve(FIXTURE_DIR, page!.filename), "utf8");
    expect(fixture).toContain("Ad ve soyad tek çözümle doğrulanamadı");
    const line1 = fixture.split("\n").find((line) => line.startsWith("P<"));
    const line2 = fixture.split("\n").find((line) => line.startsWith("U1000001"));
    expect(line1).toHaveLength(44);
    expect(line2).toHaveLength(44);

    const upper = cells(line1!);
    upper[5] = {
      ...upper[5],
      disputed: true,
      candidates: [
        { value: "Y", confidence: 52, passes: ["gray"] },
        { value: "1", confidence: 51, passes: ["binary"] },
      ],
    };
    const parsed = parseTd3FromCells(upper, cells(line2!), new Date("2026-09-22T00:00:00Z"));
    expect(parsed?.warnings).toContain("Ad ve soyad tek çözümle doğrulanamadı");
    expect(parsed?.surname).toBe("");
    expect(parsed?.givenNames).toBe("");
    expect(page).toMatchObject({
      success: false,
      finalStage: "field_matching",
      reason: "Ad ve soyad tek çözümle doğrulanamadı",
    });
  });
});
