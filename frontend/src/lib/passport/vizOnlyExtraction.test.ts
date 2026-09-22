import { describe, expect, it } from "vitest";

import { VIZ_ONLY_PASSPORT } from "./__fixtures__/vizOnlyPassport";
import { mergeMrzViz } from "./mergeMrzViz";
import { rowFromParsedMrz } from "./parseMrzText";
import { countryCode2ForRow, rowReady } from "./passportTypes";
import { matchVizFields } from "./vizFields";

describe("VIZ-only passport extraction", () => {
  it("keeps MRZ-cut-off fields as drafts with coordinates and no country mapping", () => {
    const empty = rowFromParsedMrz(VIZ_ONLY_PASSPORT.filename, null, {
      pageNo: VIZ_ONLY_PASSPORT.pageNo,
    });
    const row = mergeMrzViz(
      empty,
      matchVizFields(VIZ_ONLY_PASSPORT.words, VIZ_ONLY_PASSPORT.pageNo),
    ).row;
    expect(row).toMatchObject({
      firstName: "ADA",
      lastName: "YILMAZ",
      passportNo: "U1000001",
      birthDate: "1990-01-01",
      expiryDate: "2030-12-31",
      nationality: "",
      reviewStatus: "needs_review",
    });
    expect(row.provenance.passportNo).toMatchObject({ verification: "visual_draft" });
    expect(row.provenance.passportNo?.rect).toBeDefined();
    expect(countryCode2ForRow(row)).toBe("");
    expect(rowReady(row)).toBe(false);
  });

  it("lets a visual draft reach Excel only after user confirm and a real ISO-2 nationality", () => {
    const empty = rowFromParsedMrz(VIZ_ONLY_PASSPORT.filename, null, {
      pageNo: VIZ_ONLY_PASSPORT.pageNo,
    });
    const draft = mergeMrzViz(
      empty,
      matchVizFields(VIZ_ONLY_PASSPORT.words, VIZ_ONLY_PASSPORT.pageNo),
    ).row;
    const withTur = {
      ...draft,
      nationality: "TUR",
      nationalitySpecial: false,
      countryCode2: "TR",
      documentType: "Passport" as const,
    };
    expect(rowReady(withTur)).toBe(false);
    expect(rowReady({ ...withTur, reviewStatus: "reviewed" })).toBe(true);
    expect(rowReady({
      ...withTur,
      nationality: "XXA",
      nationalitySpecial: true,
      countryCode2: "",
      reviewStatus: "reviewed",
    })).toBe(false);
  });
});
