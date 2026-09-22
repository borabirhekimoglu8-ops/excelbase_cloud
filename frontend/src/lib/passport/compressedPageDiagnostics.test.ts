import { describe, expect, it } from "vitest";

import { COMPRESSED_PAGE_DIAGNOSTICS } from "./__fixtures__/compressedPages";
import { PASSPORT_ENGINE_PROFILE } from "./engineProfile";

describe("fixed compressed-page diagnostic", () => {
  it("records exactly 2/5 successes with fixed hashes and engine settings", () => {
    expect(COMPRESSED_PAGE_DIAGNOSTICS).toHaveLength(5);
    expect(COMPRESSED_PAGE_DIAGNOSTICS.filter((page) => page.success)).toHaveLength(2);
    expect(new Set(COMPRESSED_PAGE_DIAGNOSTICS.map((page) => page.sha256)).size).toBe(5);
    for (const page of COMPRESSED_PAGE_DIAGNOSTICS) {
      expect(page.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(page.profileId).toBe(PASSPORT_ENGINE_PROFILE.id);
    }
    expect(COMPRESSED_PAGE_DIAGNOSTICS.filter((page) => !page.success).map((page) => page.finalStage))
      .toEqual(["field_matching", "text_detection", "character_recognition"]);
  });

  it("reproduces the designated name-line failure without inventing success", () => {
    const page = COMPRESSED_PAGE_DIAGNOSTICS.find((item) => item.pageNo === 3);
    expect(page).toMatchObject({
      success: false,
      finalStage: "field_matching",
      reason: "Ad ve soyad tek çözümle doğrulanamadı",
    });
    expect(page?.stages).toContain("mrz_parser");
  });
});
