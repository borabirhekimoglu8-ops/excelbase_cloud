import { describe, expect, it } from "vitest";

import { pairsFromOcrLines, repairTd3Length } from "./mrzFromOcrLines";

const LINE1 = "P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<";
const LINE2 = "L898902C36UTO7408122F1204159ZE184226B<<<<<10";

describe("mrzFromOcrLines", () => {
  it("assembles a verified pair from noisy OCR lines without inventing a passenger", () => {
    const pairs = pairsFromOcrLines([
      { text: "PASSPORT", box: [], score: 0.4 },
      { text: LINE1.replace(/</g, "«"), box: [[0, 0], [10, 0], [10, 2], [0, 2]], score: 0.9 },
      { text: LINE2, box: [[0, 3], [10, 3], [10, 5], [0, 5]], score: 0.88 },
    ]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].parsed.surname).toBe("ERIKSSON");
    expect(pairs[0].parsed.passportNumber).toBe("L898902C3");
    expect(pairs[0].rawLine1).toContain("ERIKSSON");
  });

  it("keeps 0 and 2 pairs as separate review cases", () => {
    expect(pairsFromOcrLines([{ text: "NO MRZ HERE", box: [], score: 0.2 }])).toEqual([]);
    const two = pairsFromOcrLines([
      { text: LINE1, box: [], score: 0.9 },
      { text: LINE2, box: [], score: 0.9 },
      { text: LINE1, box: [], score: 0.8 },
      { text: LINE2, box: [], score: 0.8 },
    ]);
    expect(two).toHaveLength(2);
  });

  it("repairs only 43/45 length, not whole-string lookalikes", () => {
    expect(repairTd3Length(LINE1.slice(0, 43))).toContain(`${LINE1.slice(0, 43)}<`);
    expect(repairTd3Length(`${LINE1}X`)).toContain(LINE1);
    expect(repairTd3Length("O000")).toEqual([]);
  });
});
