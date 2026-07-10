export type V8Identity = {
  userId: string;
  organizationId: string;
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
  passport_no: string;
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

const V8_API_BASE = process.env.NEXT_PUBLIC_V8_API_URL ?? "http://localhost:8080";

async function v8Request<T>(
  path: string,
  identity: V8Identity,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  // These headers are accepted only when the backend explicitly enables development identity.
  if (identity.userId) headers.set("X-User-ID", identity.userId);
  if (identity.organizationId) headers.set("X-Organization-ID", identity.organizationId);
  const response = await fetch(`${V8_API_BASE}${path}`, {
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

export function listV8Operations(identity: V8Identity): Promise<V8Operation[]> {
  return v8Request<V8Operation[]>("/api/v8/operations", identity);
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

export function listV8Passengers(identity: V8Identity, operationId: string): Promise<V8Passenger[]> {
  return v8Request<V8Passenger[]>(`/api/v8/operations/${operationId}/passengers`, identity);
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
