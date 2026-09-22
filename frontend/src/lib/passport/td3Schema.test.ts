import { describe, expect, it } from "vitest";

import { icaoCountryToIso2 } from "./icaoCountries";
import { type Cell } from "./mrzGrid";
import {
  birthDateOracle,
  decodeLine1,
  decodeLine2,
  expiryDateOracle,
  tcChecksum,
} from "./td3Schema";

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

describe("TD3 schema decoder", () => {
  it("decodes the ICAO sample through fixed cells", () => {
    const upper = decodeLine1(cells(LINE1));
    const lower = decodeLine2(cells(LINE2), new Date("2026-09-22T00:00:00Z"));
    expect(upper.surname).toBe("ERIKSSON");
    expect(upper.givenNames).toBe("ANNA MARIA");
    expect(lower.passportNumber).toBe("L898902C3");
    expect(lower.birthDate).toBe("1974-08-12");
    expect(lower.expiryDate).toBe("2012-04-15");
    expect(lower.verified).toBe(true);
  });

  it("accepts one check-digit-selected disputed value", () => {
    const input = cells(LINE2);
    input[0] = {
      ...input[0],
      candidates: [
        { value: "L", confidence: 82, passes: ["gray"] },
        { value: "M", confidence: 84, passes: ["binary"] },
      ],
      disputed: true,
    };
    expect(decodeLine2(input, new Date("2026-09-22T00:00:00Z")).passportNumber)
      .toBe("L898902C3");
  });

  it("blanks a field when two complete check-valid solutions remain", () => {
    const input = cells(LINE2);
    input[0] = {
      ...input[0],
      candidates: [
        { value: "L", confidence: 90, passes: ["gray"] },
        { value: "V", confidence: 90, passes: ["binary"] },
      ],
      disputed: true,
    };
    const decoded = decodeLine2(input, new Date("2026-09-22T00:00:00Z"));
    expect(decoded.passportNumber).toBe("");
    expect(decoded.verified).toBe(false);
  });
});

describe("TD3 oracles", () => {
  it("validates Turkish identity checksum rules", () => {
    expect(tcChecksum("10000000146")).toBe(true);
    expect(tcChecksum("00000000146")).toBe(false);
    expect(tcChecksum("10000000145")).toBe(false);
  });

  it("rejects impossible or implausible dates", () => {
    const today = new Date("2026-09-22T00:00:00Z");
    expect(birthDateOracle("900231", today)).toBe("");
    expect(birthDateOracle("900101", today)).toBe("1990-01-01");
    expect(expiryDateOracle("301231", today)).toBe("2030-12-31");
  });

  it("uses the complete country map and never slices unknown codes", () => {
    expect(icaoCountryToIso2("EST")).toBe("EE");
    expect(icaoCountryToIso2("XYZ")).toBe("");
  });
});
