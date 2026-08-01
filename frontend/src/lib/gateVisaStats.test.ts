import { describe, expect, it } from "vitest";

import type { RecordFolder } from "@/lib/api";
import { busiestOutstandingDays, gateVisaTotals } from "@/lib/gateVisaStats";

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
