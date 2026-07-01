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
};

export type ImportHistoryItem = {
  time?: string;
  files?: string;
  rows?: number;
  mode?: string;
};

export type OperationMeta = {
  date_key: string;
  status: string;
  staff: string;
  note: string;
};

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

export type ImportResponse = {
  imported: number;
  warnings: string[];
  loaded_files: string[];
  passenger_count: number;
};

export type MatchPhotosResponse = {
  matched: number;
  unmatched: string[];
  passenger_count: number;
  with_photo: number;
};

export type SimpleResult = { ok: boolean; message: string; passenger_count: number };

export const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "";
const API_KEY = process.env.NEXT_PUBLIC_API_KEY ?? "";

function authHeaders(extra?: HeadersInit): HeadersInit {
  return { ...(API_KEY ? { "x-api-key": API_KEY } : {}), ...(extra ?? {}) };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: authHeaders(init?.headers),
  });
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
  return response.json() as Promise<T>;
}

/** Dosya indirme / görsel URL'i (anahtar query param olarak eklenir). */
export function downloadUrl(path: string): string {
  if (!API_KEY) return `${API_BASE}${path}`;
  const sep = path.includes("?") ? "&" : "?";
  return `${API_BASE}${path}${sep}k=${encodeURIComponent(API_KEY)}`;
}

export function fetchSummary(): Promise<OperationSummary> {
  return request<OperationSummary>("/api/summary");
}

export function fetchPassengers(params: {
  search?: string;
  status?: string;
  sort?: string;
} = {}): Promise<Passenger[]> {
  const qs = new URLSearchParams();
  if (params.search) qs.set("search", params.search);
  if (params.status) qs.set("status", params.status);
  if (params.sort) qs.set("sort", params.sort);
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return request<Passenger[]>(`/api/passengers${suffix}`);
}

export function fetchArchive(range = "Tümü", start = "", end = ""): Promise<ArchiveResponse> {
  const qs = new URLSearchParams({ range });
  if (start) qs.set("start", start);
  if (end) qs.set("end", end);
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

export function loadDemo(): Promise<SimpleResult> {
  return request<SimpleResult>("/api/demo", { method: "POST" });
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

export async function uploadPassengerFiles(
  files: FileList | File[],
  replace = false,
  dupStrategy = "add",
): Promise<ImportResponse> {
  const body = new FormData();
  Array.from(files).forEach((file) => body.append("files", file));
  return request<ImportResponse>(
    `/api/import?replace=${String(replace)}&dup_strategy=${dupStrategy}`,
    { method: "POST", body },
  );
}

export async function matchPhotos(files: FileList | File[]): Promise<MatchPhotosResponse> {
  const body = new FormData();
  Array.from(files).forEach((file) => body.append("files", file));
  return request<MatchPhotosResponse>("/api/photos/match", { method: "POST", body });
}

export async function setPassengerPhoto(id: number, file: File): Promise<SimpleResult> {
  const body = new FormData();
  body.append("file", file);
  return request<SimpleResult>(`/api/passengers/${id}/photo`, { method: "POST", body });
}

export function removePassengerPhoto(id: number): Promise<SimpleResult> {
  return request<SimpleResult>(`/api/passengers/${id}/photo`, { method: "DELETE" });
}

export async function restoreBackup(file: File): Promise<SimpleResult> {
  const body = new FormData();
  body.append("file", file);
  return request<SimpleResult>("/api/restore", { method: "POST", body });
}
