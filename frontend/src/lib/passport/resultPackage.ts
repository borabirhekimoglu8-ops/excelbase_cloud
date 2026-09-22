import {
  localPassportPage,
  localPassportPutRow,
  localPassportRow,
  localPassportStorePage,
} from "@/lib/offline/localApi";
import { TOKEN_ALPHABET } from "@/lib/offline/vaultSync";

import type { PassportScanRow } from "./passportTypes";

const FORMAT = "excelbase-passport-package";
const ITERATIONS = 310_000;
const AAD = "excelbase:passport-package:v2";
const MAX_PACKAGE_TEXT = 300 * 1024 * 1024;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

type EncryptedPackage = {
  format: typeof FORMAT;
  version: 2;
  kdf: { salt: string; iterations: typeof ITERATIONS };
  iv: string;
  ciphertext: string;
};

type PackagePage = {
  batchId: string;
  pageNo: number;
  mime: string;
  bytes: string;
};

type PackageBody = {
  rows: PassportScanRow[];
  pages: PackagePage[];
};

function bytesToB64(input: ArrayBuffer | Uint8Array): string {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function b64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export function createPackageCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  let code = "";
  for (const byte of bytes) code += TOKEN_ALPHABET[byte % TOKEN_ALPHABET.length];
  return code;
}

async function deriveKey(code: string, salt: Uint8Array): Promise<CryptoKey> {
  if (code.length < 12) throw new Error("Paket kodu en az 12 karakter olmalıdır.");
  const material = await crypto.subtle.importKey(
    "raw",
    encoder.encode(code),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: salt.buffer as ArrayBuffer,
      iterations: ITERATIONS,
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

function storedRow(row: PassportScanRow): PassportScanRow {
  return {
    ...row,
    previewUrl: "",
    mrzCropUrl: undefined,
  };
}

async function packageBody(rows: readonly PassportScanRow[]): Promise<PackageBody> {
  const pages: PackagePage[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (!row.sourceImageKey) continue;
    const key = `${row.batchId}:${row.pageNo}`;
    if (seen.has(key)) continue;
    const page = await localPassportPage(row.batchId, row.pageNo);
    if (!page) throw new Error(`Kaynak sayfa pakete eklenemedi: ${row.pageNo}`);
    pages.push({
      batchId: row.batchId,
      pageNo: row.pageNo,
      mime: page.type || "application/octet-stream",
      bytes: bytesToB64(await page.arrayBuffer()),
    });
    seen.add(key);
  }
  return { rows: rows.map(storedRow), pages };
}

export async function exportPassportPackage(
  rows: readonly PassportScanRow[],
  code: string,
): Promise<Blob> {
  if (!rows.length) throw new Error("Pakete eklenecek pasaport satırı yok.");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(code, salt);
  const plaintext = encoder.encode(JSON.stringify(await packageBody(rows)));
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
      additionalData: encoder.encode(AAD),
      tagLength: 128,
    },
    key,
    plaintext,
  );
  const pack: EncryptedPackage = {
    format: FORMAT,
    version: 2,
    kdf: { salt: bytesToB64(salt), iterations: ITERATIONS },
    iv: bytesToB64(iv),
    ciphertext: bytesToB64(ciphertext),
  };
  return new Blob(
    [JSON.stringify(pack)],
    { type: "application/vnd.excelbase.passport+json" },
  );
}

function readPackage(text: string): EncryptedPackage {
  if (text.length > MAX_PACKAGE_TEXT) throw new Error("Pasaport paketi boyut sınırını aşıyor.");
  const pack = JSON.parse(text) as Partial<EncryptedPackage>;
  if (
    pack.format !== FORMAT
    || pack.version !== 2
    || pack.kdf?.iterations !== ITERATIONS
    || typeof pack.kdf.salt !== "string"
    || typeof pack.iv !== "string"
    || typeof pack.ciphertext !== "string"
  ) {
    throw new Error("Paket biçimi tanınmadı.");
  }
  return pack as EncryptedPackage;
}

export async function importPassportPackage(
  file: Blob,
  code: string,
): Promise<PassportScanRow[]> {
  const pack = readPackage(await file.text());
  const key = await deriveKey(code, b64ToBytes(pack.kdf.salt));
  let plain: ArrayBuffer;
  try {
    plain = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: b64ToBytes(pack.iv),
        additionalData: encoder.encode(AAD),
        tagLength: 128,
      },
      key,
      b64ToBytes(pack.ciphertext),
    );
  } catch {
    throw new Error("Paket açılamadı. Kod yanlış veya dosya değişmiş.");
  }
  const body = JSON.parse(decoder.decode(plain)) as Partial<PackageBody>;
  if (!Array.isArray(body.rows) || !Array.isArray(body.pages)) {
    throw new Error("Paket içeriği geçersiz.");
  }
  for (const page of body.pages) {
    if (
      !page
      || typeof page.batchId !== "string"
      || !Number.isInteger(page.pageNo)
      || typeof page.bytes !== "string"
    ) throw new Error("Paket sayfası geçersiz.");
    await localPassportStorePage(
      page.batchId,
      page.pageNo,
      new Blob([b64ToBytes(page.bytes)], { type: page.mime || "application/octet-stream" }),
    );
  }
  const imported: PassportScanRow[] = [];
  for (const candidate of body.rows) {
    if (!candidate?.id || await localPassportRow(candidate.id)) continue;
    const row = storedRow(candidate);
    await localPassportPutRow(row);
    imported.push(row);
  }
  return imported;
}
