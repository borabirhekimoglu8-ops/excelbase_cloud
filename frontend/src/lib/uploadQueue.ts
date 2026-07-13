"use client";

const DB_NAME = "gatevisa-upload-queue";
const STORE_NAME = "files";
const STORAGE_TIMEOUT_MS = 2_000;

export type StoredQueueFile = { id: string; file: File; createdAt: number };

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
    const request = indexedDB.open(DB_NAME, 1);
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

function writeItem(db: IDBDatabase, item: StoredQueueFile): Promise<void> {
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

function readItems(db: IDBDatabase): Promise<StoredQueueFile[]> {
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).getAll();
    request.onsuccess = () => resolve(request.result as StoredQueueFile[]);
    request.onerror = () => reject(request.error);
  });
}

export async function persistQueueFile(item: StoredQueueFile): Promise<void> {
  let db: IDBDatabase | undefined;
  try {
    db = await withinTimeout(openDb());
    await withinTimeout(writeItem(db, item));
  } catch {
    // Safari yerel kota/veri tutma izni vermese de aktarım aynı oturumda devam eder.
  } finally {
    db?.close();
  }
}

export async function loadQueueFiles(): Promise<StoredQueueFile[]> {
  let db: IDBDatabase | undefined;
  try {
    db = await withinTimeout(openDb());
    const rows = await withinTimeout(readItems(db));
    return rows.sort((a, b) => a.createdAt - b.createdAt);
  } catch {
    return [];
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
