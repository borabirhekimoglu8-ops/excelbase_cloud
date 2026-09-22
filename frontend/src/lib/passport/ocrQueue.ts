import { openDB, type IDBPDatabase, type DBSchema } from "idb";

import { sha256Hex } from "@/lib/hash";
import { isTransientOcrCode, type TransientOcrCode } from "./failureTaxonomy";

const QUEUE_DB = "passport-ocr-queue";
const QUEUE_DB_VERSION = 1;

export type OcrQueueState = "waiting" | "running" | "retrying" | "done" | "failed";
export type OcrQueueJob = {
  id: string;
  pageSha256: string;
  profileId: string;
  state: OcrQueueState;
  attempts: number;
  message: string;
  updatedAt: string;
};

interface QueueSchema extends DBSchema {
  jobs: { key: string; value: OcrQueueJob };
}

export type QueueError = Error & { code?: string };
export type OcrQueueProcessor<T> = (page: Blob, job: OcrQueueJob) => Promise<T>;

type Pending<T> = {
  page: Blob;
  job: OcrQueueJob;
  resolve(value: T): void;
  reject(reason: unknown): void;
};

export class PassportOcrQueue<T> {
  private readonly pending: Pending<T>[] = [];
  private readonly enqueueInFlight = new Map<string, Promise<T>>();
  private readonly sourceInFlight = new Map<string, Promise<T>>();
  private readonly completed = new Map<string, T>();
  private draining = false;
  private databasePromise: Promise<IDBPDatabase<QueueSchema>> | null = null;

  constructor(
    private readonly processor: OcrQueueProcessor<T>,
    private readonly maxAttempts = 3,
    private readonly wait: (milliseconds: number) => Promise<void> =
      (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  ) {}

  private database(): Promise<IDBPDatabase<QueueSchema>> {
    if (!this.databasePromise) {
      this.databasePromise = openDB<QueueSchema>(QUEUE_DB, QUEUE_DB_VERSION, {
        upgrade(db) {
          if (!db.objectStoreNames.contains("jobs")) db.createObjectStore("jobs");
        },
      });
    }
    return this.databasePromise;
  }

  enqueue(page: Blob, pageSha256: string, profileId: string): Promise<T> {
    const sourceKey = `${pageSha256}:${profileId}`;
    const existing = this.sourceInFlight.get(sourceKey);
    if (existing) return existing;
    const promise = this.enqueueResolved(page, pageSha256, profileId)
      .finally(() => this.sourceInFlight.delete(sourceKey));
    this.sourceInFlight.set(sourceKey, promise);
    return promise;
  }

  private async enqueueResolved(page: Blob, pageSha256: string, profileId: string): Promise<T> {
    const id = await sha256Hex(`${pageSha256}${profileId}`);
    const finished = this.completed.get(id);
    if (finished !== undefined) return finished;
    const existingJob = this.enqueueInFlight.get(id);
    if (existingJob) return existingJob;

    const job: OcrQueueJob = {
      id,
      pageSha256,
      profileId,
      state: "waiting",
      attempts: 0,
      message: "Sayfa sırada bekliyor.",
      updatedAt: new Date().toISOString(),
    };
    await (await this.database()).put("jobs", job, id);
    const promise = new Promise<T>((resolve, reject) => {
      this.pending.push({ page, job, resolve, reject });
    });
    this.enqueueInFlight.set(id, promise);
    void this.drain();
    return promise;
  }

  private async save(job: OcrQueueJob): Promise<void> {
    job.updatedAt = new Date().toISOString();
    await (await this.database()).put("jobs", job, job.id);
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.pending.length) {
        const item = this.pending.shift();
        if (!item) continue;
        try {
          let output: T | undefined;
          while (item.job.attempts < this.maxAttempts) {
            item.job.attempts += 1;
            item.job.state = item.job.attempts === 1 ? "running" : "retrying";
            item.job.message = item.job.attempts === 1
              ? "Pasaport bu cihazda okunuyor…"
              : "Görüntü işleme yeniden deneniyor…";
            await this.save(item.job);
            try {
              output = await this.processor(item.page, item.job);
              break;
            } catch (reason) {
              const code = (reason as QueueError)?.code ?? "";
              if (!isTransientOcrCode(code) || item.job.attempts >= this.maxAttempts) throw reason;
              await this.wait(250 * (2 ** (item.job.attempts - 1)));
            }
          }
          if (output === undefined) throw new Error("Görüntü işlenemedi.");
          item.job.state = "done";
          item.job.message = "Sayfa işlendi.";
          await this.save(item.job);
          this.completed.set(item.job.id, output);
          item.resolve(output);
        } catch {
          item.job.state = "failed";
          item.job.message = "Sayfa okunamadı. Görüntüyü kontrol edip yeniden deneyin.";
          await this.save(item.job);
          item.reject(new Error(item.job.message));
        } finally {
          this.enqueueInFlight.delete(item.job.id);
        }
      }
    } finally {
      this.draining = false;
    }
  }

  async jobs(): Promise<OcrQueueJob[]> {
    return (await (await this.database()).getAll("jobs"))
      .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt));
  }
}

export function transientQueueError(code: TransientOcrCode): QueueError {
  return Object.assign(new Error("Geçici görüntü işleme hatası"), { code });
}
