import { icaoCountryToIso2 } from "./icaoCountries";
import type { DisputedMrzCell, MrzParseResult } from "./mrz";
import type { VisualHint } from "./visualHints";

export const PASSPORT_FIELD_NAMES = [
  "surname",
  "givenNames",
  "passportNo",
  "birthDate",
  "expiryDate",
  "nationality",
  "countryCode2",
  "sex",
  "tcNo",
  "documentType",
] as const;

export type PassportFieldName = (typeof PASSPORT_FIELD_NAMES)[number];
export type FieldSource = "mrz" | "visual" | "user" | "";
export type FieldValidation = "verified" | "unverified" | "invalid" | "missing";
export type CandidateStatus = "processing" | "review" | "conflict" | "user-approved" | "rejected";

export type FieldValue = {
  raw: string;
  normalized: string;
  source: FieldSource;
  validation: FieldValidation;
  engine_score: number | null;
  box: number[][] | null;
  page_id: string;
};

export type PassportCandidate = {
  entity_type: "passport_candidate";
  schema_version: 1;
  id: string;
  job_id: string;
  page_id: string;
  index_on_page: number;
  status: CandidateStatus;
  auto_pass: boolean;
  fields: Record<PassportFieldName, FieldValue>;
  mrz: {
    line1: string;
    line2: string;
    disputed: DisputedMrzCell[];
    warnings: string[];
  } | null;
  visual_hints: VisualHint[];
  possible_duplicate_of: string[];
  approved_at: string;
  approved_by: string;
  exported_at: string;
  created_at: string;
  updated_at: string;
};

const REQUIRED: PassportFieldName[] = [
  "surname",
  "givenNames",
  "passportNo",
  "countryCode2",
  "birthDate",
  "expiryDate",
  "documentType",
];

function emptyField(pageId: string): FieldValue {
  return {
    raw: "",
    normalized: "",
    source: "",
    validation: "missing",
    engine_score: null,
    box: null,
    page_id: pageId,
  };
}

function fieldFrom(raw: string, source: FieldSource, pageId: string, validation: FieldValidation, score: number | null, box: number[][] | null): FieldValue {
  return {
    raw,
    normalized: raw.trim(),
    source,
    validation: raw.trim() ? validation : "missing",
    engine_score: score,
    box,
    page_id: pageId,
  };
}

export function emptyFields(pageId: string): Record<PassportFieldName, FieldValue> {
  return Object.fromEntries(PASSPORT_FIELD_NAMES.map((name) => [name, emptyField(pageId)])) as Record<PassportFieldName, FieldValue>;
}

export function requiredComplete(fields: Record<PassportFieldName, FieldValue>): boolean {
  return REQUIRED.every((name) => {
    const value = fields[name].normalized.trim();
    if (name === "countryCode2") return icaoCountryToIso2(value).length === 2 || value.length === 2;
    return Boolean(value);
  });
}

export function normalizePassportNo(value: string): string {
  return value.trim().toLocaleUpperCase("tr-TR").replace(/\s+/g, "");
}

export function fieldsConflict(fields: Record<PassportFieldName, FieldValue>, hints: VisualHint[]): boolean {
  return hints.some((hint) => {
    const current = fields[hint.field];
    if (!current?.normalized || current.source !== "mrz") return false;
    const left = hint.field === "passportNo" ? normalizePassportNo(current.normalized) : current.normalized.toUpperCase();
    const right = hint.field === "passportNo" ? normalizePassportNo(hint.value) : hint.value.trim().toUpperCase();
    return Boolean(right) && left !== right;
  });
}

export function candidateStatus(
  fields: Record<PassportFieldName, FieldValue>,
  hints: VisualHint[],
  pairCountOnPage: number,
): { status: CandidateStatus; auto_pass: boolean } {
  const conflict = fieldsConflict(fields, hints) || pairCountOnPage !== 1;
  const auto = Boolean(fields.surname.source === "mrz" && fields.passportNo.validation === "verified" && requiredComplete(fields) && !fieldsConflict(fields, hints) && pairCountOnPage === 1);
  if (conflict && pairCountOnPage !== 1) return { status: "review", auto_pass: false };
  if (fieldsConflict(fields, hints)) return { status: "conflict", auto_pass: false };
  return { status: "review", auto_pass: auto };
}

export function fieldsFromMrz(
  parsed: MrzParseResult,
  pageId: string,
  score: number | null,
  box: number[][] | null,
): Record<PassportFieldName, FieldValue> {
  const verified = parsed.verified ? "verified" : "unverified";
  const country = icaoCountryToIso2(parsed.nationality);
  return {
    surname: fieldFrom(parsed.surname, "mrz", pageId, parsed.surname ? verified : "missing", score, box),
    givenNames: fieldFrom(parsed.givenNames, "mrz", pageId, parsed.givenNames ? verified : "missing", score, box),
    passportNo: fieldFrom(parsed.passportNumber, "mrz", pageId, parsed.passportNumber ? verified : "missing", score, box),
    birthDate: fieldFrom(parsed.birthDate, "mrz", pageId, parsed.birthDate ? verified : "missing", score, box),
    expiryDate: fieldFrom(parsed.expiryDate, "mrz", pageId, parsed.expiryDate ? verified : "missing", score, box),
    nationality: fieldFrom(parsed.nationality, "mrz", pageId, parsed.nationality ? verified : "missing", score, box),
    countryCode2: fieldFrom(country, "mrz", pageId, country.length === 2 ? verified : "missing", score, box),
    sex: fieldFrom(parsed.sex, "mrz", pageId, parsed.sex ? verified : "missing", score, box),
    tcNo: fieldFrom(parsed.nationalId, "mrz", pageId, parsed.nationalId ? "verified" : "missing", score, box),
    documentType: fieldFrom("Passport", "mrz", pageId, "verified", score, box),
  };
}

export function applyUserField(
  fields: Record<PassportFieldName, FieldValue>,
  name: PassportFieldName,
  value: string,
  pageId: string,
): Record<PassportFieldName, FieldValue> {
  const normalized = name === "countryCode2"
    ? value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 2)
    : name === "tcNo"
      ? value.replace(/\D/g, "").slice(0, 11)
      : name === "passportNo"
        ? value.toLocaleUpperCase("tr-TR")
        : value;
  return {
    ...fields,
    [name]: fieldFrom(normalized, "user", pageId, normalized.trim() ? "unverified" : "missing", null, fields[name].box),
  };
}

export function possibleDuplicates(
  candidate: Pick<PassportCandidate, "id" | "fields">,
  others: Array<Pick<PassportCandidate, "id" | "fields">>,
): string[] {
  const passport = normalizePassportNo(candidate.fields.passportNo.normalized);
  if (!passport || candidate.fields.passportNo.validation === "missing") return [];
  const weak = candidate.fields.passportNo.validation !== "verified";
  return others
    .filter((other) => other.id !== candidate.id && normalizePassportNo(other.fields.passportNo.normalized) === passport)
    .map((other) => (weak ? `weak:${other.id}` : other.id));
}

export function exportExclusionReason(candidate: PassportCandidate): string | null {
  if (candidate.status === "rejected") return "Reddedildi";
  if (candidate.status !== "user-approved") return "Kullanıcı onayı yok";
  if (!requiredComplete(candidate.fields)) return "Zorunlu alan eksik";
  return null;
}
