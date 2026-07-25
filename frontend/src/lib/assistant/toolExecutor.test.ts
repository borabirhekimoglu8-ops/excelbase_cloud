import { afterEach, describe, expect, it, vi } from "vitest";

import type { AssistantToolCall } from "./toolExecutor";

const passenger = {
  id: 42,
  record_uid: "uid-42",
  no: "1",
  first_name: "Ayşe",
  last_name: "Yılmaz",
  full_name: "Ayşe Yılmaz",
  passport_no: "U12345678",
  voucher: "V-9",
  departure_date: "2026-07-26",
  arrival_date: "2026-07-28",
  adult_fee: "1250",
  child_fee: "0",
  source_file: "temmuz-listesi.xlsx",
  sheet: "Sayfa1",
  created_at: "2026-07-20",
  record_date: "2026-07-20",
  created_by: "operator",
  record_status: "active",
  record_source: "import",
  photo: "photo-key",
  photo_url: "blob:...",
  documents: [
    { id: "d1", filename: "U12345678-pasaport.pdf", mime: "application/pdf", size: 1024, created_at: "2026-07-21", category: "passport" },
  ],
  issues: ["missing_photo"],
  duplicate: false,
};

const fetchPassengers = vi.fn();
const updatePassenger = vi.fn();
const deletePassenger = vi.fn();

vi.mock("@/lib/api", () => ({
  fetchPassengers: (...args: unknown[]) => fetchPassengers(...args),
  updatePassenger: (...args: unknown[]) => updatePassenger(...args),
  deletePassenger: (...args: unknown[]) => deletePassenger(...args),
  fetchSummary: vi.fn(),
  fetchWorkFiles: vi.fn(),
  fetchWorkspaceTasks: vi.fn(),
  createWorkspaceTask: vi.fn(),
  createWorkspaceNote: vi.fn(),
  toggleWorkspaceTask: vi.fn(),
  mergeDuplicates: vi.fn(),
}));

const scope = { range: "all" } as never;

function call(name: string, input: Record<string, unknown> = {}): AssistantToolCall {
  return { id: "toolu_1", name, input, writes: false, confirm: false };
}

describe("assistant tool executor", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("never returns a name, passport number or filename to the model", async () => {
    const { executeAssistantTool } = await import("./toolExecutor");
    fetchPassengers.mockResolvedValue([passenger]);

    const search = await executeAssistantTool(call("search_passengers"), scope);
    const documents = await executeAssistantTool(
      call("list_document_metadata", { ref: "p_42" }),
      scope,
    );

    for (const result of [search.content, documents.content]) {
      for (const secret of ["Ayşe", "Yılmaz", "U12345678", "V-9", "pasaport.pdf", "temmuz-listesi", "1250"]) {
        expect(result).not.toContain(secret);
      }
    }
    // What it does carry is the reference and the operational state.
    const parsed = JSON.parse(search.content) as { passengers: Array<Record<string, unknown>> };
    expect(parsed.passengers[0].ref).toBe("p_42");
    expect(parsed.passengers[0].issues).toEqual(["missing_photo"]);
    expect(parsed.passengers[0]).not.toHaveProperty("full_name");
  });

  it("resolves an opaque reference to the real record id", async () => {
    const { executeAssistantTool } = await import("./toolExecutor");
    updatePassenger.mockResolvedValue({ ok: true });

    await executeAssistantTool(
      { ...call("update_passenger_flags", { ref: "p_42", flags: { has_voucher: false } }), writes: true },
      scope,
    );

    expect(updatePassenger).toHaveBeenCalledWith(42, { voucher: "" });
  });

  it("refuses a reference the model invented instead of touching a record", async () => {
    const { executeAssistantTool } = await import("./toolExecutor");

    const result = await executeAssistantTool(
      { ...call("delete_passenger", { ref: "42" }), writes: true, confirm: true },
      scope,
    );

    expect(result.is_error).toBe(true);
    expect(deletePassenger).not.toHaveBeenCalled();
  });

  it("reports a failure back to the model rather than throwing", async () => {
    const { executeAssistantTool } = await import("./toolExecutor");
    fetchPassengers.mockRejectedValue(new Error("kasa kilitli"));

    const result = await executeAssistantTool(call("search_passengers"), scope);

    expect(result.is_error).toBe(true);
    expect(result.tool_use_id).toBe("toolu_1");
    expect(result.content).toContain("kasa kilitli");
  });

  it("rejects a tool that is not in the catalogue", async () => {
    const { executeAssistantTool } = await import("./toolExecutor");

    const result = await executeAssistantTool(call("drop_everything"), scope);

    expect(result.is_error).toBe(true);
    expect(result.content).toContain("Bilinmeyen araç");
  });
});
