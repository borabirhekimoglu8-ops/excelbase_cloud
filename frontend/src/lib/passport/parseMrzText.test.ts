import { describe, expect, it } from "vitest";

import { mrzCheckDigit } from "./mrz";
import { extractTd3LinesFromPlainText, rowsFromMrzText } from "./parseMrzText";

const ICAO_LINE1 = "P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<";
const ICAO_LINE2 = "L898902C36UTO7408122F1204159ZE184226B<<<<<10";

function adaYilmazMrz(): [string, string] {
  const line1 = "P<TURYILMAZ<<ADA".padEnd(44, "<");
  const passport = "U1000001<";
  const birth = "900101";
  const expiry = "301231";
  const personal = "10000000146<<<";
  const passportPart = `${passport}${mrzCheckDigit(passport)}`;
  const birthPart = `${birth}${mrzCheckDigit(birth)}`;
  const expiryPart = `${expiry}${mrzCheckDigit(expiry)}`;
  const personalPart = `${personal}${mrzCheckDigit(personal)}`;
  const composite = `${passportPart}${birthPart}${expiryPart}${personalPart}`;
  return [
    line1,
    `${passportPart}TUR${birthPart}F${expiryPart}${personalPart}${mrzCheckDigit(composite)}`,
  ];
}

describe("extractTd3LinesFromPlainText", () => {
  it("finds the ICAO sample inside copied text", () => {
    expect(extractTd3LinesFromPlainText(`MRZ\n${ICAO_LINE1}\n${ICAO_LINE2}\n`)).toEqual({
      line1: ICAO_LINE1,
      line2: ICAO_LINE2,
    });
  });

  it("tolerates whitespace inserted between copied characters", () => {
    const spaced = `${[...ICAO_LINE1].join(" ")}\n${[...ICAO_LINE2].join(" ")}`;
    expect(extractTd3LinesFromPlainText(spaced)).toEqual({
      line1: ICAO_LINE1,
      line2: ICAO_LINE2,
    });
  });

  it("rejects non-TD3 prose", () => {
    expect(extractTd3LinesFromPlainText("Pasaport metni bulunamadı")).toBeNull();
  });
});

describe("rowsFromMrzText", () => {
  it("creates a verified synthetic Ada Yılmaz row with passport and TC fields", () => {
    const [line1, line2] = adaYilmazMrz();
    const [row] = rowsFromMrzText(`${line1}\n${line2}`, "sentetik.txt");
    expect(row).toMatchObject({
      schema_version: 2,
      filename: "sentetik.txt",
      firstName: "ADA",
      lastName: "YILMAZ",
      passportNo: "U1000001",
      countryCode2: "TR",
      tcNo: "10000000146",
      status: "ok",
      reviewStatus: "verified",
      issuingState: "TUR",
      nationality: "TUR",
      nationalitySpecial: false,
      provenance: {
        passportNo: { source: "mrz", verification: "mrz_verified" },
      },
    });
  });
});
