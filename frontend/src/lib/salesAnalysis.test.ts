import { describe, expect, it } from "vitest";

import type { SalesSheet } from "@/lib/sales";
import {
  categoryBreakdown,
  categoryColumnIndexes,
  columnSummaries,
  distinctValues,
  emptySalesFilter,
  filterSalesRows,
  numericColumnIndexes,
  numericStats,
  sortRows,
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

  it("matches a substring within one column, unlike the dropdown's exact value", () => {
    // A free-text box over a hundred passport numbers is only usable as a
    // partial match, while a dropdown offers values that exist.
    const rows = filterSalesRows(SALES, {
      ...emptySalesFilter(),
      columnQueries: { 0: "seyahat" },
    });
    expect(rows.map((row) => row[0])).toEqual(["Ege Seyahat"]);
  });

  it("combines a column substring with the other filters", () => {
    // "tur" matches Mavi Tur and Deniz Turizm; the Sefer filter then keeps
    // only their Kos rows.
    const rows = filterSalesRows(SALES, {
      ...emptySalesFilter(),
      columnQueries: { 0: "tur" },
      columnValues: { 1: "Kos" },
    });
    expect(rows.map((row) => row[0])).toEqual(["Mavi Tur", "Deniz Turizm"]);
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

describe("sortRows", () => {
  it("sorts a money column by value, not by how it is written", () => {
    // "1.500,00" sorts before "900,00" as text, which is the kind of wrong
    // that looks plausible enough to act on.
    const rows = sortRows(SALES, SALES.rows, { index: 2, direction: "asc" });
    expect(rows.map((row) => row[2])).toEqual([
      "500,50",
      "1.000,00",
      "1.500,00",
      "2.500,00",
    ]);
  });

  it("reverses on the other direction", () => {
    const rows = sortRows(SALES, SALES.rows, { index: 2, direction: "desc" });
    expect(rows[0][2]).toBe("2.500,00");
  });

  it("sorts text with Turkish collation", () => {
    const rows = sortRows(SALES, SALES.rows, { index: 0, direction: "asc" });
    expect(rows.map((row) => row[0])).toEqual([
      "Deniz Turizm",
      "Ege Seyahat",
      "Mavi Tur",
      "Mavi Tur",
    ]);
  });

  it("keeps blanks at the end in both directions", () => {
    // An empty cell is not the smallest amount; putting it first in a
    // descending sort would read as a real value.
    const sparse = sheet(["Tutar"], [["100"], [""], ["300"]]);
    expect(sortRows(sparse, sparse.rows, { index: 0, direction: "asc" }).map((r) => r[0]))
      .toEqual(["100", "300", ""]);
    expect(sortRows(sparse, sparse.rows, { index: 0, direction: "desc" }).map((r) => r[0]))
      .toEqual(["300", "100", ""]);
  });

  it("returns the rows untouched when nothing is sorted", () => {
    expect(sortRows(SALES, SALES.rows, null)).toBe(SALES.rows);
  });

  it("does not mutate the rows it was given", () => {
    const original = [...SALES.rows];
    sortRows(SALES, SALES.rows, { index: 2, direction: "desc" });
    expect(SALES.rows).toEqual(original);
  });
});

describe("columnSummaries", () => {
  it("gives every header a line, whatever the column holds", () => {
    // Summarising only the money columns left most of a spreadsheet
    // unaccounted for, with no way to tell an empty column from an
    // unsummarised one.
    const summaries = columnSummaries(SALES, SALES.rows);

    expect(summaries.map((entry) => entry.column)).toEqual([
      "Acente",
      "Sefer",
      "Tutar",
      "Not",
    ]);
    // "Not" is text, not a category: both of its filled cells differ, so
    // grouping by it would make one group per row.
    expect(summaries.map((entry) => entry.kind)).toEqual([
      "category",
      "category",
      "numeric",
      "text",
    ]);
  });

  it("carries the numeric statistics on the numeric column only", () => {
    const summaries = columnSummaries(SALES, SALES.rows);
    const tutar = summaries[2];
    const acente = summaries[0];

    expect(tutar.numeric?.sum).toBeCloseTo(5500.5);
    expect(acente.numeric).toBeNull();
    expect(acente.top[0].value).toBe("Mavi Tur");
    expect(acente.top[0].count).toBe(2);
  });

  it("counts filled and empty cells so a sparse column is visible", () => {
    const summaries = columnSummaries(SALES, SALES.rows);
    const not = summaries[3];

    expect(not.filled).toBe(2);
    expect(not.empty).toBe(2);
    expect(not.distinct).toBe(2);
    // Blank cells were excluded before ranking, so "(boş)" is not a top value.
    expect(not.top.map((entry) => entry.value)).not.toContain("(boş)");
  });

  it("follows the filter like every other statistic", () => {
    const rows = filterSalesRows(SALES, { ...emptySalesFilter(), query: "mavi" });
    const summaries = columnSummaries(SALES, rows);

    expect(summaries[2].numeric?.count).toBe(2);
    expect(summaries[0].filled).toBe(2);
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
