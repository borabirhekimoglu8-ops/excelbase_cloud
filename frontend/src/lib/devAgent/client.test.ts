import { afterEach, describe, expect, it, vi } from "vitest";

import {
  applyDevAgentRun,
  fetchDevAgentRun,
  fetchDevAgentStatus,
  parseDevAgentEvent,
  startDevAgentRun,
} from "@/lib/devAgent/client";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("parseDevAgentEvent", () => {
  it("drops a line it does not recognise instead of rendering it", () => {
    expect(parseDevAgentEvent("not json")).toBeNull();
    expect(parseDevAgentEvent(JSON.stringify({ type: "exec", cmd: "rm -rf /" }))).toBeNull();
    expect(parseDevAgentEvent(JSON.stringify(["finished"]))).toBeNull();
  });

  it("never lets a missing field read as a passing test", () => {
    // A truncated or malformed test line must not be able to turn the gate
    // green in the panel; it is dropped rather than defaulted.
    expect(parseDevAgentEvent(JSON.stringify({ type: "test", name: "pytest" }))).toBeNull();
    expect(
      parseDevAgentEvent(JSON.stringify({ type: "test", name: "pytest", passed: "true" })),
    ).toBeNull();
    expect(parseDevAgentEvent(JSON.stringify({ type: "test", name: "pytest", passed: false })))
      .toEqual({ type: "test", name: "pytest", passed: false, detail: "" });
  });

  it("treats a finished run as unapplicable unless the server says otherwise", () => {
    expect(parseDevAgentEvent(JSON.stringify({ type: "finished" }))).toEqual({
      type: "finished",
      summary: "",
      files: [],
      committed: "",
      cost_usd: 0,
      applicable: false,
      stopped_early: "",
    });
    expect(
      parseDevAgentEvent(JSON.stringify({ type: "finished", applicable: "yes" })),
    ).toMatchObject({ applicable: false });
  });

  it("accepts only the two stop reasons the server can actually report", () => {
    expect(parseDevAgentEvent(JSON.stringify({ type: "limit", reason: "turns" })))
      .toEqual({ type: "limit", reason: "turns" });
    expect(parseDevAgentEvent(JSON.stringify({ type: "limit", reason: "budget" })))
      .toEqual({ type: "limit", reason: "budget" });
    expect(parseDevAgentEvent(JSON.stringify({ type: "limit", reason: "vibes" }))).toBeNull();
  });

  it("keeps only the string entries of a file list", () => {
    expect(
      parseDevAgentEvent(JSON.stringify({ type: "changes", files: ["a.py", 7, null], diff: "" })),
    ).toEqual({ type: "changes", files: ["a.py"], diff: "" });
  });
});

describe("startDevAgentRun", () => {
  it("returns as soon as the server owns the run, without waiting for it", async () => {
    let sent: RequestInit | undefined;
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      sent = init;
      return Response.json({ id: "run-1", status: "running" }, { status: 202 });
    }));

    await expect(startDevAgentRun("bir şey yap", "csrf")).resolves.toBe("run-1");
    expect((sent?.headers as Record<string, string>)["X-CSRF-Token"]).toBe("csrf");
  });

  it("surfaces a refusal to start a second concurrent run", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(
      { detail: "Zaten süren bir geliştirme çalışması var." },
      { status: 409 },
    )));

    await expect(startDevAgentRun("x", "csrf")).rejects.toThrow(/Zaten süren/);
  });
});

describe("fetchDevAgentRun", () => {
  it("reads a run that is still going, so a reopened panel resumes it", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      id: "run-1",
      instruction: "sürümü yükselt",
      status: "running",
      events: [
        { type: "started", worktree: "/x" },
        { type: "text", text: "Bakıyorum." },
      ],
      error: "",
    })));

    const state = await fetchDevAgentRun("csrf");

    expect(state.status).toBe("running");
    expect(state.id).toBe("run-1");
    expect(state.events).toEqual([
      { type: "started", worktree: "/x" },
      { type: "text", text: "Bakıyorum." },
    ]);
  });

  it("drops an unrecognised event rather than rendering it", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      id: "run-1",
      status: "finished",
      events: [
        { type: "exec", cmd: "rm -rf /" },
        { type: "test", name: "pytest", passed: true, detail: "" },
      ],
    })));

    const state = await fetchDevAgentRun("csrf");

    expect(state.events).toEqual([
      { type: "test", name: "pytest", passed: true, detail: "" },
    ]);
  });

  it("treats an unknown status as idle instead of guessing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ status: "whatever" })));

    await expect(fetchDevAgentRun("csrf")).resolves.toMatchObject({
      status: "idle",
      events: [],
    });
  });
});

describe("fetchDevAgentStatus", () => {
  it("refuses a state it does not know rather than assuming readiness", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ state: "totally_fine", available: true })),
    );

    await expect(fetchDevAgentStatus("csrf")).rejects.toThrow();
  });

  it("returns a known state", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ state: "blocked_open_network", available: false })),
    );

    await expect(fetchDevAgentStatus("csrf")).resolves.toEqual({
      state: "blocked_open_network",
      available: false,
    });
  });
});

describe("applyDevAgentRun", () => {
  it("surfaces the server's reason for refusing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(
        { detail: "Çalışma dizininde kaydedilmemiş değişiklik var; önce onları işleyin." },
        { status: 409 },
      )),
    );

    await expect(applyDevAgentRun("csrf")).rejects.toThrow(/kaydedilmemiş değişiklik/);
  });

  it("returns the commit it applied", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ok: true, commit: "abc123" })));

    await expect(applyDevAgentRun("csrf")).resolves.toBe("abc123");
  });
});
