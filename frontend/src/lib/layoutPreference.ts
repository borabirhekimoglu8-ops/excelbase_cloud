export type LayoutPreference = "auto" | "mobile" | "desktop";

export const LAYOUT_PREFERENCE_KEY = "excelbase:layout-preference";

export function parseLayoutPreference(value: string | null): LayoutPreference {
  return value === "mobile" || value === "desktop" ? value : "auto";
}
