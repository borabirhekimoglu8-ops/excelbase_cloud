import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ASSISTANT_READ_ONLY_CAPABILITIES,
  fetchAssistantStatus,
} from "./client";

describe("fetchAssistantStatus", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches safe public status without sending vault data or an API key", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        available: false,
        online_required: true,
        privacy_mode: "strict",
        capabilities: [...ASSISTANT_READ_ONLY_CAPABILITIES],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const status = await fetchAssistantStatus();

    expect(status.available).toBe(false);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/assistant/v1/status",
      expect.objectContaining({
        method: "GET",
        credentials: "same-origin",
        cache: "no-store",
        headers: { Accept: "application/json" },
      }),
    );
    const options = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.stringify(options)).not.toMatch(/passport|api.?key|authorization/i);
  });

  it("rejects capabilities outside the read-only contract", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        available: true,
        online_required: true,
        privacy_mode: "strict",
        capabilities: ["delete_passenger"],
      }),
    }));

    await expect(fetchAssistantStatus()).rejects.toThrow("durum yanıtı geçersiz");
  });
});
