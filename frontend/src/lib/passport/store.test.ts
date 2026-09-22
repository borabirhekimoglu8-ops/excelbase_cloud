import "fake-indexeddb/auto";

import { webcrypto } from "node:crypto";
import { deleteDB } from "idb";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { closeVaultDatabase, lockVault, setupVault, VAULT_DATABASE_NAME } from "@/lib/offline/vault";

import { persistPasteMrz } from "./batch";
import { PASSPORT_CANDIDATE_PREFIX } from "./keys";
import { clearPassportVaultRecords, listPassportCandidates, markInterruptedPages, patchCandidateField, putPassportPage, setCandidateStatus } from "./store";

Object.defineProperty(globalThis, "crypto", { configurable: true, value: webcrypto });

const LINE1 = "P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<";
const LINE2 = "L898902C36UTO7408122F1204159ZE184226B<<<<<10";

async function reset(): Promise<void> {
  lockVault();
  await closeVaultDatabase();
  await deleteDB(VAULT_DATABASE_NAME);
}

beforeEach(reset);
afterEach(reset);

describe("passport vault store", () => {
  it("appends a second paste and keeps keys opaque", async () => {
    await setupVault("Ada Yılmaz", "123456");
    const first = await persistPasteMrz(`${LINE1}\n${LINE2}`);
    const second = await persistPasteMrz(`${LINE1}\n${LINE2}`);
    expect(first.added).toBe(1);
    expect(second.added).toBe(1);
    const rows = await listPassportCandidates();
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.id && !row.id.includes("ERIKSSON"))).toBe(true);
    expect(PASSPORT_CANDIDATE_PREFIX.endsWith(":")).toBe(true);
  });

  it("clears approval when a critical field changes", async () => {
    await setupVault("Ada Yılmaz", "123456");
    await persistPasteMrz(`${LINE1}\n${LINE2}`);
    const [row] = await listPassportCandidates();
    await patchCandidateField(row.id, "countryCode2", "TR");
    await setCandidateStatus(row.id, "user-approved", "Ada");
    const changed = await patchCandidateField(row.id, "passportNo", "U1000001");
    expect(changed?.status).toBe("review");
    expect(changed?.approved_at).toBe("");
  });

  it("marks interrupted pages without dropping finished candidates", async () => {
    await setupVault("Ada Yılmaz", "123456");
    const { job } = await persistPasteMrz(`${LINE1}\n${LINE2}`);
    await putPassportPage({
      entity_type: "passport_page",
      schema_version: 1,
      id: "page-open",
      job_id: job.id,
      file_id: "file",
      page_index: 1,
      status: "processing",
      attempt: 1,
      error: "",
      text_layer_used: false,
      ocr_used: false,
      image_binary_id: "",
      image_size: null,
      raw_lines: [],
      candidate_ids: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    expect(await markInterruptedPages()).toBeGreaterThan(0);
    expect(await listPassportCandidates()).toHaveLength(1);
    await clearPassportVaultRecords();
    expect(await listPassportCandidates()).toHaveLength(0);
  });
});
