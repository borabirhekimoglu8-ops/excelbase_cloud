import type { OcrEngineInfo } from "./ocr/types";

const token = (value: string, fallback: string): string => (
  value.trim().replace(/[^A-Za-z0-9._-]+/g, "-") || fallback
);

/** Queue identity includes the service-reported engine and raster contract. */
export function passportEngineProfileId(engine: OcrEngineInfo): string {
  return [
    token(engine.name, "unknown"),
    token(engine.version, "unknown"),
    token(engine.lang ?? "en", "en"),
    "r250",
    "jpeg90",
    "v1",
  ].join("-");
}
