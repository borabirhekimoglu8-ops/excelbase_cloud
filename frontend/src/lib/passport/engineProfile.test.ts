import { describe, expect, it } from "vitest";

import { passportEngineProfileId } from "./engineProfile";

describe("passportEngineProfileId", () => {
  it("derives the queue profile from service engine information", () => {
    expect(passportEngineProfileId({
      name: "paddleocr",
      version: "PP-OCRv6",
      lang: "en",
    })).toBe("paddleocr-PP-OCRv6-en-r250-jpeg90-v1");
  });
});
