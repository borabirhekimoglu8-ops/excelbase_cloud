import type { SafeAssistantContext } from "@/lib/assistant/context";

export const ASSISTANT_READ_ONLY_CAPABILITIES = [
  "dashboard_summary",
  "search_work_files",
  "get_work_file",
  "search_c_codes",
  "search_passengers",
  "get_passenger_checklist",
  "list_document_metadata",
  "passenger_statistics",
  "search_petitions",
  "list_archive_folders",
  "list_tasks",
  "list_templates",
] as const;

export type AssistantCapability = (typeof ASSISTANT_READ_ONLY_CAPABILITIES)[number];

export type AssistantConfigurationState =
  | "ready"
  | "disabled"
  | "provider_mismatch"
  | "model_mismatch"
  | "api_key_missing"
  | "api_key_misnamed"
  | "privacy_mismatch";

export type AssistantStatus = {
  available: boolean;
  configuration_state?: AssistantConfigurationState;
  online_required: true;
  privacy_mode: "aggregate_context_only";
  capabilities: AssistantCapability[];
  /** Server-attested family; the UI must not claim Sonnet without this value. */
  model_family: "sonnet";
  /** Safe display label only; provider model IDs and secrets remain server-side. */
  model_label: string;
  /** True when the server connects Sonnet without asking for an access code. */
  open_access?: boolean;
  /** Whether Claude may change records: read_only, full, or withheld. */
  autonomy?: "read_only" | "full" | "blocked_open_network";
  /** True when an IP allowlist scopes who can reach the assistant. */
  network_scoped?: boolean;
};

export type AssistantSessionStatus = {
  setup_required: boolean;
  bootstrap_required: boolean;
  authenticated: boolean;
  user: { id: string; name: string; role: string } | null;
  csrf_token: string;
};

export type AssistantChatTurn = {
  role: "user" | "assistant";
  content: string;
};

export const ASSISTANT_DIAGNOSTIC_REASONS = [
  "ok",
  "not_configured",
  "auth",
  "permission",
  "model",
  "request",
  "rate_limit",
  "timeout",
  "network",
  "upstream",
  "response",
  "unknown",
] as const;

export type AssistantDiagnosticReason = (typeof ASSISTANT_DIAGNOSTIC_REASONS)[number];

/**
 * Server-attested readiness report. Carries a fixed reason vocabulary plus
 * opaque upstream identifiers only; the API key and provider model id never
 * cross this boundary.
 */
export type AssistantDiagnostics = {
  configuration_state: AssistantConfigurationState;
  reachable: boolean;
  reason: AssistantDiagnosticReason;
  detail: string;
  upstream_status: number;
  upstream_error_type: string;
  upstream_request_id: string;
  duration_ms: number;
};

export type AssistantToolCallPayload = {
  id: string;
  name: string;
  input: Record<string, unknown>;
  /** Server-set from the catalogue; a response cannot mark a write as a read. */
  writes: boolean;
  confirm: boolean;
};

export type AssistantToolResultPayload = {
  tool_use_id: string;
  content: string;
  is_error: boolean;
};

/** One in-flight agentic turn: either the calls, or the results. */
export type AssistantStep = {
  role: "user" | "assistant";
  content: string;
  tool_calls?: AssistantToolCallPayload[];
  tool_results?: AssistantToolResultPayload[];
};

export type AssistantChatResponse = {
  message: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
  request_id: string;
  /** Non-empty means the turn is unfinished: run these and send the results. */
  tool_calls: AssistantToolCallPayload[];
  stop_reason: string;
};

export class AssistantClientError extends Error {
  readonly status: number;
  readonly retryAfter: number;

  constructor(message: string, status = 0, retryAfter = 0) {
    super(message);
    this.name = "AssistantClientError";
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

const CAPABILITY_SET = new Set<string>(ASSISTANT_READ_ONLY_CAPABILITIES);
const CONFIGURATION_STATE_SET = new Set<string>([
  "ready",
  "disabled",
  "provider_mismatch",
  "model_mismatch",
  "api_key_missing",
  "api_key_misnamed",
  "privacy_mismatch",
]);

function isAssistantStatus(value: unknown): value is AssistantStatus {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const status = value as Record<string, unknown>;
  const validModelMetadata = (
    status.model_family === "sonnet"
    && typeof status.model_label === "string"
    && status.model_label.trim().length > 0
    && status.model_label.length <= 80
  );
  const validConfigurationState = (
    status.configuration_state === undefined
    || (
      typeof status.configuration_state === "string"
      && CONFIGURATION_STATE_SET.has(status.configuration_state)
    )
  );
  return (
    typeof status.available === "boolean"
    && (status.open_access === undefined || typeof status.open_access === "boolean")
    && (status.network_scoped === undefined || typeof status.network_scoped === "boolean")
    && (
      status.autonomy === undefined
      || (typeof status.autonomy === "string"
        && ["read_only", "full", "blocked_open_network"].includes(status.autonomy))
    )
    && validConfigurationState
    && status.online_required === true
    && status.privacy_mode === "aggregate_context_only"
    && validModelMetadata
    && Array.isArray(status.capabilities)
    && status.capabilities.every((item) => typeof item === "string" && CAPABILITY_SET.has(item))
  );
}

function isSessionStatus(value: unknown): value is AssistantSessionStatus {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const session = value as Record<string, unknown>;
  const user = session.user;
  const validUser = user === null || (
    Boolean(user)
    && typeof user === "object"
    && !Array.isArray(user)
    && typeof (user as Record<string, unknown>).id === "string"
    && typeof (user as Record<string, unknown>).name === "string"
    && typeof (user as Record<string, unknown>).role === "string"
  );
  return (
    typeof session.setup_required === "boolean"
    && typeof session.bootstrap_required === "boolean"
    && typeof session.authenticated === "boolean"
    && validUser
    && typeof session.csrf_token === "string"
    && (!session.authenticated || session.csrf_token.length > 0)
  );
}

function isToolCall(value: unknown): value is AssistantToolCallPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const call = value as Record<string, unknown>;
  return (
    typeof call.id === "string" && call.id.length > 0
    && typeof call.name === "string" && call.name.length > 0
    && typeof call.writes === "boolean"
    && typeof call.confirm === "boolean"
    && Boolean(call.input) && typeof call.input === "object" && !Array.isArray(call.input)
  );
}

function isChatResponse(value: unknown): value is AssistantChatResponse {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const response = value as Record<string, unknown>;
  const usage = response.usage;
  // An absent tool_calls means "no tools were requested", not a malformed
  // response; when present its contents are checked strictly.
  const toolCalls = response.tool_calls ?? [];
  // A tool turn carries no prose, so message may be empty when calls are present.
  const hasWork = Array.isArray(toolCalls) && toolCalls.length > 0;
  return (
    typeof response.message === "string"
    && (hasWork || response.message.trim().length > 0)
    && Array.isArray(toolCalls)
    && toolCalls.every(isToolCall)
    && typeof response.request_id === "string"
    && Boolean(usage)
    && typeof usage === "object"
    && !Array.isArray(usage)
    && typeof (usage as Record<string, unknown>).input_tokens === "number"
    && typeof (usage as Record<string, unknown>).output_tokens === "number"
  );
}

const DIAGNOSTIC_REASON_SET = new Set<string>(ASSISTANT_DIAGNOSTIC_REASONS);

function isDiagnostics(value: unknown): value is AssistantDiagnostics {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const report = value as Record<string, unknown>;
  return (
    typeof report.configuration_state === "string"
    && CONFIGURATION_STATE_SET.has(report.configuration_state)
    && typeof report.reachable === "boolean"
    && typeof report.reason === "string"
    && DIAGNOSTIC_REASON_SET.has(report.reason)
    && typeof report.detail === "string"
    && typeof report.upstream_status === "number"
    && typeof report.upstream_error_type === "string"
    && typeof report.upstream_request_id === "string"
    && typeof report.duration_ms === "number"
  );
}

async function errorFromResponse(response: Response, fallback: string): Promise<AssistantClientError> {
  let message = fallback;
  try {
    const body = await response.json() as { detail?: unknown };
    if (typeof body.detail === "string" && body.detail.trim()) message = body.detail;
  } catch {
    // Provider and proxy errors may return an empty body; the typed fallback is safer.
  }
  const retryAfter = Number.parseInt(response.headers.get("retry-after") ?? "0", 10);
  return new AssistantClientError(
    message,
    response.status,
    Number.isFinite(retryAfter) ? Math.max(0, retryAfter) : 0,
  );
}

/** Fetches public availability only; it never sends vault data or credentials. */
export async function fetchAssistantStatus(signal?: AbortSignal): Promise<AssistantStatus> {
  const response = await fetch("/api/assistant/v1/status", {
    method: "GET",
    credentials: "same-origin",
    cache: "no-store",
    headers: { Accept: "application/json" },
    signal,
  });
  if (!response.ok) throw new Error("Excelbase Assistant durumu alınamadı.");
  const payload: unknown = await response.json();
  if (!isAssistantStatus(payload)) throw new Error("Excelbase Assistant durum yanıtı geçersiz.");
  return payload;
}

export async function fetchAssistantSession(signal?: AbortSignal): Promise<AssistantSessionStatus> {
  const response = await fetch("/api/assistant/v1/session", {
    method: "GET",
    credentials: "same-origin",
    cache: "no-store",
    headers: { Accept: "application/json" },
    signal,
  });
  if (!response.ok) {
    throw await errorFromResponse(response, "Çevrimiçi asistan oturumu kontrol edilemedi.");
  }
  const payload: unknown = await response.json();
  if (!isSessionStatus(payload)) {
    throw new AssistantClientError("Çevrimiçi asistan oturum yanıtı geçersiz.");
  }
  return payload;
}

export async function unlockAssistantSession(
  setupRequired: boolean,
  pin: string,
  displayName = "",
  bootstrapToken = "",
  signal?: AbortSignal,
): Promise<AssistantSessionStatus> {
  const response = await fetch(
    setupRequired ? "/api/assistant/v1/session/setup" : "/api/assistant/v1/session/login",
    {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(
        setupRequired
          ? { display_name: displayName, pin, bootstrap_token: bootstrapToken }
          : { pin },
      ),
      signal,
    },
  );
  if (!response.ok) {
    throw await errorFromResponse(response, "Çevrimiçi asistan oturumu açılamadı.");
  }
  const payload: unknown = await response.json();
  if (!isSessionStatus(payload)) {
    throw new AssistantClientError("Çevrimiçi asistan oturum yanıtı geçersiz.");
  }
  return payload;
}

export async function logoutAssistantSession(
  csrfToken: string,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch("/api/assistant/v1/session/logout", {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: {
      Accept: "application/json",
      "X-CSRF-Token": csrfToken,
    },
    signal,
  });
  if (!response.ok) {
    throw await errorFromResponse(response, "Çevrimiçi asistan oturumu kapatılamadı.");
  }
}

/**
 * Asks the server to verify its own Anthropic credentials and model.
 * Free upstream: it never spends output tokens or the daily chat budget.
 */
export async function runAssistantDiagnostics(
  csrfToken: string,
  signal?: AbortSignal,
): Promise<AssistantDiagnostics> {
  const response = await fetch("/api/assistant/v1/diagnostics", {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: {
      Accept: "application/json",
      "X-CSRF-Token": csrfToken,
    },
    signal,
  });
  if (!response.ok) {
    throw await errorFromResponse(response, "Asistan denetimi tamamlanamadı.");
  }
  const payload: unknown = await response.json();
  if (!isDiagnostics(payload)) {
    throw new AssistantClientError("Asistan denetim yanıtı geçersiz.", 502);
  }
  return payload;
}

export async function sendAssistantMessage(
  options: {
    message: string;
    history: AssistantChatTurn[];
    context: SafeAssistantContext;
    csrfToken: string;
    steps?: AssistantStep[];
    toolResults?: AssistantToolResultPayload[];
    requestId?: string;
  },
  signal?: AbortSignal,
): Promise<AssistantChatResponse> {
  // Continuations reuse the opening id so the whole loop settles as one turn.
  const requestId = options.requestId
    ?? globalThis.crypto?.randomUUID?.()
    ?? `assistant-${Date.now()}`;
  const response = await fetch("/api/assistant/v1/chat", {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-CSRF-Token": options.csrfToken,
      "X-Request-ID": requestId,
    },
    body: JSON.stringify({
      message: options.message,
      history: options.history,
      context: options.context,
      privacy_acknowledged: true,
      steps: options.steps ?? [],
      tool_results: options.toolResults ?? [],
    }),
    signal,
  });
  if (!response.ok) {
    throw await errorFromResponse(response, "Claude Sonnet yanıt veremedi.");
  }
  const payload: unknown = await response.json();
  if (!isChatResponse(payload)) {
    throw new AssistantClientError("Claude Sonnet yanıtı geçersiz.", 502);
  }
  // Normalize so callers can always iterate the loop without a guard.
  return { ...payload, tool_calls: payload.tool_calls ?? [], stop_reason: payload.stop_reason ?? "" };
}
