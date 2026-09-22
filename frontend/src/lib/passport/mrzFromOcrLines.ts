import { parseTd3FromLines, type MrzParseResult } from "./mrz";
import type { OcrLine } from "./ocr/types";

export type MrzOcrPair = {
  line1: string;
  line2: string;
  rawLine1: string;
  rawLine2: string;
  box: number[][] | null;
  score: number | null;
  parsed: MrzParseResult;
};

function compactMrz(text: string): string {
  return text
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[«‹»›]/g, "<")
    .replace(/[^A-Z0-9<]/g, "");
}

function isUpperLine(value: string): boolean {
  return value.length >= 40 && value.length <= 48 && /^P[A-Z<]/.test(value);
}

function isLowerLine(value: string): boolean {
  return value.length >= 40 && value.length <= 48 && /^[A-Z0-9<]+$/.test(value) && /\d/.test(value) && !value.startsWith("P<") && !value.startsWith("PA") && !value.startsWith("PO");
}

function tryParse(line1: string, line2: string): MrzParseResult | null {
  if (line1.length === 44 && line2.length === 44) {
    return parseTd3FromLines(line1, line2);
  }
  return null;
}

/** Length repair only — no whole-string O/0 substitution. */
export function repairTd3Length(value: string): string[] {
  const compact = compactMrz(value);
  if (compact.length === 44) return [compact];
  const candidates: string[] = [];
  if (compact.length === 43) {
    candidates.push(`${compact}<`);
    candidates.push(`<${compact}`);
  }
  if (compact.length === 45) {
    candidates.push(compact.slice(0, 44));
    candidates.push(compact.slice(1));
  }
  return candidates;
}

function pairScore(first: OcrLine, second: OcrLine): number | null {
  const scores = [first.score, second.score].filter((value): value is number => typeof value === "number");
  if (!scores.length) return null;
  return scores.reduce((sum, value) => sum + value, 0) / scores.length;
}

export function pairsFromOcrLines(lines: readonly OcrLine[]): MrzOcrPair[] {
  const prepared = lines.map((line) => ({ line, compact: compactMrz(line.text) }));
  const uppers = prepared.filter((item) => isUpperLine(item.compact));
  const lowers = prepared.filter((item) => isLowerLine(item.compact));
  const used = new Set<number>();
  const pairs: MrzOcrPair[] = [];

  for (const upper of uppers) {
    const lowerIndex = lowers.findIndex((item, index) => !used.has(index));
    if (lowerIndex < 0) continue;
    const lower = lowers[lowerIndex];
    const upperChoices = repairTd3Length(upper.compact);
    const lowerChoices = repairTd3Length(lower.compact);
    let parsed: MrzParseResult | null = null;
    let line1 = "";
    let line2 = "";
    for (const first of upperChoices) {
      for (const second of lowerChoices) {
        const attempt = tryParse(first, second);
        if (!attempt) continue;
        parsed = attempt;
        line1 = first;
        line2 = second;
        if (attempt.verified) break;
      }
      if (parsed?.verified) break;
    }
    if (!parsed) continue;
    used.add(lowerIndex);
    pairs.push({
      line1,
      line2,
      rawLine1: upper.line.text,
      rawLine2: lower.line.text,
      box: upper.line.box.length ? upper.line.box : lower.line.box,
      score: pairScore(upper.line, lower.line),
      parsed,
    });
  }
  return pairs;
}

export function mrzLikeLineCount(lines: readonly OcrLine[]): number {
  return lines.filter((line) => {
    const compact = compactMrz(line.text);
    return isUpperLine(compact) || isLowerLine(compact);
  }).length;
}
