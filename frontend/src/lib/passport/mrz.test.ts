import { describe, expect, it } from "vitest";

import {
  extractTd3FromOcrText,
  mrzCheckDigit,
  mrzDateToIso,
  parseTd3Mrz,
} from "./mrz";

// ICAO sample TD3 from Doc 9303.
const LINE1 = "P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<";
const LINE2 = "L898902C36UTO7408122F1204159ZE184226B<<<<<10";

describe("mrzCheckDigit", () => {
  it("matches the ICAO sample passport number check", () => {
    expect(mrzCheckDigit("L898902C3")).toBe("6");
  });
});

describe("mrzDateToIso", () => {
  it("maps YYMMDD with a 1950–2049 pivot", () => {
    expect(mrzDateToIso("740812")).toBe("1974-08-12");
    expect(mrzDateToIso("120415")).toBe("2012-04-15");
  });
});

describe("parseTd3Mrz", () => {
  it("reads the ICAO sample passport", () => {
    const parsed = parseTd3Mrz(LINE1, LINE2);
    expect(parsed).not.toBeNull();
    expect(parsed?.surname).toBe("ERIKSSON");
    expect(parsed?.givenNames).toBe("ANNA MARIA");
    expect(parsed?.passportNumber).toBe("L898902C3");
    expect(parsed?.nationality).toBe("UTO");
    expect(parsed?.birthDate).toBe("1974-08-12");
    expect(parsed?.sex).toBe("F");
    expect(parsed?.expiryDate).toBe("2012-04-15");
    expect(parsed?.valid).toBe(true);
  });
});

describe("extractTd3FromOcrText", () => {
  it("finds MRZ lines inside noisy OCR output", () => {
    const text = [
      "REPUBLIC OF UTOPIA",
      "PASSPORT",
      "Surname / Nom ERIKSSON",
      LINE1,
      LINE2,
      "Authority",
    ].join("\n");
    const parsed = extractTd3FromOcrText(text);
    expect(parsed?.passportNumber).toBe("L898902C3");
    expect(parsed?.surname).toBe("ERIKSSON");
    expect(parsed?.valid).toBe(true);
  });

  it("recovers phone-photo OCR with a stray prefix and O/0 nationality swap", () => {
    const text = [
      "PASSPORTPASAPORT",
      "P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<LLL<<",
      "1L898902C36UT07408122F1204159ZE184226B<<<<<10",
    ].join("\n");
    const parsed = extractTd3FromOcrText(text);
    expect(parsed?.passportNumber).toBe("L898902C3");
    expect(parsed?.surname).toBe("ERIKSSON");
    expect(parsed?.nationality).toBe("UTO");
    expect(parsed?.valid).toBe(true);
  });
});
