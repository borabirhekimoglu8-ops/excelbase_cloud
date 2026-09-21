/**
 * Operator passport bulk-scan Excel — headers must stay byte-for-byte
 * identical to the agency template the operator already uses.
 *
 * The sheet is one piece: every column below stays, even when the UI only
 * asks the operator to fill the critical MRZ fields. Unused columns
 * (vize, araç, GSM, TC) are written as empty cells — never dropped.
 */

import * as XLSX from "@e965/xlsx";

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/**
 * Exact agency template — do not rename, reorder, translate, or drop a column.
 * Critical filled columns: Yolcu Adı, Yolcu Soyadı, Doğum Tarihi, Ülke Kodu 2,
 * Pasaport Bitiş Tar., Pasaport No, Doküman Tipi (+ Cinsiyet when known).
 */
export const PASSPORT_OPERATOR_HEADERS = [
  "Yolcu Adı",
  "Yolcu Soyadı",
  "Doğum Tarihi",
  "Ülke Kodu 2",
  "Pasaport Bitiş Tar.",
  "Vize Başlangıç Tar.",
  "Vize Bitiş Tar.",
  "Pasaport No",
  "Cinsiyet",
  "Araç Marka",
  "Araç Model",
  "Araç Tipi",
  "Plaka",
  "Gsm",
  "TC.No",
  "Doküman Tipi",
] as const;

export type PassportOperatorRow = {
  firstName: string;
  lastName: string;
  birthDate?: string;
  countryCode2?: string;
  passportExpiry?: string;
  visaStart?: string;
  visaEnd?: string;
  passportNo: string;
  sex?: string;
  vehicleMake?: string;
  vehicleModel?: string;
  vehicleType?: string;
  plate?: string;
  gsm?: string;
  tcNo?: string;
  documentType?: string;
};

/** ICAO 9303 alpha-3 → ISO 3166-1 alpha-2 for the "Ülke Kodu 2" column. */
const ICAO3_TO_ISO2: Record<string, string> = {
  TUR: "TR",
  GRC: "GR",
  DEU: "DE",
  GBR: "GB",
  USA: "US",
  FRA: "FR",
  ITA: "IT",
  ESP: "ES",
  NLD: "NL",
  BEL: "BE",
  AUT: "AT",
  CHE: "CH",
  RUS: "RU",
  UKR: "UA",
  AZE: "AZ",
  GEO: "GE",
  IRN: "IR",
  IRQ: "IQ",
  SYR: "SY",
  BGR: "BG",
  ROU: "RO",
  POL: "PL",
  SWE: "SE",
  NOR: "NO",
  DNK: "DK",
  FIN: "FI",
  PRT: "PT",
  IRL: "IE",
  CAN: "CA",
  AUS: "AU",
  NZL: "NZ",
  CHN: "CN",
  JPN: "JP",
  KOR: "KR",
  IND: "IN",
  PAK: "PK",
  AFG: "AF",
  EGY: "EG",
  MAR: "MA",
  TUN: "TN",
  LBN: "LB",
  JOR: "JO",
  ISR: "IL",
  SAU: "SA",
  ARE: "AE",
  QAT: "QA",
  KWT: "KW",
  BHR: "BH",
  OMN: "OM",
  CYP: "CY",
  MLT: "MT",
  ALB: "AL",
  MKD: "MK",
  SRB: "RS",
  BIH: "BA",
  MNE: "ME",
  XKX: "XK",
  MDA: "MD",
  BLR: "BY",
  KAZ: "KZ",
  UZB: "UZ",
  TKM: "TM",
  KGZ: "KG",
  TJK: "TJ",
  D: "DE", // legacy single-letter Germany in some MRZs
};

export function nationalityToCountryCode2(nationality: string): string {
  const raw = nationality.trim().toUpperCase();
  if (!raw) return "";
  if (raw.length === 2) return raw;
  return ICAO3_TO_ISO2[raw] ?? raw.slice(0, 2);
}

/** YYYY-MM-DD → DD.MM.YYYY for Turkish operator sheets. */
export function formatOperatorDate(iso: string): string {
  const trimmed = iso.trim();
  if (!trimmed) return "";
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (match) return `${match[3]}.${match[2]}.${match[1]}`;
  return trimmed;
}

/** MRZ sex → Turkish E/K. */
export function formatOperatorSex(sex: string): string {
  const value = sex.trim().toUpperCase();
  if (value === "M" || value === "E" || value === "ERKEK") return "E";
  if (value === "F" || value === "K" || value === "KADIN") return "K";
  return value;
}

function cell(value: unknown): string {
  return value == null ? "" : String(value).trim();
}

function workbookBytes(workbook: XLSX.WorkBook): Uint8Array {
  const output = XLSX.write(workbook, {
    type: "array",
    bookType: "xlsx",
    compression: true,
  }) as ArrayBuffer | Uint8Array;
  return output instanceof Uint8Array ? output : new Uint8Array(output);
}

function copyBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

/**
 * Builds the agency passport list workbook.
 *
 * Header row is exactly `PASSPORT_OPERATOR_HEADERS`. Empty optional columns
 * stay blank so the operator can fill vehicle / GSM / TC later.
 */
export function createPassportOperatorXlsxBlob(rows: readonly PassportOperatorRow[]): Blob {
  const data = rows.map((row) => [
    cell(row.firstName),
    cell(row.lastName),
    formatOperatorDate(cell(row.birthDate)),
    cell(row.countryCode2),
    formatOperatorDate(cell(row.passportExpiry)),
    formatOperatorDate(cell(row.visaStart)),
    formatOperatorDate(cell(row.visaEnd)),
    cell(row.passportNo).toLocaleUpperCase("tr-TR"),
    formatOperatorSex(cell(row.sex)),
    cell(row.vehicleMake),
    cell(row.vehicleModel),
    cell(row.vehicleType),
    cell(row.plate).toLocaleUpperCase("tr-TR"),
    cell(row.gsm),
    cell(row.tcNo),
    cell(row.documentType) || "Passport",
  ]);

  const worksheet = XLSX.utils.aoa_to_sheet([
    [...PASSPORT_OPERATOR_HEADERS],
    ...data,
  ]);
  worksheet["!cols"] = PASSPORT_OPERATOR_HEADERS.map((header) => ({
    wch: Math.max(12, header.length + 2),
  }));

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Yolcular");
  workbook.Props = {
    Title: "Pasaport Yolcu Listesi",
    Company: "İDO",
  };
  return new Blob([copyBuffer(workbookBytes(workbook))], { type: XLSX_MIME });
}
