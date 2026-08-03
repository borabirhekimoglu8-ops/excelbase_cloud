/**
 * Talks to the local folder scanner.
 *
 * The scan runs entirely on the machine serving the app and returns header
 * names and counts only, so this client never carries file contents. That is
 * a property of the server, not of the UI -- but the types here say so too, so
 * a future field carrying a cell would have to be added deliberately.
 */

export type DriveAuditState = "ready" | "disabled" | "blocked_open_network";

export type DriveAuditStatus = {
  state: DriveAuditState;
  available: boolean;
  default_root: string;
};

export type DriveEntity = {
  name: string;
  columns: string[];
  files: number;
  missing: string[];
  suggestion: string;
};

export type DriveFinding = {
  kind: string;
  title: string;
  detail: string;
  evidence: string[];
  suggestion: string;
};

export type DriveReport = {
  root: string;
  files_seen: number;
  truncated: boolean;
  by_kind: Record<string, number>;
  dated_folders: number;
  templates: Array<{ headers: string[]; count: number; files: string[] }>;
  unknown_columns: Array<{ column: string; files: number }>;
  entities: DriveEntity[];
  findings: DriveFinding[];
};

export class DriveAuditClientError extends Error {
  readonly status: number;

  constructor(message: string, status = 0) {
    super(message);
    this.name = "DriveAuditClientError";
    this.status = status;
  }
}

const STATES = new Set<string>(["ready", "disabled", "blocked_open_network"]);

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function asEntity(value: unknown): DriveEntity | null {
  if (!value || typeof value !== "object") return null;
  const entity = value as Record<string, unknown>;
  if (typeof entity.name !== "string" || typeof entity.files !== "number") return null;
  return {
    name: entity.name,
    columns: stringList(entity.columns),
    files: entity.files,
    missing: stringList(entity.missing),
    suggestion: typeof entity.suggestion === "string" ? entity.suggestion : "",
  };
}

function asFinding(value: unknown): DriveFinding | null {
  if (!value || typeof value !== "object") return null;
  const finding = value as Record<string, unknown>;
  if (typeof finding.title !== "string") return null;
  return {
    kind: typeof finding.kind === "string" ? finding.kind : "",
    title: finding.title,
    detail: typeof finding.detail === "string" ? finding.detail : "",
    evidence: stringList(finding.evidence),
    suggestion: typeof finding.suggestion === "string" ? finding.suggestion : "",
  };
}

export async function fetchDriveAuditStatus(
  csrfToken: string,
  signal?: AbortSignal,
): Promise<DriveAuditStatus> {
  const response = await fetch("/api/drive-audit/v1/status", {
    method: "GET",
    credentials: "same-origin",
    cache: "no-store",
    headers: { Accept: "application/json", "X-CSRF-Token": csrfToken },
    signal,
  });
  if (!response.ok) {
    throw new DriveAuditClientError("Klasör tarama durumu alınamadı.", response.status);
  }
  const payload = await response.json() as Record<string, unknown>;
  const state = typeof payload.state === "string" && STATES.has(payload.state)
    ? payload.state as DriveAuditState
    : "disabled";
  return {
    state,
    available: payload.available === true,
    default_root: typeof payload.default_root === "string" ? payload.default_root : "",
  };
}

export async function scanDriveFolder(
  root: string,
  csrfToken: string,
  signal?: AbortSignal,
): Promise<DriveReport> {
  const response = await fetch("/api/drive-audit/v1/scan", {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-CSRF-Token": csrfToken,
    },
    body: JSON.stringify({ root }),
    signal,
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    throw new DriveAuditClientError(
      typeof payload.detail === "string" && payload.detail.trim()
        ? payload.detail
        : "Klasör taranamadı.",
      response.status,
    );
  }
  return {
    root: typeof payload.root === "string" ? payload.root : "",
    files_seen: typeof payload.files_seen === "number" ? payload.files_seen : 0,
    truncated: payload.truncated === true,
    by_kind: (payload.by_kind && typeof payload.by_kind === "object"
      ? payload.by_kind : {}) as Record<string, number>,
    dated_folders: typeof payload.dated_folders === "number" ? payload.dated_folders : 0,
    templates: Array.isArray(payload.templates)
      ? payload.templates.map((item) => {
        const template = (item ?? {}) as Record<string, unknown>;
        return {
          headers: stringList(template.headers),
          count: typeof template.count === "number" ? template.count : 0,
          files: stringList(template.files),
        };
      })
      : [],
    unknown_columns: Array.isArray(payload.unknown_columns)
      ? payload.unknown_columns.flatMap((item) => {
        const entry = (item ?? {}) as Record<string, unknown>;
        return typeof entry.column === "string" && typeof entry.files === "number"
          ? [{ column: entry.column, files: entry.files }]
          : [];
      })
      : [],
    entities: Array.isArray(payload.entities)
      ? payload.entities.map(asEntity).filter((entity): entity is DriveEntity => entity !== null)
      : [],
    findings: Array.isArray(payload.findings)
      ? payload.findings.map(asFinding).filter((finding): finding is DriveFinding => finding !== null)
      : [],
  };
}
