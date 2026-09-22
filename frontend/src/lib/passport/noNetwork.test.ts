import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("passport OCR network boundary", () => {
  it("allows fetch only in the relative loopback API adapter", async () => {
    const directory = resolve(process.cwd(), "src/lib/passport");
    const files = (await readdir(directory, { recursive: true }))
      .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"));
    const sources = await Promise.all(files.map(async (name) => ({
      name,
      source: await readFile(resolve(directory, name), "utf8"),
    })));
    for (const { name, source } of sources) {
      if (name === "ocr/localFastApiEngine.ts") {
        const fetchCalls = [...source.matchAll(/\bfetch\s*\(\s*([^,\n]+)/g)]
          .map((match) => match[1]);
        expect(fetchCalls.length, name).toBeGreaterThan(0);
        expect(source, name).not.toMatch(/fetch\s*\(\s*["'`]https?:/);
        expect(source, name).toMatch(/\/api\/passport-ocr\/v1\//);
      } else {
        expect(source, name).not.toMatch(/\bfetch\s*\(/);
      }
      expect(source, name).not.toMatch(/\b(?:XMLHttpRequest|WebSocket)\s*\(/);
    }
  });
});
