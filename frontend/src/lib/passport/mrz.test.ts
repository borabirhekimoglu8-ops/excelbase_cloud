import { describe, expect, it } from "vitest";

import { mrzCheckDigit, mrzDateToIso, parseTd3FromCells } from "./mrz";
import type { Cell } from "./mrzGrid";

const LINE1 = "P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<";
const LINE2 = "L898902C36UTO7408122F1204159ZE184226B<<<<<10";

function cells(line: string): Cell[] {
  return [...line].map((value, index) => ({
    index,
    x0: index,
    x1: index + 1,
    candidates: [{ value, confidence: 99, passes: ["synthetic"] }],
    disputed: false,
  }));
}

function turkishFixture(): [string, string] {
  const upper = "P<TURYILMAZ<<ADA".padEnd(44, "<");
  const passport = "U1000001<";
  const birth = "900101";
  const expiry = "301231";
  const personal = "10000000146<<<";
  const passportPart = `${passport}${mrzCheckDigit(passport)}`;
  const birthPart = `${birth}${mrzCheckDigit(birth)}`;
  const expiryPart = `${expiry}${mrzCheckDigit(expiry)}`;
  const personalPart = `${personal}${mrzCheckDigit(personal)}`;
  const composite = `${passportPart}${birthPart}${expiryPart}${personalPart}`;
  const lower = `${passportPart}TUR${birthPart}F${expiryPart}${personalPart}`
    + mrzCheckDigit(composite);
  return [upper, lower];
}

describe("MRZ primitives", () => {
  it("matches the ICAO sample passport number check", () => {
    expect(mrzCheckDigit("L898902C3")).toBe("6");
  });

  it("keeps the display pivot and rejects invalid calendar dates", () => {
    expect(mrzDateToIso("740812")).toBe("1974-08-12");
    expect(mrzDateToIso("120415")).toBe("2012-04-15");
    expect(mrzDateToIso("230231")).toBe("");
  });
});

describe("parseTd3FromCells", () => {
  it("reads a fully verified ICAO sample", () => {
    const parsed = parseTd3FromCells(
      cells(LINE1),
      cells(LINE2),
      new Date("2026-09-22T00:00:00Z"),
    );
    expect(parsed?.surname).toBe("ERIKSSON");
    expect(parsed?.givenNames).toBe("ANNA MARIA");
    expect(parsed?.passportNumber).toBe("L898902C3");
    expect(parsed?.verified).toBe(true);
  });

  it("returns a TC number only for a valid TUR personal number", () => {
    const [upper, lower] = turkishFixture();
    const parsed = parseTd3FromCells(
      cells(upper),
      cells(lower),
      new Date("2026-09-22T00:00:00Z"),
    );
    expect(parsed?.surname).toBe("YILMAZ");
    expect(parsed?.givenNames).toBe("ADA");
    expect(parsed?.passportNumber).toBe("U1000001");
    expect(parsed?.nationalId).toBe("10000000146");
    expect(parsed?.verified).toBe(true);
  });
});
