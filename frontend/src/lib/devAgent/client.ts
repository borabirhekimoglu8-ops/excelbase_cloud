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

/** Runs one instruction, invoking `onEvent` for each line as it arrives. */
export async function streamDevAgentRun(
  options: { instruction: string; csrfToken: string; onEvent: (event: DevAgentEvent) => void },
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch("/api/dev-agent/v1/run", {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: {
      Accept: "application/x-ndjson",
      "Content-Type": "application/json",
      "X-CSRF-Token": options.csrfToken,
    },
    body: JSON.stringify({ instruction: options.instruction }),
    signal,
  });
  if (!response.ok || !response.body) {
    throw new DevAgentClientError("Geliştirme çalışması başlatılamadı.", response.status);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    // A chunk boundary can fall mid-line, so the tail is held back until its
    // newline arrives rather than parsed as a truncated object.
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const event = parseDevAgentEvent(line);
      if (event) options.onEvent(event);
    }
  }
  const tail = parseDevAgentEvent(buffer.trim());
  if (tail) options.onEvent(tail);
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
