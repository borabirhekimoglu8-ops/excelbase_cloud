import { fetchAssistantSession } from "@/lib/assistant/client";

import { detectOcrCapability } from "./capability";
import type { OcrCapability, OcrCapabilityState, OcrEngineInfo, OcrPageResult, PassportOcrEngine } from "./types";

const STATES = new Set<OcrCapabilityState>([
  "ready",
  "engine_loading",
  "engine_missing",
  "engine_error",
  "disabled",
  "blocked_open_network",
  "blocked_not_loopback",
  "login_required",
  "service_unreachable",
  "not_local_origin",
  "unsupported_device",
]);

function locationInfo() {
  if (typeof window === "undefined") {
    return { hostname: "", protocol: "http:", isSecureContext: false, maxTouchPoints: 0 };
  }
  return {
    hostname: window.location.hostname,
    protocol: window.location.protocol,
    isSecureContext: window.isSecureContext,
    maxTouchPoints: navigator.maxTouchPoints ?? 0,
  };
}

function readState(payload: Record<string, unknown>): OcrCapabilityState | null {
  const nested = payload.detail;
  const raw = typeof payload.state === "string"
    ? payload.state
    : nested && typeof nested === "object" && nested !== null && "state" in nested
      ? String((nested as { state?: unknown }).state)
      : "";
  return STATES.has(raw as OcrCapabilityState) ? raw as OcrCapabilityState : null;
}

function readEngine(payload: Record<string, unknown>): OcrEngineInfo | null {
  const engine = payload.engine;
  if (!engine || typeof engine !== "object") return null;
  const record = engine as Record<string, unknown>;
  return {
    name: typeof record.name === "string" ? record.name : "",
    version: typeof record.version === "string" ? record.version : "",
    lang: typeof record.lang === "string" ? record.lang : undefined,
  };
}

async function authorizedJson(
  url: string,
  init: RequestInit,
  csrfToken: string,
): Promise<{ ok: boolean; status: number; payload: Record<string, unknown> }> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  headers.set("X-CSRF-Token", csrfToken);
  const response = await fetch(url, {
    ...init,
    credentials: "same-origin",
    cache: "no-store",
    headers,
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  return { ok: response.ok, status: response.status, payload };
}

function capabilityFromProbe(
  probeState: Parameters<typeof detectOcrCapability>[0]["probeState"],
  engine: OcrEngineInfo | null,
): OcrCapability {
  return detectOcrCapability({ ...locationInfo(), probeState, engine });
}

export function createLocalFastApiEngine(): PassportOcrEngine {
  return {
    async probe(signal?: AbortSignal): Promise<OcrCapability> {
      const location = locationInfo();
      if (!location.hostname) return detectOcrCapability({ ...location, probeState: "unreachable" });
      const preview = detectOcrCapability({ ...location });
      if (preview.state === "not_local_origin" || preview.state === "unsupported_device") {
        return preview;
      }
      try {
        const session = await fetchAssistantSession(signal);
        if (!session.authenticated || !session.csrf_token) {
          return capabilityFromProbe("unauthenticated", null);
        }
        const { status, payload } = await authorizedJson("/api/passport-ocr/v1/status", { method: "GET", signal }, session.csrf_token);
        if (status === 401 || status === 403 && !readState(payload)) {
          return capabilityFromProbe("unauthenticated", null);
        }
        const state = readState(payload);
        if (status >= 500 && !state) return capabilityFromProbe("unreachable", readEngine(payload));
        return capabilityFromProbe(state ?? (status === 200 ? "ready" : "unreachable"), readEngine(payload));
      } catch {
        return capabilityFromProbe("unreachable", null);
      }
    },

    async warmup(signal?: AbortSignal): Promise<OcrCapability> {
      const session = await fetchAssistantSession(signal);
      if (!session.authenticated || !session.csrf_token) {
        return capabilityFromProbe("unauthenticated", null);
      }
      const { payload } = await authorizedJson("/api/passport-ocr/v1/warmup", { method: "POST", signal }, session.csrf_token);
      return capabilityFromProbe(readState(payload) ?? "engine_loading", readEngine(payload));
    },

    async recognizePage(image: Blob, pageId: string, signal?: AbortSignal): Promise<OcrPageResult> {
      const session = await fetchAssistantSession(signal);
      if (!session.authenticated || !session.csrf_token) {
        throw new Error("Yerel servise giriş gerekli.");
      }
      const body = new FormData();
      body.append("image", image, "page.jpg");
      if (pageId) body.append("page_id", pageId);
      const { ok, status, payload } = await authorizedJson(
        "/api/passport-ocr/v1/recognize",
        { method: "POST", body, signal },
        session.csrf_token,
      );
      if (!ok) {
        const detail = payload.detail;
        const message = typeof detail === "string"
          ? detail
          : detail && typeof detail === "object" && "message" in detail
            ? String((detail as { message?: unknown }).message ?? "OCR hatası")
            : "OCR hatası";
        throw new Error(status === 503 ? message : "OCR hatası");
      }
      const lines = Array.isArray(payload.lines) ? payload.lines : [];
      return {
        pageId: typeof payload.page_id === "string" ? payload.page_id : pageId,
        engine: readEngine(payload) ?? { name: "", version: "" },
        width: typeof payload.width === "number" ? payload.width : 0,
        height: typeof payload.height === "number" ? payload.height : 0,
        durationMs: typeof payload.duration_ms === "number" ? payload.duration_ms : 0,
        lines: lines.flatMap((item) => {
          if (!item || typeof item !== "object") return [];
          const row = item as Record<string, unknown>;
          if (typeof row.text !== "string") return [];
          return [{
            text: row.text,
            box: Array.isArray(row.box) ? row.box as number[][] : [],
            score: typeof row.score === "number" ? row.score : null,
          }];
        }),
      };
    },
  };
}
