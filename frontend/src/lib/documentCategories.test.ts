import { describe, expect, it } from "vitest";
import { hasRequiredDocumentCoverage } from "./documentCategories";

describe("document coverage", () => {
  it("tek birleşik evrak PDF'ini zorunlu evrakların tamamı olarak kabul eder", () => {
    expect(hasRequiredDocumentCoverage([{ category: "complete_bundle" }])).toBe(true);
  });

  it("pasaport ve başvuru formu ayrı yüklendiğinde kapsamı tamamlar", () => {
    expect(hasRequiredDocumentCoverage([
      { category: "passport" },
      { category: "application_form" },
    ])).toBe(true);
  });

  it("diğer veya tek zorunlu evrakla kapsamı tamamlamaz", () => {
    expect(hasRequiredDocumentCoverage([{ category: "other" }])).toBe(false);
    expect(hasRequiredDocumentCoverage([{ category: "passport" }])).toBe(false);
  });
});
