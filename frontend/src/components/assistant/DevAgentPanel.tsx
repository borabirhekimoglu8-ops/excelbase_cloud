"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  type DevAgentEvent,
  type DevAgentState,
  type DevRunState,
  applyDevAgentRun,
  cancelDevAgentRun,
  fetchDevAgentRun,
  fetchDevAgentStatus,
  startDevAgentRun,
} from "@/lib/devAgent/client";

type TestLine = { name: string; passed: boolean; detail: string };

/** Why the panel is unavailable, in the operator's terms and with the fix. */
const UNAVAILABLE: Record<Exclude<DevAgentState, "ready">, { title: string; body: string }> = {
  disabled: {
    title: "Uygulama içi geliştirme kapalı",
    body: "Açmak için sunucudaki .env dosyasına EXCELBASE_DEV_AGENT=1 ekleyip yeniden başlatın.",
  },
  blocked_open_network: {
    title: "Bu sunucu açık olduğu için geliştirme kapalı",
    body:
      "Kod yazabilen ve internetten erişilebilen bir uygulama arka kapıdır. Önce erişim "
      + "kodunu geri açın veya EXCELBASE_ASSISTANT_ALLOWED_IPS ile ağı kısıtlayın.",
  },
  api_key_missing: {
    title: "Anthropic anahtarı yok",
    body: "Sunucuda ANTHROPIC_API_KEY tanımlayın.",
  },
  not_a_repository: {
    title: "Kaynak kodu bulunamadı",
    body:
      "Geliştirme, uygulamanın git deposu üzerinde çalışır. Kurulum git ile yapılmadıysa "
      + "EXCELBASE_DEV_AGENT_REPOSITORY ile depo yolunu verin.",
  },
  sdk_missing: {
    title: "Geliştirme paketi kurulu değil",
    body:
      "Sunucuda claude-agent-sdk eksik. run.ps1 / run.sh betiğini yeniden çalıştırın; "
      + "eksik paketleri kendisi kurar.",
  },
};

/**
 * The in-app development console.
 *
 * Deliberately shows three things before the APPLY button becomes usable: what
 * changed, whether the tests passed, and what it cost. Applying is a separate
 * click because everything up to that point happened in a worktree the running
 * application never reads.
 */
export function DevAgentPanel({ csrfToken }: { csrfToken: string }) {
  const [state, setState] = useState<DevAgentState | null>(null);
  const [statusError, setStatusError] = useState("");
  const [open, setOpen] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [files, setFiles] = useState<string[]>([]);
  const [diff, setDiff] = useState("");
  const [tests, setTests] = useState<TestLine[]>([]);
  const [applicable, setApplicable] = useState(false);
  const [cost, setCost] = useState(0);
  const [error, setError] = useState("");
  const [applied, setApplied] = useState("");
  const [applying, setApplying] = useState(false);
  const [follow, setFollow] = useState(0);
  const seenRef = useRef(0);
  const runIdRef = useRef("");

  useEffect(() => {
    if (!csrfToken) return;
    const controller = new AbortController();
    fetchDevAgentStatus(csrfToken, controller.signal)
      .then((status) => {
        setState(status.state);
        setStatusError("");
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        // A status call that fails must not leave the panel claiming readiness
        // -- but it must not disappear silently either. A panel that renders
        // nothing looks identical to a setting that was never applied, which is
        // exactly the dead end an operator cannot debug.
        setState(null);
        setStatusError(
          cause instanceof Error && cause.message
            ? cause.message
            : "Geliştirme ajanı durumu alınamadı.",
        );
      });
    return () => controller.abort();
  }, [csrfToken]);

  const handleEvent = useCallback((event: DevAgentEvent) => {
    switch (event.type) {
      case "started":
        setLog((lines) => [...lines, "Ayrı çalışma kopyası hazırlandı."]);
        break;
      case "text":
        setLog((lines) => [...lines, event.text]);
        break;
      case "tool":
        setLog((lines) => [...lines, `· ${event.name}`]);
        break;
      case "changes":
        setFiles(event.files);
        setDiff(event.diff);
        break;
      case "testing":
        setLog((lines) => [...lines, "Testler çalıştırılıyor…"]);
        break;
      case "test":
        setTests((current) => [...current, event]);
        break;
      case "finished":
        setApplicable(event.applicable);
        setCost(event.cost_usd);
        if (!event.files.length) setLog((lines) => [...lines, "Değişiklik yapılmadı."]);
        break;
      case "error":
        setError(
          event.detail
            ?? (event.state ? `Geliştirme kullanılabilir değil: ${event.state}` : "Çalışma tamamlanamadı."),
        );
        break;
    }
  }, []);

  const clearRunView = useCallback(() => {
    seenRef.current = 0;
    setLog([]);
    setFiles([]);
    setDiff("");
    setTests([]);
    setApplicable(false);
    setCost(0);
    setError("");
  }, []);

  /**
   * Folds whatever the server has so far into the view.
   *
   * Only events past `seenRef` are applied, so repeated polls do not append the
   * same log line or test result twice; a run that changed identity resets the
   * view first.
   */
  const absorb = useCallback((snapshot: DevRunState) => {
    if (snapshot.id !== runIdRef.current) {
      runIdRef.current = snapshot.id;
      clearRunView();
      setApplied("");
    }
    const fresh = snapshot.events.slice(seenRef.current);
    seenRef.current = snapshot.events.length;
    fresh.forEach(handleEvent);
    setRunning(snapshot.status === "running");
    if (snapshot.error) setError(snapshot.error);
  }, [clearRunView, handleEvent]);

  // Follows the server's run: once on mount to pick up anything already in
  // progress, then every couple of seconds for as long as it is going. This is
  // what lets the operator start a run, go and use the application, and come
  // back to it -- the run lives on the server, so the panel is only a view of
  // it and unmounting costs nothing.
  useEffect(() => {
    if (!csrfToken || state !== "ready") return;
    let cancelled = false;
    let timer = 0;
    const controller = new AbortController();

    const poll = async () => {
      try {
        const snapshot = await fetchDevAgentRun(csrfToken, controller.signal);
        if (cancelled) return;
        absorb(snapshot);
        if (snapshot.status === "running") timer = window.setTimeout(poll, 2000);
      } catch {
        // A dropped poll is not a failed run; retry rather than reporting an
        // error for what is usually a momentary blip.
        if (!cancelled) timer = window.setTimeout(poll, 4000);
      }
    };
    void poll();

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [absorb, csrfToken, state, follow]);

  const run = useCallback(async () => {
    const cleaned = instruction.trim();
    if (!cleaned || running) return;
    setApplied("");
    clearRunView();
    try {
      runIdRef.current = await startDevAgentRun(cleaned, csrfToken);
      seenRef.current = 0;
      setRunning(true);
      // Re-arms the polling effect, which then follows this run to completion.
      setFollow((n) => n + 1);
    } catch (cause) {
      setRunning(false);
      setError(cause instanceof Error ? cause.message : "Çalışma başlatılamadı.");
    }
  }, [clearRunView, csrfToken, instruction, running]);

  const stop = useCallback(async () => {
    try {
      await cancelDevAgentRun(csrfToken);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Çalışma durdurulamadı.");
    }
  }, [csrfToken]);

  const apply = useCallback(async () => {
    if (!applicable || applying) return;
    if (!window.confirm(
      "Bu değişiklik çalıştırdığınız sürüme geçecek. Sunucuyu yeniden başlatmanız gerekir. Devam edilsin mi?",
    )) return;
    setApplying(true);
    setError("");
    try {
      const commit = await applyDevAgentRun(csrfToken);
      setApplied(commit);
      setApplicable(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Değişiklik uygulanamadı.");
    } finally {
      setApplying(false);
    }
  }, [applicable, applying, csrfToken]);

  if (state === null) {
    if (!statusError) return null;
    return (
      <section className="assistant-state-card warning" aria-label="Uygulama içi geliştirme">
        <h2>Geliştirme durumu okunamadı</h2>
        <p>
          {statusError}
          {" "}
          Sunucu eski sürümü çalıştırıyor olabilir: `git pull` sonrası run.ps1 / run.sh
          betiğini yeniden çalıştırın.
        </p>
      </section>
    );
  }
  if (state !== "ready") {
    const message = UNAVAILABLE[state];
    return (
      <section className="assistant-state-card" aria-label="Uygulama içi geliştirme">
        <h2>{message.title}</h2>
        <p>{message.body}</p>
      </section>
    );
  }

  const green = tests.length > 0 && tests.every((test) => test.passed);

  return (
    <section
      className={`assistant-dev-agent${open ? " open" : ""}`}
      aria-label="Uygulama içi geliştirme"
    >
      {/* Collapsed by default: the workspace is a fixed-height column whose
          transcript takes the remaining space, so a panel that always claimed
          its full height would push itself past the viewport edge. */}
      <button
        type="button"
        className="assistant-dev-agent-toggle"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span>Uygulamayı geliştir</span>
        {running && <small>çalışıyor…</small>}
        <span aria-hidden="true">{open ? "▾" : "▸"}</span>
      </button>

      {!open ? null : (
      <div className="assistant-dev-agent-body">
      <p className="assistant-dev-agent-note">
        Değişiklik ayrı bir çalışma kopyasında yapılır; testler geçmeden ve siz
        UYGULA demeden çalıştırdığınız sürüm değişmez.
      </p>

      <textarea
        value={instruction}
        onChange={(event) => setInstruction(event.target.value)}
        placeholder="Örn: yolcu listesine pasaport bitiş tarihine göre sıralama ekle"
        rows={3}
        maxLength={8000}
        disabled={running}
        aria-label="Geliştirme isteği"
      />

      <div className="assistant-dev-agent-actions">
        <button type="button" onClick={() => void run()} disabled={running || !instruction.trim()}>
          {running ? "ÇALIŞIYOR…" : "GELİŞTİR"}
        </button>
        {running && (
          <button type="button" onClick={() => void stop()}>
            DURDUR
          </button>
        )}
        {cost > 0 && <small>{`≈ ${cost.toFixed(2)} $`}</small>}
      </div>

      {error && (
        <p className="assistant-dev-agent-error" role="alert">
          {error}
        </p>
      )}

      {log.length > 0 && (
        <div className="assistant-dev-agent-log" role="log" aria-live="polite">
          {log.map((line, index) => (
            <p key={`${index}-${line.slice(0, 24)}`}>{line}</p>
          ))}
        </div>
      )}

      {files.length > 0 && (
        <div className="assistant-dev-agent-changes">
          <h3>{`Değişen dosyalar (${files.length})`}</h3>
          <ul>
            {files.map((file) => (
              <li key={file}>{file}</li>
            ))}
          </ul>
          {diff && <pre>{diff}</pre>}
        </div>
      )}

      {tests.length > 0 && (
        <div className={`assistant-dev-agent-tests${green ? " green" : " red"}`}>
          <h3>Test kapısı</h3>
          <ul>
            {tests.map((test) => (
              <li key={test.name}>
                <strong>{`${test.passed ? "✓" : "✗"} ${test.name}`}</strong>
                {!test.passed && test.detail && <pre>{test.detail}</pre>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {applied ? (
        <p className="assistant-dev-agent-applied" role="status">
          {`Uygulandı (${applied.slice(0, 8)}). Değişikliğin çalışması için sunucuyu yeniden başlatın.`}
        </p>
      ) : (
        <button
          type="button"
          className="assistant-dev-agent-apply"
          onClick={() => void apply()}
          disabled={!applicable || applying || running}
        >
          {applying ? "UYGULANIYOR…" : "UYGULA"}
        </button>
      )}
      </div>
      )}
    </section>
  );
}
