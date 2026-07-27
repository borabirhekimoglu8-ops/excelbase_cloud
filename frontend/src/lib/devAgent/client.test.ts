import { afterEach, describe, expect, it, vi } from "vitest";

import {
  applyDevAgentRun,
  fetchDevAgentStatus,
  parseDevAgentEvent,
  streamDevAgentRun,
} from "@/lib/devAgent/client";

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

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
    });
    expect(
      parseDevAgentEvent(JSON.stringify({ type: "finished", applicable: "yes" })),
    ).toMatchObject({ applicable: false });
  });

  it("keeps only the string entries of a file list", () => {
    expect(
      parseDevAgentEvent(JSON.stringify({ type: "changes", files: ["a.py", 7, null], diff: "" })),
    ).toEqual({ type: "changes", files: ["a.py"], diff: "" });
  });
});

describe("streamDevAgentRun", () => {
  it("delivers each event as it arrives, across chunk boundaries", async () => {
    const events: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(
        streamOf([
          '{"type":"started","worktree":"/x"}\n{"type":"te',
          'xt","text":"Yaptım."}\n',
          '{"type":"finished","files":["app.py"],"applicable":true}',
        ]),
        { status: 200 },
      )),
    );

    await streamDevAgentRun({
      instruction: "bir şey yap",
      csrfToken: "csrf",
      onEvent: (event) => events.push(event),
    });

    expect(events).toEqual([
      { type: "started", worktree: "/x" },
      { type: "text", text: "Yaptım." },
      {
        type: "finished",
        summary: "",
        files: ["app.py"],
        committed: "",
        cost_usd: 0,
        applicable: true,
      },
    ]);
  });

  it("sends the CSRF token and rejects when the run cannot start", async () => {
    let sent: RequestInit | undefined;
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      sent = init;
      return new Response("", { status: 403 });
    }));

    await expect(
      streamDevAgentRun({ instruction: "x", csrfToken: "csrf", onEvent: () => {} }),
    ).rejects.toThrow();
    expect((sent?.headers as Record<string, string>)["X-CSRF-Token"]).toBe("csrf");
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
