/**
 * Opaque ciphertext sync: the server stores a vault backup blob addressed by
 * a random token. It never sees the PIN, the recovery key or the DEK.
 */
const TOKEN_META = "vault-sync-token";
const TOKEN_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function formatSyncToken(raw: string): string {
  const compact = raw.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  return compact.match(/.{1,4}/g)?.join("-") ?? compact;
}

export function normalizeSyncToken(value: string): string {
  return value.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

export function createSyncToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const byte of bytes) out += TOKEN_ALPHABET[byte % TOKEN_ALPHABET.length];
  return formatSyncToken(out);
}

export { TOKEN_META as VAULT_SYNC_TOKEN_META };

export async function pushVaultBlob(token: string, blob: Blob): Promise<void> {
  const key = normalizeSyncToken(token);
  if (key.length < 16) throw new Error("Eşleme kodu eksik.");
  const response = await fetch("/api/vault/sync", {
    method: "PUT",
    headers: { "X-Vault-Sync-Token": key, "Content-Type": "application/vnd.excelbase.vault+json" },
    body: blob,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(detail || `Yedek gönderilemedi (${response.status}).`);
  }
}

export async function pullVaultBlob(token: string): Promise<Blob> {
  const key = normalizeSyncToken(token);
  if (key.length < 16) throw new Error("Eşleme kodu eksik.");
  const response = await fetch("/api/vault/sync", {
    method: "GET",
    headers: { "X-Vault-Sync-Token": key },
  });
  if (response.status === 404) throw new Error("Bu eşleme kodu için henüz bir yedek yok.");
  if (!response.ok) throw new Error(`Yedek alınamadı (${response.status}).`);
  return response.blob();
}
