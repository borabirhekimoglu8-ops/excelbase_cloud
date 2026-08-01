/**
 * The passenger list as a table of named columns.
 *
 * A Gate Visa list arrives as an Excel file and is stored as passenger
 * records, which left the two pages asking questions in different ways: the
 * sales page could filter and summarise by any column, while the Gate Visa
 * page could only report the handful of counters the folder view already had.
 * Projecting passengers back into headers and rows lets one engine serve both,
 * so "filter by column" means the same thing on either page.
 *
 * The headers are the fields of the Gate Visa template, in the order an
 * operator reads them.
 */

import type { Passenger } from "@/lib/api";
import type { ColumnTable } from "@/lib/salesAnalysis";

export const PASSENGER_COLUMNS = [
  "No",
  "Ad",
  "Soyad",
  "Pasaport No",
  "Voucher",
  "Gidiş Tarihi",
  "Varış Tarihi",
  "Yetişkin Ücret",
  "Çocuk Ücret",
  "Durum",
  "Fotoğraf",
  "Evrak Sayısı",
  "Kayıt Tarihi",
  "Kaynak Dosya",
  "Eksikler",
] as const;

const STATUS_LABELS: Record<string, string> = {
  ready: "Hazır",
  review: "Kontrol",
  draft: "Taslak",
};

function statusLabel(value: string): string {
  return STATUS_LABELS[value] ?? value ?? "";
}

/**
 * Booleans are rendered as words rather than left blank.
 *
 * An empty cell reads as "not filled in", which is a different statement from
 * "no photo" -- and the difference matters when the column is being counted.
 */
function yesNo(value: boolean): string {
  return value ? "Var" : "Yok";
}

export function passengerTable(passengers: Passenger[]): ColumnTable {
  return {
    headers: [...PASSENGER_COLUMNS],
    rows: passengers.map((passenger) => [
      passenger.no ?? "",
      passenger.first_name ?? "",
      passenger.last_name ?? "",
      passenger.passport_no ?? "",
      passenger.voucher ?? "",
      passenger.departure_date ?? "",
      passenger.arrival_date ?? "",
      passenger.adult_fee ?? "",
      passenger.child_fee ?? "",
      statusLabel(passenger.record_status ?? ""),
      yesNo(Boolean(passenger.photo || passenger.photo_url)),
      String(passenger.documents?.length ?? 0),
      passenger.record_date ?? "",
      passenger.source_file ?? "",
      (passenger.issues ?? []).join(", "),
    ]),
  };
}
