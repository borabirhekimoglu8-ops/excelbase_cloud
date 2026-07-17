import { newId } from "@/lib/id";
import { downloadLocalPassengerDocument } from "@/lib/offline/downloads";
import {
  localArchive,
  localAssignUnmatched,
  localAudit,
  localAuthStatus,
  localBackups,
  localBulkDelete,
  localClearAll,
  localCreatePassengerRecord,
  localDeleteJob,
  localDeletePassenger,
  localDeletePassengerDocument,
  localDeleteUnmatched,
  localImportMail,
  localLogin,
  localLogout,
  localMatchPhotos,
  localMergeDuplicates,
  localPassengerPage,
  localPassengerDocumentFile,
  localPassengerDocuments,
  localPassengers,
  localPreview,
  localQueueImportFile,
  localQueueState,
  localRecordFolders,
  localRemovePassengerPhoto,
  localRetryJob,
  localRestoreEncryptedBackup,
  localSaveOperationMeta,
  localSetPassengerPhoto,
  localSetup,
  localSummary,
  localUndoImport,
  localUnmatchedPhotos,
  localUpdatePassenger,
  localUpdatePassengerDocumentCategory,
  localUploadPassengerFile,
  localUploadPassengerFiles,
  localUploadPassengerDocuments,
  localUsers,
} from "@/lib/offline/localApi";

export type DateField = "departure" | "created";
export type DateScope = { range: string; start: string; end: string; field?: DateField };

export const DOCUMENT_CATEGORIES = [
  "passport",
  "application_form",
  "hotel",
  "ferry",
  "insurance",
  "bank",
  "other",
] as const;

export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];
export const REQUIRED_DOCUMENT_CATEGORIES: readonly DocumentCategory[] = ["passport", "application_form"];
export type RecordStatus = "draft" | "review" | "ready";
export type RecordSource = "manual" | "import";

export const DOCUMENT_CATEGORY_LABELS: Record<DocumentCategory, string> = {
  passport: "Pasaport",
  application_form: "Başvuru formu",
  hotel: "Otel rezervasyonu",
  ferry: "Feribot bileti",
  insurance: "Seyahat sigortası",
  bank: "Banka / finansal evrak",
  other: "Diğer evrak",
};

export type PassengerDocument = {
  id: string;
  filename: string;
  mime: "application/pdf";
  size: number;
  created_at: string;
  category: DocumentCategory;
};

export type PassengerDocumentFile = {
  metadata: PassengerDocument;
  blob: Blob;
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
  /** Empty only for legacy rows whose creation time is genuinely unknown. */
  created_at: string;
  /** Local calendar date used as the stable record-folder key. */
  record_date: string;
  created_by: string;
  record_status: RecordStatus;
  record_source: RecordSource;
  photo: string;
  photo_url: string;
  /** Passenger-specific PDF metadata. Payloads stay encrypted in the local vault. */
  documents?: PassengerDocument[];
  issues: string[];
  duplicate: boolean;
};

export type ManualPassengerInput = {
  no: string;
  first_name: string;
  last_name: string;
  passport_no: string;
  voucher: string;
  departure_date: string;
  arrival_date: string;
  adult_fee: string;
  child_fee: string;
  record_date: string;
  created_by: string;
  save_as_draft?: boolean;
};

export type PassengerDocumentUpload = { file: File; category: DocumentCategory };

export type RecordFolder = {
  date_key: string;
  count: number;
  ready_count: number;
  review_count: number;
  draft_count: number;
  with_photo: number;
  document_count: number;
  passenger_ids: number[];
};

export type RecordFolderResponse = { groups: RecordFolder[]; total_count: number };

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
  ready_count: number;
  missing_count: number;
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
  status: "waiting" | "pending" | "processing" | "done" | "error";
  imported: number;
  duplicates: number;
  invalid: number;
  message: string;
  created_at: string;
  finished_at?: string | null;
  parent_id?: string | null;
  kind?: "upload" | "file";
  stage?: string;
  total_files?: number;
  processed_files?: number;
};

export type ImportQueueResponse = { jobs: ImportJob[]; active: boolean; batch_id: string };
export type PassengerPage = { items: Passenger[]; total: number };
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

export const API_BASE = "";

type ApiErrorKind = "http" | "timeout" | "network";

/** Kept for compatibility with old UI branches; the offline path never emits transport errors. */
export class ApiRequestError extends Error {
  readonly kind: ApiErrorKind;
  readonly status: number | null;
  readonly detail: string;
  readonly requestId: string;
  readonly originalError?: unknown;

  constructor(options: {
    kind: ApiErrorKind;
    detail: string;
    status?: number | null;
    requestId?: string;
    originalError?: unknown;
  }) {
    super(options.detail);
    this.name = "ApiRequestError";
    this.kind = options.kind;
    this.status = options.status ?? null;
    this.detail = options.detail;
    this.requestId = options.requestId ?? "";
    this.originalError = options.originalError;
  }
}

export function isRetryableTransportError(error: unknown): error is ApiRequestError {
  return error instanceof ApiRequestError && (error.kind === "network" || error.kind === "timeout");
}

function appendScope(qs: URLSearchParams, scope?: DateScope): void {
  if (!scope) return;
  qs.set("range", scope.range || "Tümü");
  qs.set("field", scope.field ?? "departure");
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

/** Legacy helper; main offline UI uses local Blob export buttons instead. */
export function downloadUrl(path: string): string {
  return path;
}

export const fetchAuthStatus = localAuthStatus;
export const setupAuth = localSetup;
export const login = localLogin;
export const logout = localLogout;
export const fetchSummary = localSummary;
export const fetchPassengers = localPassengers;
export const fetchPassengerPage = localPassengerPage;
export function fetchArchive(scope: DateScope = { range: "Tümü", start: "", end: "" }): Promise<ArchiveResponse> {
  return localArchive(scope);
}
export const fetchRecordFolders = localRecordFolders;
export const createPassengerRecord = localCreatePassengerRecord;
export const updatePassenger = localUpdatePassenger;
export const deletePassenger = localDeletePassenger;
export const bulkDelete = localBulkDelete;
export const clearAll = localClearAll;
export const mergeDuplicates = localMergeDuplicates;
export const saveOperationMeta = localSaveOperationMeta;
export const previewPassengerFile = localPreview;
export const uploadPassengerFile = localUploadPassengerFile;

export function uploadPassengerFiles(
  files: FileList | File[],
  replace = false,
  dupStrategy = "add",
): Promise<ImportResponse> {
  return localUploadPassengerFiles(Array.from(files), replace, dupStrategy);
}

export type QueueImportFailure = { filename: string; error: string };
export type QueueImportResult = ImportQueueResponse & {
  failedFiles: string[];
  failures: QueueImportFailure[];
};

export const queueImportFile = localQueueImportFile;

export async function queueImportFiles(
  files: File[],
  replace: boolean,
  dupStrategy: string,
  onProgress?: (delivered: number, total: number) => void,
): Promise<QueueImportResult> {
  const batchId = newId();
  const jobs: ImportJob[] = [];
  const failedFiles: string[] = [];
  const failures: QueueImportFailure[] = [];
  onProgress?.(0, files.length);
  for (const [index, file] of files.entries()) {
    const response = await localQueueImportFile(file, replace, dupStrategy, batchId, newId(), index);
    const job = response.jobs[0];
    if (job) jobs.push(job);
    if (job?.status === "error") {
      failedFiles.push(file.name);
      failures.push({ filename: file.name, error: job.message });
    }
    onProgress?.(index + 1, files.length);
  }
  return { jobs, active: false, batch_id: batchId, failedFiles, failures };
}

export const fetchImportQueue = localQueueState;
export const retryImportJob = localRetryJob;
export const deleteImportJob = localDeleteJob;
export const undoImport = localUndoImport;
export function matchPhotos(files: FileList | File[]): Promise<MatchPhotosResponse> {
  return localMatchPhotos(Array.from(files));
}
export const setPassengerPhoto = localSetPassengerPhoto;
export const removePassengerPhoto = localRemovePassengerPhoto;
export const fetchPassengerDocuments = localPassengerDocuments;
export const openPassengerDocument = localPassengerDocumentFile;
export function addPassengerDocuments(
  passengerId: number,
  files: FileList | File[],
  category: DocumentCategory = "other",
): Promise<PassengerDocument[]> {
  return localUploadPassengerDocuments(passengerId, Array.from(files), category);
}
export const uploadPassengerDocuments = addPassengerDocuments;
export const deletePassengerDocument = localDeletePassengerDocument;
export const updatePassengerDocumentCategory = localUpdatePassengerDocumentCategory;
export const downloadPassengerDocument = downloadLocalPassengerDocument;
export const fetchUnmatchedPhotos = localUnmatchedPhotos;
export const assignUnmatchedPhoto = localAssignUnmatched;
export const deleteUnmatchedPhoto = localDeleteUnmatched;
export const importMail = localImportMail;

// Backup is implemented by the local export screen; these compatibility
// functions deliberately make unsupported server-era actions explicit.
export const restoreBackup = localRestoreEncryptedBackup;
export const fetchBackups = localBackups;
export async function restoreDailyBackup(_snapshotDate: string): Promise<SimpleResult> {
  throw new Error("Yerel cihazda sunucu günlük yedeği bulunmaz.");
}
export const fetchUsers = localUsers;
export async function createUser(_name: string, _pin: string, _role: string): Promise<UserView> {
  throw new Error("Çevrimdışı sürüm tek cihaz kasası kullanır.");
}
export async function deactivateUser(_userId: string): Promise<SimpleResult> {
  throw new Error("Çevrimdışı sürüm tek cihaz kasası kullanır.");
}
export const fetchAudit = localAudit;
