export type V8Identity = {
  userId: string;
  organizationId: string;
  /** JWT for production; when set it takes precedence over the dev headers. */
  token?: string;
};

export type V8Page<T> = {
  items: T[];
  total: number;
  limit: number;
  offset: number;
  next_offset: number | null;
};

export type V8Operation = {
  id: string;
  organization_id: string;
  code: string;
  route_origin: string;
  route_destination: string;
  departure_date: string;
  vessel_name: string;
  status: string;
  notes: string;
  version: number;
  created_at: string;
  updated_at: string;
};

export type V8Passenger = {
  id: string;
  organization_id: string;
  operation_id: string;
  first_name: string;
  last_name: string;
  full_name: string;
  passport_masked: string;
  voucher: string;
  arrival_date: string | null;
  adult_fee: string;
  child_fee: string;
  currency: string;
  source_file: string;
  source_row: number | null;
  photo_object_key: string | null;
  version: number;
  created_at: string;
  updated_at: string;
};

export type V8PassportReveal = {
  passenger_id: string;
  passport_no: string;
};

export type V8PassengerPhoto = {
  passenger_id: string;
  object_key: string;
  sha256: string;
  size_bytes: number;
  mime_type: string;
  version: number;
};

export type V8ImportPreview = {
  batch: {
    id: string;
    operation_id: string;
    filename: string;
    status: string;
    total_rows: number;
    valid_rows: number;
    invalid_rows: number;
  };
  rows: Array<{
    id: string;
    row_number: number;
    is_valid: boolean;
    errors: string[];
    preview: Record<string, string | number | null>;
  }>;
  warnings: string[];
};

export type V8ImportCommit = {
  batch_id: string;
  status: string;
  created: number;
  skipped_duplicates: number;
  invalid_rows: number;
};

const API_URL_STORAGE_KEY = "excelbase-v8-api-url";

/** Build-time default, overridable at runtime so a static export can point
 * at a different API origin without a rebuild. */
function v8ApiBase(): string {
  if (typeof window !== "undefined") {
    const saved = window.localStorage.getItem(API_URL_STORAGE_KEY);
    if (saved) return saved.replace(/\/+$/, "");
  }
  return process.env.NEXT_PUBLIC_V8_API_URL ?? "http://localhost:8080";
}

export function getV8ApiUrl(): string {
  return v8ApiBase();
}

export function setV8ApiUrl(url: string): void {
  const trimmed = url.trim().replace(/\/+$/, "");
  if (trimmed) {
    window.localStorage.setItem(API_URL_STORAGE_KEY, trimmed);
  } else {
    window.localStorage.removeItem(API_URL_STORAGE_KEY);
  }
}

function identityHeaders(identity: V8Identity, headers: Headers): void {
  if (identity.token) {
    headers.set("Authorization", `Bearer ${identity.token}`);
    return;
  }
  // Dev headers are accepted only when the backend explicitly enables development identity.
  if (identity.userId) headers.set("X-User-ID", identity.userId);
  if (identity.organizationId) headers.set("X-Organization-ID", identity.organizationId);
}

async function v8Request<T>(
  path: string,
  identity: V8Identity,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  identityHeaders(identity, headers);
  const response = await fetch(`${v8ApiBase()}${path}`, {
    ...init,
    headers,
    credentials: "include",
    cache: "no-store",
  });
  if (!response.ok) {
    let detail = `${response.status}`;
    try {
      const body = (await response.json()) as { detail?: string };
      detail = body.detail ?? detail;
    } catch {
      detail = (await response.text()) || detail;
    }
    throw new Error(detail);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export async function getV8SetupStatus(): Promise<{ setup_required: boolean }> {
  const response = await fetch(`${v8ApiBase()}/api/v8/setup`, { cache: "no-store" });
  if (!response.ok) throw new Error(`Kurulum durumu alınamadı (${response.status}).`);
  return (await response.json()) as { setup_required: boolean };
}

export async function runV8Setup(payload: {
  organization?: string;
  email: string;
  display_name: string;
}): Promise<{ token: string; organization_id: string; user_id: string }> {
  const response = await fetch(`${v8ApiBase()}/api/v8/setup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    cache: "no-store",
  });
  if (!response.ok) {
    let detail = `${response.status}`;
    try {
      const body = (await response.json()) as { detail?: string };
      detail = body.detail ?? detail;
    } catch {
      /* yanıt gövdesi yoksa durum kodu yeterli */
    }
    throw new Error(detail);
  }
  return (await response.json()) as { token: string; organization_id: string; user_id: string };
}

export function listV8Operations(
  identity: V8Identity,
  options: { limit?: number; offset?: number } = {},
): Promise<V8Page<V8Operation>> {
  const params = new URLSearchParams();
  if (options.limit) params.set("limit", String(options.limit));
  if (options.offset) params.set("offset", String(options.offset));
  const query = params.size ? `?${params.toString()}` : "";
  return v8Request<V8Page<V8Operation>>(`/api/v8/operations${query}`, identity);
}

export function createV8Operation(
  identity: V8Identity,
  payload: {
    code: string;
    route_origin: string;
    route_destination: string;
    departure_date: string;
    vessel_name?: string;
    notes?: string;
  },
): Promise<V8Operation> {
  return v8Request<V8Operation>("/api/v8/operations", identity, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function listV8Passengers(
  identity: V8Identity,
  operationId: string,
  options: { limit?: number; offset?: number } = {},
): Promise<V8Page<V8Passenger>> {
  const params = new URLSearchParams();
  if (options.limit) params.set("limit", String(options.limit));
  if (options.offset) params.set("offset", String(options.offset));
  const query = params.size ? `?${params.toString()}` : "";
  return v8Request<V8Page<V8Passenger>>(`/api/v8/operations/${operationId}/passengers${query}`, identity);
}

export function createV8Passenger(
  identity: V8Identity,
  operationId: string,
  payload: {
    first_name: string;
    last_name: string;
    passport_no: string;
    voucher?: string;
    arrival_date?: string | null;
    adult_fee?: string;
    child_fee?: string;
    currency?: string;
  },
): Promise<V8Passenger> {
  return v8Request<V8Passenger>(`/api/v8/operations/${operationId}/passengers`, identity, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function revealV8Passport(identity: V8Identity, passengerId: string): Promise<V8PassportReveal> {
  return v8Request<V8PassportReveal>(`/api/v8/passengers/${passengerId}/passport/reveal`, identity, {
    method: "POST",
  });
}

export async function uploadV8PassengerPhoto(
  identity: V8Identity,
  passengerId: string,
  file: File,
): Promise<V8PassengerPhoto> {
  const body = new FormData();
  body.append("file", file);
  return v8Request<V8PassengerPhoto>(`/api/v8/passengers/${passengerId}/photo`, identity, {
    method: "POST",
    body,
  });
}

export async function fetchV8PassengerPhoto(
  identity: V8Identity,
  passengerId: string,
): Promise<Blob> {
  const headers = new Headers();
  identityHeaders(identity, headers);
  const response = await fetch(`${v8ApiBase()}/api/v8/passengers/${passengerId}/photo`, {
    headers,
    credentials: "include",
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Fotoğraf alınamadı (${response.status}).`);
  return response.blob();
}

export function deleteV8PassengerPhoto(identity: V8Identity, passengerId: string): Promise<void> {
  return v8Request<void>(`/api/v8/passengers/${passengerId}/photo`, identity, { method: "DELETE" });
}

export async function stageV8Import(
  identity: V8Identity,
  operationId: string,
  file: File,
): Promise<V8ImportPreview> {
  const body = new FormData();
  body.append("file", file);
  return v8Request<V8ImportPreview>(`/api/v8/operations/${operationId}/imports`, identity, {
    method: "POST",
    body,
  });
}

export function commitV8Import(identity: V8Identity, batchId: string): Promise<V8ImportCommit> {
  return v8Request<V8ImportCommit>(`/api/v8/imports/${batchId}/commit`, identity, {
    method: "POST",
  });
}
