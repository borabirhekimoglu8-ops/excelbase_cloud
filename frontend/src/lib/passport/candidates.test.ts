import { describe, expect, it } from "vitest";

import {
  applyUserField,
  candidateStatus,
  emptyFields,
  exportExclusionReason,
  fieldsFromMrz,
  possibleDuplicates,
  requiredComplete,
} from "./candidates";
import { parseTd3FromLines } from "./mrz";

const LINE1 = "P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<";
const LINE2 = "L898902C36UTO7408122F1204159ZE184226B<<<<<10";

describe("passport candidates", () => {
  it("does not treat auto-pass as user-approved", () => {
    const parsed = parseTd3FromLines(LINE1, LINE2);
    expect(parsed).not.toBeNull();
    const fields = fieldsFromMrz(parsed!, "page-1", 0.9, null);
    fields.countryCode2 = applyUserField(fields, "countryCode2", "TR", "page-1").countryCode2;
    const { status, auto_pass } = candidateStatus(fields, [], 1);
    expect(auto_pass).toBe(true);
    expect(status).toBe("review");
    expect(exportExclusionReason({
      entity_type: "passport_candidate",
      schema_version: 1,
      id: "c1",
      job_id: "j",
      page_id: "page-1",
      index_on_page: 0,
      status: "review",
      auto_pass,
      fields,
      mrz: null,
      visual_hints: [],
      possible_duplicate_of: [],
      approved_at: "",
      approved_by: "",
      exported_at: "",
      created_at: "",
      updated_at: "",
    })).toBe("Kullanıcı onayı yok");
  });

  it("flags MRZ vs visual conflict without picking a side", () => {
    const parsed = parseTd3FromLines(LINE1, LINE2);
    const fields = fieldsFromMrz(parsed!, "page-1", null, null);
    const { status } = candidateStatus(fields, [{ field: "passportNo", value: "U1000001", box: [], score: 0.4 }], 1);
    expect(status).toBe("conflict");
  });

  it("lists possible duplicates but does not merge weak reads automatically", () => {
    const fields = emptyFields("p");
    fields.passportNo.normalized = "U1000001";
    fields.passportNo.validation = "unverified";
    const ids = possibleDuplicates(
      { id: "a", fields },
      [{ id: "b", fields }],
    );
    expect(ids[0]).toMatch(/^weak:/);
  });

  it("requires operator-complete fields before Excel", () => {
    expect(requiredComplete(emptyFields("p"))).toBe(false);
  });
});
