import { newId } from "@/lib/id";

export type DateScope = {
  range: string;
  start: string;
  end: string;
};

export type Passenger = {
  id: number;
  no: string;
  first_name: string;
  last_name: string;
  full_name: string;
  passport_no: string;
  voucher: string;
  departure_date: string;
  arrival_date: string;
  adult_fee: string;
  child_fee: string;
  source_file: string;
  sheet: string;
  photo: string;
  photo_url: string;
  issues: string[];
  duplicate: boolean;
};

export type ImportHistoryItem = {
  time?: string;
  files?: string;
  file_count?: number;
  rows?: number;
  mode?: string;
  batch_id?: string;
  undone?: boolean;
};

export type OperationSummary = {
  passenger_count: number;
  adult_total: number;
  child_total: number;
  total_fee: number;
  with_photo: number;
  missing_photo: number;
  missing_passport: number;
  missing_voucher: number;
  missing_fee: number;
  duplicates: number;
  readiness_percent: number;
  issue_counts: Record<string, number>;
  loaded_files: string[];
  import_history: ImportHistoryItem[];
  today_count: number;
  can_undo: boolean;
  last_batch_id: string;
  unmatched_photo_count: number;
  persistence: string;
  version: string;
};

export type OperationMeta = { date_key: string; status: string; staff: string; note: string };
export type ArchiveGroup = {
  date_key: string;
  count: number;
  adult_total: number;
  child_total: number;
  total: number;
  with_photo: number;
  passenger_ids: number[];
  meta: OperationMeta | null;
};
export type ArchiveResponse = { groups: ArchiveGroup[]; total_count: number };

export type ImportPreviewResponse = {
  filename: string;
  rows: number;
  warnings: string[];
  duplicate_count: number;
  invalid_count: number;
};

export type ImportJob = {
  id: string;
  filename: string;
  status: "pending" | "processing" | "done" | "error";
  imported: number;
  duplicates: number;
  invalid: number;
  message: string;
  created_at: string;
  finished_at: string;
};

export type ImportQueueResponse = {
  jobs: ImportJob[];
  active: boolean;
  batch_id: string;
};

export type ImportResponse = {
  imported: number;
  warnings: string[];
  loaded_files: string[];
  passenger_count: number;
  batch_id: string;
  duplicate_count: number;
  invalid_count: number;
};

export type MatchPhotosResponse = {
  matched: number;
  unmatched: string[];
  passenger_count: number;
  with_photo: number;
  matches: Array<{
    filename: string;
    passenger_id: number;
    passenger_name: string;
    method: string;
    confidence: number;
  }>;
};

export type UnmatchedPhoto = { id: string; filename: string; photo_url: string; created_at: string };
export type SimpleResult = { ok: boolean; message: string; passenger_count: number };
export type AuthUser = { id: string; name: string; role: "admin" | "operator" | "viewer" };
export type AuthStatus = { setup_required: boolean; authenticated: boolean; user: AuthUser | null };
export type UserView = AuthUser & { active: boolean };
export type AuditEntry = { id: string; time: string; actor: string; role: string; action: string; path: string };
export type BackupInfo = { snapshot_date: string };
export type MailImportResponse = {
  subject: string;
  sender: string;
  attachment_count: number;
  imported_rows: number;
  matched_photos: number;
  stored_documents: number;
  warnings: string[];
};

export const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "";
const API_KEY = process.env.NEXT_PUBLIC_API_KEY ?? "";

function authHeaders(extra?: HeadersInit): HeadersInit {
  return { ...(API_KEY ? { "x-api-key": API_KEY } : {}), ...(extra ?? {}) };
}

function unreadableUploadMessage(file: File): string {
  return `${file.name || "Dosya"}: dosya içeriği telefondan okunamadı. Dosyayı yeniden seçin.`;
}

async function appendReadableFile(body: FormData, field: string, file: File): Promise<void> {
  if (!(file instanceof Blob) || file.size === 0) throw new Error(unreadableUploadMessage(file));
  try {
    const probe = await file.slice(0, 1).arrayBuffer();
    if (probe.byteLength === 0) throw new Error(unreadableUploadMessage(file));
  } catch {
    throw new Error(unreadableUploadMessage(file));
  }
  body.append(field, file, file.name);
}

async function request<T>(path: string, init?: RequestInit, timeoutMs = 45_000): Promise<T> {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      credentials: "include",
      headers: authHeaders(init?.headers),
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error("İşlem zaman aşımına uğradı. Bağlantıyı kontrol edip yeniden deneyin.");
    }
    throw error;
  } finally {
    globalThis.clearTimeout(timeout);
  }
  if (!response.ok) {
    let detail = `${response.status}`;
    try {
      const body = await response.json();
      detail = body?.detail ?? detail;
    } catch {
      detail = (await response.text()) || detail;
    }
    throw new Error(detail);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

function appendScope(qs: URLSearchParams, scope?: DateScope): void {
  if (!scope) return;
  qs.set("range", scope.range || "Tümü");
  if (scope.start) qs.set("start", scope.start);
  if (scope.end) qs.set("end", scope.end);
}

export function scopedPath(path: string, scope?: DateScope): string {
  if (!scope) return path;
  const [base, query = ""] = path.split("?", 2);
  const qs = new URLSearchParams(query);
  appendScope(qs, scope);
  return `${base}?${qs.toString()}`;
}

export function downloadUrl(path: string): string {
  if (!API_KEY) return `${API_BASE}${path}`;
  const sep = path.includes("?") ? "&" : "?";
  return `${API_BASE}${path}${sep}k=${encodeURIComponent(API_KEY)}`;
}

export function fetchAuthStatus(): Promise<AuthStatus> {
  return request<AuthStatus>("/api/auth/status");
}
export function setupAuth(displayName: string, pin: string): Promise<AuthStatus> {
  return request<AuthStatus>("/api/auth/setup", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ display_name: displayName, pin }),
  });
}
export function login(pin: string): Promise<AuthStatus> {
  return request<AuthStatus>("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pin }),
  });
}
export function logout(): Promise<SimpleResult> {
  return request<SimpleResult>("/api/auth/logout", { method: "POST" });
}

export function fetchSummary(scope?: DateScope): Promise<OperationSummary> {
  return request<OperationSummary>(scopedPath("/api/summary", scope));
}
export function fetchPassengers(
  params: { search?: string; status?: string; sort?: string; scope?: DateScope } = {},
): Promise<Passenger[]> {
  const qs = new URLSearchParams();
  if (params.search) qs.set("search", params.search);
  if (params.status) qs.set("status", params.status);
  if (params.sort) qs.set("sort", params.sort);
  appendScope(qs, params.scope);
  return request<Passenger[]>(`/api/passengers${qs.size ? `?${qs.toString()}` : ""}`);
}
export function fetchArchive(scope: DateScope = { range: "Tümü", start: "", end: "" }): Promise<ArchiveResponse> {
  const qs = new URLSearchParams();
  appendScope(qs, scope);
  return request<ArchiveResponse>(`/api/archive?${qs.toString()}`);
}

export function updatePassenger(id: number, updates: Partial<Passenger>): Promise<SimpleResult> {
  return request<SimpleResult>(`/api/passengers/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(updates),
  });
}
export function deletePassenger(id: number): Promise<SimpleResult> {
  return request<SimpleResult>(`/api/passengers/${id}`, { method: "DELETE" });
}
export function bulkDelete(ids: number[]): Promise<SimpleResult> {
  return request<SimpleResult>("/api/passengers/bulk-delete", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ids }),
  });
}
export function clearAll(): Promise<SimpleResult> {
  return request<SimpleResult>("/api/passengers/clear", { method: "POST" });
}
export function mergeDuplicates(passportKey = ""): Promise<{ removed: number; passenger_count: number }> {
  const qs = passportKey ? `?passport_key=${encodeURIComponent(passportKey)}` : "";
  return request(`/api/merge-duplicates${qs}`, { method: "POST" });
}
export function saveOperationMeta(meta: OperationMeta): Promise<SimpleResult> {
  return request<SimpleResult>("/api/operation-meta", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(meta),
  });
}

export async function previewPassengerFile(file: File): Promise<ImportPreviewResponse> {
  const body = new FormData();
  await appendReadableFile(body, "file", file);
  return request<ImportPreviewResponse>("/api/import/preview", { method: "POST", body });
}
export async function uploadPassengerFile(
  file: File,
  replace: boolean,
  dupStrategy: string,
  batchId: string,
): Promise<ImportResponse> {
  const body = new FormData();
  await appendReadableFile(body, "files", file);
  const qs = new URLSearchParams({ replace: String(replace), dup_strategy: dupStrategy, batch_id: batchId });
  return request<ImportResponse>(`/api/import?${qs.toString()}`, { method: "POST", body }, 120_000);
}
export async function uploadPassengerFiles(
  files: FileList | File[],
  replace = false,
  dupStrategy = "add",
): Promise<ImportResponse> {
  const body = new FormData();
  for (const file of Array.from(files)) await appendReadableFile(body, "files", file);
  const qs = new URLSearchParams({
    replace: String(replace),
    dup_strategy: dupStrategy,
    batch_id: newId(),
  });
  return request<ImportResponse>(`/api/import?${qs.toString()}`, { method: "POST", body });
}
export async function queueImportFiles(
  files: File[],
  replace: boolean,
  dupStrategy: string,
): Promise<ImportQueueResponse> {
  const body = new FormData();
  for (const file of files) await appendReadableFile(body, "files", file);
  const qs = new URLSearchParams({ replace: String(replace), dup_strategy: dupStrategy, batch_id: newId() });
  return request<ImportQueueResponse>(`/api/import/queue?${qs.toString()}`, { method: "POST", body }, 300_000);
}
export function fetchImportQueue(): Promise<ImportQueueResponse> {
  return request<ImportQueueResponse>("/api/import/queue");
}
export function retryImportJob(jobId: string): Promise<SimpleResult> {
  return request<SimpleResult>(`/api/import/queue/${encodeURIComponent(jobId)}/retry`, { method: "POST" });
}
export function deleteImportJob(jobId: string): Promise<SimpleResult> {
  return request<SimpleResult>(`/api/import/queue/${encodeURIComponent(jobId)}`, { method: "DELETE" });
}
export function undoImport(batchId = ""): Promise<SimpleResult> {
  const suffix = batchId ? `?batch_id=${encodeURIComponent(batchId)}` : "";
  return request<SimpleResult>(`/api/import/undo${suffix}`, { method: "POST" });
}

export async function matchPhotos(files: FileList | File[]): Promise<MatchPhotosResponse> {
  const body = new FormData();
  for (const file of Array.from(files)) await appendReadableFile(body, "files", file);
  return request<MatchPhotosResponse>("/api/photos/match", { method: "POST", body }, 120_000);
}
export async function setPassengerPhoto(id: number, file: File): Promise<SimpleResult> {
  const body = new FormData();
  await appendReadableFile(body, "file", file);
  return request<SimpleResult>(`/api/passengers/${id}/photo`, { method: "POST", body });
}
export function removePassengerPhoto(id: number): Promise<SimpleResult> {
  return request<SimpleResult>(`/api/passengers/${id}/photo`, { method: "DELETE" });
}
export function fetchUnmatchedPhotos(): Promise<UnmatchedPhoto[]> {
  return request<UnmatchedPhoto[]>("/api/photos/unmatched");
}
export function assignUnmatchedPhoto(itemId: string, passengerId: number): Promise<SimpleResult> {
  return request<SimpleResult>(`/api/photos/unmatched/${itemId}/assign`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ passenger_id: passengerId }),
  });
}
export function deleteUnmatchedPhoto(itemId: string): Promise<SimpleResult> {
  return request<SimpleResult>(`/api/photos/unmatched/${itemId}`, { method: "DELETE" });
}

export async function importMail(file: File, batchId: string): Promise<MailImportResponse> {
  const body = new FormData();
  await appendReadableFile(body, "file", file);
  return request<MailImportResponse>(`/api/mail/import?batch_id=${encodeURIComponent(batchId)}`, {
    method: "POST",
    body,
  }, 120_000);
}

export async function restoreBackup(file: File): Promise<SimpleResult> {
  const body = new FormData();
  await appendReadableFile(body, "file", file);
  return request<SimpleResult>("/api/restore", { method: "POST", body });
}
export function fetchBackups(): Promise<BackupInfo[]> {
  return request<BackupInfo[]>("/api/backups");
}
export function restoreDailyBackup(snapshotDate: string): Promise<SimpleResult> {
  return request<SimpleResult>(`/api/backups/${encodeURIComponent(snapshotDate)}/restore`, { method: "POST" });
}
export function fetchUsers(): Promise<UserView[]> {
  return request<UserView[]>("/api/users");
}
export function createUser(name: string, pin: string, role: string): Promise<UserView> {
  return request<UserView>("/api/users", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, pin, role }),
  });
}
export function deactivateUser(userId: string): Promise<SimpleResult> {
  return request<SimpleResult>(`/api/users/${userId}`, { method: "DELETE" });
}
export function fetchAudit(): Promise<AuditEntry[]> {
  return request<AuditEntry[]>("/api/audit?limit=150");
}
