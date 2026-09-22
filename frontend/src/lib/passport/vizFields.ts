import type { FieldProvenance, PassportFieldName, SourceRect } from "./passportTypes";

export type VizWord = {
  text: string;
  confidence: number;
  rect: SourceRect;
};

export type VizField = {
  value: string;
  rect: SourceRect;
  confidence: number;
  provenance: FieldProvenance;
};

export type VizExtraction = Partial<Record<PassportFieldName, VizField>> & {
  nationalityHint?: VizField;
};

type MatchField = PassportFieldName | "nationalityHint";
type LabelRule = { field: MatchField; labels: string[] };

const RULES: LabelRule[] = [
  { field: "lastName", labels: ["surname", "soyadı", "soyadi", "nom"] },
  { field: "firstName", labels: ["given names", "given name", "adları", "adlari", "adı", "adi", "prénoms"] },
  { field: "passportNo", labels: ["passport no", "passport number", "pasaport no", "document no"] },
  { field: "birthDate", labels: ["date of birth", "doğum tarihi", "dogum tarihi"] },
  { field: "expiryDate", labels: ["date of expiry", "expiry date", "geçerlilik tarihi", "gecerlilik tarihi"] },
  { field: "nationalityHint", labels: ["nationality", "uyruğu", "uyrugu"] },
];

function fold(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function unionRect(words: readonly VizWord[]): SourceRect {
  const x = Math.min(...words.map((word) => word.rect.x));
  const y = Math.min(...words.map((word) => word.rect.y));
  const right = Math.max(...words.map((word) => word.rect.x + word.rect.width));
  const bottom = Math.max(...words.map((word) => word.rect.y + word.rect.height));
  return { x, y, width: right - x, height: bottom - y };
}

function sameLine(left: SourceRect, right: SourceRect): boolean {
  const leftMiddle = left.y + left.height / 2;
  const rightMiddle = right.y + right.height / 2;
  return Math.abs(leftMiddle - rightMiddle) <= Math.max(left.height, right.height) * 0.7;
}

function validDate(value: string): string {
  const normalized = value.trim().replace(/[/-]/g, ".");
  const match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(normalized);
  if (!match) return "";
  const [, day, month, year] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return date.getUTCFullYear() === Number(year)
    && date.getUTCMonth() === Number(month) - 1
    && date.getUTCDate() === Number(day)
    ? `${year}-${month}-${day}`
    : "";
}

function gate(field: MatchField, raw: string): string {
  const value = raw.trim().replace(/\s+/g, " ");
  if (field === "birthDate" || field === "expiryDate") return validDate(value);
  if (field === "passportNo") {
    const compact = value.toUpperCase().replace(/\s/g, "");
    return /^(?=.*[A-Z])(?=.*\d)[A-Z0-9]{6,12}$/.test(compact) ? compact : "";
  }
  if (field === "firstName" || field === "lastName") {
    return /^[\p{L}][\p{L}' -]{1,49}$/u.test(value) && !/\d/.test(value)
      ? value.toLocaleUpperCase("tr-TR")
      : "";
  }
  // Nationality is deliberately retained as an untrusted visual hint.
  return /^[\p{L}][\p{L} .'-]{1,39}$/u.test(value)
    ? value.toLocaleUpperCase("tr-TR")
    : "";
}

function valueWordsAfterLabel(words: readonly VizWord[], labelWords: readonly VizWord[]): VizWord[] {
  const labelRect = unionRect(labelWords);
  const right = words
    .filter((word) => word.rect.x >= labelRect.x + labelRect.width - 2 && sameLine(labelRect, word.rect))
    .sort((a, b) => a.rect.x - b.rect.x)
    .slice(0, 4);
  if (right.length) return right;

  const below = words
    .filter((word) => word.rect.y >= labelRect.y + labelRect.height - 2)
    .sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x);
  if (!below.length) return [];
  const first = below[0];
  return below.filter((word) => sameLine(first.rect, word.rect)).slice(0, 4);
}

/**
 * Extract only values anchored to explicit VIZ labels. No unlabelled token is
 * promoted to a passport field.
 */
export function matchVizFields(words: readonly VizWord[], pageNo = 1): VizExtraction {
  const ordered = [...words]
    .filter((word) => word.text.trim() && word.confidence >= 45)
    .sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x);
  const output: VizExtraction = {};

  for (const rule of RULES) {
    if (output[rule.field as keyof VizExtraction]) continue;
    for (const label of rule.labels) {
      const parts = fold(label).split(" ");
      let matched: VizWord[] | null = null;
      for (let index = 0; index <= ordered.length - parts.length; index += 1) {
        const candidate = ordered.slice(index, index + parts.length);
        if (
          candidate.every((word, offset) => fold(word.text) === parts[offset])
          && candidate.every((word) => sameLine(candidate[0].rect, word.rect))
        ) {
          matched = candidate;
          break;
        }
      }
      if (!matched) continue;
      const valueWords = valueWordsAfterLabel(
        ordered.filter((word) => !matched?.includes(word)),
        matched,
      );
      for (let count = valueWords.length; count > 0; count -= 1) {
        const selected = valueWords.slice(0, count);
        const value = gate(rule.field, selected.map((word) => word.text).join(" "));
        if (!value) continue;
        const field: VizField = {
          value,
          rect: unionRect(selected),
          confidence: Math.min(...selected.map((word) => word.confidence)),
          provenance: {
            source: "viz",
            verification: "visual_draft",
            pageNo,
            rect: unionRect(selected),
          },
        };
        if (rule.field === "nationalityHint") output.nationalityHint = field;
        else output[rule.field] = field;
        break;
      }
      if (output[rule.field as keyof VizExtraction]) break;
    }
  }
  return output;
}
