import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

function shellVersion(source: string, filename: string): string {
  const match = source.match(/const SHELL_VERSION = "([^"]+)";/);
  if (!match) throw new Error(`${filename} içinde SHELL_VERSION bulunamadı.`);
  return match[1];
}

describe("offline PWA shell version", () => {
  it("keeps the service worker and registration cache versions in sync", async () => {
    const [bootstrap, worker] = await Promise.all([
      readFile(resolve(process.cwd(), "src/components/pwa/PwaBootstrap.tsx"), "utf8"),
      readFile(resolve(process.cwd(), "public/sw.js"), "utf8"),
    ]);

    const bootstrapVersion = shellVersion(bootstrap, "PwaBootstrap.tsx");
    const workerVersion = shellVersion(worker, "sw.js");
    expect(bootstrapVersion).toBe("2026.07.17.2");
    expect(workerVersion).toBe(bootstrapVersion);
  });
});
