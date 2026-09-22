import type { OcrLine } from "./ocr/types";
import type { PassportFieldName } from "./candidates";

export type VisualHint = {
  field: PassportFieldName;
  value: string;
  box: number[][];
  score: number | null;
};

const DATE = /\b(\d{2})[./-](\d{2})[./-](\d{4})\b/;
const PASSPORT = /\b([A-Z][A-Z0-9]{6,8})\b/;

function isoFromDisplay(day: string, month: string, year: string): string {
  return `${year}-${month}-${day}`;
}

function nearbyLabel(lines: readonly OcrLine[], index: number, labels: string[]): boolean {
  const window = lines.slice(Math.max(0, index - 2), index + 1);
  return window.some((line) => labels.some((label) => line.text.toUpperCase().includes(label)));
}

/** Suggestions only. Never auto-fill a candidate field. */
export function visualHintsFromLines(lines: readonly OcrLine[]): VisualHint[] {
  const hints: VisualHint[] = [];
  lines.forEach((line, index) => {
    const text = line.text.toUpperCase();
    const date = DATE.exec(text);
    if (date) {
      const iso = isoFromDisplay(date[1], date[2], date[3]);
      const birth = nearbyLabel(lines, index, ["BIRTH", "DOB", "DOĞUM", "DOGUM"]);
      const expiry = nearbyLabel(lines, index, ["EXPIR", "VALID", "BİTİŞ", "BITIS", "SON"]);
      if (birth) hints.push({ field: "birthDate", value: iso, box: line.box, score: line.score });
      else if (expiry) hints.push({ field: "expiryDate", value: iso, box: line.box, score: line.score });
    }
    if (nearbyLabel(lines, index, ["PASSPORT NO", "PASSPORT", "PASAPORT"])) {
      const match = PASSPORT.exec(text.replace(/PASSPORT|PASAPORT|NO/g, " "));
      if (match) hints.push({ field: "passportNo", value: match[1], box: line.box, score: line.score });
    }
    if (nearbyLabel(lines, index, ["SURNAME", "SOYADI", "SOYAD"])) {
      const value = text.replace(/SURNAME|SOYADI|SOYAD|[:]/g, "").trim();
      if (value && !DATE.test(value)) hints.push({ field: "surname", value, box: line.box, score: line.score });
    }
    if (nearbyLabel(lines, index, ["GIVEN", "ADI", "NAME"]) && !text.includes("SURNAME")) {
      const value = text.replace(/GIVEN NAMES?|GIVEN|ADI|NAME|[:]/g, "").trim();
      if (value && !DATE.test(value)) hints.push({ field: "givenNames", value, box: line.box, score: line.score });
    }
  });
  return hints;
}
