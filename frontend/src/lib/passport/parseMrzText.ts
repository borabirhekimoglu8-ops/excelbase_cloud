import { icaoCountryToIso2 } from "./icaoCountries";
import { parseTd3FromLines, type MrzParseResult } from "./mrz";

export type PassportScanStatus = "ok" | "weak";

export const DOCUMENT_TYPES = ["Passport", "ID CARD"] as const;
export type PassportDocumentType = (typeof DOCUMENT_TYPES)[number];

export type PassportScanRow = {
  id: string;
  filename: string;
  firstName: string;
  lastName: string;
  passportNo: string;
  countryCode2: string;
  nationality: string;
  birthDate: string;
  sex: string;
  expiryDate: string;
  tcNo: string;
  documentType: PassportDocumentType;
  status: PassportScanStatus;
  warnings: string[];
  mrzLine1: string;
  mrzLine2: string;
};

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

export function allTd3Lines(text: string): Td3TextLines[] {
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

function rowFromMrz(sourceLabel: string, mrz: MrzParseResult): PassportScanRow {
  return {
    id: newId(),
    filename: sourceLabel,
    firstName: mrz.givenNames,
    lastName: mrz.surname,
    passportNo: mrz.passportNumber,
    countryCode2: icaoCountryToIso2(mrz.nationality),
    nationality: mrz.nationality,
    birthDate: mrz.birthDate,
    sex: mrz.sex,
    expiryDate: mrz.expiryDate,
    tcNo: mrz.nationality === "TUR" ? mrz.nationalId : "",
    documentType: "Passport",
    status: mrz.verified ? "ok" : "weak",
    warnings: mrz.warnings,
    mrzLine1: mrz.line1,
    mrzLine2: mrz.line2,
  };
}

/** Convert every TD3 pair found in pasted or PDF text into editable operator rows. */
export function rowsFromMrzText(text: string, sourceLabel: string): PassportScanRow[] {
  return allTd3Lines(text).flatMap((lines, index, found) => {
    const parsed = parseTd3FromLines(lines.line1, lines.line2);
    if (!parsed) return [];
    const label = found.length > 1 ? `${sourceLabel} · ${index + 1}` : sourceLabel;
    return [rowFromMrz(label, parsed)];
  });
}
