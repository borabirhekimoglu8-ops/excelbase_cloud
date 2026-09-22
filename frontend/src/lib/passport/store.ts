import { newId } from "@/lib/id";
import {
  deleteBinary,
  deleteEntity,
  getBinary,
  getEntity,
  getMeta,
  listBinaryIds,
  listEntities,
  putBinary,
  putEntity,
  setMeta,
  vaultAuthStatus,
} from "@/lib/offline/vault";

import {
  applyUserField,
  exportExclusionReason,
  possibleDuplicates,
  requiredComplete,
  type CandidateStatus,
  type PassportCandidate,
  type PassportFieldName,
} from "./candidates";
import {
  PASSPORT_CANDIDATE_PREFIX,
  PASSPORT_JOB_PREFIX,
  PASSPORT_PAGE_BINARY_PREFIX,
  PASSPORT_PAGE_PREFIX,
  PASSPORT_PREFS_META,
  PASSPORT_SOURCE_BINARY_PREFIX,
} from "./keys";

export type PassportJobStatus = "processing" | "review" | "done" | "cancelled";
export type PassportPageStatus = "queued" | "processing" | "review" | "conflict" | "done" | "error" | "cancelled";

export type PassportOcrJob = {
  entity_type: "passport_job";
  schema_version: 1;
  id: string;
  status: PassportJobStatus;
  sources: Array<{ fileId: string; filename: string; mime: string; size: number; pageCount: number }>;
  page_ids: string[];
  engine: { name: string; version: string } | null;
  origin: "local-ocr" | "text-layer" | "paste" | "package-import";
  keep_page_images: boolean;
  created_at: string;
  updated_at: string;
};

export type PassportOcrPage = {
  entity_type: "passport_page";
  schema_version: 1;
  id: string;
  job_id: string;
  file_id: string;
  page_index: number;
  status: PassportPageStatus;
  attempt: number;
  error: string;
  text_layer_used: boolean;
  ocr_used: boolean;
  image_binary_id: string;
  image_size: { width: number; height: number } | null;
  raw_lines: Array<{ text: string; box: number[][]; score: number | null }>;
  candidate_ids: string[];
  created_at: string;
  updated_at: string;
};

function now(): string {
  return new Date().toISOString();
}

function jobKey(id: string): string {
  return `${PASSPORT_JOB_PREFIX}${id}`;
}

function pageKey(id: string): string {
  return `${PASSPORT_PAGE_PREFIX}${id}`;
}

function candidateKey(id: string): string {
  return `${PASSPORT_CANDIDATE_PREFIX}${id}`;
}

export async function vaultIsUnlocked(): Promise<boolean> {
  const status = await vaultAuthStatus();
  return status.authenticated;
}

export async function listPassportJobs(): Promise<PassportOcrJob[]> {
  return listEntities<PassportOcrJob>(PASSPORT_JOB_PREFIX);
}

export async function listPassportPages(): Promise<PassportOcrPage[]> {
  return listEntities<PassportOcrPage>(PASSPORT_PAGE_PREFIX);
}

export async function listPassportCandidates(): Promise<PassportCandidate[]> {
  return listEntities<PassportCandidate>(PASSPORT_CANDIDATE_PREFIX);
}

export async function getPassportCandidate(id: string): Promise<PassportCandidate | null> {
  return getEntity<PassportCandidate>(candidateKey(id));
}

export async function putPassportJob(job: PassportOcrJob): Promise<void> {
  await putEntity(jobKey(job.id), { ...job, updated_at: now() });
}

export async function putPassportPage(page: PassportOcrPage): Promise<void> {
  await putEntity(pageKey(page.id), { ...page, updated_at: now() });
}

export async function putPassportCandidate(candidate: PassportCandidate): Promise<void> {
  await putEntity(candidateKey(candidate.id), { ...candidate, updated_at: now() });
}

export function createJobDraft(origin: PassportOcrJob["origin"]): PassportOcrJob {
  const created = now();
  return {
    entity_type: "passport_job",
    schema_version: 1,
    id: newId(),
    status: "processing",
    sources: [],
    page_ids: [],
    engine: null,
    origin,
    keep_page_images: false,
    created_at: created,
    updated_at: created,
  };
}

export function createPageDraft(jobId: string, fileId: string, pageIndex: number): PassportOcrPage {
  const created = now();
  return {
    entity_type: "passport_page",
    schema_version: 1,
    id: newId(),
    job_id: jobId,
    file_id: fileId,
    page_index: pageIndex,
    status: "queued",
    attempt: 0,
    error: "",
    text_layer_used: false,
    ocr_used: false,
    image_binary_id: "",
    image_size: null,
    raw_lines: [],
    candidate_ids: [],
    created_at: created,
    updated_at: created,
  };
}

export async function savePageImage(pageId: string, blob: Blob): Promise<string> {
  const id = `${PASSPORT_PAGE_BINARY_PREFIX}${pageId}`;
  await putBinary(id, blob, { kind: "passport-page" });
  return id;
}

export async function saveSourceFile(fileId: string, blob: Blob): Promise<string> {
  const id = `${PASSPORT_SOURCE_BINARY_PREFIX}${fileId}`;
  await putBinary(id, blob, { kind: "passport-source" });
  return id;
}

export async function readPageImage(pageId: string): Promise<Blob | null> {
  const binary = await getBinary(`${PASSPORT_PAGE_BINARY_PREFIX}${pageId}`);
  return binary?.data ?? null;
}

export async function readSourceFile(fileId: string): Promise<Blob | null> {
  const binary = await getBinary(`${PASSPORT_SOURCE_BINARY_PREFIX}${fileId}`);
  return binary?.data ?? null;
}

export async function deleteNonApprovedCandidates(page: PassportOcrPage): Promise<PassportOcrPage> {
  const kept: string[] = [];
  for (const id of page.candidate_ids) {
    const candidate = await getPassportCandidate(id);
    if (candidate?.status === "user-approved") {
      kept.push(id);
      continue;
    }
    if (candidate) await deleteEntity(candidateKey(id));
  }
  const next = { ...page, candidate_ids: kept, updated_at: now() };
  await putPassportPage(next);
  return next;
}

export async function patchCandidateField(
  id: string,
  name: PassportFieldName,
  value: string,
): Promise<PassportCandidate | null> {
  const candidate = await getPassportCandidate(id);
  if (!candidate) return null;
  const fields = applyUserField(candidate.fields, name, value, candidate.page_id);
  const next: PassportCandidate = {
    ...candidate,
    fields,
    auto_pass: false,
    status: candidate.status === "user-approved" ? "review" : candidate.status === "rejected" ? "rejected" : "review",
    approved_at: "",
    approved_by: "",
    updated_at: now(),
  };
  await putPassportCandidate(next);
  return next;
}

export async function setCandidateStatus(id: string, status: CandidateStatus, approvedBy = ""): Promise<PassportCandidate | null> {
  const candidate = await getPassportCandidate(id);
  if (!candidate) return null;
  const next: PassportCandidate = {
    ...candidate,
    status,
    approved_at: status === "user-approved" ? now() : "",
    approved_by: status === "user-approved" ? approvedBy : "",
    updated_at: now(),
  };
  await putPassportCandidate(next);
  return next;
}

export async function refreshDuplicates(): Promise<void> {
  const candidates = await listPassportCandidates();
  for (const candidate of candidates) {
    const ids = possibleDuplicates(candidate, candidates);
    if (ids.join("|") !== candidate.possible_duplicate_of.join("|")) {
      await putPassportCandidate({ ...candidate, possible_duplicate_of: ids });
    }
  }
}

export async function markInterruptedPages(): Promise<number> {
  const pages = await listPassportPages();
  let changed = 0;
  for (const page of pages) {
    if (page.status === "queued" || page.status === "processing") {
      await putPassportPage({
        ...page,
        status: "error",
        error: "Uygulama işlem sırasında kapanmış; yeniden dene",
      });
      changed += 1;
    }
  }
  return changed;
}

export async function exportableCandidates(): Promise<{ included: PassportCandidate[]; excluded: Array<{ id: string; reason: string }> }> {
  const candidates = await listPassportCandidates();
  const included: PassportCandidate[] = [];
  const excluded: Array<{ id: string; reason: string }> = [];
  for (const candidate of candidates) {
    const reason = exportExclusionReason(candidate);
    if (reason) excluded.push({ id: candidate.id, reason });
    else included.push(candidate);
  }
  return { included, excluded };
}

export function candidateReady(candidate: PassportCandidate): boolean {
  return candidate.status === "user-approved" && requiredComplete(candidate.fields);
}

export async function getPassportPrefs(): Promise<{ keep_page_images: boolean; concurrency: 1 | 2 }> {
  const value = await getMeta<{ keep_page_images?: boolean; concurrency?: number }>(PASSPORT_PREFS_META);
  return {
    keep_page_images: value?.keep_page_images === true,
    concurrency: value?.concurrency === 2 ? 2 : 1,
  };
}

export async function setPassportPrefs(prefs: { keep_page_images: boolean; concurrency: 1 | 2 }): Promise<void> {
  await setMeta(PASSPORT_PREFS_META, prefs);
}

export async function clearPassportVaultRecords(): Promise<void> {
  const [jobs, pages, candidates, binaryIds] = await Promise.all([
    listPassportJobs(),
    listPassportPages(),
    listPassportCandidates(),
    listBinaryIds(),
  ]);
  for (const job of jobs) await deleteEntity(jobKey(job.id));
  for (const page of pages) await deleteEntity(pageKey(page.id));
  for (const candidate of candidates) await deleteEntity(candidateKey(candidate.id));
  for (const id of binaryIds) {
    if (id.startsWith(PASSPORT_SOURCE_BINARY_PREFIX) || id.startsWith(PASSPORT_PAGE_BINARY_PREFIX)) {
      await deleteBinary(id);
    }
  }
}

export async function deleteSourceIfIdle(fileId: string): Promise<void> {
  const pages = await listPassportPages();
  const busy = pages.some((page) => page.file_id === fileId && (page.status === "queued" || page.status === "error"));
  if (!busy) await deleteBinary(`${PASSPORT_SOURCE_BINARY_PREFIX}${fileId}`);
}
