/**
 * Local closed-circuit workstation client.
 *
 * Catalogue metadata only — never file bodies. All calls stay on this host.
 */

export type WorkstationState = "ready" | "disabled" | "blocked_open_network";

export type WorkstationStatus = {
  state: WorkstationState;
  available: boolean;
  default_root: string;
  privacy: string;
  egress: string;
};

export type CatalogStats = {
  root: string;
  built_at: number;
  files_seen: number;
  truncated: boolean;
  total_bytes: number;
  c_code_files: number;
  dated_files: number;
  by_kind: Record<string, number>;
};

export type CatalogHit = {
  path: string;
  name: string;
  kind: string;
  suffix: string;
  size: number;
  mtime: number;
  parent: string;
  has_c_code: boolean;
  has_date: boolean;
};

export type AdviceItem = {
  kind: string;
  title: string;
  detail: string;
  weight: number;
  evidence: string[];
};

export type AdviceReport = {
  mode: string;
  privacy: string;
  answer: string;
  items: AdviceItem[];
  stats: CatalogStats | Record<string, unknown>;
};

export class WorkstationClientError extends Error {
  readonly status: number;

  constructor(message: string, status = 0) {
    super(message);
    this.name = "WorkstationClientError";
    this.status = status;
  }
}

const STATES = new Set<string>(["ready", "disabled", "blocked_open_network"]);

async function readError(response: Response, fallback: string): Promise<string> {
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  return typeof payload.detail === "string" && payload.detail.trim()
    ? payload.detail
    : fallback;
}

export async function fetchWorkstationStatus(
  csrfToken: string,
  signal?: AbortSignal,
): Promise<WorkstationStatus> {
  const response = await fetch("/api/workstation/v1/status", {
    method: "GET",
    credentials: "same-origin",
    cache: "no-store",
    headers: { Accept: "application/json", "X-CSRF-Token": csrfToken },
    signal,
  });
  if (!response.ok) {
    throw new WorkstationClientError("İş istasyonu durumu alınamadı.", response.status);
  }
  const payload = await response.json() as Record<string, unknown>;
  const state = typeof payload.state === "string" && STATES.has(payload.state)
    ? payload.state as WorkstationState
    : "disabled";
  return {
    state,
    available: payload.available === true,
    default_root: typeof payload.default_root === "string" ? payload.default_root : "",
    privacy: typeof payload.privacy === "string" ? payload.privacy : "",
    egress: typeof payload.egress === "string" ? payload.egress : "",
  };
}

export async function buildWorkstationCatalog(
  root: string,
  csrfToken: string,
  signal?: AbortSignal,
): Promise<CatalogStats> {
  const response = await fetch("/api/workstation/v1/catalog/build", {
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
  if (!response.ok) {
    throw new WorkstationClientError(await readError(response, "Katalog oluşturulamadı."), response.status);
  }
  return (await response.json()) as CatalogStats;
}

export async function searchWorkstationCatalog(
  query: string,
  root: string,
  csrfToken: string,
  signal?: AbortSignal,
): Promise<{ count: number; results: CatalogHit[]; query: string }> {
  const response = await fetch("/api/workstation/v1/catalog/search", {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-CSRF-Token": csrfToken,
    },
    body: JSON.stringify({ query, root, limit: 40 }),
    signal,
  });
  if (!response.ok) {
    throw new WorkstationClientError(await readError(response, "Arama yapılamadı."), response.status);
  }
  const payload = await response.json() as Record<string, unknown>;
  const results = Array.isArray(payload.results)
    ? payload.results.filter((item): item is CatalogHit => !!item && typeof item === "object")
    : [];
  return {
    count: typeof payload.count === "number" ? payload.count : results.length,
    query: typeof payload.query === "string" ? payload.query : query,
    results,
  };
}

export async function adviseWorkstation(
  question: string,
  root: string,
  csrfToken: string,
  signal?: AbortSignal,
): Promise<AdviceReport> {
  const response = await fetch("/api/workstation/v1/advise", {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-CSRF-Token": csrfToken,
    },
    body: JSON.stringify({ question, root }),
    signal,
  });
  if (!response.ok) {
    throw new WorkstationClientError(await readError(response, "Öneri alınamadı."), response.status);
  }
  return (await response.json()) as AdviceReport;
}
