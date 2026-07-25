import type { DocumentCategory } from "@/lib/documentCategories";

export type PassengerFileIdentity = {
  id?: number;
  departure_date?: unknown;
  first_name?: unknown;
  last_name?: unknown;
  full_name?: unknown;
  passport_no?: unknown;
};

export type PassengerFileDocument = {
  filename: string;
  source_filename?: string;
  category?: DocumentCategory;
};

const DOCUMENT_SUFFIX: Record<Exclude<DocumentCategory, "complete_bundle">, string> = {
  passport: "PASSPORT",
  application_form: "APPLICATION_FORM",
  hotel: "HOTEL_RESERVATION",
  ferry: "FERRY_TICKET",
  insurance: "TRAVEL_INSURANCE",
  bank: "BANK_DOCUMENT",
  other: "OTHER_DOCUMENT",
};

function valueText(value: unknown): string {
  if (value === null || value === undefined) return "";
  const output = String(value).trim();
  return output.toLocaleLowerCase("en-US") === "nan" ? "" : output;
}

function validIsoDate(year: number, month: number, day: number): string {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) return "";
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function portableDepartureDate(value: unknown): string {
  const raw = valueText(value).split(/[T ]/, 1)[0];
  let match = raw.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (match) return validIsoDate(Number(match[1]), Number(match[2]), Number(match[3])) || "UNDATED";
  match = raw.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (match) return validIsoDate(Number(match[3]), Number(match[2]), Number(match[1])) || "UNDATED";
  return "UNDATED";
}

function portableToken(value: unknown, fallback: string, maxLength: number): string {
  const output = valueText(value)
    .toLocaleUpperCase("tr-TR")
    .replace(/[ÇĞİÖŞÜ]/g, (character) => (
      ({ Ç: "C", Ğ: "G", İ: "I", Ö: "O", Ş: "S", Ü: "U" })[character] ?? character
    ))
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, maxLength)
    .replace(/_+$/g, "");
  return output || fallback;
}

function portablePassport(value: unknown): string {
  const output = portableToken(value, "", 48).replaceAll("_", "");
  return output || "NO_PASSPORT";
}

function resolvedNames(passenger: PassengerFileIdentity): [string, string] {
  const fullNameParts = valueText(passenger.full_name).split(/\s+/).filter(Boolean);
  const firstName = valueText(passenger.first_name) || fullNameParts[0] || "";
  const lastName = valueText(passenger.last_name)
    || (fullNameParts.length > 1 ? fullNameParts.slice(1).join(" ") : "");
  return [firstName, lastName];
}

/**
 * Produces the portable, deterministic filename stem requested by operations:
 * departure-date_first-name_last-name_passport-number.
 */
export function passengerFileBase(passenger: PassengerFileIdentity): string {
  const [firstName, lastName] = resolvedNames(passenger);
  return [
    portableDepartureDate(passenger.departure_date),
    portableToken(firstName, "UNKNOWN", 36),
    portableToken(lastName, "UNKNOWN", 48),
    portablePassport(passenger.passport_no),
  ].join("_");
}

export function passengerPhotoFilename(passenger: PassengerFileIdentity): string {
  return `${passengerFileBase(passenger)}.jpg`;
}

export function passengerDocumentFilename(
  passenger: PassengerFileIdentity,
  category: DocumentCategory = "other",
  ordinal = 1,
): string {
  const categorySuffix = category === "complete_bundle" ? "" : `_${DOCUMENT_SUFFIX[category]}`;
  const duplicateSuffix = ordinal > 1 ? `_${String(ordinal).padStart(2, "0")}` : "";
  return `${passengerFileBase(passenger)}${categorySuffix}${duplicateSuffix}.pdf`;
}

/**
 * Keeps the original source name for audit/history while exposing a filename
 * generated from the passenger's latest record values.
 */
export function autoNamedPassengerDocuments<T extends PassengerFileDocument>(
  passenger: PassengerFileIdentity,
  documents: readonly T[],
): Array<T & { filename: string; source_filename: string; category: DocumentCategory }> {
  const categoryCounts = new Map<DocumentCategory, number>();
  return documents.map((document) => {
    const category = document.category ?? "other";
    const ordinal = (categoryCounts.get(category) ?? 0) + 1;
    categoryCounts.set(category, ordinal);
    return {
      ...document,
      category,
      source_filename: document.source_filename || document.filename,
      filename: passengerDocumentFilename(passenger, category, ordinal),
    };
  });
}
