import * as XLSX from "@e965/xlsx";
import { describe, expect, it } from "vitest";

import type { ColumnTable } from "@/lib/salesAnalysis";
import { createColumnTableXlsxBlob, filteredExportName } from "@/lib/salesExport";

const TABLE: ColumnTable = {
  headers: ["Acente", "Tutar"],
  rows: [
    ["Mavi Tur", "1.500,00"],
    ["Ege Seyahat", "1.000,00"],
  ],
};

async function readBack(blob: Blob): Promise<string[][]> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const book = XLSX.read(bytes, { type: "array" });
  const sheet = book.Sheets[book.SheetNames[0]];
  return XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, blankrows: false, defval: "" });
}

describe("createColumnTableXlsxBlob", () => {
  it("writes the header row and exactly the rows it was given", async () => {
    // The narrowed list is the point: exporting the whole sheet instead would
    // be discovered by whoever received the file, not here.
    const blob = createColumnTableXlsxBlob(TABLE, [TABLE.rows[0]]);

    expect(await readBack(blob)).toEqual([
      ["Acente", "Tutar"],
      ["Mavi Tur", "1.500,00"],
    ]);
  });

  it("keeps the column order of the table", async () => {
    const matrix = await readBack(createColumnTableXlsxBlob(TABLE, TABLE.rows));
    expect(matrix[0]).toEqual(["Acente", "Tutar"]);
    expect(matrix[2]).toEqual(["Ege Seyahat", "1.000,00"]);
  });

  it("defuses a cell that would run as a formula", async () => {
    // Values come from someone else's spreadsheet; handing "=1+1" back as a
    // live formula makes the export an attack on whoever opens it.
    const risky: ColumnTable = { headers: ["Not"], rows: [["=1+1"], ["@cmd"], ["-5"]] };
    const matrix = await readBack(createColumnTableXlsxBlob(risky, risky.rows));

    expect(matrix[1][0]).toBe("'=1+1");
    expect(matrix[2][0]).toBe("'@cmd");
    expect(matrix[3][0]).toBe("'-5");
  });

  it("survives a sheet name Excel would reject", async () => {
    const blob = createColumnTableXlsxBlob(TABLE, TABLE.rows, "satis[2026]/temmuz*rapor-cok-uzun-bir-isim");
    const book = XLSX.read(new Uint8Array(await blob.arrayBuffer()), { type: "array" });

    expect(book.SheetNames[0].length).toBeLessThanOrEqual(31);
    expect(book.SheetNames[0]).not.toMatch(/[[\]:*?/\\]/);
  });

  it("exports an empty result as headers alone rather than failing", async () => {
    expect(await readBack(createColumnTableXlsxBlob(TABLE, []))).toEqual([["Acente", "Tutar"]]);
  });
});

describe("filteredExportName", () => {
  it("marks the file as the filtered one", () => {
    expect(filteredExportName("temmuz-satis.xlsx")).toBe("temmuz-satis-filtreli.xlsx");
    expect(filteredExportName("liste.csv")).toBe("liste-filtreli.xlsx");
    expect(filteredExportName("")).toBe("veri-filtreli.xlsx");
  });
});
