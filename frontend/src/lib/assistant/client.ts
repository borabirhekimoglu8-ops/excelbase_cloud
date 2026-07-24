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

export type AssistantStatus = {
  available: boolean;
  online_required: true;
  privacy_mode: "strict";
  capabilities: AssistantCapability[];
};

const CAPABILITY_SET = new Set<string>(ASSISTANT_READ_ONLY_CAPABILITIES);

function isAssistantStatus(value: unknown): value is AssistantStatus {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const status = value as Record<string, unknown>;
  return (
    typeof status.available === "boolean"
    && status.online_required === true
    && status.privacy_mode === "strict"
    && Array.isArray(status.capabilities)
    && status.capabilities.every((item) => typeof item === "string" && CAPABILITY_SET.has(item))
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
