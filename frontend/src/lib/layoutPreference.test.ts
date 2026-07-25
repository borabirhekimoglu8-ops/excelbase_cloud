import { describe, expect, it } from "vitest";
import { parseLayoutPreference } from "./layoutPreference";

describe("layout preference", () => {
  it.each([
    ["auto", "auto"],
    ["mobile", "mobile"],
    ["desktop", "desktop"],
  ] as const)("%s değerini korur", (value, expected) => {
    expect(parseLayoutPreference(value)).toBe(expected);
  });

  it("bozuk veya eksik tercihte otomatik görünüme döner", () => {
    expect(parseLayoutPreference(null)).toBe("auto");
    expect(parseLayoutPreference("wide")).toBe("auto");
  });
});
