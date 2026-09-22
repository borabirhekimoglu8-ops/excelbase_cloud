import { newId } from "@/lib/id";

import {
  candidateStatus,
  emptyFields,
  fieldsFromMrz,
  type PassportCandidate,
} from "./candidates";
import { isImageFile, isPdfFile, isTextFile, prepareImageForOcr } from "./imageInput";
import { mrzLikeLineCount, pairsFromOcrLines } from "./mrzFromOcrLines";
import { allTd3Lines } from "./parseMrzText";
import { parseTd3FromLines } from "./mrz";
import type { OcrLine, OcrPageResult } from "./ocr/types";
import { extractTextPerPage } from "./pdfExtractText";
import { MAX_PASSPORT_BATCH_PAGES, passportPdfPageCount, renderPdfPage } from "./pdfRender";
import {
  createJobDraft,
  createPageDraft,
  deleteNonApprovedCandidates,
  putPassportCandidate,
  putPassportJob,
  putPassportPage,
  refreshDuplicates,
  savePageImage,
  saveSourceFile,
  type PassportOcrJob,
  type PassportOcrPage,
} from "./store";
import { visualHintsFromLines } from "./visualHints";

export type BatchPageView = {
  pageId: string;
  jobId: string;
  label: string;
  status: PassportOcrPage["status"];
  error: string;
  attempt: number;
  candidateCount: number;
};

export type BatchRecognize = (image: Blob, pageId: string, signal: AbortSignal) => Promise<OcrPageResult>;

function stamp(fields: ReturnType<typeof emptyFields>, jobId: string, pageId: string, index: number, pairCount: number, hints: ReturnType<typeof visualHintsFromLines>, mrz: PassportCandidate["mrz"]): PassportCandidate {
  const created = new Date().toISOString();
  const { status, auto_pass } = candidateStatus(fields, hints, pairCount);
  return {
    entity_type: "passport_candidate",
    schema_version: 1,
    id: newId(),
    job_id: jobId,
    page_id: pageId,
    index_on_page: index,
    status,
    auto_pass,
    fields,
    mrz,
    visual_hints: hints,
    possible_duplicate_of: [],
    approved_at: "",
    approved_by: "",
    exported_at: "",
    created_at: created,
    updated_at: created,
  };
}

async function writeCandidates(page: PassportOcrPage, candidates: PassportCandidate[]): Promise<PassportOcrPage> {
  for (const candidate of candidates) await putPassportCandidate(candidate);
  const next: PassportOcrPage = {
    ...page,
    candidate_ids: [...page.candidate_ids, ...candidates.map((item) => item.id)],
    status: candidates.length === 1 && candidates[0].status !== "conflict" ? "review" : "review",
    error: "",
  };
  if (candidates.length === 0) next.status = "review";
  await putPassportPage(next);
  return next;
}

export async function persistPasteMrz(text: string): Promise<{ job: PassportOcrJob; added: number }> {
  const pairs = allTd3Lines(text);
  const job = createJobDraft("paste");
  const page = createPageDraft(job.id, newId(), 0);
  job.page_ids = [page.id];
  job.sources = [{ fileId: page.file_id, filename: "Yapıştırılan MRZ", mime: "text/plain", size: text.length, pageCount: 1 }];
  await putPassportJob(job);
  await putPassportPage(page);
  const candidates: PassportCandidate[] = [];
  pairs.forEach((pair, index) => {
    const parsed = parseTd3FromLines(pair.line1, pair.line2);
    if (!parsed) return;
    const fields = fieldsFromMrz(parsed, page.id, null, null);
    candidates.push(stamp(fields, job.id, page.id, index, pairs.length, [], {
      line1: parsed.line1,
      line2: parsed.line2,
      disputed: parsed.disputedCells,
      warnings: parsed.warnings,
    }));
  });
  const finished = await writeCandidates({ ...page, text_layer_used: true, status: "review" }, candidates);
  await putPassportJob({ ...job, status: "review" });
  await refreshDuplicates();
  return { job, added: finished.candidate_ids.length };
}

async function mapPool<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>, signal: AbortSignal): Promise<void> {
  const queue = [...items];
  const runners = Array.from({ length: Math.max(1, Math.min(concurrency, 2)) }, async () => {
    while (queue.length && !signal.aborted) {
      const item = queue.shift();
      if (!item) return;
      await worker(item);
    }
  });
  await Promise.all(runners);
}

async function processPage(
  page: PassportOcrPage,
  file: File,
  canOcr: boolean,
  recognize: BatchRecognize | null,
  signal: AbortSignal,
): Promise<PassportOcrPage> {
  let current: PassportOcrPage = { ...page, status: "processing", error: "", attempt: page.attempt + 1 };
  await putPassportPage(current);

  let text = "";
  let texts: string[] = [];
  if (isTextFile(file)) {
    text = await file.text();
    texts = [text];
    current.text_layer_used = true;
  } else if (isPdfFile(file)) {
    texts = await extractTextPerPage(file, MAX_PASSPORT_BATCH_PAGES);
    text = texts[page.page_index] ?? "";
    current.text_layer_used = Boolean(text.trim());
  }

  const textPairs = allTd3Lines(text);
  if (textPairs.length >= 1) {
    const candidates = textPairs.flatMap((pair, index) => {
      const parsed = parseTd3FromLines(pair.line1, pair.line2);
      if (!parsed) return [];
      return [stamp(fieldsFromMrz(parsed, page.id, null, null), page.job_id, page.id, index, textPairs.length, [], {
        line1: parsed.line1,
        line2: parsed.line2,
        disputed: parsed.disputedCells,
        warnings: parsed.warnings,
      })];
    });
    current = await writeCandidates(current, candidates);
    return current;
  }

  if (!canOcr || !recognize) {
    current.status = "error";
    current.error = isPdfFile(file)
      ? "Metin katmanında MRZ yok; yerel OCR bağlı değil."
      : "Yerel OCR yok";
    await putPassportPage(current);
    return current;
  }

  let image: Blob;
  let width = 0;
  let height = 0;
  if (isPdfFile(file)) {
    const rendered = await renderPdfPage(file, page.page_index);
    image = rendered.blob;
    width = rendered.width;
    height = rendered.height;
  } else {
    image = await prepareImageForOcr(file);
  }
  current.image_binary_id = await savePageImage(page.id, image);
  current.image_size = width ? { width, height } : current.image_size;
  current.ocr_used = true;

  const result = await recognize(image, page.id, signal);
  const lines: OcrLine[] = result.lines;
  current.raw_lines = lines;
  current.image_size = { width: result.width || width, height: result.height || height };
  const pairs = pairsFromOcrLines(lines);
  const hints = visualHintsFromLines(lines);
  if (pairs.length === 0) {
    const draft = stamp(emptyFields(page.id), page.job_id, page.id, 0, 0, hints, null);
    current = await writeCandidates(current, [draft]);
    return current;
  }
  const candidates = pairs.map((pair, index) => stamp(
    fieldsFromMrz(pair.parsed, page.id, pair.score, pair.box),
    page.job_id,
    page.id,
    index,
    pairs.length,
    hints,
    {
      line1: pair.parsed.line1,
      line2: pair.parsed.line2,
      disputed: pair.parsed.disputedCells,
      warnings: pair.parsed.warnings,
    },
  ));
  current = await writeCandidates(current, candidates);
  return current;
}

export async function runPassportBatch(options: {
  files: File[];
  canOcr: boolean;
  recognize: BatchRecognize | null;
  concurrency?: number;
  signal: AbortSignal;
  onProgress?: (pages: BatchPageView[]) => void;
}): Promise<{ job: PassportOcrJob; pages: PassportOcrPage[] }> {
  const job = createJobDraft(options.canOcr ? "local-ocr" : "text-layer");
  const pages: PassportOcrPage[] = [];
  const fileById = new Map<string, File>();

  for (const file of options.files) {
    if (options.signal.aborted) break;
    const fileId = newId();
    fileById.set(fileId, file);
    await saveSourceFile(fileId, file);
    const pageCount = isPdfFile(file) ? await passportPdfPageCount(file) : 1;
    job.sources.push({ fileId, filename: file.name, mime: file.type, size: file.size, pageCount });
    for (let index = 0; index < pageCount; index += 1) {
      const page = createPageDraft(job.id, fileId, index);
      pages.push(page);
      job.page_ids.push(page.id);
    }
  }
  await putPassportJob(job);
  for (const page of pages) await putPassportPage(page);

  const views = () => pages.map((page) => {
    const source = job.sources.find((item) => item.fileId === page.file_id);
    return {
      pageId: page.id,
      jobId: job.id,
      label: `${source?.filename ?? "dosya"} · sayfa ${page.page_index + 1}`,
      status: page.status,
      error: page.error,
      attempt: page.attempt,
      candidateCount: page.candidate_ids.length,
    };
  });
  options.onProgress?.(views());

  await mapPool(pages, options.concurrency ?? 1, async (page) => {
    if (options.signal.aborted) {
      page.status = "cancelled";
      await putPassportPage(page);
      return;
    }
    const file = fileById.get(page.file_id);
    if (!file) return;
    try {
      const next = await processPage(page, file, options.canOcr, options.recognize, options.signal);
      Object.assign(page, next);
    } catch (reason) {
      page.status = "error";
      page.error = reason instanceof Error ? reason.message : "Sayfa işlenemedi.";
      if (/YILMAZ|ERIKSSON|passport/i.test(page.error)) page.error = "Sayfa işlenemedi.";
      await putPassportPage(page);
    }
    options.onProgress?.(views());
  }, options.signal);

  job.status = options.signal.aborted ? "cancelled" : "review";
  await putPassportJob(job);
  await refreshDuplicates();
  return { job, pages };
}

export async function retryPassportPage(
  page: PassportOcrPage,
  file: File,
  canOcr: boolean,
  recognize: BatchRecognize | null,
  signal: AbortSignal,
): Promise<PassportOcrPage> {
  const cleared = await deleteNonApprovedCandidates(page);
  if (cleared.candidate_ids.length && !file) return cleared;
  return processPage(cleared, file, canOcr, recognize, signal);
}

export function fileKindSupported(file: File, acceptImages: boolean): boolean {
  if (isPdfFile(file) || isTextFile(file)) return true;
  return acceptImages && isImageFile(file);
}

export { mrzLikeLineCount };
