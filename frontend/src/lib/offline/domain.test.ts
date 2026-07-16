import { describe, expect, it, vi } from "vitest";
import {
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
    photo: "",
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
