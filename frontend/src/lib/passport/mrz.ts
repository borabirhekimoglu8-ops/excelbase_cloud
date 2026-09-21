/**
 * ICAO 9303 TD3 Machine Readable Zone (passport) parsing.
 *
 * Two lines of 44 characters each. Operators photograph the biodata page;
 * OCR returns noisy text, so we hunt for the densest A–Z / 0–9 / < runs and
 * prefer pairs that pass the official check digits.
 */

export type MrzSex = "M" | "F" | "X" | "";

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
  line1: string;
  line2: string;
  /** All mandatory check digits matched. */
  valid: boolean;
  /** Optional notes for the UI (e.g. which check failed). */
  warnings: string[];
};

const WEIGHTS = [7, 3, 1] as const;

function charValue(ch: string): number {
  if (ch >= "0" && ch <= "9") return Number(ch);
  if (ch >= "A" && ch <= "Z") return ch.charCodeAt(0) - 55;
  if (ch === "<") return 0;
  return -1;
}

/** ICAO check digit for a field (or the composite range on line 2). */
export function mrzCheckDigit(field: string): string {
  let sum = 0;
  for (let i = 0; i < field.length; i += 1) {
    const value = charValue(field[i] ?? "<");
    if (value < 0) return "";
    sum += value * WEIGHTS[i % 3];
  }
  return String(sum % 10);
}

function fieldOk(field: string, check: string): boolean {
  if (!check || check === "<") return true;
  const expected = mrzCheckDigit(field);
  return expected !== "" && expected === check;
}

/** YYMMDD → YYYY-MM-DD using a 1950–2049 pivot for the century. */
export function mrzDateToIso(yymmdd: string): string {
  if (!/^\d{6}$/.test(yymmdd)) return "";
  const yy = Number(yymmdd.slice(0, 2));
  const mm = yymmdd.slice(2, 4);
  const dd = yymmdd.slice(4, 6);
  const year = yy >= 50 ? 1900 + yy : 2000 + yy;
  return `${year}-${mm}-${dd}`;
}

function namesFromLine1(line1: string): { surname: string; givenNames: string } {
  const body = line1.slice(5);
  const [rawSurname = "", rawGiven = ""] = body.split("<<");
  const surname = rawSurname.replace(/</g, " ").replace(/\s+/g, " ").trim();
  const givenNames = rawGiven.replace(/</g, " ").replace(/\s+/g, " ").trim();
  return { surname, givenNames };
}

/** Collapse OCR noise into the ICAO alphabet used in the MRZ. */
export function normalizeMrzLine(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[\u00AB\u00BB«»]/g, "<")
    .replace(/[\s|_]/g, "")
    .replace(/[^A-Z0-9<]/g, "")
    .slice(0, 44)
    .padEnd(44, "<");
}

/**
 * Soften common OCR swaps on the digit-heavy second line without touching names.
 * Only applied when the candidate already looks like line 2.
 */
function softenLine2(line: string): string {
  return line
    .replace(/O/g, "0")
    .replace(/I/g, "1")
    .replace(/Z/g, "2")
    .replace(/S/g, "5")
    .replace(/B/g, "8");
}

/** Country / nationality codes are letters — undo digit lookalikes from OCR. */
function softenAlpha3(code: string): string {
  return code
    .replace(/0/g, "O")
    .replace(/1/g, "I")
    .replace(/5/g, "S")
    .replace(/8/g, "B")
    .replace(/2/g, "Z");
}

/**
 * Digit fields (dates + check digits): letter→digit lookalikes.
 * Leaves A–Z passport serial letters alone by operating only on known digit spans.
 */
function softenDigitSpan(span: string): string {
  return span
    .replace(/O/g, "0")
    .replace(/I/g, "1")
    .replace(/Z/g, "2")
    .replace(/S/g, "5")
    .replace(/B/g, "8");
}

export function parseTd3Mrz(line1Raw: string, line2Raw: string): MrzParseResult | null {
  const line1 = normalizeMrzLine(line1Raw);
  let line2 = normalizeMrzLine(line2Raw);
  if (line1.length !== 44 || line2.length !== 44) return null;
  if (!/^P[A-Z<]/.test(line1)) return null;

  // Prefer a softened line 2 when raw checks fail.
  const soft = softenLine2(line2);
  const softBetter = soft !== line2
    && fieldOk(soft.slice(0, 9), soft[9] ?? "")
    && !fieldOk(line2.slice(0, 9), line2[9] ?? "");
  if (softBetter) line2 = soft;

  // Repair digit spans in-place when check digits prefer the softened form.
  const birthCandidate = softenDigitSpan(line2.slice(13, 19));
  const birthCheckChar = softenDigitSpan(line2[19] ?? "");
  if (
    birthCandidate !== line2.slice(13, 19)
    && fieldOk(birthCandidate, birthCheckChar)
    && !fieldOk(line2.slice(13, 19), line2[19] ?? "")
  ) {
    line2 = `${line2.slice(0, 13)}${birthCandidate}${birthCheckChar}${line2.slice(20)}`;
  }
  const expiryCandidate = softenDigitSpan(line2.slice(21, 27));
  const expiryCheckChar = softenDigitSpan(line2[27] ?? "");
  if (
    expiryCandidate !== line2.slice(21, 27)
    && fieldOk(expiryCandidate, expiryCheckChar)
    && !fieldOk(line2.slice(21, 27), line2[27] ?? "")
  ) {
    line2 = `${line2.slice(0, 21)}${expiryCandidate}${expiryCheckChar}${line2.slice(28)}`;
  }

  const warnings: string[] = [];
  const documentCode = line1.slice(0, 2).replace(/</g, "");
  const issuingState = softenAlpha3(line1.slice(2, 5).replace(/</g, ""));
  const { surname, givenNames } = namesFromLine1(line1);

  const passportNumber = line2.slice(0, 9).replace(/</g, "").trim();
  const passportCheck = line2[9] ?? "";
  const nationality = softenAlpha3(line2.slice(10, 13).replace(/</g, ""));
  const birthRaw = line2.slice(13, 19);
  const birthCheck = line2[19] ?? "";
  const sexChar = line2[20] ?? "<";
  const expiryRaw = line2.slice(21, 27);
  const expiryCheck = line2[27] ?? "";
  const personalNumber = line2.slice(28, 42).replace(/</g, "").trim();
  const personalCheck = line2[42] ?? "";
  const compositeCheck = line2[43] ?? "";

  if (!fieldOk(line2.slice(0, 9), passportCheck)) warnings.push("Pasaport no kontrol hanesi uyuşmadı");
  if (!fieldOk(birthRaw, birthCheck)) warnings.push("Doğum tarihi kontrol hanesi uyuşmadı");
  if (!fieldOk(expiryRaw, expiryCheck)) warnings.push("Son geçerlilik kontrol hanesi uyuşmadı");
  if (!fieldOk(line2.slice(28, 42), personalCheck) && personalNumber) {
    warnings.push("Kişisel numara kontrol hanesi uyuşmadı");
  }
  const composite = `${line2.slice(0, 10)}${line2.slice(13, 20)}${line2.slice(21, 43)}`;
  if (!fieldOk(composite, compositeCheck)) warnings.push("Satır bileşik kontrol hanesi uyuşmadı");

  const sex: MrzSex = sexChar === "M" || sexChar === "F" ? sexChar : sexChar === "<" ? "X" : "";

  return {
    documentCode,
    issuingState,
    surname,
    givenNames,
    passportNumber,
    nationality,
    birthDate: mrzDateToIso(birthRaw),
    sex,
    expiryDate: mrzDateToIso(expiryRaw),
    personalNumber,
    line1,
    line2,
    valid: warnings.length === 0 && Boolean(passportNumber && surname),
    warnings,
  };
}

/**
 * Pull the best TD3 pair out of free OCR text.
 *
 * Returns null when nothing looks like a passport MRZ.
 */
export function extractTd3FromOcrText(text: string): MrzParseResult | null {
  const candidates = text
    .toUpperCase()
    .split(/\r?\n/)
    .map((line) => line.replace(/[^A-Z0-9<\s]/g, "").replace(/\s+/g, ""))
    .filter((line) => line.length >= 28);

  const scored: string[] = [];
  for (const line of candidates) {
    if (line.length === 44) {
      scored.push(line);
      continue;
    }
    if (line.length > 44) {
      // Sliding window — OCR often prefixes a stray digit/letter before the MRZ.
      for (let i = 0; i <= line.length - 44; i += 1) {
        scored.push(line.slice(i, i + 44));
      }
      continue;
    }
    if (line.length >= 38) scored.push(line.padEnd(44, "<"));
  }

  // Also hunt P<… and digit-heavy runs inside the flattened blob (phones often
  // glue both MRZ lines into one OCR line).
  const flat = text.toUpperCase().replace(/[^A-Z0-9<]/g, "");
  for (let i = 0; i <= flat.length - 44; i += 1) {
    const slice = flat.slice(i, i + 44);
    if (/^P[A-Z<]/.test(slice) || /[0-9].*[0-9]/.test(slice)) {
      scored.push(slice);
    }
  }

  const line1s = scored.filter((line) => /^P[A-Z<]/.test(line));
  const line2s = scored.filter((line) => /[0-9]/.test(line) && !/^P[A-Z<]/.test(line));

  let best: MrzParseResult | null = null;
  for (const first of line1s) {
    for (const second of line2s) {
      if (first === second) continue;
      const parsed = parseTd3Mrz(first, second);
      if (!parsed) continue;
      if (!best || (parsed.valid && !best.valid) || parsed.warnings.length < best.warnings.length) {
        best = parsed;
      }
      if (parsed.valid) return parsed;
    }
  }

  for (let i = 0; i < candidates.length - 1; i += 1) {
    const a = candidates[i].padEnd(44, "<").slice(0, 44);
    const b = candidates[i + 1].padEnd(44, "<").slice(0, 44);
    const parsed = parseTd3Mrz(a, b);
    if (!parsed) continue;
    if (!best || (parsed.valid && !best.valid)) best = parsed;
    if (parsed.valid) return parsed;
  }

  return best;
}
