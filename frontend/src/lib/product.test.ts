import { describe, expect, it } from "vitest";

import { PRODUCT, productBrandLine, productWindowTitle } from "./product";

describe("product identity", () => {
  it("exposes a single rename surface", () => {
    expect(PRODUCT.shortName.length).toBeGreaterThan(0);
    expect(PRODUCT.fullName).toContain(PRODUCT.shortName);
    expect(PRODUCT.themeColor).toMatch(/^#[0-9a-fA-F]{6}$/);
  });

  it("builds brand and window titles from the same source", () => {
    expect(productBrandLine()).toContain(PRODUCT.shortName);
    expect(productWindowTitle()).toContain(PRODUCT.fullName);
  });
});
