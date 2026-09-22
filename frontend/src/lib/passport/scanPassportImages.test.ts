import { describe, expect, it } from "vitest";

import { parseTd3Mrz, type MrzParseResult } from "./mrz";
import {
  betterMrz,
  hasMrzLikeSignal,
  orderedMrzBandTops,
  shouldTryPassportRotations,
} from "./scanPassportImages";

const LINE1 = "P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<";
const LINE2 = "L898902C36UTO7408122F1204159ZE184226B<<<<<10";

function sampleMrz(): MrzParseResult {
  const parsed = parseTd3Mrz(LINE1, LINE2);
  if (!parsed) throw new Error("Synthetic MRZ fixture must parse");
  return parsed;
}

describe("orderedMrzBandTops", () => {
  it("starts with common lower-page passport bands", () => {
    expect(orderedMrzBandTops(null)).toEqual([0.72, 0.68, 0.75, 0.62, 0.55, 0.48]);
  });

  it("tries the last successful session band first without duplicates", () => {
    expect(orderedMrzBandTops(0.55)).toEqual([0.55, 0.72, 0.68, 0.75, 0.62, 0.48]);
  });
});

describe("hasMrzLikeSignal", () => {
  it("detects long filler-dense OCR lines", () => {
    expect(hasMrzLikeSignal(`PASSPORT\n${LINE1}\n${LINE2}`)).toBe(true);
  });

  it("rejects ordinary biodata labels", () => {
    expect(hasMrzLikeSignal("PASSPORT\nSURNAME ERIKSSON\nDATE OF BIRTH 12 AUG 1974")).toBe(false);
  });
});

describe("shouldTryPassportRotations", () => {
  it("tries sideways recovery when upright OCR has no parse", () => {
    expect(shouldTryPassportRotations(null, false)).toBe(true);
    expect(shouldTryPassportRotations(null, true)).toBe(true);
  });

  it("keeps weak parses that already contain a passport number", () => {
    const weak = { ...sampleMrz(), valid: false, warnings: ["sentetik kontrol uyarısı"] };
    expect(shouldTryPassportRotations(weak, false)).toBe(false);
  });

  it("only retries an incomplete parse when OCR lacks MRZ-like signal", () => {
    const incomplete = { ...sampleMrz(), valid: false, passportNumber: "" };
    expect(shouldTryPassportRotations(incomplete, true)).toBe(false);
    expect(shouldTryPassportRotations(incomplete, false)).toBe(true);
  });
});

describe("betterMrz", () => {
  it("prefers a passport-bearing weak parse over an empty candidate", () => {
    const parsed = sampleMrz();
    const empty = { ...parsed, valid: false, passportNumber: "", warnings: [] };
    const weak = { ...parsed, valid: false, warnings: ["sentetik kontrol uyarısı"] };
    expect(betterMrz(empty, weak)).toBe(weak);
  });
});
