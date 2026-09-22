import { describe, expect, it } from "vitest";

import { mergeMrzViz } from "./mergeMrzViz";
import { rowFromParsedMrz } from "./parseMrzText";
import type { VizExtraction } from "./vizFields";

const provenance = {
  source: "viz",
  verification: "visual_draft",
  pageNo: 1,
  rect: { x: 1, y: 2, width: 3, height: 4 },
} as const;

describe("mergeMrzViz", () => {
  it("keeps MRZ values and flags a visual mismatch", () => {
    const row = rowFromParsedMrz("sentetik.jpg", null);
    row.firstName = "ADA";
    row.provenance.firstName = { source: "mrz", verification: "mrz_verified", pageNo: 1 };
    const merged = mergeMrzViz(row, {
      firstName: { value: "AYŞE", confidence: 95, rect: provenance.rect, provenance },
    });
    expect(merged.row.firstName).toBe("ADA");
    expect(merged.mismatchFields).toEqual(["firstName"]);
  });

  it("fills blanks as visual drafts, never as verified MRZ", () => {
    const row = rowFromParsedMrz("sentetik.jpg", null);
    const viz: VizExtraction = {
      passportNo: { value: "U1000001", confidence: 95, rect: provenance.rect, provenance },
    };
    const merged = mergeMrzViz(row, viz).row;
    expect(merged.passportNo).toBe("U1000001");
    expect(merged.provenance.passportNo?.verification).toBe("visual_draft");
    expect(merged.reviewStatus).toBe("needs_review");
  });
});
