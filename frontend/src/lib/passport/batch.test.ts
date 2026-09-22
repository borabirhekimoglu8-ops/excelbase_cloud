import { describe, expect, it } from "vitest";

import { fileKindSupported } from "./batch";
import { detectOcrCapability, fileAcceptForCapability } from "./ocr/capability";

describe("passport batch helpers", () => {
  it("rejects images when the capability does not accept them", () => {
    const capability = detectOcrCapability({
      hostname: "excelbase.onrender.com",
      protocol: "https:",
      isSecureContext: true,
    });
    const image = new File(["x"], "scan.jpg", { type: "image/jpeg" });
    const pdf = new File(["%PDF"], "scan.pdf", { type: "application/pdf" });
    expect(fileKindSupported(image, capability.acceptImages)).toBe(false);
    expect(fileKindSupported(pdf, capability.acceptImages)).toBe(true);
    expect(fileAcceptForCapability(capability)).toContain(".pdf");
  });
});
