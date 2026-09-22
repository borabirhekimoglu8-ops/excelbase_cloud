import type { OcrLine } from "./ocr/types";
import type { VizWord } from "./vizFields";

function confidence(score: number | null): number {
  if (score == null || !Number.isFinite(score)) return 0;
  return score <= 1 ? score * 100 : score;
}

/** Convert PP-OCR quadrilaterals to the axis-aligned boxes used by VIZ matching. */
export function vizWordsFromOcrLines(lines: readonly OcrLine[]): VizWord[] {
  return lines.flatMap((line) => {
    const points = line.box.filter(
      (point) => point.length >= 2 && Number.isFinite(point[0]) && Number.isFinite(point[1]),
    );
    if (!line.text.trim() || points.length < 2) return [];
    const xs = points.map((point) => point[0]);
    const ys = points.map((point) => point[1]);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    const width = Math.max(...xs) - x;
    const height = Math.max(...ys) - y;
    if (width <= 0 || height <= 0) return [];
    return [{
      text: line.text,
      confidence: confidence(line.score),
      rect: { x, y, width, height },
    }];
  });
}
