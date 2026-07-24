import { describe, expect, it } from "vitest";

import { buildAssistantContext } from "./context";

describe("buildAssistantContext", () => {
  it("selects aggregate fields and cannot carry passenger or document PII", () => {
    const context = buildAssistantContext(
      {
        passenger_count: 12,
        ready_count: 7,
        missing_count: 5,
        with_photo: 10,
        missing_photo: 2,
        missing_passport: 1,
        missing_voucher: 3,
        missing_fee: 4,
        duplicates: 1,
        today_count: 6,
        readiness_percent: 58,
        adult_total: 1250.456,
        child_total: 300,
        total_fee: 1550.456,
        issue_counts: {
          Fotosuz: 2,
          Pasaportsuz: 1,
          "Voucher eksik": 3,
          Ücretsiz: 4,
          Tekrarlı: 1,
          "İsim eksik": 0,
          "Tarih hatası": 2,
          "U12345678 özel hata": 99,
        },
        loaded_files: ["U12345678-Ayşe-Yılmaz.xlsx"],
        import_history: [{ files: "ayse@example.com" }],
        passport_no: "U12345678",
        full_name: "Ayşe Yılmaz",
        documents: [{ filename: "U12345678-pasaport.pdf", body: "raw PDF" }],
        notes: "+90 555 123 45 67",
      },
      { range: "Aralık", field: "created", start: "2026-07-01", end: "2026-07-31" },
    );

    expect(context).toEqual({
      version: 1,
      scope: {
        range: "custom",
        field: "created",
        start: "2026-07-01",
        end: "2026-07-31",
      },
      metrics: {
        passenger_count: 12,
        ready_count: 7,
        missing_count: 5,
        with_photo: 10,
        missing_photo: 2,
        missing_passport: 1,
        missing_voucher: 3,
        missing_fee: 4,
        duplicates: 1,
        today_count: 6,
        readiness_percent: 58,
        adult_total: 1250.46,
        child_total: 300,
        total_fee: 1550.46,
      },
      issues: {
        missing_photo: 2,
        missing_passport: 1,
        missing_voucher: 3,
        missing_fee: 4,
        duplicate: 1,
        missing_name: 0,
        invalid_date: 2,
      },
    });

    const serialized = JSON.stringify(context);
    for (const pii of ["U12345678", "Ayşe", "example.com", "pasaport.pdf", "raw PDF", "+90"]) {
      expect(serialized).not.toContain(pii);
    }
  });

  it("clamps malformed and excessive aggregate values", () => {
    const context = buildAssistantContext(
      {
        passenger_count: Number.POSITIVE_INFINITY,
        missing_count: -3,
        readiness_percent: 900,
        total_fee: 10 ** 20,
        issue_counts: { Fotosuz: 10 ** 20 },
      },
      { range: "unsafe-range", field: "unsafe-field", start: "passaport U12345678" },
    );

    expect(context.metrics.passenger_count).toBe(0);
    expect(context.metrics.missing_count).toBe(0);
    expect(context.metrics.readiness_percent).toBe(100);
    expect(context.metrics.total_fee).toBe(1_000_000_000);
    expect(context.issues.missing_photo).toBe(1_000_000);
    expect(context.scope).toEqual({ range: "all", field: "departure", start: "", end: "" });
  });
});
