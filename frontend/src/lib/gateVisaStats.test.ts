import { describe, expect, it } from "vitest";

import type { RecordFolder } from "@/lib/api";
import {
  busiestOutstandingDays,
  emptyGateVisaFilter,
  filterGateVisaFolders,
  gateVisaTotals,
} from "@/lib/gateVisaStats";

function folder(overrides: Partial<RecordFolder> & { date_key: string }): RecordFolder {
  return {
    count: 0,
    ready_count: 0,
    review_count: 0,
    draft_count: 0,
    with_photo: 0,
    document_count: 0,
    passenger_ids: [],
    ...overrides,
  };
}

const FOLDERS: RecordFolder[] = [
  folder({ date_key: "2026-07-01", count: 10, ready_count: 10, with_photo: 10, document_count: 12 }),
  folder({ date_key: "2026-07-02", count: 8, ready_count: 3, review_count: 4, draft_count: 1, with_photo: 5 }),
  folder({ date_key: "2026-08-01", count: 6, ready_count: 2, review_count: 4, with_photo: 6, document_count: 3 }),
];

describe("gateVisaTotals", () => {
  it("adds up the operation and reports the two coverage rates", () => {
    const totals = gateVisaTotals(FOLDERS);

    expect(totals.folders).toBe(3);
    expect(totals.passengers).toBe(24);
    expect(totals.ready).toBe(15);
    expect(totals.outstanding).toBe(9);
    expect(totals.documents).toBe(15);
    expect(totals.readinessPercent).toBeCloseTo(62.5);
    expect(totals.photoPercent).toBeCloseTo(87.5);
  });

  it("reports zero rather than dividing by no passengers", () => {
    const totals = gateVisaTotals([]);
    expect(totals.readinessPercent).toBe(0);
    expect(totals.photoPercent).toBe(0);
    expect(totals.outstanding).toBe(0);
  });
});

describe("filterGateVisaFolders", () => {
  it("narrows to a month by date prefix", () => {
    const rows = filterGateVisaFolders(FOLDERS, { ...emptyGateVisaFilter(), query: "2026-07" });
    expect(rows.map((entry) => entry.date_key)).toEqual(["2026-07-01", "2026-07-02"]);
  });

  it("keeps only days with work left", () => {
    const rows = filterGateVisaFolders(FOLDERS, { ...emptyGateVisaFilter(), onlyIncomplete: true });
    expect(rows.map((entry) => entry.date_key)).toEqual(["2026-07-02", "2026-08-01"]);
  });

  it("finds days where someone still has no photo", () => {
    const rows = filterGateVisaFolders(FOLDERS, { ...emptyGateVisaFilter(), onlyMissingPhoto: true });
    expect(rows.map((entry) => entry.date_key)).toEqual(["2026-07-02"]);
  });

  it("finds days with no documents attached at all", () => {
    const rows = filterGateVisaFolders(FOLDERS, {
      ...emptyGateVisaFilter(),
      onlyMissingDocuments: true,
    });
    expect(rows.map((entry) => entry.date_key)).toEqual(["2026-07-02"]);
  });

  it("never flags an empty day as missing something", () => {
    // A day with no passengers has nothing outstanding; listing it would send
    // the operator to an empty folder.
    const empty = [folder({ date_key: "2026-09-01" })];
    expect(filterGateVisaFolders(empty, { ...emptyGateVisaFilter(), onlyMissingPhoto: true })).toEqual([]);
    expect(filterGateVisaFolders(empty, { ...emptyGateVisaFilter(), onlyMissingDocuments: true })).toEqual([]);
  });

  it("combines filters rather than widening with each one", () => {
    const rows = filterGateVisaFolders(FOLDERS, {
      ...emptyGateVisaFilter(),
      query: "2026-08",
      onlyIncomplete: true,
    });
    expect(rows.map((entry) => entry.date_key)).toEqual(["2026-08-01"]);
  });
});

describe("busiestOutstandingDays", () => {
  it("ranks by work left, not by size or date", () => {
    // 2026-07-01 is a complete day and must not appear at all, even though it
    // is the largest and the earliest.
    const days = busiestOutstandingDays(FOLDERS);

    expect(days.map((day) => day.dateKey)).toEqual(["2026-07-02", "2026-08-01"]);
    expect(days[0].outstanding).toBe(5);
    expect(days[0].readinessPercent).toBeCloseTo(37.5);
  });

  it("stops at the requested number of days", () => {
    expect(busiestOutstandingDays(FOLDERS, 1)).toHaveLength(1);
  });
});
