import { type DBSchema, type IDBPDatabase, openDB } from "idb";

const DATABASE_NAME = "excelbase-offline-vault";
const DATABASE_VERSION = 1;
const VAULT_CONFIG_KEY = "vault";
const PBKDF2_ITERATIONS = 310_000;
const CRYPTO_VERSION = 1;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

type StoreName = "passengers" | "binaries" | "jobs" | "meta";
type StoreKey = number | string;

type EncryptedPayload = {
  version: 1;
  iv: ArrayBuffer;
  ciphertext: ArrayBuffer;
};

type VaultConfig = {
  id: typeof VAULT_CONFIG_KEY;
  version: 1;
  iterations: number;
  salt: ArrayBuffer;
  wrappedDek: EncryptedPayload;
  verifier: EncryptedPayload;
};

interface VaultSchema extends DBSchema {
  config: { key: string; value: VaultConfig };
  passengers: { key: number; value: EncryptedPayload };
  binaries: { key: string; value: EncryptedPayload };
  jobs: { key: string; value: EncryptedPayload };
  meta: { key: string; value: EncryptedPayload };
}

export type VaultAuthUser = {
  id: "local-admin";
  name: string;
  role: "admin";
};

export type VaultAuthStatus = {
  setup_required: boolean;
  authenticated: boolean;
  user: VaultAuthUser | null;
};

export type VaultBinary = {
  id: string;
  data: Blob;
  name: string;
  type: string;
  size: number;
  lastModified: number | null;
  metadata: unknown;
};

type BinaryHeader = Omit<VaultBinary, "id" | "data" | "size">;

let databasePromise: Promise<IDBPDatabase<VaultSchema>> | null = null;
let dataKey: CryptoKey | null = null;
let unlockedUser: VaultAuthUser | null = null;

function cryptography(): Crypto {
  const value = globalThis.crypto;
  if (!value?.subtle) throw new Error("Bu tarayıcı güvenli yerel şifrelemeyi desteklemiyor.");
  return value;
}

function database(): Promise<IDBPDatabase<VaultSchema>> {
  if (!databasePromise) {
    databasePromise = openDB<VaultSchema>(DATABASE_NAME, DATABASE_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains("config")) db.createObjectStore("config");
        if (!db.objectStoreNames.contains("passengers")) db.createObjectStore("passengers");
        if (!db.objectStoreNames.contains("binaries")) db.createObjectStore("binaries");
        if (!db.objectStoreNames.contains("jobs")) db.createObjectStore("jobs");
        if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta");
      },
      blocked() {
        throw new Error("Yerel kasa başka bir sekmede açık. Diğer sekmeleri kapatıp yeniden deneyin.");
      },
      blocking() {
        void closeVaultDatabase();
      },
      terminated() {
        databasePromise = null;
        lockVault();
      },
    });
  }
  return databasePromise;
}

function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(new ArrayBuffer(length));
  cryptography().getRandomValues(bytes);
  return bytes;
}

function copyBuffer(bytes: Uint8Array<ArrayBuffer>): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function aad(label: string): Uint8Array<ArrayBuffer> {
  return encoder.encode(`excelbase:v${CRYPTO_VERSION}:${label}`);
}

function recordLabel(store: StoreName, key: StoreKey): string {
  return `record:${store}:${typeof key}:${String(key)}`;
}

async function derivePinKey(pin: string, salt: ArrayBuffer, iterations: number): Promise<CryptoKey> {
  const material = await cryptography().subtle.importKey(
    "raw",
    encoder.encode(pin),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return cryptography().subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

async function encryptBytes(key: CryptoKey, bytes: BufferSource, label: string): Promise<EncryptedPayload> {
  const iv = randomBytes(12);
  const ciphertext = await cryptography().subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: aad(label), tagLength: 128 },
    key,
    bytes,
  );
  return { version: CRYPTO_VERSION, iv: copyBuffer(iv), ciphertext };
}

async function decryptBytes(key: CryptoKey, payload: EncryptedPayload, label: string): Promise<ArrayBuffer> {
  if (payload.version !== CRYPTO_VERSION) throw new Error("Kasa şifreleme sürümü desteklenmiyor.");
  return cryptography().subtle.decrypt(
    {
      name: "AES-GCM",
      iv: payload.iv,
      additionalData: aad(label),
      tagLength: 128,
    },
    key,
    payload.ciphertext,
  );
}

async function encryptJson(key: CryptoKey, value: unknown, label: string): Promise<EncryptedPayload> {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new Error("Tanımsız bir değer kasaya kaydedilemez.");
  return encryptBytes(key, encoder.encode(serialized), label);
}

async function decryptJson<T>(key: CryptoKey, payload: EncryptedPayload, label: string): Promise<T> {
  const bytes = await decryptBytes(key, payload, label);
  return JSON.parse(decoder.decode(bytes)) as T;
}

function activeKey(): CryptoKey {
  if (!dataKey) throw new Error("Yerel kasa kilitli. Erişim kodunuzla tekrar giriş yapın.");
  return dataKey;
}

function announceChange(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event("excelbase:vault-change"));
}

function validatePin(pin: string): void {
  if (!/^\d{6,}$/.test(pin)) throw new Error("Erişim kodu en az 6 rakam olmalıdır.");
}

export async function setupVault(name: string, pin: string): Promise<VaultAuthStatus> {
  const displayName = name.trim();
  if (!displayName) throw new Error("Ad soyad alanı boş bırakılamaz.");
  validatePin(pin);

  const db = await database();
  if (await db.get("config", VAULT_CONFIG_KEY)) {
    throw new Error("Bu cihazda bir kasa zaten bulunuyor.");
  }

  const salt = copyBuffer(randomBytes(16));
  const rawDek = randomBytes(32);
  try {
    const pinKey = await derivePinKey(pin, salt, PBKDF2_ITERATIONS);
    const importedDataKey = await cryptography().subtle.importKey(
      "raw",
      rawDek,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
    const wrappedDek = await encryptBytes(pinKey, rawDek, "wrapped-dek");
    const verifier = await encryptJson(
      importedDataKey,
      { magic: "excelbase-local-vault", name: displayName },
      "verifier",
    );
    const config: VaultConfig = {
      id: VAULT_CONFIG_KEY,
      version: CRYPTO_VERSION,
      iterations: PBKDF2_ITERATIONS,
      salt,
      wrappedDek,
      verifier,
    };

    const transaction = db.transaction(
      ["config", "passengers", "binaries", "jobs", "meta"],
      "readwrite",
    );
    await Promise.all([
      transaction.objectStore("passengers").clear(),
      transaction.objectStore("binaries").clear(),
      transaction.objectStore("jobs").clear(),
      transaction.objectStore("meta").clear(),
      transaction.objectStore("config").put(config, VAULT_CONFIG_KEY),
      transaction.done,
    ]);
    dataKey = importedDataKey;
    unlockedUser = { id: "local-admin", name: displayName, role: "admin" };
    announceChange();
    return vaultAuthStatus();
  } finally {
    rawDek.fill(0);
  }
}

export async function unlockVault(pin: string): Promise<VaultAuthStatus> {
  const db = await database();
  const config = await db.get("config", VAULT_CONFIG_KEY);
  if (!config) throw new Error("Bu cihazda henüz bir kasa oluşturulmamış.");

  try {
    const pinKey = await derivePinKey(pin, config.salt, config.iterations);
    const rawDek = new Uint8Array(await decryptBytes(pinKey, config.wrappedDek, "wrapped-dek"));
    try {
      const candidate = await cryptography().subtle.importKey(
        "raw",
        rawDek,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"],
      );
      const verifier = await decryptJson<{ magic: string; name: string }>(candidate, config.verifier, "verifier");
      if (verifier.magic !== "excelbase-local-vault" || !verifier.name) throw new Error("invalid verifier");
      dataKey = candidate;
      unlockedUser = { id: "local-admin", name: verifier.name, role: "admin" };
      announceChange();
      return vaultAuthStatus();
    } finally {
      rawDek.fill(0);
    }
  } catch {
    dataKey = null;
    unlockedUser = null;
    throw new Error("Erişim kodu yanlış veya kasa verisi bozulmuş.");
  }
}

export function lockVault(): void {
  dataKey = null;
  unlockedUser = null;
  announceChange();
}

export async function vaultAuthStatus(): Promise<VaultAuthStatus> {
  const config = await (await database()).get("config", VAULT_CONFIG_KEY);
  if (!config) return { setup_required: true, authenticated: false, user: null };
  return {
    setup_required: false,
    authenticated: Boolean(dataKey && unlockedUser),
    user: dataKey ? unlockedUser : null,
  };
}

async function encryptRecord(store: StoreName, key: StoreKey, value: unknown): Promise<EncryptedPayload> {
  return encryptJson(activeKey(), value, recordLabel(store, key));
}

async function decryptRecord<T>(store: StoreName, key: StoreKey, value: EncryptedPayload): Promise<T> {
  try {
    return await decryptJson<T>(activeKey(), value, recordLabel(store, key));
  } catch (error) {
    if (!dataKey) throw error;
    throw new Error("Kasa kaydı çözülemedi; veri bozulmuş veya değiştirilmiş olabilir.");
  }
}

export async function listPassengers<T extends { id: number }>(): Promise<T[]> {
  activeKey();
  const db = await database();
  const transaction = db.transaction("passengers");
  const [keys, values] = await Promise.all([
    transaction.store.getAllKeys(),
    transaction.store.getAll(),
  ]);
  await transaction.done;
  const rows = await Promise.all(values.map((value, index) => decryptRecord<T>("passengers", keys[index], value)));
  return rows.toSorted((left, right) => left.id - right.id);
}

export async function getPassenger<T extends { id: number }>(id: number): Promise<T | null> {
  activeKey();
  const value = await (await database()).get("passengers", id);
  return value ? decryptRecord<T>("passengers", id, value) : null;
}

export async function putPassenger<T extends { id: number }>(row: T): Promise<void> {
  const encrypted = await encryptRecord("passengers", row.id, row);
  await (await database()).put("passengers", encrypted, row.id);
  announceChange();
}

export async function putPassengers<T extends { id: number }>(rows: T[]): Promise<void> {
  if (!rows.length) return;
  const encrypted = await Promise.all(rows.map(async (row) => ({
    id: row.id,
    value: await encryptRecord("passengers", row.id, row),
  })));
  const transaction = (await database()).transaction("passengers", "readwrite");
  await Promise.all([
    ...encrypted.map(({ id, value }) => transaction.store.put(value, id)),
    transaction.done,
  ]);
  announceChange();
}

export async function replacePassengers<T extends { id: number }>(rows: T[]): Promise<void> {
  const encrypted = await Promise.all(rows.map(async (row) => ({
    id: row.id,
    value: await encryptRecord("passengers", row.id, row),
  })));
  const transaction = (await database()).transaction("passengers", "readwrite");
  await Promise.all([
    transaction.store.clear(),
    ...encrypted.map(({ id, value }) => transaction.store.put(value, id)),
    transaction.done,
  ]);
  announceChange();
}

export async function deletePassenger(id: number): Promise<void> {
  activeKey();
  await (await database()).delete("passengers", id);
  announceChange();
}

export async function clearPassengers(): Promise<void> {
  activeKey();
  await (await database()).clear("passengers");
  announceChange();
}

export async function listJobs<T extends { id: string }>(): Promise<T[]> {
  activeKey();
  const db = await database();
  const transaction = db.transaction("jobs");
  const [keys, values] = await Promise.all([transaction.store.getAllKeys(), transaction.store.getAll()]);
  await transaction.done;
  return Promise.all(values.map((value, index) => decryptRecord<T>("jobs", keys[index], value)));
}

export async function getJob<T extends { id: string }>(id: string): Promise<T | null> {
  activeKey();
  const value = await (await database()).get("jobs", id);
  return value ? decryptRecord<T>("jobs", id, value) : null;
}

export async function putJob<T extends { id: string }>(job: T): Promise<void> {
  const encrypted = await encryptRecord("jobs", job.id, job);
  await (await database()).put("jobs", encrypted, job.id);
  announceChange();
}

export async function deleteJob(id: string): Promise<void> {
  activeKey();
  await (await database()).delete("jobs", id);
  announceChange();
}

export async function clearJobs(): Promise<void> {
  activeKey();
  await (await database()).clear("jobs");
  announceChange();
}

export async function getMeta<T>(key: string): Promise<T | null> {
  activeKey();
  const value = await (await database()).get("meta", key);
  return value ? decryptRecord<T>("meta", key, value) : null;
}

export async function setMeta<T>(key: string, value: T): Promise<void> {
  const encrypted = await encryptRecord("meta", key, value);
  await (await database()).put("meta", encrypted, key);
  announceChange();
}

export async function removeMeta(key: string): Promise<void> {
  activeKey();
  await (await database()).delete("meta", key);
  announceChange();
}

export async function clearMeta(): Promise<void> {
  activeKey();
  await (await database()).clear("meta");
  announceChange();
}

function asBytes(value: ArrayBuffer | ArrayBufferView): Uint8Array<ArrayBuffer> {
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
  const source = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return new Uint8Array(source);
}

async function binaryBytes(
  data: Blob | ArrayBuffer | ArrayBufferView,
): Promise<{ bytes: Uint8Array<ArrayBuffer>; type: string; name: string; lastModified: number | null }> {
  if (data instanceof Blob) {
    const file = typeof File !== "undefined" && data instanceof File ? data : null;
    return {
      bytes: new Uint8Array(await data.arrayBuffer()),
      type: data.type,
      name: file?.name ?? "",
      lastModified: file?.lastModified ?? null,
    };
  }
  return { bytes: asBytes(data), type: "application/octet-stream", name: "", lastModified: null };
}

function packBinary(header: BinaryHeader, bytes: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  const headerBytes = encoder.encode(JSON.stringify(header));
  const packed = new Uint8Array(new ArrayBuffer(4 + headerBytes.length + bytes.length));
  new DataView(packed.buffer).setUint32(0, headerBytes.length, false);
  packed.set(headerBytes, 4);
  packed.set(bytes, 4 + headerBytes.length);
  return packed;
}

function unpackBinary(id: string, decrypted: ArrayBuffer): VaultBinary {
  if (decrypted.byteLength < 4) throw new Error("Kasa ikili kaydı geçersiz.");
  const length = new DataView(decrypted).getUint32(0, false);
  if (length > decrypted.byteLength - 4) throw new Error("Kasa ikili kaydı geçersiz.");
  const header = JSON.parse(decoder.decode(new Uint8Array(decrypted, 4, length))) as BinaryHeader;
  const raw = decrypted.slice(4 + length);
  return {
    id,
    data: new Blob([raw], { type: header.type }),
    name: header.name,
    type: header.type,
    size: raw.byteLength,
    lastModified: header.lastModified,
    metadata: header.metadata,
  };
}

export async function putBinary(
  id: string,
  data: Blob | ArrayBuffer | ArrayBufferView,
  metadata: unknown = null,
): Promise<void> {
  const source = await binaryBytes(data);
  const packed = packBinary(
    { name: source.name, type: source.type, lastModified: source.lastModified, metadata },
    source.bytes,
  );
  const encrypted = await encryptBytes(activeKey(), packed, recordLabel("binaries", id));
  await (await database()).put("binaries", encrypted, id);
  announceChange();
}

export async function getBinary(id: string): Promise<VaultBinary | null> {
  activeKey();
  const value = await (await database()).get("binaries", id);
  if (!value) return null;
  try {
    return unpackBinary(id, await decryptBytes(activeKey(), value, recordLabel("binaries", id)));
  } catch (error) {
    if (!dataKey) throw error;
    throw new Error("Kasa dosyası çözülemedi; veri bozulmuş veya değiştirilmiş olabilir.");
  }
}

export async function listBinary(): Promise<VaultBinary[]> {
  activeKey();
  const db = await database();
  const transaction = db.transaction("binaries");
  const [keys, values] = await Promise.all([transaction.store.getAllKeys(), transaction.store.getAll()]);
  await transaction.done;
  return Promise.all(values.map(async (value, index) => {
    const id = keys[index];
    const raw = await decryptBytes(activeKey(), value, recordLabel("binaries", id));
    return unpackBinary(id, raw);
  }));
}

export async function listBinaryIds(): Promise<string[]> {
  activeKey();
  return (await database()).getAllKeys("binaries");
}

export async function deleteBinary(id: string): Promise<void> {
  activeKey();
  await (await database()).delete("binaries", id);
  announceChange();
}

export async function clearBinaries(): Promise<void> {
  activeKey();
  await (await database()).clear("binaries");
  announceChange();
}

type EncodedBuffer = { $buffer: string };
type VaultBackup = {
  format: "excelbase-encrypted-vault";
  version: 1;
  createdAt: string;
  stores: Record<"config" | StoreName, Array<{ key: string | number; value: unknown }>>;
};

function bufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function base64ToBuffer(value: string): ArrayBuffer {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
}

function encodeBackupValue(value: unknown): unknown {
  if (value instanceof ArrayBuffer) return { $buffer: bufferToBase64(value) } satisfies EncodedBuffer;
  if (ArrayBuffer.isView(value)) {
    const source = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    const copy = new Uint8Array(source);
    return { $buffer: bufferToBase64(copy.buffer) } satisfies EncodedBuffer;
  }
  if (Array.isArray(value)) return value.map(encodeBackupValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encodeBackupValue(item)]));
  }
  return value;
}

function decodeBackupValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(decodeBackupValue);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.$buffer === "string" && Object.keys(record).length === 1) return base64ToBuffer(record.$buffer);
    return Object.fromEntries(Object.entries(record).map(([key, item]) => [key, decodeBackupValue(item)]));
  }
  return value;
}

function validEncryptedPayload(value: unknown): value is EncryptedPayload {
  if (!value || typeof value !== "object") return false;
  const payload = value as Partial<EncryptedPayload>;
  return payload.version === 1 && payload.iv instanceof ArrayBuffer && payload.iv.byteLength === 12
    && payload.ciphertext instanceof ArrayBuffer && payload.ciphertext.byteLength >= 16;
}

/** Exports the already-encrypted database records; no passenger or photo plaintext enters the backup. */
export async function exportEncryptedVault(): Promise<Blob> {
  activeKey();
  const db = await database();
  const names = ["config", "passengers", "binaries", "jobs", "meta"] as const;
  const stores = {} as VaultBackup["stores"];
  for (const name of names) {
    const transaction = db.transaction(name);
    const [keys, values] = await Promise.all([transaction.store.getAllKeys(), transaction.store.getAll()]);
    await transaction.done;
    stores[name] = values.map((value, index) => ({ key: keys[index], value: encodeBackupValue(value) }));
  }
  const backup: VaultBackup = {
    format: "excelbase-encrypted-vault",
    version: 1,
    createdAt: new Date().toISOString(),
    stores,
  };
  return new Blob([JSON.stringify(backup)], { type: "application/vnd.excelbase.vault+json" });
}

/** Restores a versioned encrypted backup after validating every raw encrypted record. */
export async function restoreEncryptedVault(file: Blob): Promise<void> {
  if (file.size > 750 * 1024 * 1024) throw new Error("Yedek dosyası güvenli boyut sınırını aşıyor.");
  let parsed: VaultBackup;
  try {
    parsed = JSON.parse(await file.text()) as VaultBackup;
  } catch {
    throw new Error("Yedek dosyası geçerli JSON değil.");
  }
  if (parsed.format !== "excelbase-encrypted-vault" || parsed.version !== 1 || !parsed.stores) {
    throw new Error("Bu dosya desteklenen bir Gate Visa Checklist şifreli yedeği değil.");
  }
  const decoded = {} as Record<"config" | StoreName, Array<{ key: string | number; value: unknown }>>;
  for (const name of ["config", "passengers", "binaries", "jobs", "meta"] as const) {
    const records = parsed.stores[name];
    if (!Array.isArray(records)) throw new Error(`Yedekte ${name} bölümü eksik.`);
    decoded[name] = records.map((record) => ({ key: record.key, value: decodeBackupValue(record.value) }));
  }
  const configRecord = decoded.config.find((record) => record.key === VAULT_CONFIG_KEY)?.value as VaultConfig | undefined;
  if (decoded.config.length !== 1 || !configRecord || configRecord.id !== VAULT_CONFIG_KEY || configRecord.version !== 1
    || !(configRecord.salt instanceof ArrayBuffer) || configRecord.salt.byteLength !== 16
    || !Number.isSafeInteger(configRecord.iterations) || configRecord.iterations < 100_000 || configRecord.iterations > 2_000_000
    || !validEncryptedPayload(configRecord.wrappedDek) || !validEncryptedPayload(configRecord.verifier)) {
    throw new Error("Yedek kasa anahtarı geçersiz veya eksik.");
  }
  for (const name of ["passengers", "binaries", "jobs", "meta"] as const) {
    if (decoded[name].some((record) => !validEncryptedPayload(record.value))) {
      throw new Error(`Yedekteki ${name} kayıtlarından biri bozuk.`);
    }
    const keys = decoded[name].map((record) => record.key);
    const keysAreValid = name === "passengers"
      ? keys.every((key) => typeof key === "number" && Number.isSafeInteger(key) && key >= 0)
      : keys.every((key) => typeof key === "string" && key.length > 0 && key.length <= 512);
    if (!keysAreValid || new Set(keys).size !== keys.length) {
      throw new Error(`Yedekteki ${name} kayıt anahtarlarından biri geçersiz.`);
    }
  }

  const db = await database();
  const transaction = db.transaction(["config", "passengers", "binaries", "jobs", "meta"], "readwrite");
  for (const name of ["config", "passengers", "binaries", "jobs", "meta"] as const) {
    const store = transaction.objectStore(name);
    await store.clear();
    for (const record of decoded[name]) {
      await store.put(record.value as never, record.key as never);
    }
  }
  await transaction.done;
  lockVault();
}

/** Closes open IndexedDB handles, primarily for upgrades, tests and safe account removal. */
export async function closeVaultDatabase(): Promise<void> {
  if (!databasePromise) return;
  const pending = databasePromise;
  databasePromise = null;
  (await pending).close();
}

export { DATABASE_NAME as VAULT_DATABASE_NAME };
