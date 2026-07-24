export type AssistantDateScope = {
  range?: string;
  start?: string;
  end?: string;
  field?: string;
};

export type AssistantSummarySource = {
  passenger_count?: unknown;
  ready_count?: unknown;
  missing_count?: unknown;
  with_photo?: unknown;
  missing_photo?: unknown;
  missing_passport?: unknown;
  missing_voucher?: unknown;
  missing_fee?: unknown;
  duplicates?: unknown;
  today_count?: unknown;
  readiness_percent?: unknown;
  adult_total?: unknown;
  child_total?: unknown;
  total_fee?: unknown;
  issue_counts?: unknown;
  [key: string]: unknown;
};

export type SafeAssistantContext = {
  version: 1;
  scope: {
    range: "all" | "today" | "week" | "month" | "custom";
    field: "departure" | "created";
    start: string;
    end: string;
  };
  metrics: {
    passenger_count: number;
    ready_count: number;
    missing_count: number;
    with_photo: number;
    missing_photo: number;
    missing_passport: number;
    missing_voucher: number;
    missing_fee: number;
    duplicates: number;
    today_count: number;
    readiness_percent: number;
    adult_total: number;
    child_total: number;
    total_fee: number;
  };
  issues: {
    missing_photo: number;
    missing_passport: number;
    missing_voucher: number;
    missing_fee: number;
    duplicate: number;
    missing_name: number;
    invalid_date: number;
  };
};

const RANGE_MAP: Record<string, SafeAssistantContext["scope"]["range"]> = {
  Tümü: "all",
  Bugün: "today",
  "Bu hafta": "week",
  "Bu ay": "month",
  Aralık: "custom",
};

const ISSUE_MAP = {
  Fotosuz: "missing_photo",
  Pasaportsuz: "missing_passport",
  "Voucher eksik": "missing_voucher",
  Ücretsiz: "missing_fee",
  Tekrarlı: "duplicate",
  "İsim eksik": "missing_name",
  "Tarih hatası": "invalid_date",
} as const;

function boundedCount(value: unknown, maximum = 1_000_000): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(maximum, Math.trunc(value)));
}

function boundedAmount(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.round(Math.max(0, Math.min(1_000_000_000, value)) * 100) / 100;
}

function safeDate(value: unknown): string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
}

function safeIssues(value: unknown): SafeAssistantContext["issues"] {
  const result: SafeAssistantContext["issues"] = {
    missing_photo: 0,
    missing_passport: 0,
    missing_voucher: 0,
    missing_fee: 0,
    duplicate: 0,
    missing_name: 0,
    invalid_date: 0,
  };
  if (!value || typeof value !== "object" || Array.isArray(value)) return result;
  const source = value as Record<string, unknown>;
  for (const [sourceKey, targetKey] of Object.entries(ISSUE_MAP)) {
    result[targetKey] = boundedCount(source[sourceKey]);
  }
  return result;
}

/**
 * Build the only context shape that the keyless assistant scaffold may later
 * send to a provider.  It accepts a full summary object but selects aggregate
 * numbers only; filenames, passenger rows, passports, notes and document
 * payloads have no output field.
 */
export function buildAssistantContext(
  summary: AssistantSummarySource,
  scope: AssistantDateScope = {},
): SafeAssistantContext {
  return {
    version: 1,
    scope: {
      range: RANGE_MAP[scope.range ?? ""] ?? "all",
      field: scope.field === "created" ? "created" : "departure",
      start: safeDate(scope.start),
      end: safeDate(scope.end),
    },
    metrics: {
      passenger_count: boundedCount(summary.passenger_count),
      ready_count: boundedCount(summary.ready_count),
      missing_count: boundedCount(summary.missing_count),
      with_photo: boundedCount(summary.with_photo),
      missing_photo: boundedCount(summary.missing_photo),
      missing_passport: boundedCount(summary.missing_passport),
      missing_voucher: boundedCount(summary.missing_voucher),
      missing_fee: boundedCount(summary.missing_fee),
      duplicates: boundedCount(summary.duplicates),
      today_count: boundedCount(summary.today_count),
      readiness_percent: boundedCount(summary.readiness_percent, 100),
      adult_total: boundedAmount(summary.adult_total),
      child_total: boundedAmount(summary.child_total),
      total_fee: boundedAmount(summary.total_fee),
    },
    issues: safeIssues(summary.issue_counts),
  };
}
