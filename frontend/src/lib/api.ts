export type Passenger = {
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
  readiness_percent: number;
  loaded_files: string[];
};

export const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const API_KEY = process.env.NEXT_PUBLIC_API_KEY ?? "";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      ...(API_KEY ? { "x-api-key": API_KEY } : {}),
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    throw new Error(`API ${response.status}: ${await response.text()}`);
  }

  return response.json() as Promise<T>;
}

export function fetchSummary(): Promise<OperationSummary> {
  return request<OperationSummary>("/api/summary");
}

export function fetchPassengers(search = ""): Promise<Passenger[]> {
  const query = search ? `?search=${encodeURIComponent(search)}` : "";
  return request<Passenger[]>(`/api/passengers${query}`);
}

export async function uploadPassengerFiles(files: FileList, replace = false) {
  const body = new FormData();
  Array.from(files).forEach((file) => body.append("files", file));
  return request<{ imported: number; warnings: string[]; loaded_files: string[] }>(
    `/api/import?replace=${String(replace)}`,
    { method: "POST", body },
  );
}
