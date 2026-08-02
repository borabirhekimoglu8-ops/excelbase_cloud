import { describe, expect, it } from "vitest";

import type { SalesSheet } from "@/lib/sales";
import {
  categoryBreakdown,
  categoryColumnIndexes,
  columnSummaries,
  dateColumnIndexes,
  distinctValues,
  emptySalesFilter,
  filterSalesRows,
  numericColumnIndexes,
  numericHistogram,
  numericStats,
  parseSalesDate,
  sortRows,
  timeSeries,
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

  it("reports the middle and the spread, not just the average", () => {
    // The average and the median disagree exactly when it matters: one large
    // sale drags the average away from what a typical row looks like.
    const skewed = sheet(["Tutar"], [["10"], ["20"], ["30"], ["40"], ["900"]]);
    const [stats] = numericStats(skewed, skewed.rows);

    expect(stats.average).toBeCloseTo(200);
    expect(stats.median).toBeCloseTo(30);
    expect(stats.p25).toBeCloseTo(20);
    expect(stats.p75).toBeCloseTo(40);
    // sqrt(613000 / 5)
    expect(stats.stdDev).toBeCloseTo(350.14, 1);
  });

  it("interpolates a quartile rather than rounding to one side", () => {
    const even = sheet(["Tutar"], [["10"], ["20"], ["30"], ["40"]]);
    const [stats] = numericStats(even, even.rows);

    expect(stats.median).toBeCloseTo(25);
    expect(stats.p25).toBeCloseTo(17.5);
    expect(stats.p75).toBeCloseTo(32.5);
  });

  it("handles a column of one value without dividing by nothing", () => {
    const single = sheet(["Tutar"], [["42"]]);
    const [stats] = numericStats(single, single.rows);

    expect(stats.median).toBeCloseTo(42);
    expect(stats.stdDev).toBe(0);
  });

  it("survives a column too large to spread across Math.min", () => {
    // Math.min(...values) throws once the column outgrows the argument limit,
    // which it now can: rows are no longer capped.
    const rows = Array.from({ length: 200_000 }, (_unused, i) => [String(i)]);
    const huge = sheet(["Tutar"], rows);
    const [stats] = numericStats(huge, huge.rows);

    expect(stats.min).toBe(0);
    expect(stats.max).toBe(199_999);
    expect(stats.count).toBe(200_000);
  });

  it("ignores unparseable cells instead of counting them as zero", () => {
    // Averaging "iptal" as 0 would silently halve the average.
    const partial = sheet(["Tutar"], [["100"], ["iptal"], ["300"]]);
    const [stats] = numericStats(partial, partial.rows);

    expect(stats.count).toBe(2);
    expect(stats.average).toBeCloseTo(200);
  });
});

const HAT = sheet(
  ["Hat", "Temsilci", "Tarih", "Tutar"],
  [
    ["Bodrum-Kos", "Ali", "01.07.2026", "100"],
    ["Bodrum-Kos", "Ayşe", "01.07.2026", "200"],
    ["Bodrum-Kos", "Ali", "03.07.2026", "300"],
    ["Çeşme-Sakız", "Ayşe", "02.07.2026", "400"],
    ["Çeşme-Sakız", "Ali", "03.07.2026", "500"],
    ["Datça-Simi", "Mehmet", "", "600"],
  ],
);

describe("parseSalesDate", () => {
  it("reads Turkish and ISO dates into one sortable key", () => {
    // d.m.y does not sort as text; the shared yyyy-mm-dd key does.
    expect(parseSalesDate("01.07.2026")).toBe("2026-07-01");
    expect(parseSalesDate("2026-07-01")).toBe("2026-07-01");
    expect(parseSalesDate("1/7/2026")).toBe("2026-07-01");
  });

  it("refuses something that is not a date", () => {
    expect(parseSalesDate("Bodrum")).toBeNull();
    expect(parseSalesDate("")).toBeNull();
    expect(parseSalesDate("45.13.2026")).toBeNull();
  });

  it("finds the date column without being told its name", () => {
    expect(dateColumnIndexes(HAT)).toEqual([2]);
  });
});

describe("timeSeries", () => {
  it("counts sales per day for each route", () => {
    const result = timeSeries(HAT, HAT.rows, {
      dateIndex: 2,
      valueIndex: null,
      seriesIndex: 0,
    });

    expect(result.keys).toEqual(["2026-07-01", "2026-07-02", "2026-07-03"]);
    const bodrum = result.series.find((entry) => entry.label === "Bodrum-Kos");
    expect(bodrum?.values).toEqual([2, 0, 1]);
    expect(bodrum?.total).toBe(3);
  });

  it("zero-fills every series so the lines share one axis", () => {
    // Without this each line has its own x-axis and two routes cannot be
    // compared at a glance, which is the whole point of drawing them together.
    const result = timeSeries(HAT, HAT.rows, { dateIndex: 2, valueIndex: null, seriesIndex: 0 });
    for (const entry of result.series) {
      expect(entry.values).toHaveLength(result.keys.length);
    }
    expect(result.series.find((e) => e.label === "Çeşme-Sakız")?.values).toEqual([0, 1, 1]);
  });

  it("sums a money column instead of counting when asked", () => {
    const result = timeSeries(HAT, HAT.rows, { dateIndex: 2, valueIndex: 3, seriesIndex: 0 });
    expect(result.series.find((e) => e.label === "Bodrum-Kos")?.values).toEqual([300, 0, 300]);
  });

  it("splits by person just as readily as by route", () => {
    const result = timeSeries(HAT, HAT.rows, { dateIndex: 2, valueIndex: null, seriesIndex: 1 });
    expect(result.series.map((entry) => entry.label).sort()).toEqual(["Ali", "Ayşe"]);
    expect(result.series.find((e) => e.label === "Ali")?.values).toEqual([1, 0, 2]);
  });

  it("drops rows with no usable date rather than bunching them at one end", () => {
    // The Datça row has no date; inventing one would put a sale on a day it
    // did not happen.
    const result = timeSeries(HAT, HAT.rows, { dateIndex: 2, valueIndex: null, seriesIndex: 0 });
    expect(result.series.some((entry) => entry.label === "Datça-Simi")).toBe(false);
  });

  it("groups by month when asked", () => {
    const result = timeSeries(HAT, HAT.rows, {
      dateIndex: 2,
      valueIndex: null,
      seriesIndex: null,
      grain: "month",
    });
    expect(result.keys).toEqual(["2026-07"]);
    expect(result.series[0].values).toEqual([5]);
  });

  it("folds the long tail into one line rather than dropping it", () => {
    const many = sheet(
      ["Hat", "Tarih"],
      Array.from({ length: 10 }, (_unused, i) => [`Hat ${i}`, "01.07.2026"]),
    );
    const result = timeSeries(many, many.rows, {
      dateIndex: 1,
      valueIndex: null,
      seriesIndex: 0,
      maxSeries: 3,
    });

    expect(result.series).toHaveLength(4);
    const other = result.series[result.series.length - 1];
    expect(other.label).toBe("Diğer (7)");
    expect(other.total).toBe(7);
  });

  it("returns nothing usable when no row has a date", () => {
    const undated = sheet(["Hat", "Tarih"], [["A", ""], ["B", "yok"]]);
    const result = timeSeries(undated, undated.rows, {
      dateIndex: 1,
      valueIndex: null,
      seriesIndex: 0,
    });
    expect(result.keys).toEqual([]);
    expect(result.series).toEqual([]);
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

describe("numericHistogram", () => {
  it("spreads values across equal-width buckets", () => {
    const buckets = numericHistogram([0, 1, 2, 3, 4, 5, 6, 7], 4);

    expect(buckets).toHaveLength(4);
    expect(buckets.map((bucket) => bucket.count)).toEqual([2, 2, 2, 2]);
  });

  it("puts the highest value in the last bucket, not one past the end", () => {
    // floor((max - low) / width) lands on `buckets`, which would be a ninth
    // bucket that does not exist.
    const buckets = numericHistogram([0, 10], 4);
    expect(buckets[buckets.length - 1].count).toBe(1);
    expect(buckets.reduce((total, bucket) => total + bucket.count, 0)).toBe(2);
  });

  it("gives an all-identical column one bucket rather than eight empty ones", () => {
    const buckets = numericHistogram([5, 5, 5]);
    expect(buckets).toHaveLength(1);
    expect(buckets[0].count).toBe(3);
  });

  it("shows shape the five-number summary hides", () => {
    // Both halves bunched at the ends; min/median/max alone cannot say so.
    const split = numericHistogram([1, 1, 1, 1, 100, 100, 100, 100], 4);
    expect(split[0].count).toBe(4);
    expect(split[split.length - 1].count).toBe(4);
    expect(split[1].count).toBe(0);
  });

  it("returns nothing for an empty column", () => {
    expect(numericHistogram([])).toEqual([]);
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
