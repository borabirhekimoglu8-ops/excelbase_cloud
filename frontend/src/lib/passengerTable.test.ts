import { describe, expect, it } from "vitest";

import type { Passenger } from "@/lib/api";
import { PASSENGER_COLUMNS, passengerTable } from "@/lib/passengerTable";
import {
  categoryColumnIndexes,
  columnSummaries,
  emptySalesFilter,
  filterSalesRows,
  numericColumnIndexes,
} from "@/lib/salesAnalysis";

function passenger(overrides: Partial<Passenger> = {}): Passenger {
  return {
    id: 1,
    record_uid: "u1",
    no: "1",
    first_name: "Ali",
    last_name: "YILMAZ",
    full_name: "Ali YILMAZ",
    passport_no: "U1234567",
    voucher: "V-1",
    departure_date: "2026-07-01",
    arrival_date: "2026-07-05",
    adult_fee: "1.500,00",
    child_fee: "",
    source_file: "temmuz.xlsx",
    sheet: "Sayfa1",
    created_at: "2026-07-01T08:00:00.000Z",
    record_date: "2026-07-01",
    created_by: "Bora",
    record_status: "ready",
    record_source: "import",
    photo: "photo-1",
    photo_url: "blob:1",
    documents: [],
    issues: [],
    duplicate: false,
    ...overrides,
  } as Passenger;
}

describe("passengerTable", () => {
  it("projects the Gate Visa fields as column headers", () => {
    const table = passengerTable([passenger()]);

    expect(table.headers).toEqual([...PASSENGER_COLUMNS]);
    expect(table.rows).toHaveLength(1);
    expect(table.rows[0][table.headers.indexOf("Ad")]).toBe("Ali");
    expect(table.rows[0][table.headers.indexOf("Pasaport No")]).toBe("U1234567");
  });

  it("writes status and photo as words rather than codes or blanks", () => {
    // An empty cell reads as "not filled in", which is a different statement
    // from "no photo" -- and the difference matters when it is being counted.
    const table = passengerTable([
      passenger({ record_status: "draft", photo: "", photo_url: "" }),
    ]);
    const row = table.rows[0];

    expect(row[table.headers.indexOf("Durum")]).toBe("Taslak");
    expect(row[table.headers.indexOf("Fotoğraf")]).toBe("Yok");
  });

  it("counts documents so the column can be filtered as a number", () => {
    const table = passengerTable([
      passenger({ documents: [{}, {}] as Passenger["documents"] }),
    ]);
    expect(table.rows[0][table.headers.indexOf("Evrak Sayısı")]).toBe("2");
  });

  it("feeds the same engine the sales page uses", () => {
    // Three rows with a repeated status: a column only counts as groupable
    // once a value recurs, otherwise it is an identifier.
    const table = passengerTable([
      passenger({ record_status: "ready", adult_fee: "1.500,00" }),
      passenger({ id: 2, first_name: "Ayşe", record_status: "draft", adult_fee: "2.500,00" }),
      passenger({ id: 3, first_name: "Mehmet", record_status: "draft", adult_fee: "" }),
    ]);

    // Fees are recognised as numbers, status as something to group by.
    expect(numericColumnIndexes(table)).toContain(table.headers.indexOf("Yetişkin Ücret"));
    expect(categoryColumnIndexes(table)).toContain(table.headers.indexOf("Durum"));

    const draft = filterSalesRows(table, {
      ...emptySalesFilter(),
      columnValues: { [table.headers.indexOf("Durum")]: "Taslak" },
    });
    expect(draft.map((row) => row[table.headers.indexOf("Ad")])).toEqual(["Ayşe", "Mehmet"]);

    const summaries = columnSummaries(table, table.rows);
    const fee = summaries[table.headers.indexOf("Yetişkin Ücret")];
    expect(fee.numeric?.sum).toBeCloseTo(4000);
  });

  it("produces an empty table rather than failing on no passengers", () => {
    const table = passengerTable([]);
    expect(table.headers).toEqual([...PASSENGER_COLUMNS]);
    expect(table.rows).toEqual([]);
  });
});
