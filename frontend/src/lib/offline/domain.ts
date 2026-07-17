import { REQUIRED_DOCUMENT_CATEGORIES } from "@/lib/api";
import type {
  ArchiveGroup,
  DateScope,
  DocumentCategory,
  ImportHistoryItem,
  OperationMeta,
  OperationSummary,
  Passenger,
  PassengerDocument,
  RecordFolder,
  RecordStatus,
} from "@/lib/api";

export type StoredPassengerDocument = Omit<PassengerDocument, "category"> & { category?: DocumentCategory };

export type StoredPassenger = Omit<
  Passenger,
  | "issues"
  | "duplicate"
  | "photo_url"
  | "documents"
  | "created_at"
  | "record_date"
  | "created_by"
  | "record_status"
  | "record_source"
> & {
  documents?: StoredPassengerDocument[];
  created_at?: string;
  record_date?: string;
  created_by?: string;
  record_status?: RecordStatus;
  record_source?: "manual" | "import";
  /** Internal idempotency marker; never exported to the passenger workbook. */
  _import_job_id?: string;
};

const TURKISH_FOLD: Record<string, string> = {
  ç: "c",
  ğ: "g",
  ı: "i",
  i: "i",
  ö: "o",
  ş: "s",
  ü: "u",
};

export function text(value: unknown): string {
  if (value === null || value === undefined) return "";
  const result = String(value).trim();
  return result.toLocaleLowerCase("tr-TR") === "nan" ? "" : result;
}

export function fold(value: unknown): string {
  return text(value)
    .toLocaleLowerCase("tr-TR")
    .replace(/[çğıiöşü]/g, (letter) => TURKISH_FOLD[letter] ?? letter)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

export function canonicalDate(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return [value.getFullYear(), value.getMonth() + 1, value.getDate()]
      .map((part, index) => String(part).padStart(index === 0 ? 4 : 2, "0"))
      .join("-");
  }
  const raw = text(value);
  if (!raw) return "";
  const datePart = raw.split(/[T ]/, 1)[0];
  let match = datePart.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (match) return validDateParts(Number(match[1]), Number(match[2]), Number(match[3]));
  match = datePart.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (match) return validDateParts(Number(match[3]), Number(match[2]), Number(match[1]));
  return "";
}

function validDateParts(year: number, month: number, day: number): string {
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return "";
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function amount(value: unknown): number {
  const raw = text(value).replace(/\s/g, "");
  const found = raw.match(/[-+]?\d*[.,]?\d+/)?.[0];
  if (!found) return 0;
  const parsed = Number(found.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function passengerIdentity(passenger: Pick<StoredPassenger, "passport_no" | "departure_date">): string {
  const passport = fold(passenger.passport_no).toUpperCase();
  if (!passport) return "";
  return `${passport}|${canonicalDate(passenger.departure_date) || text(passenger.departure_date)}`;
}

export function duplicateIdentities(rows: StoredPassenger[]): Set<string> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const identity = passengerIdentity(row);
    if (identity) counts.set(identity, (counts.get(identity) ?? 0) + 1);
  }
  return new Set([...counts].filter(([, count]) => count > 1).map(([identity]) => identity));
}

export function rowIssues(row: StoredPassenger, duplicates: Set<string>): string[] {
  const issues: string[] = [];
  if (!text(row.photo)) issues.push("Foto yok");
  if (!text(row.passport_no)) issues.push("Pasaport yok");
  if (!text(row.voucher)) issues.push("Voucher yok");
  if (!text(row.adult_fee) && !text(row.child_fee)) issues.push("Ücret yok");
  const identity = passengerIdentity(row);
  if (identity && duplicates.has(identity)) issues.push("Tekrarlı");
  if (!text(row.full_name)) issues.push("İsim yok");
  const departure = canonicalDate(row.departure_date);
  const arrival = canonicalDate(row.arrival_date);
  if (departure && arrival && arrival < departure) issues.push("Tarih hatalı");
  const passport = fold(row.passport_no);
  if (passport && passport.length < 6) issues.push("Pasaport formatı");
  const categories = new Set((row.documents ?? []).map((document) => document.category ?? "other"));
  const labels: Record<string, string> = { passport: "Pasaport PDF yok", application_form: "Başvuru formu PDF yok" };
  for (const category of REQUIRED_DOCUMENT_CATEGORIES) {
    if (!categories.has(category)) issues.push(labels[category] ?? `${category} PDF yok`);
  }
  return issues;
}

function normalizedDocuments(documents: StoredPassengerDocument[] | undefined): PassengerDocument[] {
  return (documents ?? []).map((document) => ({ ...document, category: document.category ?? "other" }));
}

export function resolvedRecordStatus(row: StoredPassenger, issues: string[]): RecordStatus {
  if (row.record_status === "draft") return "draft";
  return issues.length ? "review" : "ready";
}

export function toPassenger(row: StoredPassenger, duplicates: Set<string>, photoUrl = ""): Passenger {
  const issues = rowIssues(row, duplicates);
  const { _import_job_id: _internalJobId, ...publicRow } = row;
  return {
    ...publicRow,
    departure_date: canonicalDate(row.departure_date) || text(row.departure_date),
    arrival_date: canonicalDate(row.arrival_date) || text(row.arrival_date),
    full_name: text(row.full_name) || [text(row.first_name), text(row.last_name)].filter(Boolean).join(" "),
    created_at: text(row.created_at),
    record_date: canonicalDate(row.record_date),
    created_by: text(row.created_by) || "Bilinmiyor",
    record_source: row.record_source === "manual" ? "manual" : "import",
    record_status: resolvedRecordStatus(row, issues),
    photo_url: photoUrl,
    documents: normalizedDocuments(row.documents),
    issues,
    duplicate: issues.includes("Tekrarlı"),
  };
}

function localIsoDate(date = new Date()): string {
  return validDateParts(date.getFullYear(), date.getMonth() + 1, date.getDate());
}

function scopeBounds(scope?: DateScope): [string, string] | null {
  if (!scope || !scope.range || scope.range === "Tümü") return null;
  const today = new Date();
  if (scope.range === "Bugün") {
    const iso = localIsoDate(today);
    return [iso, iso];
  }
  if (scope.range === "Bu hafta") {
    const monday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const weekday = (monday.getDay() + 6) % 7;
    monday.setDate(monday.getDate() - weekday);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    return [localIsoDate(monday), localIsoDate(sunday)];
  }
  if (scope.range === "Bu ay") {
    const first = new Date(today.getFullYear(), today.getMonth(), 1);
    const last = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    return [localIsoDate(first), localIsoDate(last)];
  }
  if (scope.range === "Aralık") {
    const start = canonicalDate(scope.start || scope.end);
    const end = canonicalDate(scope.end || scope.start);
    return start && end ? (start <= end ? [start, end] : [end, start]) : null;
  }
  return null;
}

export function filterScope(rows: StoredPassenger[], scope?: DateScope): StoredPassenger[] {
  const bounds = scopeBounds(scope);
  if (!bounds) return rows;
  return rows.filter((row) => {
    const date = scope?.field === "created"
      ? canonicalDate(row.record_date)
      : canonicalDate(row.departure_date);
    return Boolean(date && date >= bounds[0] && date <= bounds[1]);
  });
}

export function buildRecordFolders(
  allRows: StoredPassenger[],
  scope?: DateScope,
): { groups: RecordFolder[]; total_count: number } {
  const recordScope = { ...(scope ?? { range: "Tümü", start: "", end: "" }), field: "created" as const };
  const rows = filterScope(allRows, recordScope);
  const duplicates = duplicateIdentities(rows);
  const groups = new Map<string, StoredPassenger[]>();
  for (const row of rows) {
    const key = canonicalDate(row.record_date) || "Tarihsiz";
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return {
    groups: [...groups.entries()]
      .toSorted(([a], [b]) => (a === "Tarihsiz" ? 1 : b === "Tarihsiz" ? -1 : b.localeCompare(a)))
      .map(([dateKey, group]) => {
        const statuses = group.map((row) => resolvedRecordStatus(row, rowIssues(row, duplicates)));
        return {
          date_key: dateKey,
          count: group.length,
          ready_count: statuses.filter((status) => status === "ready").length,
          review_count: statuses.filter((status) => status === "review").length,
          draft_count: statuses.filter((status) => status === "draft").length,
          with_photo: group.filter((row) => Boolean(row.photo)).length,
          document_count: group.reduce((count, row) => count + (row.documents?.length ?? 0), 0),
          passenger_ids: group.map((row) => row.id),
        };
      }),
    total_count: rows.length,
  };
}

export function filterPassengers(
  allRows: StoredPassenger[],
  options: { search?: string; status?: string; sort?: string; scope?: DateScope } = {},
): { rows: StoredPassenger[]; duplicates: Set<string> } {
  const scoped = filterScope(allRows, options.scope);
  const duplicates = duplicateIdentities(scoped);
  const query = fold(options.search);
  let rows = scoped.filter((row) => {
    if (query && !Object.values(row).some((value) => fold(value).includes(query))) return false;
    const issues = rowIssues(row, duplicates);
    switch (options.status) {
      case "Fotosuz": return !row.photo;
      case "Pasaportsuz": return !text(row.passport_no);
      case "Voucher eksik": return !text(row.voucher);
      case "Ücretsiz": return !text(row.adult_fee) && !text(row.child_fee);
      case "Tekrarlı": return issues.includes("Tekrarlı");
      case "İsim eksik": return !text(row.full_name);
      case "Tarih hatası": return issues.includes("Tarih hatalı");
      case "Eksik": return issues.length > 0;
      case "Hazır": return issues.length === 0;
      default: return true;
    }
  });
  if (options.sort === "name") rows = rows.toSorted((a, b) => text(a.full_name).localeCompare(text(b.full_name), "tr"));
  if (options.sort === "passport") rows = rows.toSorted((a, b) => text(a.passport_no).localeCompare(text(b.passport_no), "tr"));
  if (options.sort === "departure") {
    rows = rows.toSorted((a, b) => (canonicalDate(a.departure_date) || "9999").localeCompare(canonicalDate(b.departure_date) || "9999"));
  }
  return { rows, duplicates };
}

export function buildSummary(
  allRows: StoredPassenger[],
  scope: DateScope | undefined,
  options: {
    loadedFiles?: string[];
    history?: ImportHistoryItem[];
    canUndo?: boolean;
    lastBatchId?: string;
    unmatchedPhotoCount?: number;
    version?: string;
  } = {},
): OperationSummary {
  const rows = filterScope(allRows, scope);
  const duplicates = duplicateIdentities(rows);
  const enriched = rows.map((row) => toPassenger(row, duplicates));
  const issueCounts: Record<string, number> = {
    Fotosuz: enriched.filter((row) => row.issues.includes("Foto yok")).length,
    Pasaportsuz: enriched.filter((row) => row.issues.includes("Pasaport yok")).length,
    "Voucher eksik": enriched.filter((row) => row.issues.includes("Voucher yok")).length,
    Ücretsiz: enriched.filter((row) => row.issues.includes("Ücret yok")).length,
    Tekrarlı: enriched.filter((row) => row.issues.includes("Tekrarlı")).length,
    "İsim eksik": enriched.filter((row) => row.issues.includes("İsim yok")).length,
    "Tarih hatası": enriched.filter((row) => row.issues.includes("Tarih hatalı")).length,
  };
  const passengerCount = rows.length;
  const missingCount = enriched.filter((row) => row.issues.length > 0).length;
  const missingPhoto = issueCounts.Fotosuz;
  const missingPassport = issueCounts.Pasaportsuz;
  const missingVoucher = issueCounts["Voucher eksik"];
  const missingFee = issueCounts.Ücretsiz;
  const duplicateCount = issueCounts.Tekrarlı;
  const score = passengerCount
    ? Math.max(0, passengerCount - missingPhoto + Math.max(0, passengerCount - missingPassport - duplicateCount) + passengerCount - missingVoucher + passengerCount - missingFee)
    : 0;
  const today = localIsoDate();
  return {
    passenger_count: passengerCount,
    ready_count: Math.max(0, passengerCount - missingCount),
    missing_count: missingCount,
    adult_total: rows.reduce((sum, row) => sum + amount(row.adult_fee), 0),
    child_total: rows.reduce((sum, row) => sum + amount(row.child_fee), 0),
    total_fee: rows.reduce((sum, row) => sum + amount(row.adult_fee) + amount(row.child_fee), 0),
    with_photo: passengerCount - missingPhoto,
    missing_photo: missingPhoto,
    missing_passport: missingPassport,
    missing_voucher: missingVoucher,
    missing_fee: missingFee,
    duplicates: duplicateCount,
    readiness_percent: passengerCount ? Math.round((score / (passengerCount * 4)) * 100) : 0,
    issue_counts: issueCounts,
    loaded_files: options.loadedFiles ?? [],
    import_history: options.history ?? [],
    today_count: rows.filter((row) => canonicalDate(row.departure_date) === today).length,
    can_undo: Boolean(options.canUndo),
    last_batch_id: options.lastBatchId ?? "",
    unmatched_photo_count: options.unmatchedPhotoCount ?? 0,
    persistence: "device-encrypted",
    version: options.version ?? "offline",
  };
}

export function buildArchive(
  allRows: StoredPassenger[],
  scope: DateScope | undefined,
  operationMeta: Record<string, OperationMeta> = {},
): { groups: ArchiveGroup[]; total_count: number } {
  const rows = filterScope(allRows, scope ? { ...scope, field: "departure" } : scope);
  const groups = new Map<string, StoredPassenger[]>();
  for (const row of rows) {
    const key = canonicalDate(row.departure_date) || "Tarihsiz";
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return {
    groups: [...groups.entries()]
      .toSorted(([a], [b]) => (a === "Tarihsiz" ? 1 : b === "Tarihsiz" ? -1 : a.localeCompare(b)))
      .map(([dateKey, group]) => ({
        date_key: dateKey,
        count: group.length,
        adult_total: group.reduce((sum, row) => sum + amount(row.adult_fee), 0),
        child_total: group.reduce((sum, row) => sum + amount(row.child_fee), 0),
        total: group.reduce((sum, row) => sum + amount(row.adult_fee) + amount(row.child_fee), 0),
        with_photo: group.filter((row) => Boolean(row.photo)).length,
        passenger_ids: group.map((row) => row.id),
        meta: operationMeta[dateKey] ?? null,
      })),
    total_count: rows.length,
  };
}
