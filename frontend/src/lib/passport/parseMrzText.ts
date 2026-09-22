import { icaoCountryToIso2, isSpecialNationality } from "./icaoCountries";
import { parseTd3FromLines, type MrzParseResult } from "./mrz";
import {
  DOCUMENT_TYPES,
  PASSPORT_SCHEMA_VERSION,
  deriveReviewStatus,
  type FieldProvenance,
  type PassportDocumentType,
  type PassportFieldName,
  type PassportScanRow,
  type PassportScanStatus,
} from "./passportTypes";

export {
  DOCUMENT_TYPES,
  type PassportDocumentType,
  type PassportScanRow,
  type PassportScanStatus,
} from "./passportTypes";

export type Td3TextLines = {
  line1: string;
  line2: string;
};

type Candidate = {
  value: string;
  position: number;
};

function candidateRuns(text: string): Array<{ value: string; position: number }> {
  const normalized = text
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[«‹]/g, "<")
    .replace(/\r\n?/g, "\n");
  const output: Array<{ value: string; position: number }> = [];
  let position = 0;

  for (const physicalLine of normalized.split("\n")) {
    const compact = physicalLine.replace(/\s/g, "");
    for (const match of compact.matchAll(/[A-Z0-9<]{44,}/g)) {
      output.push({ value: match[0], position });
      position += match[0].length + 1;
    }
    position += 1;
  }
  return output;
}

function lineCandidates(text: string): { upper: Candidate[]; lower: Candidate[] } {
  const upper: Candidate[] = [];
  const lower: Candidate[] = [];

  for (const run of candidateRuns(text)) {
    for (let offset = 0; offset <= run.value.length - 44; offset += 1) {
      const value = run.value.slice(offset, offset + 44);
      const position = run.position + offset;
      if (/^P[A-Z<][A-Z]{3}[A-Z<]{39}$/.test(value)) {
        upper.push({ value, position });
      }
      if (/^[A-Z0-9<]{9}\d[A-Z]{3}\d{6}\d[MF<]\d{6}\d[A-Z0-9<]{14}[0-9<]\d$/.test(value)) {
        lower.push({ value, position });
      }
    }
  }
  return { upper, lower };
}

function allTd3Lines(text: string): Td3TextLines[] {
  const { upper, lower } = lineCandidates(text);
  const pairs: Td3TextLines[] = [];
  const usedLower = new Set<number>();
  const seen = new Set<string>();

  for (const first of upper) {
    const secondIndex = lower.findIndex(
      (candidate, index) => !usedLower.has(index) && candidate.position > first.position,
    );
    if (secondIndex < 0) continue;
    const second = lower[secondIndex];
    const parsed = parseTd3FromLines(first.value, second.value);
    if (!parsed) continue;
    const key = `${first.value}\n${second.value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    usedLower.add(secondIndex);
    pairs.push({ line1: first.value, line2: second.value });
  }
  return pairs;
}

/** Find the first TD3 pair in copied text while tolerating whitespace between characters. */
export function extractTd3LinesFromPlainText(text: string): Td3TextLines | null {
  return allTd3Lines(text)[0] ?? null;
}

function newId(): string {
  return `ps-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

type ParsedRowOptions = {
  previewUrl?: string;
  batchId?: string;
  pageNo?: number;
};

function mrzProvenance(mrz: MrzParseResult, pageNo: number): PassportScanRow["provenance"] {
  const output: Partial<Record<PassportFieldName, FieldProvenance>> = {};
  const set = (field: PassportFieldName, value: string) => {
    if (value) output[field] = { source: "mrz", verification: "mrz_verified", pageNo };
  };
  set("firstName", mrz.givenNames);
  set("lastName", mrz.surname);
  set("passportNo", mrz.passportNumber);
  set("nationality", mrz.nationality);
  set("birthDate", mrz.birthDate);
  set("sex", mrz.sex);
  set("expiryDate", mrz.expiryDate);
  set("tcNo", mrz.nationalId);
  return output;
}

export function rowFromParsedMrz(
  sourceLabel: string,
  mrz: MrzParseResult | null,
  options: ParsedRowOptions = {},
): PassportScanRow {
  const pageNo = options.pageNo ?? 1;
  const status: PassportScanStatus = !mrz ? "failed" : mrz.verified ? "ok" : "weak";
  const provenance = mrz ? mrzProvenance(mrz, pageNo) : {};
  const row: PassportScanRow = {
    schema_version: PASSPORT_SCHEMA_VERSION,
    id: newId(),
    filename: sourceLabel,
    previewUrl: options.previewUrl ?? "",
    batchId: options.batchId ?? `text-${Date.now().toString(36)}`,
    pageNo,
    firstName: mrz?.givenNames ?? "",
    lastName: mrz?.surname ?? "",
    passportNo: mrz?.passportNumber ?? "",
    countryCode2: icaoCountryToIso2(mrz?.nationality ?? ""),
    nationality: mrz?.nationality ?? "",
    nationalitySpecial: isSpecialNationality(mrz?.nationality ?? ""),
    issuingState: mrz?.issuingState ?? "",
    birthDate: mrz?.birthDate ?? "",
    sex: mrz?.sex ?? "",
    expiryDate: mrz?.expiryDate ?? "",
    tcNo: mrz?.nationality === "TUR" ? mrz.nationalId : "",
    documentType: "Passport",
    status,
    reviewStatus: "failed",
    provenance,
    warnings: mrz?.warnings ?? ["MRZ okunamadı — görsel alanlar operatör kontrolü gerektirir"],
    mrzLine1: mrz?.line1 ?? "",
    mrzLine2: mrz?.line2 ?? "",
  };
  row.reviewStatus = deriveReviewStatus(row);
  return row;
}

/** Convert every TD3 pair found in pasted or PDF text into editable operator rows. */
export function rowsFromMrzText(text: string, sourceLabel: string): PassportScanRow[] {
  return allTd3Lines(text).flatMap((lines, index, found) => {
    const parsed = parseTd3FromLines(lines.line1, lines.line2);
    if (!parsed) return [];
    const label = found.length > 1 ? `${sourceLabel} · ${index + 1}` : sourceLabel;
    return [rowFromParsedMrz(label, parsed, { pageNo: index + 1 })];
  });
}
