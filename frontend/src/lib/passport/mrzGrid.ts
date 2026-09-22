export type OcrSymbol = {
  text: string;
  confidence: number;
  bbox: {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
  };
  pass?: string;
};

export type CellCandidate = {
  value: string;
  confidence: number;
  passes: string[];
};

export type Cell = {
  index: number;
  x0: number;
  x1: number;
  candidates: CellCandidate[];
  disputed: boolean;
};

export type GridFit = {
  origin: number;
  pitch: number;
  columns: number;
  residual: number;
};

function centre(symbol: OcrSymbol): number {
  return (symbol.bbox.x0 + symbol.bbox.x1) / 2;
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = values.toSorted((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function printableSymbols(symbols: readonly OcrSymbol[]): OcrSymbol[] {
  return symbols
    .filter((symbol) => (
      /^[A-Z0-9<]$/i.test(symbol.text)
      && Number.isFinite(symbol.bbox.x0)
      && Number.isFinite(symbol.bbox.x1)
      && symbol.bbox.x1 > symbol.bbox.x0
    ))
    .toSorted((left, right) => centre(left) - centre(right));
}

/**
 * Fit a fixed-pitch 44-cell lattice to OCR symbol geometry.
 *
 * Character order is never used as a cell index. A missing chevron therefore
 * leaves one empty cell instead of shifting every character after it.
 */
export function fitGrid(
  symbols: readonly OcrSymbol[],
  columns = 44,
  canvasWidth?: number,
): GridFit | null {
  const ordered = printableSymbols(symbols);
  if (ordered.length < 2 || columns < 2) return null;

  const widths = ordered.map((symbol) => symbol.bbox.x1 - symbol.bbox.x0);
  const typicalWidth = median(widths);
  if (!(typicalWidth > 0)) return null;

  const centres = ordered.map(centre);
  const pitchCandidates = new Set<number>();
  if (canvasWidth && canvasWidth > 0) {
    // lineCanvas reserves roughly one cell of horizontal padding in total.
    for (const divisor of [columns, columns + 0.5, columns + 1, columns + 1.5]) {
      pitchCandidates.add(canvasWidth / divisor);
    }
  }

  for (let left = 0; left < centres.length; left += 1) {
    for (let right = left + 1; right < Math.min(centres.length, left + 9); right += 1) {
      const distance = centres[right] - centres[left];
      for (let cells = 1; cells <= Math.min(columns - 1, right - left + 5); cells += 1) {
        const pitch = distance / cells;
        if (pitch >= typicalWidth * 0.82 && pitch <= typicalWidth * 2.8) {
          pitchCandidates.add(pitch);
        }
      }
    }
  }

  let best: GridFit | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const pitch of pitchCandidates) {
    if (!(pitch > 0)) continue;
    const relative = centres.map((x) => Math.round((x - centres[0]) / pitch));
    const maximumIndex = Math.max(...relative);
    if (maximumIndex >= columns) continue;

    const unique = new Set(relative).size;
    const duplicatePenalty = (relative.length - unique) * 2;
    const offsets = centres.map((x, index) => x - relative[index] * pitch);
    const origin = median(offsets);
    const residual = Math.sqrt(
      centres.reduce((sum, x, index) => (
        sum + (x - (origin + relative[index] * pitch)) ** 2
      ), 0) / centres.length,
    ) / pitch;
    const widthRatio = typicalWidth / pitch;
    const widthPenalty = widthRatio < 0.42 || widthRatio > 1.12
      ? 2
      : Math.abs(widthRatio - 0.72) * 0.08;
    const pagePitch = canvasWidth ? canvasWidth / (columns + 1) : pitch;
    const pagePenalty = canvasWidth ? Math.abs(pitch - pagePitch) / pagePitch * 0.12 : 0;
    const score = residual + duplicatePenalty + widthPenalty + pagePenalty;

    if (score < bestScore) {
      bestScore = score;
      best = { origin, pitch, columns, residual };
    }
  }

  if (!best || best.residual > 0.34) return null;
  return best;
}

/**
 * Snap one OCR pass to the fitted lattice. Symbols that land between cells are
 * discarded; inserting or deleting cells is deliberately impossible.
 */
export function snapToCells(
  symbols: readonly OcrSymbol[],
  grid: GridFit,
  alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<",
  pass = "ocr",
): Cell[] {
  const allowed = new Set(alphabet);
  const buckets = Array.from({ length: grid.columns }, () => new Map<string, CellCandidate>());

  for (const symbol of printableSymbols(symbols)) {
    const value = symbol.text.toUpperCase();
    if (!allowed.has(value)) continue;
    const position = (centre(symbol) - grid.origin) / grid.pitch;
    const index = Math.round(position);
    if (index < 0 || index >= grid.columns || Math.abs(position - index) > 0.46) continue;
    const source = symbol.pass ?? pass;
    const previous = buckets[index].get(value);
    if (!previous) {
      buckets[index].set(value, {
        value,
        confidence: Math.max(0, symbol.confidence),
        passes: [source],
      });
    } else {
      previous.confidence = Math.max(previous.confidence, symbol.confidence);
      if (!previous.passes.includes(source)) previous.passes.push(source);
    }
  }

  return buckets.map((bucket, index) => {
    const candidates = [...bucket.values()]
      .toSorted((left, right) => (
        right.passes.length - left.passes.length || right.confidence - left.confidence
      ));
    return {
      index,
      x0: grid.origin + (index - 0.5) * grid.pitch,
      x1: grid.origin + (index + 0.5) * grid.pitch,
      candidates,
      disputed: candidates.length > 1,
    };
  });
}

/** Merge geometry-aligned OCR passes without choosing between disagreements. */
export function mergePasses(...passes: readonly Cell[][]): Cell[] {
  const columns = Math.max(0, ...passes.map((cells) => cells.length));
  const output: Cell[] = [];

  for (let index = 0; index < columns; index += 1) {
    const merged = new Map<string, CellCandidate>();
    let x0 = index;
    let x1 = index + 1;
    for (const cells of passes) {
      const cell = cells[index];
      if (!cell) continue;
      x0 = cell.x0;
      x1 = cell.x1;
      for (const candidate of cell.candidates) {
        const previous = merged.get(candidate.value);
        if (!previous) {
          merged.set(candidate.value, {
            value: candidate.value,
            confidence: candidate.confidence,
            passes: [...candidate.passes],
          });
          continue;
        }
        previous.confidence = Math.max(previous.confidence, candidate.confidence);
        for (const source of candidate.passes) {
          if (!previous.passes.includes(source)) previous.passes.push(source);
        }
      }
    }
    const candidates = [...merged.values()]
      .toSorted((left, right) => (
        right.passes.length - left.passes.length || right.confidence - left.confidence
      ));
    output.push({ index, x0, x1, candidates, disputed: candidates.length > 1 });
  }

  return output;
}
