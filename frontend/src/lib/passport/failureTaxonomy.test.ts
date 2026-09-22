import { describe, expect, it } from "vitest";

import {
  PASSPORT_FAILURE_STAGES,
  isTransientOcrCode,
  operatorFailureMessage,
  passportFailure,
} from "./failureTaxonomy";

describe("passport failure taxonomy", () => {
  it("keeps exactly four analysis stages", () => {
    expect(PASSPORT_FAILURE_STAGES).toEqual([
      "text_detection",
      "character_recognition",
      "mrz_parser",
      "field_matching",
    ]);
  });

  it("retries only the explicitly transient engine/image codes", () => {
    expect(isTransientOcrCode("engine_crashed")).toBe(true);
    expect(isTransientOcrCode("mrz_invalid")).toBe(false);
    expect(operatorFailureMessage(
      passportFailure("character_recognition", "engine_timeout", "internal"),
    )).not.toMatch(/\b(?:429|HTTP)\b/i);
  });
});
