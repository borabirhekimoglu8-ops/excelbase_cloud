import { describe, expect, it } from "vitest";

import words from "./__fixtures__/vizWords.ada.json";
import { matchVizFields, type VizWord } from "./vizFields";

describe("matchVizFields", () => {
  it("extracts only label-anchored, type-gated visual drafts with rectangles", () => {
    const result = matchVizFields(words as VizWord[], 1);
    expect(result.firstName?.value).toBe("ADA");
    expect(result.lastName?.value).toBe("YILMAZ");
    expect(result.passportNo?.value).toBe("U1000001");
    expect(result.birthDate?.value).toBe("1990-01-01");
    expect(result.expiryDate?.value).toBe("2030-12-31");
    expect(result.firstName?.provenance).toMatchObject({
      source: "viz",
      verification: "visual_draft",
      pageNo: 1,
    });
    expect(result.firstName?.rect.width).toBeGreaterThan(0);
  });

  it("does not guess from unlabelled values or accept a malformed passport number", () => {
    const result = matchVizFields([
      { text: "ADA", confidence: 99, rect: { x: 10, y: 10, width: 30, height: 10 } },
      { text: "Passport", confidence: 99, rect: { x: 10, y: 30, width: 50, height: 10 } },
      { text: "No", confidence: 99, rect: { x: 65, y: 30, width: 15, height: 10 } },
      { text: "123", confidence: 99, rect: { x: 100, y: 30, width: 25, height: 10 } },
    ]);
    expect(result.firstName).toBeUndefined();
    expect(result.passportNo).toBeUndefined();
  });
});
