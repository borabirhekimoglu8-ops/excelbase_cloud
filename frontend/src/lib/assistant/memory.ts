/**
 * What the assistant remembers between conversations.
 *
 * Notes live in the encrypted vault like everything else, so they stay on the
 * device. They are written *by* the model, which is what keeps them safe to
 * replay into a later prompt: the model only ever sees pseudonymous data, so
 * it has no name or passport number to write down in the first place. The
 * bounds below exist so a long-running deployment cannot grow a prompt without
 * limit -- memory that costs more than it saves is not memory.
 */

import { getMeta, setMeta } from "@/lib/offline/vault";

const MEMORY_KEY = "assistant_memory_v1";

export const MEMORY_MAX_ENTRIES = 40;
export const MEMORY_MAX_CHARS = 400;

export type AssistantMemory = {
  id: string;
  text: string;
  created_at: string;
};

function newId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `mem-${Date.now()}-${Math.random()}`;
}

export async function listMemories(): Promise<AssistantMemory[]> {
  const stored = await getMeta<AssistantMemory[]>(MEMORY_KEY);
  if (!Array.isArray(stored)) return [];
  return stored.filter((entry) => (
    Boolean(entry)
    && typeof entry.id === "string"
    && typeof entry.text === "string"
    && entry.text.trim().length > 0
  ));
}

export async function rememberFact(text: string): Promise<AssistantMemory> {
  const clean = text.trim().slice(0, MEMORY_MAX_CHARS);
  if (!clean) throw new Error("Hatırlanacak bir şey yok.");

  const existing = await listMemories();
  // Re-learning the same thing should not consume a slot; the model restates
  // its conclusions often and would otherwise fill memory with near-copies.
  const duplicate = existing.find(
    (entry) => entry.text.trim().toLowerCase() === clean.toLowerCase(),
  );
  if (duplicate) return duplicate;

  const entry: AssistantMemory = {
    id: newId(),
    text: clean,
    created_at: new Date().toISOString(),
  };
  // Oldest out when full, so the assistant keeps what it learned most recently
  // rather than refusing to learn anything more.
  const next = [...existing, entry].slice(-MEMORY_MAX_ENTRIES);
  await setMeta(MEMORY_KEY, next);
  return entry;
}

export async function forgetFact(id: string): Promise<boolean> {
  const existing = await listMemories();
  const next = existing.filter((entry) => entry.id !== id);
  if (next.length === existing.length) return false;
  await setMeta(MEMORY_KEY, next);
  return true;
}

export async function clearMemories(): Promise<void> {
  await setMeta(MEMORY_KEY, []);
}

/** The compact form replayed into each conversation's context. */
export async function memoryDigest(): Promise<string[]> {
  return (await listMemories()).map((entry) => entry.text);
}
