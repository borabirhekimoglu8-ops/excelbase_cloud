import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("passport OCR network boundary", () => {
  it("contains no direct fetch, XHR, or WebSocket calls", async () => {
    const directory = resolve(process.cwd(), "src/lib/passport");
    const files = (await readdir(directory)).filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"));
    const sources = await Promise.all(files.map(async (name) => ({
      name,
      source: await readFile(resolve(directory, name), "utf8"),
    })));
    for (const { name, source } of sources) {
      expect(source, name).not.toMatch(/\bfetch\s*\(/);
      expect(source, name).not.toMatch(/\b(?:XMLHttpRequest|WebSocket)\s*\(/);
    }
  });
});
