import { describe, expect, it } from "vitest";

import { fitGrid, snapToCells, type OcrSymbol } from "./mrzGrid";

function symbolsFor(line: string, omitted = new Set<number>()): OcrSymbol[] {
  return [...line].flatMap((text, index) => (
    omitted.has(index)
      ? []
      : [{
          text,
          confidence: 95,
          bbox: {
            x0: 12 + index * 14,
            y0: 4,
            x1: 21 + index * 14,
            y1: 20,
          },
        }]
  ));
}

describe("MRZ fixed-pitch grid", () => {
  it("leaves missing chevrons empty without shifting later symbols", () => {
    const line = "P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<";
    const omitted = new Set([1, 13, 14, 27, 28, 29]);
    const symbols = symbolsFor(line, omitted);
    const grid = fitGrid(symbols, 44, 44 * 14 + 24);
    expect(grid).not.toBeNull();
    const cells = snapToCells(symbols, grid!, "ABCDEFGHIJKLMNOPQRSTUVWXYZ<");

    expect(cells[0].candidates[0]?.value).toBe("P");
    expect(cells[1].candidates).toHaveLength(0);
    expect(cells[2].candidates[0]?.value).toBe("U");
    expect(cells[15].candidates[0]?.value).toBe("A");
    expect(cells[30].index).toBe(30);
  });
});
