import { describe, expect, it } from "vitest";
import * as XLSX from "@e965/xlsx";

import { icaoCountryToIso2 } from "./icaoCountries";
import {
  PASSPORT_OPERATOR_HEADERS,
  createPassportOperatorXlsxBlob,
  formatOperatorDate,
  formatOperatorSex,
} from "./operatorExcel";

describe("operatorExcel", () => {
  it("keeps the full agency header row byte-for-byte (template is one piece)", async () => {
    expect([...PASSPORT_OPERATOR_HEADERS]).toEqual([
      "Yolcu Adı",
      "Yolcu Soyadı",
      "Doğum Tarihi",
      "Ülke Kodu 2",
      "Pasaport Bitiş Tar.",
      "Vize Başlangıç Tar.",
      "Vize Bitiş Tar.",
      "Pasaport No",
      "Cinsiyet",
      "Araç Marka",
      "Araç Model",
      "Araç Tipi",
      "Plaka",
      "Gsm",
      "TC.No",
      "Doküman Tipi",
    ]);
    const blob = createPassportOperatorXlsxBlob([]);
    const workbook = XLSX.read(await blob.arrayBuffer(), { type: "array" });
    const sheet = workbook.Sheets.Yolcular;
    const headers = PASSPORT_OPERATOR_HEADERS.map((_, index) => {
      const cell = sheet[XLSX.utils.encode_cell({ r: 0, c: index })];
      return cell?.v;
    });
    expect(headers).toEqual([...PASSPORT_OPERATOR_HEADERS]);
    // No extra columns beyond the agency template.
    expect(sheet[XLSX.utils.encode_cell({ r: 0, c: 16 })]).toBeUndefined();
  });

  it("fills MRZ-derived columns and leaves vehicle fields blank", async () => {
    const blob = createPassportOperatorXlsxBlob([
      {
        firstName: "ANNA MARIA",
        lastName: "ERIKSSON",
        birthDate: "1974-08-12",
        countryCode2: icaoCountryToIso2("TUR"),
        passportExpiry: "2030-04-15",
        passportNo: "U12345678",
        sex: "F",
        tcNo: "10000000146",
      },
    ]);
    const workbook = XLSX.read(await blob.arrayBuffer(), { type: "array" });
    const sheet = workbook.Sheets.Yolcular;
    expect(sheet.A2.v).toBe("ANNA MARIA");
    expect(sheet.B2.v).toBe("ERIKSSON");
    expect(sheet.C2.v).toBe("12.08.1974");
    expect(sheet.D2.v).toBe("TR");
    expect(sheet.E2.v).toBe("15.04.2030");
    expect(sheet.F2.v).toBe("");
    expect(sheet.G2.v).toBe("");
    expect(sheet.H2.v).toBe("U12345678");
    expect(sheet.I2.v).toBe("K");
    expect(sheet.J2.v).toBe("");
    expect(sheet.K2.v).toBe("");
    expect(sheet.L2.v).toBe("");
    expect(sheet.M2.v).toBe("");
    expect(sheet.N2.v).toBe("");
    expect(sheet.O2.v).toBe("10000000146");
    expect(sheet.P2.v).toBe("Passport");
  });

  it("writes ID CARD when the operator selects it", async () => {
    const blob = createPassportOperatorXlsxBlob([
      {
        firstName: "ADA",
        lastName: "YILMAZ",
        birthDate: "1990-01-02",
        countryCode2: "TR",
        passportExpiry: "2031-01-02",
        passportNo: "U99887766",
        documentType: "ID CARD",
      },
    ]);
    const workbook = XLSX.read(await blob.arrayBuffer(), { type: "array" });
    const sheet = workbook.Sheets.Yolcular;
    expect(sheet.D2.v).toBe("TR");
    expect(sheet.P2.v).toBe("ID CARD");
  });

  it("maps nationality and sex for the operator sheet", () => {
    expect(icaoCountryToIso2("TUR")).toBe("TR");
    expect(icaoCountryToIso2("EST")).toBe("EE");
    expect(icaoCountryToIso2("XYZ")).toBe("");
    expect(formatOperatorSex("M")).toBe("E");
    expect(formatOperatorSex("F")).toBe("K");
    expect(formatOperatorDate("2026-07-16")).toBe("16.07.2026");
  });
});
