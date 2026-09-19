import { afterEach, describe, expect, it, vi } from "vitest";

import {
  adviseWorkstation,
  buildWorkstationCatalog,
  fetchWorkstationStatus,
  searchWorkstationCatalog,
} from "./client";

describe("workstation client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads status with csrf and never invents availability", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        state: "ready",
        available: true,
        default_root: "/ops",
        privacy: "catalog_metadata_only",
        egress: "none",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const status = await fetchWorkstationStatus("csrf-token");
    expect(status.available).toBe(true);
    expect(status.egress).toBe("none");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/workstation/v1/status",
      expect.objectContaining({
        credentials: "same-origin",
        headers: expect.objectContaining({ "X-CSRF-Token": "csrf-token" }),
      }),
    );
  });

  it("builds, searches and advises through local endpoints", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          root: "/ops",
          files_seen: 3,
          truncated: false,
          total_bytes: 100,
          c_code_files: 1,
          dated_files: 1,
          by_kind: { tablo: 1, belge: 1, gorsel: 1, diger: 0 },
          built_at: 1,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          query: "C-1",
          count: 1,
          results: [{
            path: "C-1.xlsx",
            name: "C-1.xlsx",
            kind: "tablo",
            suffix: ".xlsx",
            size: 10,
            mtime: 1,
            parent: "",
            has_c_code: true,
            has_date: false,
          }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          mode: "local_deterministic",
          privacy: "aggregate_catalog_only",
          answer: "3 dosya",
          items: [],
          stats: {},
        }),
      });
    vi.stubGlobal("fetch", fetchMock);

    await buildWorkstationCatalog("/ops", "csrf");
    await searchWorkstationCatalog("C-1", "/ops", "csrf");
    const advice = await adviseWorkstation("kaç dosya", "/ops", "csrf");
    expect(advice.mode).toBe("local_deterministic");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
