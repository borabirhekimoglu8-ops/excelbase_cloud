/**
 * Talks to the Claude that develops this application from inside it.
 *
 * The run endpoint streams NDJSON rather than returning one JSON body: a
 * development run takes minutes, and an operator watching a spinner has no way
 * to tell a working agent from a wedged one. Each line is delivered as it
 * arrives so the panel can show the same progress the server sees.
 */

export type DevAgentState =
  | "ready"
  | "disabled"
  | "blocked_open_network"
  | "api_key_missing"
  | "not_a_repository"
  | "sdk_missing";

export type DevAgentStatus = {
  state: DevAgentState;
  available: boolean;
};

export type DevAgentEvent =
  | { type: "started"; worktree: string }
  | { type: "text"; text: string }
  | { type: "tool"; name: string }
  | { type: "changes"; files: string[]; diff: string }
  | { type: "testing" }
  | { type: "test"; name: string; passed: boolean; detail: string }
  | {
      type: "finished";
      summary: string;
      files: string[];
      committed: string;
      cost_usd: number;
      applicable: boolean;
    }
  | { type: "error"; detail?: string; state?: string };

const DEV_AGENT_STATES = new Set<string>([
  "ready",
  "disabled",
  "blocked_open_network",
  "api_key_missing",
  "not_a_repository",
  "sdk_missing",
]);

export class DevAgentClientError extends Error {
  readonly status: number;

  constructor(message: string, status = 0) {
    super(message);
    this.name = "DevAgentClientError";
    this.status = status;
  }
}

function isStatus(value: unknown): value is DevAgentStatus {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const status = value as Record<string, unknown>;
  return (
    typeof status.state === "string"
    && DEV_AGENT_STATES.has(status.state)
    && typeof status.available === "boolean"
  );
}

/**
 * Narrows one streamed line to a known event.
 *
 * Anything unrecognised is dropped rather than rendered: a panel that displays
 * whatever the stream contains would print a future server's internals, and a
 * malformed line must not be able to look like a green test result.
 */
export function parseDevAgentEvent(line: string): DevAgentEvent | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const event = parsed as Record<string, unknown>;
  const stringList = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

  switch (event.type) {
    case "started":
      return { type: "started", worktree: String(event.worktree ?? "") };
    case "text":
      return typeof event.text === "string" && event.text.trim()
        ? { type: "text", text: event.text }
        : null;
    case "tool":
      return typeof event.name === "string" ? { type: "tool", name: event.name } : null;
    case "changes":
      return {
        type: "changes",
        files: stringList(event.files),
        diff: typeof event.diff === "string" ? event.diff : "",
      };
    case "testing":
      return { type: "testing" };
    case "test":
      // passed must be a real boolean; a missing field cannot read as a pass.
      return typeof event.name === "string" && typeof event.passed === "boolean"
        ? {
            type: "test",
            name: event.name,
            passed: event.passed,
            detail: typeof event.detail === "string" ? event.detail : "",
          }
        : null;
    case "finished":
      return {
        type: "finished",
        summary: typeof event.summary === "string" ? event.summary : "",
        files: stringList(event.files),
        committed: typeof event.committed === "string" ? event.committed : "",
        cost_usd: typeof event.cost_usd === "number" ? event.cost_usd : 0,
        applicable: event.applicable === true,
      };
    case "error":
      return {
        type: "error",
        detail: typeof event.detail === "string" ? event.detail : undefined,
        state: typeof event.state === "string" ? event.state : undefined,
      };
    default:
      return null;
  }
}

export async function fetchDevAgentStatus(
  csrfToken: string,
  signal?: AbortSignal,
): Promise<DevAgentStatus> {
  const response = await fetch("/api/dev-agent/v1/status", {
    method: "GET",
    credentials: "same-origin",
    cache: "no-store",
    headers: { Accept: "application/json", "X-CSRF-Token": csrfToken },
    signal,
  });
  if (!response.ok) {
    throw new DevAgentClientError("Geliştirme ajanı durumu alınamadı.", response.status);
  }
  const payload: unknown = await response.json();
  if (!isStatus(payload)) throw new DevAgentClientError("Geliştirme ajanı yanıtı geçersiz.");
  return payload;
}

export type DevRunStatus = "idle" | "running" | "finished" | "error" | "cancelled";

export type DevRunState = {
  id: string;
  instruction: string;
  status: DevRunStatus;
  events: DevAgentEvent[];
  error: string;
};

const RUN_STATUSES = new Set<string>(["idle", "running", "finished", "error", "cancelled"]);

/**
 * Starts a run and returns as soon as the server has it.
 *
 * The run belongs to the server, not to this request: closing the panel or
 * moving to another screen no longer cancels work that is already underway.
 */
export async function startDevAgentRun(
  instruction: string,
  csrfToken: string,
  signal?: AbortSignal,
): Promise<string> {
  const response = await fetch("/api/dev-agent/v1/run", {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-CSRF-Token": csrfToken,
    },
    body: JSON.stringify({ instruction }),
    signal,
  });
  const payload = await response.json().catch(() => ({})) as { id?: unknown; detail?: unknown };
  if (!response.ok) {
    throw new DevAgentClientError(
      typeof payload.detail === "string" && payload.detail.trim()
        ? payload.detail
        : "Geliştirme çalışması başlatılamadı.",
      response.status,
    );
  }
  return typeof payload.id === "string" ? payload.id : "";
}

/** Reads how the current or most recent run is going. */
export async function fetchDevAgentRun(
  csrfToken: string,
  signal?: AbortSignal,
): Promise<DevRunState> {
  const response = await fetch("/api/dev-agent/v1/run", {
    method: "GET",
    credentials: "same-origin",
    cache: "no-store",
    headers: { Accept: "application/json", "X-CSRF-Token": csrfToken },
    signal,
  });
  if (!response.ok) {
    throw new DevAgentClientError("Geliştirme durumu alınamadı.", response.status);
  }
  const payload = await response.json() as Record<string, unknown>;
  const status = typeof payload.status === "string" && RUN_STATUSES.has(payload.status)
    ? payload.status as DevRunStatus
    : "idle";
  // Unknown lines are dropped here for the same reason the stream dropped them:
  // a malformed entry must not be able to render as a passing test.
  const events = Array.isArray(payload.events)
    ? payload.events
        .map((event) => parseDevAgentEvent(JSON.stringify(event)))
        .filter((event): event is DevAgentEvent => event !== null)
    : [];
  return {
    id: typeof payload.id === "string" ? payload.id : "",
    instruction: typeof payload.instruction === "string" ? payload.instruction : "",
    status,
    events,
    error: typeof payload.error === "string" ? payload.error : "",
  };
}

export async function cancelDevAgentRun(
  csrfToken: string,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch("/api/dev-agent/v1/run/cancel", {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: { Accept: "application/json", "X-CSRF-Token": csrfToken },
    signal,
  });
  if (!response.ok) {
    throw new DevAgentClientError("Çalışma durdurulamadı.", response.status);
  }
}

/** Takes the reviewed commit into the branch the operator runs. */
export async function applyDevAgentRun(
  csrfToken: string,
  signal?: AbortSignal,
): Promise<string> {
  const response = await fetch("/api/dev-agent/v1/apply", {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: { Accept: "application/json", "X-CSRF-Token": csrfToken },
    signal,
  });
  const payload = await response.json().catch(() => ({})) as {
    detail?: unknown;
    commit?: unknown;
  };
  if (!response.ok) {
    throw new DevAgentClientError(
      typeof payload.detail === "string" && payload.detail.trim()
        ? payload.detail
        : "Değişiklik uygulanamadı.",
      response.status,
    );
  }
  return typeof payload.commit === "string" ? payload.commit : "";
}
