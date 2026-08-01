import * as XLSX from "@e965/xlsx";
import { describe, expect, it } from "vitest";

import {
  SALES_MAX_ROWS,
  parseSalesNumber,
  parseSalesWorkbook,
  salesColumnTotals,
} from "@/lib/sales";

function workbookBytes(rows: unknown[][]): Uint8Array {
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Satis");
  return new Uint8Array(XLSX.write(book, { type: "array", bookType: "xlsx" }));
}

describe("parseSalesNumber", () => {
  it("reads Turkish and English separators without corrupting either", () => {
    // "1.234,56" and "1,234.56" are the same amount written two ways; guessing
    // by locale turns one of them into 1234 or 123456.
    expect(parseSalesNumber("1.234,56")).toBeCloseTo(1234.56);
    expect(parseSalesNumber("1,234.56")).toBeCloseTo(1234.56);
    expect(parseSalesNumber("1.234")).toBe(1234);
    expect(parseSalesNumber("1,234")).toBe(1234);
    expect(parseSalesNumber("12,5")).toBeCloseTo(12.5);
    expect(parseSalesNumber("12.5")).toBeCloseTo(12.5);
    // Multi-group thousands have no decimal reading; treating every dot as a
    // decimal point made this NaN, so the value was dropped from the total.
    expect(parseSalesNumber("1.234.567")).toBe(1234567);
  });

  it("ignores currency decoration but refuses text", () => {
    expect(parseSalesNumber("₺ 2.500,00")).toBeCloseTo(2500);
    expect(parseSalesNumber("1.500,00 TL")).toBeCloseTo(1500);
    expect(parseSalesNumber("-450")).toBe(-450);
    expect(parseSalesNumber("iptal")).toBeNull();
    expect(parseSalesNumber("")).toBeNull();
  });

  it("refuses a reference code that merely contains digits", () => {
    // Stripping letters turned "F1000" into 1000, which made an invoice-number
    // column look like money and gave it a total nobody asked for.
    expect(parseSalesNumber("F1000")).toBeNull();
    expect(parseSalesNumber("2026-07-01")).toBeNull();
    expect(parseSalesNumber("A-12")).toBeNull();
  });
});

describe("parseSalesWorkbook", () => {
  it("takes the first row as headers and keeps the rest as rows", () => {
    const sheet = parseSalesWorkbook(
      workbookBytes([
        ["Acente", "Tutar", "Tarih"],
        ["Mavi Tur", "1.500,00", "2026-07-01"],
        ["Ege Seyahat", "2.250,50", "2026-07-02"],
      ]),
      "temmuz.xlsx",
    );

    expect(sheet.headers).toEqual(["Acente", "Tutar", "Tarih"]);
    expect(sheet.rows).toHaveLength(2);
    expect(sheet.rows[0][0]).toBe("Mavi Tur");
    expect(sheet.filename).toBe("temmuz.xlsx");
    expect(sheet.truncated).toBe(0);
  });

  it("names blank headers and disambiguates repeated ones", () => {
    // Real exports have merged or empty header cells; two columns called
    // "Tutar" must stay distinguishable or the totals below are meaningless.
    const sheet = parseSalesWorkbook(
      workbookBytes([
        ["Acente", "", "Tutar", "Tutar"],
        ["Mavi Tur", "x", "10", "20"],
      ]),
      "a.xlsx",
    );

    expect(sheet.headers).toEqual(["Acente", "Sütun 2", "Tutar", "Tutar (2)"]);
  });

  it("truncates rather than swallowing a spreadsheet whole, and says how much", () => {
    const rows: unknown[][] = [["Acente", "Tutar"]];
    for (let i = 0; i < SALES_MAX_ROWS + 25; i += 1) rows.push([`A${i}`, i]);

    const sheet = parseSalesWorkbook(workbookBytes(rows), "buyuk.xlsx");

    expect(sheet.rows).toHaveLength(SALES_MAX_ROWS);
    expect(sheet.truncated).toBe(25);
  });

  it("refuses a file with nothing in it instead of storing an empty sheet", () => {
    expect(() => parseSalesWorkbook(workbookBytes([]), "bos.xlsx")).toThrow();
  });

  it("reports an unreadable file as such rather than storing an empty sheet", () => {
    // The reader treats arbitrary bytes as a one-cell CSV, so this would
    // otherwise import "successfully" with a nonsense header and no rows.
    expect(() => parseSalesWorkbook(new Uint8Array([1, 2, 3]), "bozuk.xlsx")).toThrow(
      /okunamadı|veri satırı|boş/i,
    );
  });

  it("refuses a header row with no data under it", () => {
    expect(() => parseSalesWorkbook(workbookBytes([["Acente", "Tutar"]]), "a.xlsx"))
      .toThrow(/veri satırı/i);
  });
});

describe("salesColumnTotals", () => {
  it("totals numeric columns and leaves text columns alone", () => {
    const sheet = parseSalesWorkbook(
      workbookBytes([
        ["Acente", "Tutar"],
        ["Mavi Tur", "1.500,00"],
        ["Ege Seyahat", "2.500,00"],
      ]),
      "a.xlsx",
    );

    const totals = salesColumnTotals(sheet);

    expect(totals).toHaveLength(1);
    expect(totals[0].column).toBe("Tutar");
    expect(totals[0].total).toBeCloseTo(4000);
    expect(totals[0].counted).toBe(2);
  });

  it("does not present a mostly-text column as a total", () => {
    // A "Not" column containing one stray year must not be summed and shown
    // as if it meant something.
    const sheet = parseSalesWorkbook(
      workbookBytes([
        ["Not"],
        ["iptal"],
        ["beklemede"],
        ["2024"],
      ]),
      "a.xlsx",
    );

    expect(salesColumnTotals(sheet)).toEqual([]);
  });
});
