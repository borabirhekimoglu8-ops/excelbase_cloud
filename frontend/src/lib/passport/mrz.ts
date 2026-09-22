/**
 * Safe ICAO 9303 TD3 parsing.
 *
 * Input is already fixed to physical MRZ cells. This module never inserts,
 * deletes, shifts, or harvests characters from unrelated page text.
 */

import {
  decodeLine1,
  decodeLine2,
  icaoCheckDigit,
  tcChecksum,
  type Cell,
} from "./td3Schema";

export type MrzSex = "M" | "F" | "X" | "";

export type DisputedMrzCell = {
  line: 1 | 2;
  column: number;
  candidates: string[];
};

export type MrzParseResult = {
  documentCode: string;
  issuingState: string;
  surname: string;
  givenNames: string;
  passportNumber: string;
  nationality: string;
  birthDate: string;
  sex: MrzSex;
  expiryDate: string;
  personalNumber: string;
  nationalId: string;
  line1: string;
  line2: string;
  /** Every mandatory TD3 field and the composite check have one solution. */
  verified: boolean;
  /** Compatibility alias; new code should use verified. */
  valid: boolean;
  disputedCells: DisputedMrzCell[];
  warnings: string[];
};

/** ICAO check digit for a field (or the composite range on line 2). */
export function mrzCheckDigit(field: string): string {
  return icaoCheckDigit(field);
}

function cellsFromLine(line: string): Cell[] {
  return [...line].map((value, index) => ({
    index,
    x0: index,
    x1: index + 1,
    candidates: [{ value, confidence: 100, passes: ["text"] }],
    disputed: false,
  }));
}

/** Decode two exact 44-character TD3 text lines without OCR heuristics. */
export function parseTd3FromLines(
  line1: string,
  line2: string,
  today = new Date(),
): MrzParseResult | null {
  const upper = line1.trim().toUpperCase();
  const lower = line2.trim().toUpperCase();
  if (
    upper.length !== 44
    || lower.length !== 44
    || !/^[A-Z<]{44}$/.test(upper)
    || !/^[A-Z0-9<]{44}$/.test(lower)
  ) return null;
  return parseTd3FromCells(cellsFromLine(upper), cellsFromLine(lower), today);
}

/** YYMMDD → YYYY-MM-DD using the retained 1950–2049 display pivot. */
export function mrzDateToIso(yymmdd: string): string {
  if (!/^\d{6}$/.test(yymmdd)) return "";
  const yy = Number(yymmdd.slice(0, 2));
  const month = Number(yymmdd.slice(2, 4));
  const day = Number(yymmdd.slice(4, 6));
  const year = yy >= 50 ? 1900 + yy : 2000 + yy;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) return "";
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function disputes(line: 1 | 2, cells: readonly Cell[]): DisputedMrzCell[] {
  return cells
    .filter((cell) => cell.disputed || cell.candidates.length > 1)
    .map((cell) => ({
      line,
      column: cell.index,
      candidates: cell.candidates.map((candidate) => candidate.value),
    }));
}

/**
 * Decode two geometry-snapped TD3 lines. Each returned field is either backed
 * by one schema-valid solution or blank.
 */
export function parseTd3FromCells(
  cells1: readonly Cell[],
  cells2: readonly Cell[],
  today = new Date(),
): MrzParseResult | null {
  if (cells1.length !== 44 || cells2.length !== 44) return null;
  const upper = decodeLine1(cells1);
  if (!upper.documentCode.startsWith("P")) return null;
  const lower = decodeLine2(cells2, today);
  const verified = upper.verified && lower.verified;
  const warnings: string[] = [];

  if (!upper.verifiedFields.names) warnings.push("Ad ve soyad tek çözümle doğrulanamadı");
  if (!lower.verifiedFields.passportNumber) warnings.push("Pasaport no doğrulanamadı");
  if (!lower.verifiedFields.birthDate) warnings.push("Doğum tarihi doğrulanamadı");
  if (!lower.verifiedFields.expiryDate) warnings.push("Son geçerlilik tarihi doğrulanamadı");
  if (!lower.verifiedFields.composite) warnings.push("MRZ bileşik kontrolü doğrulanamadı");
  if (!lower.verifiedFields.nationality) warnings.push("Uyruk kodu doğrulanamadı");

  const nationalId = lower.nationality === "TUR" && tcChecksum(lower.personalNumber)
    ? lower.personalNumber
    : "";

  return {
    documentCode: upper.documentCode,
    issuingState: upper.issuingState,
    surname: upper.verifiedFields.names ? upper.surname : "",
    givenNames: upper.verifiedFields.names ? upper.givenNames : "",
    passportNumber: lower.verifiedFields.passportNumber ? lower.passportNumber : "",
    nationality: lower.verifiedFields.nationality ? lower.nationality : "",
    birthDate: lower.verifiedFields.birthDate ? lower.birthDate : "",
    sex: lower.verifiedFields.sex ? lower.sex : "",
    expiryDate: lower.verifiedFields.expiryDate ? lower.expiryDate : "",
    personalNumber: lower.verifiedFields.personalNumber ? lower.personalNumber : "",
    nationalId,
    line1: upper.line,
    line2: lower.line,
    verified,
    valid: verified,
    disputedCells: [...disputes(1, cells1), ...disputes(2, cells2)],
    warnings,
  };
}
