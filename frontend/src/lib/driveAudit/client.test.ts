import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchDriveAuditStatus, scanDriveFolder } from "@/lib/driveAudit/client";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchDriveAuditStatus", () => {
  it("refuses a state it does not know rather than assuming readiness", async () => {
    // Falling back to "ready" on an unrecognised state would offer a scan
    // button that cannot work, on a server that deliberately said no.
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ state: "sure", available: true })));

    await expect(fetchDriveAuditStatus("csrf")).resolves.toEqual({
      state: "disabled",
      available: true,
      default_root: "",
    });
  });

  it("carries the configured folder so the operator does not retype it", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      state: "ready",
      available: true,
      default_root: "G:\\Drive'ım",
    })));

    await expect(fetchDriveAuditStatus("csrf")).resolves.toMatchObject({
      state: "ready",
      default_root: "G:\\Drive'ım",
    });
  });
});

describe("scanDriveFolder", () => {
  it("sends the folder and the token, and reads back the record types", async () => {
    let sent: RequestInit | undefined;
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      sent = init;
      return Response.json({
        root: "/Drive",
        files_seen: 121,
        truncated: false,
        by_kind: { tablo: 12, belge: 80 },
        dated_folders: 9,
        templates: [{ headers: ["Ad Soyad"], count: 4, files: ["a.xlsx"] }],
        unknown_columns: [{ column: "Acente", files: 4 }],
        entities: [{
          name: "Yolcu listesi",
          columns: ["Ad Soyad", "Acente"],
          files: 4,
          missing: ["Acente"],
          suggestion: "Acente alanını ekle.",
        }],
        findings: [{
          kind: "missing_column",
          title: "Acente alanı yok",
          detail: "4 dosyada var.",
          evidence: ["operasyon/pax-0.xlsx"],
          suggestion: "Acente alanını ekle.",
        }],
      });
    }));

    const report = await scanDriveFolder("/Drive", "csrf");

    expect(JSON.parse(String(sent?.body))).toEqual({ root: "/Drive" });
    expect((sent?.headers as Record<string, string>)["X-CSRF-Token"]).toBe("csrf");
    expect(report.entities[0].missing).toEqual(["Acente"]);
    expect(report.findings[0].evidence).toEqual(["operasyon/pax-0.xlsx"]);
  });

  it("keeps the server's reason for refusing, since only it knows the folder", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(
      { detail: "Klasör bulunamadı: G:\\yok" },
      { status: 400 },
    )));

    await expect(scanDriveFolder("G:\\yok", "csrf")).rejects.toThrow(/bulunamadı/);
  });

  it("drops a malformed record type instead of rendering a nameless card", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      files_seen: 3,
      entities: [
        { name: "Yolcu listesi", files: 4, columns: ["Ad Soyad", 7], missing: [] },
        { files: 4 },
        null,
      ],
      findings: [{ detail: "başlıksız" }],
    })));

    const report = await scanDriveFolder("/Drive", "csrf");

    expect(report.entities).toEqual([{
      name: "Yolcu listesi",
      columns: ["Ad Soyad"],
      files: 4,
      missing: [],
      suggestion: "",
    }]);
    expect(report.findings).toEqual([]);
  });

  it("reads a truncated scan as partial rather than complete", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ truncated: true })));

    await expect(scanDriveFolder("/Drive", "csrf")).resolves.toMatchObject({
      truncated: true,
      files_seen: 0,
      entities: [],
    });
  });
});
