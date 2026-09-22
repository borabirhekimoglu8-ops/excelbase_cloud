import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  COUNTRY_TABLE_SOURCES,
  ICAO3_TO_ISO2,
  ICAO_COUNTRIES,
  ICAO_EXCEPTIONS,
  countryEntry,
  icaoCountryToIso2,
  isSpecialNationality,
  resolveCountrySelection,
  searchCountries,
} from "./icaoCountries";

const PRE_REFACTOR_ISO2: Record<string, string> = {
  D: "DE",
  GBD: "GB",
  GBN: "GB",
  GBO: "GB",
  GBP: "GB",
  GBS: "GB",
  RKS: "XK",
  XKX: "XK",
};

describe("country table completeness", () => {
  it("keeps one table with 249 ISO states and unique codes", () => {
    const states = ICAO_COUNTRIES.filter((entry) => entry.kind === "state");
    expect(states).toHaveLength(249);
    const alpha3 = states.map((entry) => entry.alpha3);
    expect(new Set(alpha3).size).toBe(249);
    expect(new Set(ICAO_COUNTRIES.map((entry) => entry.alpha3)).size).toBe(ICAO_COUNTRIES.length);
    const stateAlpha2 = states.map((entry) => entry.alpha2);
    expect(new Set(stateAlpha2).size).toBe(249);
  });

  it("preserves the previous ICAO3→ISO2 mapping for states and documented aliases", () => {
    for (const [alpha3, alpha2] of Object.entries(PRE_REFACTOR_ISO2)) {
      expect(ICAO3_TO_ISO2[alpha3]).toBe(alpha2);
    }
    expect(icaoCountryToIso2("TUR")).toBe("TR");
    expect(icaoCountryToIso2("GRC")).toBe("GR");
    expect(icaoCountryToIso2("DEU")).toBe("DE");
    expect(icaoCountryToIso2("GBR")).toBe("GB");
    expect(icaoCountryToIso2("USA")).toBe("US");
    expect(icaoCountryToIso2("tr")).toBe("TR");
  });

  it("records official source URLs, retrieval date and terms", () => {
    expect(COUNTRY_TABLE_SOURCES.retrievedAt).toBe("2026-09-22");
    expect(COUNTRY_TABLE_SOURCES.iso.urls[0]).toContain("iso.org");
    expect(COUNTRY_TABLE_SOURCES.icao9303.urls[0]).toContain("icao.int");
    expect(COUNTRY_TABLE_SOURCES.iso.terms.length).toBeGreaterThan(40);
    expect(COUNTRY_TABLE_SOURCES.icao9303.terms).toMatch(/Do not assume/i);
  });
});

describe("special and unknown codes", () => {
  it("does not invent a country for UTO, stateless, refugee or organization codes", () => {
    for (const code of ["UTO", "XXA", "XXB", "XXC", "XXX", "UNO", "UNA", "UNK", "EUE", "XOM"]) {
      expect(icaoCountryToIso2(code)).toBe("");
      expect(isSpecialNationality(code)).toBe(true);
      expect(countryEntry(code)?.kind).toBe("special");
    }
    expect(ICAO_EXCEPTIONS.some((entry) => entry.alpha3 === "UTO")).toBe(true);
  });

  it("leaves unknown codes blank and marks them for operator confirmation", () => {
    expect(icaoCountryToIso2("ZZZ")).toBe("");
    expect(icaoCountryToIso2("QQ")).toBe("");
    expect(isSpecialNationality("ZZZ")).toBe(true);
  });
});

describe("searchCountries", () => {
  it("matches two-letter codes, three-letter codes and Turkish / English names locally", () => {
    expect(searchCountries("TUR")[0]?.alpha3).toBe("TUR");
    expect(searchCountries("TR")[0]?.alpha2).toBe("TR");
    expect(searchCountries("Türkiye")[0]?.alpha3).toBe("TUR");
    expect(searchCountries("turk")[0]?.alpha3).toBe("TUR");
    expect(searchCountries("Greece")[0]?.alpha3).toBe("GRC");
    const kosovo = searchCountries("kosova", 8).map((entry) => entry.alpha3);
    expect(kosovo).toEqual(expect.arrayContaining(["RKS", "XKX"]));
  });

  it("resolves two-letter codes and names but rejects invalid or special codes", () => {
    expect(resolveCountrySelection("TR")?.alpha3).toBe("TUR");
    expect(resolveCountrySelection("Türkiye")?.alpha3).toBe("TUR");
    expect(resolveCountrySelection("UTO")).toBeNull();
    expect(resolveCountrySelection("XXA")).toBeNull();
    expect(resolveCountrySelection("QQ")).toBeNull();
  });

  it("never talks to the network", () => {
    const source = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), "icaoCountries.ts"),
      "utf8",
    );
    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toMatch(/XMLHttpRequest/);
    expect(source).not.toMatch(/WebSocket/);
  });
});
