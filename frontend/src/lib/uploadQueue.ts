"use client";

const DB_NAME = "gatevisa-upload-queue";
const STORE_NAME = "files";
const DB_VERSION = 2;
const STORAGE_TIMEOUT_MS = 2_000;

export type StoredQueueFile = { id: string; file: File; createdAt: number };
export type QueueLoadResult = { files: StoredQueueFile[]; discarded: number };

type StoredQueueRecord = {
  id: string;
  name: string;
  type: string;
  lastModified: number;
  bytes: ArrayBuffer;
  createdAt: number;
};

type LegacyQueueRecord = {
  id?: unknown;
  file?: unknown;
  name?: unknown;
  type?: unknown;
  lastModified?: unknown;
  bytes?: unknown;
  createdAt?: unknown;
};

export class UnreadableUploadFileError extends Error {}

function unreadableMessage(name: string): string {
  return `${name || "Dosya"}: dosya içeriği telefondan okunamadı. Dosyayı yeniden seçin.`;
}

export async function materializeUploadFile(source: File): Promise<File> {
  let bytes: ArrayBuffer;
  try {
    bytes = await source.arrayBuffer();
  } catch {
    throw new UnreadableUploadFileError(unreadableMessage(source.name));
  }
  if (bytes.byteLength === 0) {
    throw new UnreadableUploadFileError(unreadableMessage(source.name));
  }
  return new File([bytes], source.name, {
    type: source.type || "application/octet-stream",
    lastModified: source.lastModified || Date.now(),
  });
}

function withinTimeout<T>(operation: Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = globalThis.setTimeout(
      () => reject(new Error("Yerel kuyruk yanıt vermedi.")),
      STORAGE_TIMEOUT_MS,
    );
    void operation.then(
      (value) => {
        globalThis.clearTimeout(timeout);
        resolve(value);
      },
      (error: unknown) => {
        globalThis.clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Yerel kuyruk kullanımda."));
  });
}

function writeItem(db: IDBDatabase, item: StoredQueueRecord): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put(item);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

function deleteItem(db: IDBDatabase, id: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).delete(id);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

function clearItems(db: IDBDatabase): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).clear();
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

function readItems(db: IDBDatabase): Promise<LegacyQueueRecord[]> {
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).getAll();
    request.onsuccess = () => resolve(request.result as LegacyQueueRecord[]);
    request.onerror = () => reject(request.error);
  });
}

async function normalizeRecord(record: LegacyQueueRecord): Promise<StoredQueueFile | null> {
  if (typeof record.id !== "string") return null;
  let bytes: ArrayBuffer;
  let name = typeof record.name === "string" ? record.name : "";
  let type = typeof record.type === "string" ? record.type : "application/octet-stream";
  let lastModified = typeof record.lastModified === "number" ? record.lastModified : Date.now();
  try {
    if (record.bytes instanceof ArrayBuffer) {
      bytes = record.bytes;
    } else if (record.file instanceof Blob) {
      bytes = await record.file.arrayBuffer();
      if (record.file instanceof File) {
        name ||= record.file.name;
        type = record.file.type || type;
        lastModified = record.file.lastModified || lastModified;
      }
    } else {
      return null;
    }
  } catch {
    return null;
  }
  if (!bytes.byteLength || !name) return null;
  return {
    id: record.id,
    file: new File([bytes], name, { type, lastModified }),
    createdAt: typeof record.createdAt === "number" ? record.createdAt : Date.now(),
  };
}

export async function persistQueueFile(item: StoredQueueFile): Promise<File> {
  const file = await materializeUploadFile(item.file);
  const bytes = await file.arrayBuffer();
  const record: StoredQueueRecord = {
    id: item.id,
    name: file.name,
    type: file.type,
    lastModified: file.lastModified,
    bytes,
    createdAt: item.createdAt,
  };
  let db: IDBDatabase | undefined;
  try {
    db = await withinTimeout(openDb());
    await withinTimeout(writeItem(db, record));
  } catch {
    // Safari yerel kota/veri tutma izni vermese de aktarım aynı oturumda devam eder.
  } finally {
    db?.close();
  }
  return file;
}

export async function loadQueueFiles(): Promise<QueueLoadResult> {
  let db: IDBDatabase | undefined;
  try {
    db = await withinTimeout(openDb());
    const rows = await withinTimeout(readItems(db));
    const files: StoredQueueFile[] = [];
    let discarded = 0;
    for (const row of rows) {
      const item = await normalizeRecord(row);
      if (item) {
        files.push(item);
      } else {
        discarded += 1;
        if (typeof row.id === "string") await withinTimeout(deleteItem(db, row.id));
      }
    }
    return { files: files.sort((a, b) => a.createdAt - b.createdAt), discarded };
  } catch {
    return { files: [], discarded: 0 };
  } finally {
    db?.close();
  }
}

export async function removeQueueFile(id: string): Promise<void> {
  let db: IDBDatabase | undefined;
  try {
    db = await withinTimeout(openDb());
    await withinTimeout(deleteItem(db, id));
  } catch {
    // Temizleme hatası operasyonu durdurmaz.
  } finally {
    db?.close();
  }
}

export async function clearQueueFiles(): Promise<void> {
  let db: IDBDatabase | undefined;
  try {
    db = await withinTimeout(openDb());
    await withinTimeout(clearItems(db));
  } catch {
    // Kuyruk arayüzden yine temizlenir; depolama hatası sonraki açılışta yeniden denenir.
  } finally {
    db?.close();
  }
}
