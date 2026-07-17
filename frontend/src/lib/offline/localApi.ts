import PostalMime from "postal-mime";
import {
  BlobReader,
  BlobWriter,
  ZipReader,
} from "@zip.js/zip.js";

import type {
  ArchiveResponse,
  AuditEntry,
  AuthStatus,
  BackupInfo,
  DateScope,
  ImportHistoryItem,
  ImportJob,
  ImportPreviewResponse,
  ImportQueueResponse,
  ImportResponse,
  MailImportResponse,
  MatchPhotosResponse,
  OperationMeta,
  OperationSummary,
  Passenger,
  PassengerDocument,
  PassengerDocumentFile,
  PassengerPage,
  SimpleResult,
  UnmatchedPhoto,
  UserView,
} from "@/lib/api";
import { newId } from "@/lib/id";
import {
  buildArchive,
  buildSummary,
  filterPassengers,
  fold,
  passengerIdentity,
  text,
  toPassenger,
  type StoredPassenger,
} from "./domain";
import { parsePassengerBytes, parseSelectedFile, type ParsedPassengerRow } from "./parser";
import type { ExportDocument } from "./exporter";
import {
  clearPassengers,
  clearMeta,
  clearBinaries,
  clearJobs,
  deleteBinary,
  deleteJob,
  deletePassenger as deletePassengerRecord,
  exportEncryptedVault,
  getBinary,
  getJob,
  getMeta,
  getPassenger,
  listBinary,
  listBinaryIds,
  listJobs,
  listPassengers,
  lockVault,
  putBinary,
  putJob,
  putPassenger,
  putPassengers,
  removeMeta,
  replacePassengers,
  restoreEncryptedVault,
  setMeta,
  setupVault,
  unlockVault,
  vaultAuthStatus,
  type VaultBinary,
} from "./vault";

const META_LOADED_FILES = "loaded-files";
const META_IMPORT_HISTORY = "import-history";
const META_OPERATION = "operation-meta";
const META_UNMATCHED = "unmatched-photos";
const META_LAST_UNDO = "last-undo";
const META_BATCH_PREFIX = "import-batch:";
const APP_VERSION = "7.4.1-offline";
const SOURCE_PREFIX = "source:";
const PHOTO_PREFIX = "photo:";
const DOCUMENT_PREFIX = "document:";
const MAX_PHOTO_BYTES = 25 * 1024 * 1024;
const MAX_PHOTO_BATCH_BYTES = 350 * 1024 * 1024;
const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;
const MAX_DOCUMENT_BATCH_BYTES = 250 * 1024 * 1024;
const MAX_EMAIL_BYTES = 100 * 1024 * 1024;
const MAX_EMAIL_ATTACHMENT_BYTES = 50 * 1024 * 1024;
const MAX_EMAIL_ATTACHMENTS_BYTES = 250 * 1024 * 1024;

type StoredImportJob = ImportJob & {
  batchId: string;
  replace: boolean;
  dupStrategy: string;
  uploadIndex: number;
  sourceBinaryId: string;
};

type BatchState = { started: boolean; replaceConsumed: boolean };
type UndoState = { batchId: string; passengers: StoredPassenger[] };
type UnmatchedRecord = { id: string; binaryId: string; filename: string; createdAt: string };
type BinaryMetadata = {
  kind: "source" | "photo" | "document";
  filename: string;
  mime: string;
  passengerId?: number;
  documentId?: string;
};

const photoUrlCache = new Map<string, string>();

function revokePhotoUrl(binaryId: string): void {
  const url = photoUrlCache.get(binaryId);
  if (url) URL.revokeObjectURL(url);
  photoUrlCache.delete(binaryId);
}

function revokeAllPhotoUrls(): void {
  for (const url of photoUrlCache.values()) URL.revokeObjectURL(url);
  photoUrlCache.clear();
}

async function photoUrl(binaryId: string): Promise<string> {
  if (!binaryId) return "";
  const cached = photoUrlCache.get(binaryId);
  if (cached) return cached;
  const binary = await getBinary(binaryId);
  if (!binary) return "";
  const url = URL.createObjectURL(binary.data);
  photoUrlCache.set(binaryId, url);
  return url;
}

async function enrichedPassengers(rows: StoredPassenger[]): Promise<Passenger[]> {
  const { duplicates } = filterPassengers(rows);
  return Promise.all(rows.map(async (row) => toPassenger(row, duplicates, await photoUrl(row.photo))));
}

function asStoredRow(row: ParsedPassengerRow, id: number, importJobId: string): StoredPassenger {
  return {
    id,
    ...row,
    full_name: text(row.full_name) || [text(row.first_name), text(row.last_name)].filter(Boolean).join(" "),
    photo: "",
    documents: [],
    _import_job_id: importJobId,
  };
}

function criticalInvalid(row: ParsedPassengerRow): boolean {
  if (!text(row.full_name) || !text(row.passport_no)) return true;
  return Boolean(row.departure_date && row.arrival_date && row.arrival_date < row.departure_date);
}

function sortedJobs(jobs: StoredImportJob[]): StoredImportJob[] {
  return jobs.toSorted((a, b) => b.created_at.localeCompare(a.created_at));
}

async function loadedFiles(): Promise<string[]> {
  return (await getMeta<string[]>(META_LOADED_FILES)) ?? [];
}

async function importHistory(): Promise<ImportHistoryItem[]> {
  return (await getMeta<ImportHistoryItem[]>(META_IMPORT_HISTORY)) ?? [];
}

async function unmatchedRecords(): Promise<UnmatchedRecord[]> {
  return (await getMeta<UnmatchedRecord[]>(META_UNMATCHED)) ?? [];
}

function documentBinaryId(documentId: string): string {
  return `${DOCUMENT_PREFIX}${documentId}`;
}

function documentIds(row: Pick<StoredPassenger, "documents">): string[] {
  return (row.documents ?? []).map((document) => documentBinaryId(document.id));
}

async function garbageCollectAttachmentBinaries(): Promise<void> {
  const [rows, unmatched, undo, binaryIds] = await Promise.all([
    listPassengers<StoredPassenger>(),
    unmatchedRecords(),
    getMeta<UndoState>(META_LAST_UNDO),
    listBinaryIds(),
  ]);
  const referenced = new Set<string>();
  for (const row of rows) if (row.photo) referenced.add(row.photo);
  for (const row of rows) for (const id of documentIds(row)) referenced.add(id);
  for (const item of unmatched) referenced.add(item.binaryId);
  for (const row of undo?.passengers ?? []) if (row.photo) referenced.add(row.photo);
  for (const row of undo?.passengers ?? []) for (const id of documentIds(row)) referenced.add(id);
  for (const id of binaryIds) {
    if ((!id.startsWith(PHOTO_PREFIX) && !id.startsWith(DOCUMENT_PREFIX)) || referenced.has(id)) continue;
    if (id.startsWith(PHOTO_PREFIX)) revokePhotoUrl(id);
    await deleteBinary(id);
  }
}

export async function localAuthStatus(): Promise<AuthStatus> {
  return vaultAuthStatus();
}

export async function localSetup(displayName: string, pin: string): Promise<AuthStatus> {
  return setupVault(displayName, pin);
}

export async function localLogin(pin: string): Promise<AuthStatus> {
  return unlockVault(pin);
}

export async function localLogout(): Promise<SimpleResult> {
  revokeAllPhotoUrls();
  lockVault();
  return { ok: true, message: "Yerel kasa kilitlendi.", passenger_count: 0 };
}

export async function localSummary(scope?: DateScope): Promise<OperationSummary> {
  const [rows, files, history, unmatched, undo] = await Promise.all([
    listPassengers<StoredPassenger>(),
    loadedFiles(),
    importHistory(),
    unmatchedRecords(),
    getMeta<UndoState>(META_LAST_UNDO),
  ]);
  return buildSummary(rows, scope, {
    loadedFiles: files,
    history,
    canUndo: Boolean(undo),
    lastBatchId: undo?.batchId ?? "",
    unmatchedPhotoCount: unmatched.length,
    version: APP_VERSION,
  });
}

export async function localPassengers(
  params: { search?: string; status?: string; sort?: string; scope?: DateScope } = {},
): Promise<Passenger[]> {
  const allRows = await listPassengers<StoredPassenger>();
  const filtered = filterPassengers(allRows, params);
  return Promise.all(filtered.rows.map(async (row) => toPassenger(row, filtered.duplicates, await photoUrl(row.photo))));
}

export async function localPassengerPage(
  params: {
    search?: string;
    status?: string;
    sort?: string;
    scope?: DateScope;
    offset?: number;
    limit?: number;
  } = {},
): Promise<PassengerPage> {
  const allRows = await listPassengers<StoredPassenger>();
  const filtered = filterPassengers(allRows, params);
  const offset = Math.max(0, params.offset ?? 0);
  const limit = Math.max(1, Math.min(100, params.limit ?? 20));
  const visible = filtered.rows.slice(offset, offset + limit);
  return {
    items: await Promise.all(visible.map(async (row) => toPassenger(row, filtered.duplicates, await photoUrl(row.photo)))),
    total: filtered.rows.length,
  };
}

export async function localArchive(scope?: DateScope): Promise<ArchiveResponse> {
  const [rows, meta] = await Promise.all([
    listPassengers<StoredPassenger>(),
    getMeta<Record<string, OperationMeta>>(META_OPERATION),
  ]);
  return buildArchive(rows, scope, meta ?? {});
}

export async function localUpdatePassenger(id: number, updates: Partial<Passenger>): Promise<SimpleResult> {
  const current = await getPassenger<StoredPassenger>(id);
  if (!current) throw new Error("Yolcu bulunamadı.");
  const allowed: Array<keyof StoredPassenger> = [
    "no", "first_name", "last_name", "full_name", "passport_no", "voucher", "departure_date",
    "arrival_date", "adult_fee", "child_fee", "source_file", "sheet",
  ];
  const next = { ...current };
  for (const key of allowed) {
    const value = updates[key as keyof Passenger];
    if (value !== undefined) (next[key] as string | number) = typeof value === "number" ? value : text(value);
  }
  if (updates.first_name !== undefined || updates.last_name !== undefined) {
    next.full_name = [text(next.first_name), text(next.last_name)].filter(Boolean).join(" ");
  }
  await putPassenger(next);
  return { ok: true, message: "Yolcu güncellendi.", passenger_count: (await listPassengers()).length };
}

async function deletePassengerAttachments(
  passenger: StoredPassenger,
  retained = new Set<string>(),
): Promise<void> {
  if (passenger.photo && !retained.has(passenger.photo)) {
    revokePhotoUrl(passenger.photo);
    await deleteBinary(passenger.photo);
  }
  for (const binaryId of documentIds(passenger)) {
    if (!retained.has(binaryId)) await deleteBinary(binaryId);
  }
}

export async function localDeletePassenger(id: number): Promise<SimpleResult> {
  const passenger = await getPassenger<StoredPassenger>(id);
  if (!passenger) throw new Error("Yolcu bulunamadı.");
  await deletePassengerRecord(id);
  await deletePassengerAttachments(passenger);
  return { ok: true, message: "Yolcu silindi.", passenger_count: (await listPassengers()).length };
}

export async function localBulkDelete(ids: number[]): Promise<SimpleResult> {
  const wanted = new Set(ids.filter(Number.isInteger));
  const rows = await listPassengers<StoredPassenger>();
  const removed = rows.filter((row) => wanted.has(row.id));
  for (const row of removed) {
    await deletePassengerRecord(row.id);
    await deletePassengerAttachments(row);
  }
  return { ok: true, message: `${removed.length} yolcu silindi.`, passenger_count: rows.length - removed.length };
}

export async function localClearAll(): Promise<SimpleResult> {
  await clearBinaries();
  await clearPassengers();
  await clearJobs();
  await clearMeta();
  revokeAllPhotoUrls();
  return { ok: true, message: "Bu cihazdaki yolcu verileri temizlendi.", passenger_count: 0 };
}

export async function localMergeDuplicates(passportKey = ""): Promise<{ removed: number; passenger_count: number }> {
  const rows = await listPassengers<StoredPassenger>();
  const groups = new Map<string, StoredPassenger[]>();
  for (const row of rows) {
    const identity = passengerIdentity(row);
    if (!identity || (passportKey && !identity.startsWith(fold(passportKey).toUpperCase()))) continue;
    groups.set(identity, [...(groups.get(identity) ?? []), row]);
  }
  let removed = 0;
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const [first, ...rest] = group;
    const merged: StoredPassenger = {
      ...first,
      documents: [...new Map(
        group.flatMap((row) => row.documents ?? []).map((document) => [document.id, document]),
      ).values()],
    };
    for (const duplicate of rest) {
      for (const key of Object.keys(merged) as Array<keyof StoredPassenger>) {
        if (key !== "id" && key !== "documents" && !text(merged[key]) && text(duplicate[key])) {
          (merged[key] as string | number) = duplicate[key] as string | number;
        }
      }
    }
    await putPassenger(merged);
    const retained = new Set([merged.photo, ...documentIds(merged)].filter(Boolean));
    for (const duplicate of rest) {
      await deletePassengerRecord(duplicate.id);
      await deletePassengerAttachments(duplicate, retained);
      removed += 1;
    }
  }
  return { removed, passenger_count: rows.length - removed };
}

export async function localSaveOperationMeta(meta: OperationMeta): Promise<SimpleResult> {
  const all = (await getMeta<Record<string, OperationMeta>>(META_OPERATION)) ?? {};
  all[meta.date_key] = meta;
  await setMeta(META_OPERATION, all);
  return { ok: true, message: "Tarih notu kaydedildi.", passenger_count: (await listPassengers()).length };
}

export async function localPreview(file: File): Promise<ImportPreviewResponse> {
  const parsed = await parseSelectedFile(file);
  return {
    filename: file.name,
    rows: parsed.rows.length,
    warnings: [...parsed.warnings, ...parsed.errors],
    duplicate_count: new Set(parsed.rows.map((row) => `${fold(row.passport_no)}|${row.departure_date}`)).size === parsed.rows.length
      ? 0
      : parsed.rows.length - new Set(parsed.rows.map((row) => `${fold(row.passport_no)}|${row.departure_date}`)).size,
    invalid_count: parsed.rows.filter(criticalInvalid).length,
  };
}

async function applyParsedJob(job: StoredImportJob, bytes: ArrayBuffer): Promise<StoredImportJob> {
  const parsed = await parsePassengerBytes(job.filename, bytes);
  if (!parsed.rows.length) {
    throw new Error(parsed.errors[0] || "Dosyada aktarılabilir yolcu satırı bulunamadı.");
  }

  const allRows = await listPassengers<StoredPassenger>();
  const batchKey = `${META_BATCH_PREFIX}${job.batchId}`;
  const batch = (await getMeta<BatchState>(batchKey)) ?? { started: false, replaceConsumed: false };
  const alreadyApplied = allRows.filter((row) => row._import_job_id === job.id);
  if (alreadyApplied.length) {
    if (job.replace && !batch.replaceConsumed) {
      batch.started = true;
      batch.replaceConsumed = true;
      await setMeta(batchKey, batch);
    }
    return {
      ...job,
      status: "done",
      stage: "completed",
      imported: alreadyApplied.length,
      message: `${alreadyApplied.length} yolcu daha önce güvenle kaydedilmiş; yinelenmedi.`,
      finished_at: new Date().toISOString(),
    };
  }
  if (!batch.started) {
    await setMeta<UndoState>(META_LAST_UNDO, { batchId: job.batchId, passengers: allRows });
    await garbageCollectAttachmentBinaries();
    batch.started = true;
  }

  const shouldReplace = job.replace && !batch.replaceConsumed;
  const baseRows = shouldReplace ? [] : allRows;
  await setMeta(batchKey, batch);

  let nextId = baseRows.reduce((max, row) => Math.max(max, row.id), 0) + 1;
  const byIdentity = new Map<string, StoredPassenger>();
  for (const row of baseRows) {
    const identity = passengerIdentity(row);
    if (identity && !byIdentity.has(identity)) byIdentity.set(identity, row);
  }

  const changed = new Map<number, StoredPassenger>();
  const additions: StoredPassenger[] = [];
  let duplicates = 0;
  for (const parsedRow of parsed.rows) {
    const candidate = asStoredRow(parsedRow, nextId, job.id);
    const identity = passengerIdentity(candidate);
    const existing = identity ? byIdentity.get(identity) : undefined;
    if (existing) {
      duplicates += 1;
      if (job.dupStrategy === "skip") continue;
      if (job.dupStrategy === "overwrite") {
        const updated: StoredPassenger = {
          ...candidate,
          id: existing.id,
          photo: existing.photo,
          documents: existing.documents ?? [],
        };
        byIdentity.set(identity, updated);
        const pendingIndex = additions.findIndex((row) => row.id === existing.id);
        if (pendingIndex >= 0) additions[pendingIndex] = updated;
        else changed.set(updated.id, updated);
        continue;
      }
    }
    nextId += 1;
    additions.push(candidate);
    if (identity && !byIdentity.has(identity)) byIdentity.set(identity, candidate);
  }

  if (shouldReplace) {
    await replacePassengers([...changed.values(), ...additions]);
    batch.replaceConsumed = true;
    await setMeta(batchKey, batch);
  } else {
    await putPassengers([...changed.values(), ...additions]);
  }

  const files = [...new Set([...(await loadedFiles()), ...parsed.files.filter((item) => item.rows.length).map((item) => item.filename)])];
  await setMeta(META_LOADED_FILES, files);
  const history = await importHistory();
  const imported = changed.size + additions.length;
  const historyItem: ImportHistoryItem = {
    time: new Date().toISOString(),
    files: job.filename,
    file_count: parsed.files.filter((item) => item.rows.length).length || 1,
    rows: imported,
    mode: job.replace ? "replace" : job.dupStrategy,
    batch_id: job.batchId,
  };
  await setMeta(META_IMPORT_HISTORY, [historyItem, ...history].slice(0, 50));

  return {
    ...job,
    status: "done",
    stage: "completed",
    imported,
    duplicates,
    invalid: parsed.rows.filter(criticalInvalid).length,
    total_files: parsed.files.length || 1,
    processed_files: parsed.files.filter((item) => item.rows.length || item.error).length || 1,
    message: [
      `${imported} yolcu cihazdaki şifreli kasaya kaydedildi.`,
      parsed.errors.length ? `${parsed.errors.length} dosya/üye işlenemedi.` : "",
      parsed.warnings[0] ?? "",
    ].filter(Boolean).join(" "),
    finished_at: new Date().toISOString(),
  };
}

export async function localQueueImportFile(
  file: File,
  replace: boolean,
  dupStrategy: string,
  batchId: string,
  uploadId: string,
  uploadIndex = 0,
): Promise<ImportQueueResponse> {
  const sourceBinaryId = `${SOURCE_PREFIX}${uploadId}`;
  const job: StoredImportJob = {
    id: uploadId,
    filename: file.name,
    status: "processing",
    imported: 0,
    duplicates: 0,
    invalid: 0,
    message: "Dosya bu cihazda okunuyor…",
    created_at: new Date().toISOString(),
    kind: "upload",
    stage: "reading",
    batchId,
    replace,
    dupStrategy,
    uploadIndex,
    sourceBinaryId,
  };
  await putJob(job);

  try {
    const bytes = await file.arrayBuffer();
    await putBinary(sourceBinaryId, bytes, {
      kind: "source",
      filename: file.name,
      mime: file.type || "application/octet-stream",
    } satisfies BinaryMetadata);
    const completed = await applyParsedJob(job, bytes);
    await putJob(completed);
    await deleteBinary(sourceBinaryId);
    return { jobs: [completed], active: false, batch_id: batchId };
  } catch (error) {
    const failed: StoredImportJob = {
      ...job,
      status: "error",
      stage: "error",
      message: error instanceof Error ? error.message : String(error),
      finished_at: new Date().toISOString(),
    };
    await putJob(failed);
    return { jobs: [failed], active: false, batch_id: batchId };
  }
}

export async function localQueueState(): Promise<ImportQueueResponse> {
  const jobs = await listJobs<StoredImportJob>();
  for (const job of jobs) {
    if (job.status === "processing" || job.status === "pending" || job.status === "waiting") {
      job.status = "error";
      job.stage = "paused";
      job.message = "Uygulama işlem sırasında kapanmış. Yeniden dene ile cihazdaki kopyadan sürdürün.";
      await putJob(job);
    }
  }
  return { jobs: sortedJobs(jobs), active: false, batch_id: jobs[0]?.batchId ?? "" };
}

export async function localRetryJob(jobId: string): Promise<SimpleResult> {
  const job = await getJob<StoredImportJob>(jobId);
  if (!job) throw new Error("Aktarım kaydı bulunamadı.");
  const source = await getBinary(job.sourceBinaryId);
  if (!source) throw new Error("Dosyanın yerel kopyası bulunamadı; dosyayı yeniden seçin.");
  const processing: StoredImportJob = { ...job, status: "processing", message: "Cihazdaki kopya yeniden işleniyor…" };
  await putJob(processing);
  try {
    const completed = await applyParsedJob(processing, await source.data.arrayBuffer());
    await putJob(completed);
    await deleteBinary(job.sourceBinaryId);
    return { ok: true, message: completed.message, passenger_count: (await listPassengers()).length };
  } catch (error) {
    await putJob({
      ...processing,
      status: "error",
      message: error instanceof Error ? error.message : String(error),
      finished_at: new Date().toISOString(),
    });
    throw error;
  }
}

export async function localDeleteJob(jobId: string): Promise<SimpleResult> {
  const job = await getJob<StoredImportJob>(jobId);
  if (job?.sourceBinaryId) await deleteBinary(job.sourceBinaryId);
  await deleteJob(jobId);
  return { ok: true, message: "Aktarım kaydı kaldırıldı.", passenger_count: (await listPassengers()).length };
}

export async function localUndoImport(batchId = ""): Promise<SimpleResult> {
  const undo = await getMeta<UndoState>(META_LAST_UNDO);
  if (!undo || (batchId && undo.batchId !== batchId)) throw new Error("Geri alınabilecek aktarım bulunamadı.");
  await replacePassengers(undo.passengers);
  await removeMeta(META_LAST_UNDO);
  await garbageCollectAttachmentBinaries();
  return { ok: true, message: "Son toplu aktarım geri alındı.", passenger_count: undo.passengers.length };
}

export async function localUploadPassengerFile(
  file: File,
  replace: boolean,
  dupStrategy: string,
  batchId: string,
): Promise<ImportResponse> {
  const state = await localQueueImportFile(file, replace, dupStrategy, batchId, newId());
  const job = state.jobs[0];
  if (!job || job.status === "error") throw new Error(job?.message || "Dosya işlenemedi.");
  return {
    imported: job.imported,
    warnings: job.message ? [job.message] : [],
    loaded_files: await loadedFiles(),
    passenger_count: (await listPassengers()).length,
    batch_id: batchId,
    duplicate_count: job.duplicates,
    invalid_count: job.invalid,
  };
}

export async function localUploadPassengerFiles(files: File[], replace: boolean, dupStrategy: string): Promise<ImportResponse> {
  const batchId = newId();
  let imported = 0;
  let duplicates = 0;
  let invalid = 0;
  const warnings: string[] = [];
  for (const [index, file] of files.entries()) {
    const response = await localQueueImportFile(file, replace, dupStrategy, batchId, newId(), index);
    const job = response.jobs[0];
    if (!job) continue;
    imported += job.imported;
    duplicates += job.duplicates;
    invalid += job.invalid;
    if (job.status === "error") warnings.push(`${file.name}: ${job.message}`);
  }
  return {
    imported,
    warnings,
    loaded_files: await loadedFiles(),
    passenger_count: (await listPassengers()).length,
    batch_id: batchId,
    duplicate_count: duplicates,
    invalid_count: invalid,
  };
}

function imageMime(filename: string, fallback = "application/octet-stream"): string {
  const ext = filename.split(".").pop()?.toLocaleLowerCase("en-US");
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  if (ext === "heic" || ext === "heif") return "image/heic";
  return fallback;
}

function leafFilename(filename: string, fallback: string): string {
  const leaf = filename.replaceAll("\\", "/").split("/").pop()?.trim() ?? "";
  return leaf || fallback;
}

async function assertJpegBlob(blob: Blob, filename: string, declaredMime = blob.type): Promise<void> {
  const extension = filename.split(".").pop()?.toLocaleLowerCase("en-US");
  const signature = new Uint8Array(await blob.slice(0, 3).arrayBuffer());
  const hasJpegSignature = signature.length === 3
    && signature[0] === 0xff
    && signature[1] === 0xd8
    && signature[2] === 0xff;
  const mime = declaredMime.toLocaleLowerCase("en-US");
  const acceptedMime = !mime || mime === "image/jpeg" || mime === "image/jpg" || mime === "application/octet-stream";
  if (!hasJpegSignature || !acceptedMime || (extension !== "jpg" && extension !== "jpeg")) {
    throw new Error("Biyometrik fotoğraf geçerli bir JPG/JPEG dosyası olmalıdır.");
  }
}

async function assertJpegFile(file: File): Promise<void> {
  await assertJpegBlob(file, file.name, file.type);
}

async function assertPdfFile(file: File): Promise<void> {
  if (!file.size) throw new Error(`${file.name || "Evrak"}: PDF dosyası boş.`);
  if (file.size > MAX_DOCUMENT_BYTES) throw new Error(`${file.name}: PDF 25 MB sınırını aşıyor.`);
  if (file.name.split(".").pop()?.toLocaleLowerCase("en-US") !== "pdf") {
    throw new Error(`${file.name}: yalnızca PDF evrak yüklenebilir.`);
  }
  const mime = file.type.toLocaleLowerCase("en-US");
  if (mime && mime !== "application/pdf" && mime !== "application/octet-stream") {
    throw new Error(`${file.name}: dosya türü PDF değil.`);
  }
  const header = new Uint8Array(await file.slice(0, Math.min(file.size, 1024)).arrayBuffer());
  const signature = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
  const hasSignature = header.some((_, index) => (
    index + signature.length <= header.length
      && signature.every((byte, offset) => header[index + offset] === byte)
  ));
  if (!hasSignature) throw new Error(`${file.name}: geçerli PDF imzası bulunamadı.`);
}

export async function localPassengerDocuments(passengerId: number): Promise<PassengerDocument[]> {
  const row = await getPassenger<StoredPassenger>(passengerId);
  if (!row) throw new Error("Yolcu bulunamadı.");
  return row.documents ?? [];
}

export async function localUploadPassengerDocuments(
  passengerId: number,
  files: File[],
): Promise<PassengerDocument[]> {
  const row = await getPassenger<StoredPassenger>(passengerId);
  if (!row) throw new Error("Yolcu bulunamadı.");
  if (!files.length) return row.documents ?? [];

  let totalBytes = 0;
  for (const file of files) {
    totalBytes += file.size;
    if (totalBytes > MAX_DOCUMENT_BATCH_BYTES) {
      throw new Error("PDF evrak seçimi toplam 250 MB güvenli cihaz sınırını aşıyor.");
    }
    await assertPdfFile(file);
  }

  const created: PassengerDocument[] = [];
  try {
    for (const file of files) {
      const id = newId();
      const filename = leafFilename(file.name, "evrak.pdf");
      const normalized = new File([file], filename, {
        type: "application/pdf",
        lastModified: file.lastModified || Date.now(),
      });
      const document: PassengerDocument = {
        id,
        filename,
        mime: "application/pdf",
        size: normalized.size,
        created_at: new Date().toISOString(),
      };
      await putBinary(documentBinaryId(id), normalized, {
        kind: "document",
        filename,
        mime: "application/pdf",
        passengerId,
        documentId: id,
      } satisfies BinaryMetadata);
      created.push(document);
    }
    row.documents = [...(row.documents ?? []), ...created];
    await putPassenger(row);
  } catch (error) {
    for (const document of created) await deleteBinary(documentBinaryId(document.id));
    throw error;
  }
  return row.documents;
}

export async function localPassengerDocumentFile(
  passengerId: number,
  documentId: string,
): Promise<PassengerDocumentFile> {
  const row = await getPassenger<StoredPassenger>(passengerId);
  if (!row) throw new Error("Yolcu bulunamadı.");
  const document = (row.documents ?? []).find((item) => item.id === documentId);
  if (!document) throw new Error("PDF evrak bulunamadı.");
  const binary = await getBinary(documentBinaryId(document.id));
  if (!binary) throw new Error("PDF evrakın şifreli dosyası bulunamadı.");
  return {
    metadata: document,
    blob: binary.data.type === "application/pdf"
      ? binary.data
      : new Blob([binary.data], { type: "application/pdf" }),
  };
}

export async function localDeletePassengerDocument(
  passengerId: number,
  documentId: string,
): Promise<SimpleResult> {
  const row = await getPassenger<StoredPassenger>(passengerId);
  if (!row) throw new Error("Yolcu bulunamadı.");
  const documents = row.documents ?? [];
  if (!documents.some((document) => document.id === documentId)) throw new Error("PDF evrak bulunamadı.");
  row.documents = documents.filter((document) => document.id !== documentId);
  await putPassenger(row);
  await deleteBinary(documentBinaryId(documentId));
  return {
    ok: true,
    message: "PDF evrak silindi.",
    passenger_count: (await listPassengers()).length,
  };
}

function safeArchivePath(name: string): boolean {
  const normalized = name.replaceAll("\\", "/");
  return Boolean(normalized && !normalized.startsWith("/") && !/^[A-Za-z]:\//.test(normalized) && !normalized.split("/").includes(".."));
}

function isArchiveSymlink(entry: { unixMode?: number }): boolean {
  return entry.unixMode !== undefined && (entry.unixMode & 0o170000) === 0o120000;
}

async function selectedPhotoFiles(files: File[]): Promise<Array<{ filename: string; blob: Blob }>> {
  const output: Array<{ filename: string; blob: Blob }> = [];
  let total = 0;
  for (const file of files) {
    const signature = new Uint8Array(await file.slice(0, 4).arrayBuffer());
    const isZip = signature[0] === 0x50 && signature[1] === 0x4b;
    if (!isZip) {
      await assertJpegFile(file);
      if (file.size > MAX_PHOTO_BYTES || total + file.size > MAX_PHOTO_BATCH_BYTES) {
        throw new Error("Fotoğraf seçimi güvenli cihaz boyutu sınırını aşıyor.");
      }
      total += file.size;
      output.push({ filename: file.name, blob: file });
      continue;
    }
    const reader = new ZipReader(new BlobReader(file), { useWebWorkers: false });
    try {
      for await (const entry of reader.getEntriesGenerator()) {
        if (entry.directory || !safeArchivePath(entry.filename) || entry.encrypted || isArchiveSymlink(entry)) continue;
        const mime = imageMime(entry.filename);
        if (!mime.startsWith("image/")) continue;
        if (mime !== "image/jpeg") {
          throw new Error(`${entry.filename}: biyometrik fotoğraf JPG/JPEG olmalıdır.`);
        }
        if (entry.uncompressedSize > MAX_PHOTO_BYTES || total + entry.uncompressedSize > MAX_PHOTO_BATCH_BYTES) {
          throw new Error("Fotoğraf ZIP'i güvenli açılmış boyut sınırını aşıyor.");
        }
        const ratio = entry.uncompressedSize / Math.max(entry.compressedSize, 1);
        if (entry.uncompressedSize > 1024 * 1024 && ratio > 200) continue;
        const blob = await entry.getData(new BlobWriter(mime), { checkSignature: true, useWebWorkers: false });
        await assertJpegBlob(blob, entry.filename, mime);
        if (blob.size > MAX_PHOTO_BYTES || total + blob.size > MAX_PHOTO_BATCH_BYTES) {
          throw new Error("Fotoğraf ZIP'i güvenli açılmış boyut sınırını aşıyor.");
        }
        total += blob.size;
        output.push({ filename: entry.filename.split("/").pop() || entry.filename, blob });
      }
    } finally {
      await reader.close();
    }
  }
  return output;
}

function photoMatch(filename: string, rows: StoredPassenger[]): { passenger: StoredPassenger; method: string; confidence: number } | null {
  const stem = filename.replace(/\.[^.]+$/, "");
  const key = fold(stem);
  const tokens = stem.split(/[^\p{L}\p{N}]+/u).map(fold).filter(Boolean);
  if (!key) return null;
  const passportMatches = rows.filter((row) => {
    const passport = fold(row.passport_no);
    if (passport.length < 6) return false;
    return tokens.includes(passport) || key === passport || key.startsWith(passport) || key.endsWith(passport);
  });
  if (passportMatches.length === 1) return { passenger: passportMatches[0], method: "passport", confidence: 1 };
  if (passportMatches.length > 1) return null;

  const nameMatches = rows.filter((row) => {
    const full = fold(row.full_name);
    const joined = `${fold(row.first_name)}${fold(row.last_name)}`;
    return Boolean((full && key.includes(full)) || (joined && key.includes(joined)));
  });
  return nameMatches.length === 1 ? { passenger: nameMatches[0], method: "name", confidence: 0.85 } : null;
}

async function storePhoto(filename: string, blob: Blob): Promise<string> {
  const id = `${PHOTO_PREFIX}${newId()}`;
  const file = new File([blob], filename, { type: blob.type || imageMime(filename), lastModified: Date.now() });
  await putBinary(id, file, { kind: "photo", filename, mime: file.type } satisfies BinaryMetadata);
  return id;
}

export async function localMatchPhotos(files: File[]): Promise<MatchPhotosResponse> {
  const [photos, rows] = await Promise.all([selectedPhotoFiles(files), listPassengers<StoredPassenger>()]);
  const unmatched = await unmatchedRecords();
  const matches: MatchPhotosResponse["matches"] = [];
  const unmatchedNames: string[] = [];
  for (const photo of photos) {
    const match = photoMatch(photo.filename, rows);
    const binaryId = await storePhoto(photo.filename, photo.blob);
    if (!match) {
      unmatched.push({ id: newId(), binaryId, filename: photo.filename, createdAt: new Date().toISOString() });
      unmatchedNames.push(photo.filename);
      continue;
    }
    const index = rows.findIndex((row) => row.id === match.passenger.id);
    const current = rows[index];
    const previousPhoto = current.photo;
    rows[index] = { ...current, photo: binaryId };
    try {
      await putPassenger(rows[index]);
    } catch (error) {
      await deleteBinary(binaryId);
      throw error;
    }
    if (previousPhoto && previousPhoto !== binaryId) {
      revokePhotoUrl(previousPhoto);
      await deleteBinary(previousPhoto);
    }
    matches.push({
      filename: photo.filename,
      passenger_id: current.id,
      passenger_name: current.full_name,
      method: match.method,
      confidence: match.confidence,
    });
  }
  await setMeta(META_UNMATCHED, unmatched);
  return {
    matched: matches.length,
    unmatched: unmatchedNames,
    passenger_count: rows.length,
    with_photo: rows.filter((row) => Boolean(row.photo)).length,
    matches,
  };
}

export async function localSetPassengerPhoto(id: number, file: File): Promise<SimpleResult> {
  const row = await getPassenger<StoredPassenger>(id);
  if (!row) throw new Error("Yolcu bulunamadı.");
  if (file.size > MAX_PHOTO_BYTES) throw new Error("Fotoğraf 25 MB sınırını aşıyor.");
  await assertJpegFile(file);
  const previousPhoto = row.photo;
  const nextPhoto = await storePhoto(file.name, file);
  try {
    row.photo = nextPhoto;
    await putPassenger(row);
  } catch (error) {
    await deleteBinary(nextPhoto);
    throw error;
  }
  if (previousPhoto && previousPhoto !== nextPhoto) {
    revokePhotoUrl(previousPhoto);
    await deleteBinary(previousPhoto);
  }
  return { ok: true, message: "Fotoğraf cihazda şifreli kaydedildi.", passenger_count: (await listPassengers()).length };
}

export async function localRemovePassengerPhoto(id: number): Promise<SimpleResult> {
  const row = await getPassenger<StoredPassenger>(id);
  if (!row) throw new Error("Yolcu bulunamadı.");
  const previousPhoto = row.photo;
  row.photo = "";
  await putPassenger(row);
  if (previousPhoto) {
    revokePhotoUrl(previousPhoto);
    await deleteBinary(previousPhoto);
  }
  return { ok: true, message: "Fotoğraf silindi.", passenger_count: (await listPassengers()).length };
}

export async function localUnmatchedPhotos(): Promise<UnmatchedPhoto[]> {
  return Promise.all((await unmatchedRecords()).map(async (item) => ({
    id: item.id,
    filename: item.filename,
    photo_url: await photoUrl(item.binaryId),
    created_at: item.createdAt,
  })));
}

export async function localAssignUnmatched(itemId: string, passengerId: number): Promise<SimpleResult> {
  const unmatched = await unmatchedRecords();
  const item = unmatched.find((record) => record.id === itemId);
  const row = await getPassenger<StoredPassenger>(passengerId);
  if (!item || !row) throw new Error("Fotoğraf veya yolcu bulunamadı.");
  const previousPhoto = row.photo;
  row.photo = item.binaryId;
  await putPassenger(row);
  await setMeta(META_UNMATCHED, unmatched.filter((record) => record.id !== itemId));
  if (previousPhoto && previousPhoto !== item.binaryId) {
    revokePhotoUrl(previousPhoto);
    await deleteBinary(previousPhoto);
  }
  return { ok: true, message: "Fotoğraf yolcuya atandı.", passenger_count: (await listPassengers()).length };
}

export async function localDeleteUnmatched(itemId: string): Promise<SimpleResult> {
  const unmatched = await unmatchedRecords();
  const item = unmatched.find((record) => record.id === itemId);
  if (!item) throw new Error("Fotoğraf bulunamadı.");
  await setMeta(META_UNMATCHED, unmatched.filter((record) => record.id !== itemId));
  revokePhotoUrl(item.binaryId);
  await deleteBinary(item.binaryId);
  return { ok: true, message: "Eşleşmeyen fotoğraf silindi.", passenger_count: (await listPassengers()).length };
}

export async function localImportMail(file: File, batchId: string): Promise<MailImportResponse> {
  if (file.size > MAX_EMAIL_BYTES) throw new Error("E-posta dosyası 100 MB sınırını aşıyor.");
  const email = await PostalMime.parse(await file.arrayBuffer(), {
    attachmentEncoding: "arraybuffer",
    maxNestingDepth: 3,
    maxHeadersSize: 1024 * 1024,
  });
  let importedRows = 0;
  let matchedPhotos = 0;
  let storedDocuments = 0;
  const warnings: string[] = [];
  const photos: File[] = [];
  let attachmentBytes = 0;
  for (const attachment of email.attachments) {
    const filename = attachment.filename || `ek-${storedDocuments + 1}`;
    const content = typeof attachment.content === "string"
      ? new TextEncoder().encode(attachment.content).buffer
      : attachment.content;
    const attached = new File([content], filename, { type: attachment.mimeType });
    attachmentBytes += attached.size;
    if (attached.size > MAX_EMAIL_ATTACHMENT_BYTES || attachmentBytes > MAX_EMAIL_ATTACHMENTS_BYTES) {
      warnings.push(`${filename}: güvenli ek boyutu sınırı nedeniyle atlandı.`);
      continue;
    }
    if (attachment.mimeType.startsWith("image/") || imageMime(filename).startsWith("image/")) {
      photos.push(attached);
      continue;
    }
    const ext = filename.split(".").pop()?.toLocaleLowerCase("en-US");
    if (["xlsx", "xls", "xlsm", "ods", "csv", "zip"].includes(ext ?? "")) {
      const response = await localUploadPassengerFile(attached, false, "skip", batchId);
      importedRows += response.imported;
      warnings.push(...response.warnings);
    } else {
      storedDocuments += 1;
    }
  }
  if (photos.length) matchedPhotos = (await localMatchPhotos(photos)).matched;
  return {
    subject: email.subject ?? file.name,
    sender: email.from && "address" in email.from ? (email.from.address ?? "") : "",
    attachment_count: email.attachments.length,
    imported_rows: importedRows,
    matched_photos: matchedPhotos,
    stored_documents: storedDocuments,
    warnings,
  };
}

export async function localUsers(): Promise<UserView[]> {
  const status = await vaultAuthStatus();
  return status.user ? [{ ...status.user, active: true }] : [];
}

export async function localAudit(): Promise<AuditEntry[]> {
  const history = await importHistory();
  return history.map((item, index) => ({
    id: `${item.batch_id ?? "batch"}-${index}`,
    time: item.time ?? "",
    actor: "Yerel kullanıcı",
    role: "admin",
    action: "Dosya aktarımı",
    path: item.files ?? "",
  }));
}

export async function localBackups(): Promise<BackupInfo[]> {
  return [];
}

export async function localExportRows(scope?: DateScope, ids?: number[]): Promise<StoredPassenger[]> {
  const rows = await listPassengers<StoredPassenger>();
  const selected = ids?.length ? rows.filter((row) => ids.includes(row.id)) : rows;
  return filterPassengers(selected, { scope }).rows;
}

export async function localExportPhotos(rows: StoredPassenger[]): Promise<Array<{ filename: string; blob: Blob }>> {
  const output: Array<{ filename: string; blob: Blob }> = [];
  for (const row of rows) {
    if (!row.photo) continue;
    const binary = await getBinary(row.photo);
    if (!binary) continue;
    const extension = binary.name.includes(".") ? `.${binary.name.split(".").pop()}` : ".jpg";
    output.push({ filename: `${row.passport_no || row.full_name || row.id}${extension}`, blob: binary.data });
  }
  return output;
}

export async function localExportDocuments(rows: StoredPassenger[]): Promise<ExportDocument[]> {
  const output: ExportDocument[] = [];
  for (const row of rows) {
    for (const document of row.documents ?? []) {
      const binary = await getBinary(documentBinaryId(document.id));
      if (!binary) continue;
      output.push({
        passengerId: row.id,
        passengerName: row.full_name,
        passportNo: row.passport_no,
        filename: document.filename,
        blob: binary.data.type === "application/pdf"
          ? binary.data
          : new Blob([binary.data], { type: "application/pdf" }),
      });
    }
  }
  return output;
}

export async function localBinaryRecords(): Promise<VaultBinary[]> {
  return listBinary();
}

export async function localPassengerCount(): Promise<number> {
  return (await listPassengers()).length;
}

export function localExportEncryptedBackup(): Promise<Blob> {
  return exportEncryptedVault();
}

export async function localRestoreEncryptedBackup(file: File): Promise<SimpleResult> {
  await restoreEncryptedVault(file);
  return {
    ok: true,
    message: "Şifreli yedek geri yüklendi. Yedekte kullanılan erişim koduyla kasayı açın.",
    passenger_count: 0,
  };
}
