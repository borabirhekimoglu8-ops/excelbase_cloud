import { afterEach, describe, expect, it, vi } from "vitest";

import type { Cell } from "./mrzGrid";
import {
  classifyMrzRoles,
  documentTypeFromMrzCode,
  revokePassportScanPreviews,
  rowFromMrz,
  type PassportScanRow,
} from "./scanPassportImages";

const TD3_UPPER = "P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<";
const TD3_LOWER = "L898902C36UTO7408122F1204159ZE184226B<<<<<10";

function cells(line: string): Cell[] {
  return [...line].map((value, index) => ({
    index,
    x0: index,
    x1: index + 1,
    candidates: [{ value, confidence: 99, passes: ["synthetic"] }],
    disputed: false,
  }));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("passport MRZ role gates", () => {
  it("recognises TD3 and explicitly rejects TD1 identity cards", () => {
    expect(classifyMrzRoles(cells(TD3_UPPER), cells(TD3_LOWER))).toBe("td3");
    const td1Upper = `I<TUR${"ADA<YILMAZ".padEnd(39, "<")}`;
    expect(classifyMrzRoles(cells(td1Upper), cells(TD3_LOWER))).toBe("td1");
    expect(documentTypeFromMrzCode("I<")).toBe("ID CARD");
  });
});

describe("safe failed rows", () => {
  it("keeps every passport field empty when the locator returns no MRZ", () => {
    const row = rowFromMrz(
      "sentetik.jpg",
      "blob:sentetik",
      null,
      ["MRZ alanı bulunamadı — alanlar boş bırakıldı"],
    );
    expect(row.status).toBe("failed");
    expect(row.firstName).toBe("");
    expect(row.lastName).toBe("");
    expect(row.passportNo).toBe("");
    expect(row.countryCode2).toBe("");
    expect(row.tcNo).toBe("");
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
