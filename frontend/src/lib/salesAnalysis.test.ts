import { describe, expect, it } from "vitest";

import type { SalesSheet } from "@/lib/sales";
import {
  categoryBreakdown,
  categoryColumnIndexes,
  distinctValues,
  emptySalesFilter,
  filterSalesRows,
  numericColumnIndexes,
  numericStats,
} from "@/lib/salesAnalysis";

function sheet(headers: string[], rows: string[][]): SalesSheet {
  return {
    id: "s1",
    filename: "satis.xlsx",
    imported_at: "2026-08-01T00:00:00.000Z",
    headers,
    rows,
    truncated: 0,
  };
}

const SALES = sheet(
  ["Acente", "Sefer", "Tutar", "Not"],
  [
    ["Mavi Tur", "Bodrum", "1.500,00", "iptal"],
    ["Mavi Tur", "Kos", "2.500,00", ""],
    ["Ege Seyahat", "Bodrum", "1.000,00", "beklemede"],
    ["Deniz Turizm", "Kos", "500,50", ""],
  ],
);

describe("column roles", () => {
  it("finds the money column without being told its name", () => {
    expect(numericColumnIndexes(SALES)).toEqual([2]);
  });

  it("offers repeating text columns to group by, and not the numbers", () => {
    expect(categoryColumnIndexes(SALES)).toEqual([0, 1]);
  });

  it("does not offer a column where every row differs", () => {
    // An invoice number would produce one group per row, which answers nothing.
    const invoices = sheet(["Fis", "Tutar"], [["A1", "10"], ["A2", "20"], ["A3", "30"]]);
    expect(categoryColumnIndexes(invoices)).toEqual([]);
  });

  it("lists a column's distinct values in Turkish order", () => {
    expect(distinctValues(SALES, 0)).toEqual(["Deniz Turizm", "Ege Seyahat", "Mavi Tur"]);
  });
});

describe("filterSalesRows", () => {
  it("searches every column, case- and Turkish-insensitively", () => {
    const rows = filterSalesRows(SALES, { ...emptySalesFilter(), query: "mavi" });
    expect(rows).toHaveLength(2);
    expect(filterSalesRows(SALES, { ...emptySalesFilter(), query: "BODRUM" })).toHaveLength(2);
  });

  it("narrows to an exact value in one column", () => {
    const rows = filterSalesRows(SALES, {
      ...emptySalesFilter(),
      columnValues: { 1: "Kos" },
    });
    expect(rows.map((row) => row[0])).toEqual(["Mavi Tur", "Deniz Turizm"]);
  });

  it("combines filters rather than widening with each one", () => {
    const rows = filterSalesRows(SALES, {
      ...emptySalesFilter(),
      query: "mavi",
      columnValues: { 1: "Kos" },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0][2]).toBe("2.500,00");
  });

  it("applies numeric bounds to the parsed value, not the text", () => {
    // "1.500,00" must compare as 1500, not as the string it is.
    const rows = filterSalesRows(SALES, {
      ...emptySalesFilter(),
      numericRanges: { 2: { min: 1000, max: 2000 } },
    });
    expect(rows.map((row) => row[0])).toEqual(["Mavi Tur", "Ege Seyahat"]);
  });

  it("excludes a row with nothing numeric where a bound was asked for", () => {
    const partial = sheet(["Acente", "Tutar"], [["A", "100"], ["B", ""], ["C", "yok"]]);
    const rows = filterSalesRows(partial, {
      ...emptySalesFilter(),
      numericRanges: { 1: { min: 0 } },
    });
    expect(rows.map((row) => row[0])).toEqual(["A"]);
  });
});

describe("numericStats", () => {
  it("reports the shape of a money column over the rows it was given", () => {
    const [stats] = numericStats(SALES, SALES.rows);

    expect(stats.column).toBe("Tutar");
    expect(stats.count).toBe(4);
    expect(stats.sum).toBeCloseTo(5500.5);
    expect(stats.average).toBeCloseTo(1375.13, 1);
    expect(stats.min).toBeCloseTo(500.5);
    expect(stats.max).toBeCloseTo(2500);
  });

  it("recomputes over filtered rows, so statistics follow the filter", () => {
    const rows = filterSalesRows(SALES, { ...emptySalesFilter(), query: "mavi" });
    const [stats] = numericStats(SALES, rows);

    expect(stats.count).toBe(2);
    expect(stats.sum).toBeCloseTo(4000);
  });

  it("ignores unparseable cells instead of counting them as zero", () => {
    // Averaging "iptal" as 0 would silently halve the average.
    const partial = sheet(["Tutar"], [["100"], ["iptal"], ["300"]]);
    const [stats] = numericStats(partial, partial.rows);

    expect(stats.count).toBe(2);
    expect(stats.average).toBeCloseTo(200);
  });
});

describe("categoryBreakdown", () => {
  it("sums a value column per group and ranks the largest first", () => {
    const result = categoryBreakdown(SALES, SALES.rows, 0, 2);

    expect(result.column).toBe("Acente");
    expect(result.valueColumn).toBe("Tutar");
    expect(result.entries.map((entry) => entry.value)).toEqual([
      "Mavi Tur",
      "Ege Seyahat",
      "Deniz Turizm",
    ]);
    expect(result.entries[0].sum).toBeCloseTo(4000);
    expect(result.entries[0].count).toBe(2);
    expect(result.entries[0].share).toBeCloseTo(72.7, 0);
  });

  it("counts rows when no value column is chosen", () => {
    const result = categoryBreakdown(SALES, SALES.rows, 1, null);

    expect(result.entries.map((entry) => [entry.value, entry.count])).toEqual([
      ["Bodrum", 2],
      ["Kos", 2],
    ]);
    expect(result.entries[0].share).toBeCloseTo(50);
  });

  it("gives empty cells a visible bucket rather than dropping them", () => {
    const result = categoryBreakdown(SALES, SALES.rows, 3, null);
    expect(result.entries.some((entry) => entry.value === "(boş)")).toBe(true);
  });
});
