import { TOKEN_ALPHABET } from "@/lib/offline/vaultSync";

import type { PassportCandidate } from "./candidates";
import { listPassportCandidates, putPassportCandidate, vaultIsUnlocked } from "./store";

const FORMAT = "excelbase-passport-package";
const ITERATIONS = 310_000;
const AAD = "excelbase:passport-package:v1";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export type PassportResultPackage = {
  format: typeof FORMAT;
  version: 1;
  kdf: { salt: string; iterations: number };
  iv: string;
  ciphertext: string;
};

function bytesToB64(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  view.forEach((value) => {
    binary += String.fromCharCode(value);
  });
  return btoa(binary);
}

function b64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export function createPackageCode(): string {
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const byte of bytes) out += TOKEN_ALPHABET[byte % TOKEN_ALPHABET.length];
  return out;
}

async function deriveKey(code: string, salt: Uint8Array): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey("raw", encoder.encode(code), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt: salt.buffer as ArrayBuffer, iterations: ITERATIONS },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function exportPassportPackage(candidates: PassportCandidate[], code: string): Promise<Blob> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(code, salt);
  const payload = encoder.encode(JSON.stringify({
    candidates: candidates.map((item) => ({ ...item, visual_hints: item.visual_hints })),
  }));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: encoder.encode(AAD), tagLength: 128 },
    key,
    payload,
  );
  const pack: PassportResultPackage = {
    format: FORMAT,
    version: 1,
    kdf: { salt: bytesToB64(salt), iterations: ITERATIONS },
    iv: bytesToB64(iv),
    ciphertext: bytesToB64(ciphertext),
  };
  return new Blob([JSON.stringify(pack)], { type: "application/vnd.excelbase.passport+json" });
}

export async function importPassportPackage(file: Blob, code: string): Promise<number> {
  if (!(await vaultIsUnlocked())) throw new Error("Kasa kilitliyken paket içe aktarılamaz.");
  const pack = JSON.parse(await file.text()) as PassportResultPackage;
  if (pack.format !== FORMAT || pack.version !== 1) throw new Error("Paket biçimi tanınmadı.");
  const key = await deriveKey(code, b64ToBytes(pack.kdf.salt));
  let plain: ArrayBuffer;
  try {
    plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: b64ToBytes(pack.iv), additionalData: encoder.encode(AAD), tagLength: 128 },
      key,
      b64ToBytes(pack.ciphertext),
    );
  } catch {
    throw new Error("Paket açılamadı. Kod yanlış veya dosya değişmiş.");
  }
  const body = JSON.parse(decoder.decode(plain)) as { candidates?: PassportCandidate[] };
  const incoming = Array.isArray(body.candidates) ? body.candidates : [];
  const existing = new Set((await listPassportCandidates()).map((item) => item.id));
  let added = 0;
  for (const candidate of incoming) {
    if (!candidate?.id || existing.has(candidate.id)) continue;
    await putPassportCandidate({ ...candidate, updated_at: new Date().toISOString() });
    added += 1;
  }
  return added;
}
