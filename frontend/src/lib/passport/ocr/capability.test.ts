import { describe, expect, it } from "vitest";

import { detectOcrCapability, fileAcceptForCapability } from "./capability";

describe("detectOcrCapability", () => {
  it("never probes a remote HTTPS origin", () => {
    const capability = detectOcrCapability({
      hostname: "excelbase.onrender.com",
      protocol: "https:",
      isSecureContext: true,
      probeState: "ready",
    });
    expect(capability.state).toBe("not_local_origin");
    expect(capability.canOcr).toBe(false);
    expect(capability.acceptImages).toBe(false);
    expect(fileAcceptForCapability(capability)).not.toContain(".jpg");
  });

  it("marks iPhone as unsupported instead of pretending localhost works", () => {
    const capability = detectOcrCapability({
      hostname: "127.0.0.1",
      protocol: "http:",
      isSecureContext: true,
      maxTouchPoints: 5,
      probeState: "unreachable",
    });
    expect(capability.state).toBe("unsupported_device");
    expect(capability.canOcr).toBe(false);
  });

  it("maps local probe failures without mixing in fake OCR", () => {
    const capability = detectOcrCapability({
      hostname: "localhost",
      protocol: "http:",
      isSecureContext: true,
      probeState: "unreachable",
    });
    expect(capability.state).toBe("service_unreachable");
    expect(capability.canOcr).toBe(false);
  });

  it("accepts images only on a local origin that is not an unsupported phone", () => {
    const capability = detectOcrCapability({
      hostname: "127.0.0.1",
      protocol: "http:",
      isSecureContext: true,
      probeState: "ready",
      engine: { name: "paddleocr", version: "PP-OCRv6" },
    });
    expect(capability.canOcr).toBe(true);
    expect(fileAcceptForCapability(capability)).toContain(".jpg");
  });
});
