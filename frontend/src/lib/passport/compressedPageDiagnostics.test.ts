import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { TEXT_FIXTURE_EXPECTED_OUTPUTS } from "./__fixtures__/expectedOutputs";
import { rowsFromMrzText } from "./parseMrzText";

const FIXTURE_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "__fixtures__/compressed-pages",
);

describe("committed text fixture expected outputs", () => {
  it("locks fixture hashes and labels every record as non-image evidence", () => {
    expect(TEXT_FIXTURE_EXPECTED_OUTPUTS).toHaveLength(5);
    for (const fixture of TEXT_FIXTURE_EXPECTED_OUTPUTS) {
      const bytes = readFileSync(resolve(FIXTURE_DIR, fixture.filename));
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(fixture.sha256);
      expect(fixture.evidence).toBe("text_fixture_expected_output");
    }
  });

  it("tests parser output without claiming that OCR ran", () => {
    const parsed = TEXT_FIXTURE_EXPECTED_OUTPUTS.map((fixture) => {
      const text = readFileSync(resolve(FIXTURE_DIR, fixture.filename), "utf8");
      const rows = rowsFromMrzText(text, fixture.filename);
      return {
        pageNo: fixture.pageNo,
        verified: rows.some((row) => row.status === "ok"),
        hasRows: rows.length > 0,
      };
    });
    expect(parsed).toEqual([
      { pageNo: 1, verified: false, hasRows: true },
      { pageNo: 2, verified: false, hasRows: true },
      { pageNo: 3, verified: false, hasRows: false },
      { pageNo: 4, verified: false, hasRows: false },
      { pageNo: 5, verified: false, hasRows: false },
    ]);
  });
});
