import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ASSISTANT_READ_ONLY_CAPABILITIES,
  fetchAssistantStatus,
  fetchAssistantSession,
  logoutAssistantSession,
  sendAssistantMessage,
  unlockAssistantSession,
} from "./client";
import { buildAssistantContext } from "./context";

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
        privacy_mode: "aggregate_context_only",
        model_family: "sonnet",
        model_label: "Claude Sonnet",
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

  it("accepts only a bounded Sonnet display identity when model metadata is present", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        available: true,
        online_required: true,
        privacy_mode: "aggregate_context_only",
        model_family: "sonnet",
        model_label: "Claude Sonnet",
        capabilities: [...ASSISTANT_READ_ONLY_CAPABILITIES],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchAssistantStatus()).resolves.toMatchObject({
      model_family: "sonnet",
      model_label: "Claude Sonnet",
    });

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        available: true,
        online_required: true,
        privacy_mode: "aggregate_context_only",
        model_family: "opus",
        model_label: "Claude Opus",
        capabilities: [...ASSISTANT_READ_ONLY_CAPABILITIES],
      }),
    });
    await expect(fetchAssistantStatus()).rejects.toThrow("durum yanıtı geçersiz");
  });

  it("rejects capabilities outside the read-only contract", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        available: true,
        online_required: true,
        privacy_mode: "aggregate_context_only",
        capabilities: ["delete_passenger"],
      }),
    }));

    await expect(fetchAssistantStatus()).rejects.toThrow("durum yanıtı geçersiz");
  });

  it("reads a paired same-origin session without exposing the cookie", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        setup_required: false,
        bootstrap_required: false,
        authenticated: true,
        user: { id: "actor-1", name: "Operasyon", role: "admin" },
        csrf_token: "derived-csrf-token",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const session = await fetchAssistantSession();

    expect(session.authenticated).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/assistant/v1/session",
      expect.objectContaining({ method: "GET", credentials: "same-origin", cache: "no-store" }),
    );
    expect(JSON.stringify(fetchMock.mock.calls[0])).not.toMatch(/cookie|api.?key/i);
  });

  it("opens a dedicated online Sonnet session without using the global auth endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        setup_required: false,
        bootstrap_required: false,
        authenticated: true,
        user: { id: "actor-1", name: "Operasyon", role: "admin" },
        csrf_token: "csrf",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await unlockAssistantSession(false, "123456");

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toBe("/api/assistant/v1/session/login");
    const loginOptions = fetchMock.mock.calls[0][1] as RequestInit;
    expect(loginOptions.credentials).toBe("same-origin");
    expect(JSON.parse(String(loginOptions.body))).toEqual({ pin: "123456" });
  });

  it("sends the one-time bootstrap token only to dedicated first setup", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        setup_required: false,
        bootstrap_required: false,
        authenticated: true,
        user: { id: "actor-1", name: "Operasyon", role: "admin" },
        csrf_token: "csrf",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await unlockAssistantSession(true, "123456", "Operasyon", "bootstrap-once");

    expect(fetchMock.mock.calls[0][0]).toBe("/api/assistant/v1/session/setup");
    expect(JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))).toEqual({
      display_name: "Operasyon",
      pin: "123456",
      bootstrap_token: "bootstrap-once",
    });
  });

  it("disconnects only the dedicated assistant session with CSRF", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    await logoutAssistantSession("csrf");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/assistant/v1/session/logout",
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        headers: expect.objectContaining({ "X-CSRF-Token": "csrf" }),
      }),
    );
  });

  it("sends only acknowledged aggregate context and conversation text", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        message: "Hazırlık oranı yüzde 80.",
        usage: { input_tokens: 120, output_tokens: 18 },
        request_id: "request-1",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await sendAssistantMessage({
      message: "Durumu özetle",
      history: [{ role: "assistant", content: "Nasıl yardımcı olabilirim?" }],
      csrfToken: "derived-token",
      context: buildAssistantContext(
        {
          passenger_count: 10,
          readiness_percent: 80,
          missing_photo: 2,
          issue_counts: { Fotosuz: 2 },
        },
        { range: "Bugün", field: "departure" },
      ),
    });

    expect(response.message).toContain("yüzde 80");
    const [url, rawOptions] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/assistant/v1/chat");
    expect(rawOptions.credentials).toBe("same-origin");
    expect((rawOptions.headers as Record<string, string>)["X-CSRF-Token"]).toBe("derived-token");
    const body = JSON.parse(String(rawOptions.body));
    expect(body.privacy_acknowledged).toBe(true);
    expect(body.context.metrics.passenger_count).toBe(10);
    expect(JSON.stringify(body)).not.toMatch(
      /api.?key|model|photo_url|passport_(?:number|no)|document_(?:number|url)/i,
    );
  });
});
