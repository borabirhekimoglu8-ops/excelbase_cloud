import { describe, expect, it, vi } from "vitest";
import {
  buildRecordFolders,
  buildSummary,
  canonicalDate,
  filterPassengers,
  passengerIdentity,
  type StoredPassenger,
} from "./domain";

function passenger(overrides: Partial<StoredPassenger> = {}): StoredPassenger {
  return {
    id: 1,
    no: "1",
    first_name: "Ayşe",
    last_name: "Yılmaz",
    full_name: "Ayşe Yılmaz",
    passport_no: "TR 123456",
    voucher: "V-1",
    departure_date: "16.07.2026",
    arrival_date: "20.07.2026",
    adult_fee: "25,50 EUR",
    child_fee: "0",
    source_file: "liste.xlsx",
    sheet: "PAX",
    created_at: "2026-07-10T09:30:00.000Z",
    record_date: "2026-07-10",
    created_by: "Yerel Yönetici",
    record_status: "review",
    record_source: "import",
    photo: "",
    documents: [],
    ...overrides,
  };
}

describe("offline passenger domain", () => {
  it("tarihleri saat dilimine bağlı olmadan ISO biçimine çevirir", () => {
    expect(canonicalDate("16.07.2026")).toBe("2026-07-16");
    expect(canonicalDate("2026/07/16 00:00:00")).toBe("2026-07-16");
    expect(canonicalDate("31.02.2026")).toBe("");
  });

  it("pasaport ve gidiş tarihiyle kararlı mükerrer anahtarı üretir", () => {
    expect(passengerIdentity(passenger())).toBe("TR123456|2026-07-16");
  });

  it("arama ve mükerrer durumunu seçili tarih kapsamından hesaplar", () => {
    const rows = [
      passenger(),
      passenger({ id: 2, first_name: "Başka", last_name: "Yolcu", full_name: "Başka Yolcu" }),
    ];
    const result = filterPassengers(rows, { search: "AYSE", status: "Tekrarlı" });
    expect(result.rows.map((row) => row.id)).toEqual([1]);
  });

  it("tarih kapsamını sefer veya kayıt tarihine göre ayrı uygular", () => {
    const rows = [
      passenger({ id: 1, departure_date: "2026-07-16", record_date: "2026-07-10" }),
      passenger({ id: 2, departure_date: "2026-07-10", record_date: "2026-07-16" }),
    ];
    const range = { range: "Aralık", start: "2026-07-16", end: "2026-07-16" };

    expect(filterPassengers(rows, { scope: { ...range, field: "departure" } }).rows.map((row) => row.id))
      .toEqual([1]);
    expect(filterPassengers(rows, { scope: { ...range, field: "created" } }).rows.map((row) => row.id))
      .toEqual([2]);
  });

  it("kayıt klasörlerini record_date alanına göre gruplar ve durumları sayar", () => {
    const requiredDocuments = [
      {
        id: "passport-doc",
        filename: "pasaport.pdf",
        mime: "application/pdf" as const,
        size: 100,
        created_at: "2026-07-17T08:00:00.000Z",
        category: "passport" as const,
      },
      {
        id: "form-doc",
        filename: "form.pdf",
        mime: "application/pdf" as const,
        size: 100,
        created_at: "2026-07-17T08:01:00.000Z",
        category: "application_form" as const,
      },
    ];
    const rows = [
      passenger({
        id: 1,
        passport_no: "READY123",
        record_date: "2026-07-17",
        record_status: "ready",
        photo: "photo:1",
        documents: requiredDocuments,
      }),
      passenger({ id: 2, passport_no: "REVIEW123", record_date: "2026-07-17", record_status: "review" }),
      passenger({ id: 3, passport_no: "DRAFT123", record_date: "2026-07-16", record_status: "draft" }),
    ];

    const result = buildRecordFolders(rows);

    expect(result.total_count).toBe(3);
    expect(result.groups.map((group) => group.date_key)).toEqual(["2026-07-17", "2026-07-16"]);
    expect(result.groups[0]).toMatchObject({
      count: 2,
      ready_count: 1,
      review_count: 1,
      draft_count: 0,
      with_photo: 1,
      document_count: 2,
      passenger_ids: [1, 2],
    });
    expect(result.groups[1]).toMatchObject({ draft_count: 1, passenger_ids: [3] });
  });

  it("kayıt tarihi bilinmeyen eski yolcuyu Tarihsiz klasöründe korur", () => {
    const result = buildRecordFolders([
      passenger({
        id: 7,
        created_at: "",
        record_date: "",
        created_by: "",
      }),
    ]);

    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]).toMatchObject({ date_key: "Tarihsiz", passenger_ids: [7] });
  });

  it("yerel özeti ve ücretleri hesaplar", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 16, 12));
    const summary = buildSummary([passenger()], { range: "Tümü", start: "", end: "" });
    expect(summary.passenger_count).toBe(1);
    expect(summary.total_fee).toBe(25.5);
    expect(summary.today_count).toBe(1);
    expect(summary.missing_photo).toBe(1);
    vi.useRealTimers();
  });
});
