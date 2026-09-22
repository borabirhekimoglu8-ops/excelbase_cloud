import { afterEach, describe, expect, it, vi } from "vitest";

import { parseTd3Mrz, type MrzParseResult } from "./mrz";
import {
  betterMrz,
  documentTypeFromMrzCode,
  revokePassportScanPreviews,
  type PassportScanRow,
} from "./scanPassportImages";

const LINE1 = "P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<";
const LINE2 = "L898902C36UTO7408122F1204159ZE184226B<<<<<10";

function sampleMrz(): MrzParseResult {
  const parsed = parseTd3Mrz(LINE1, LINE2);
  if (!parsed) throw new Error("Synthetic MRZ fixture must parse");
  return parsed;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("documentTypeFromMrzCode", () => {
  it("maps identity cards separately and defaults travel documents to passport", () => {
    expect(documentTypeFromMrzCode("I<")).toBe("ID CARD");
    expect(documentTypeFromMrzCode("P<")).toBe("Passport");
  });
});

describe("betterMrz", () => {
  it("always prefers a valid check-digit parse", () => {
    const valid = sampleMrz();
    const weak = { ...valid, valid: false, warnings: ["sentetik kontrol uyarısı"] };
    expect(betterMrz(weak, valid)).toBe(valid);
    expect(betterMrz(valid, weak)).toBe(valid);
  });

  it("keeps the more complete weak parse", () => {
    const parsed = sampleMrz();
    const complete = { ...parsed, valid: false, warnings: ["sentetik uyarı"] };
    const sparse = {
      ...complete,
      surname: "",
      givenNames: "",
      passportNumber: "1",
      birthDate: "",
      expiryDate: "",
      warnings: [],
    };
    expect(betterMrz(sparse, complete)).toBe(complete);
  });
});

describe("revokePassportScanPreviews", () => {
  it("revokes both source and optional MRZ crop object URLs", () => {
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const row = {
      previewUrl: "blob:source",
      mrzCropUrl: "blob:mrz-crop",
    } as PassportScanRow;
    revokePassportScanPreviews([row]);
    expect(revoke).toHaveBeenCalledWith("blob:source");
    expect(revoke).toHaveBeenCalledWith("blob:mrz-crop");
  });
});
