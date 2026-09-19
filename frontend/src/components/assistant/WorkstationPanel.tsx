"use client";

import { useCallback, useEffect, useState } from "react";

import {
  type AdviceReport,
  type CatalogHit,
  type CatalogStats,
  type WorkstationState,
  adviseWorkstation,
  buildWorkstationCatalog,
  fetchWorkstationStatus,
  searchWorkstationCatalog,
} from "@/lib/workstation/client";

const UNAVAILABLE: Record<Exclude<WorkstationState, "ready">, { title: string; body: string }> = {
  disabled: {
    title: "İş istasyonu kapalı",
    body: "Açmak için .env dosyasına EXCELBASE_WORKSTATION=1 ekleyip sunucuyu yeniden başlatın. Klasör yolu için EXCELBASE_WORKSTATION_ROOT kullanın.",
  },
  blocked_open_network: {
    title: "Açık ağda istasyon kapalı",
    body:
      "Herhangi bir klasörü indeksleyen uç nokta, sunucuya başkası da ulaşabiliyorsa "
      + "dosya sızdırma aracıdır. Önce erişimi kapatın (PIN veya IP kısıtı).",
  },
};

const KIND_LABELS: Record<string, string> = {
  tablo: "Tablo",
  belge: "Belge",
  gorsel: "Görsel",
  diger: "Diğer",
};

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 ** 3) return `${(value / (1024 ** 2)).toFixed(1)} MB`;
  return `${(value / (1024 ** 3)).toFixed(2)} GB`;
}

/**
 * Kapalı yerel iş istasyonu: katalog, arama ve deterministik danışman.
 *
 * Dosya içerikleri okunmaz; meta veri bu makinede kalır. Bulut modeli gerekmez.
 */
export function WorkstationPanel({ csrfToken }: { csrfToken: string }) {
  const [state, setState] = useState<WorkstationState | null>(null);
  const [root, setRoot] = useState("");
  const [stats, setStats] = useState<CatalogStats | null>(null);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<CatalogHit[]>([]);
  const [advice, setAdvice] = useState<AdviceReport | null>(null);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(true);

  useEffect(() => {
    if (!csrfToken) return;
    const controller = new AbortController();
    fetchWorkstationStatus(csrfToken, controller.signal)
      .then((status) => {
        setState(status.state);
        setRoot((current) => current || status.default_root);
      })
      .catch(() => {
        if (!controller.signal.aborted) setState(null);
      });
    return () => controller.abort();
  }, [csrfToken]);

  const runBuild = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const next = await buildWorkstationCatalog(root, csrfToken);
      setStats(next);
      setHits([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Katalog oluşturulamadı.");
    } finally {
      setBusy(false);
    }
  }, [csrfToken, root]);

  const runSearch = useCallback(async () => {
    if (!query.trim()) return;
    setBusy(true);
    setError("");
    try {
      const result = await searchWorkstationCatalog(query, root, csrfToken);
      setHits(result.results);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Arama yapılamadı.");
    } finally {
      setBusy(false);
    }
  }, [csrfToken, query, root]);

  const runAdvise = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const report = await adviseWorkstation(question, root, csrfToken);
      setAdvice(report);
      if (report.stats && typeof report.stats === "object" && "files_seen" in report.stats) {
        setStats(report.stats as CatalogStats);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Öneri alınamadı.");
    } finally {
      setBusy(false);
    }
  }, [csrfToken, question, root]);

  if (state === null) return null;

  if (state !== "ready") {
    const copy = UNAVAILABLE[state];
    return (
      <section className="assistant-state-card" data-testid="workstation-panel">
        <h2>{copy.title}</h2>
        <p>{copy.body}</p>
      </section>
    );
  }

  return (
    <section className="workstation-panel" data-testid="workstation-panel">
      <header className="workstation-panel-header">
        <div>
          <p className="workstation-kicker">Kapalı yerel istasyon</p>
          <h2>İş klasörü kataloğu</h2>
        </div>
        <button type="button" className="ops-secondary" onClick={() => setOpen((value) => !value)}>
          {open ? "Gizle" : "Aç"}
        </button>
      </header>

      {open && (
        <>
          <p className="workstation-privacy">
            Yalnız dosya adı ve yol indekslenir. Hücre, PDF ve JPEG içeriği okunmaz; dışarı çıkış yok.
          </p>

          <label className="workstation-field">
            <span>İş klasörü</span>
            <input
              value={root}
              onChange={(event) => setRoot(event.target.value)}
              placeholder="/yol/operasyon"
              autoComplete="off"
            />
          </label>

          <div className="workstation-actions">
            <button type="button" className="ops-primary" disabled={busy || !root.trim()} onClick={runBuild}>
              {busy ? "Çalışıyor…" : "Kataloğu indeksle"}
            </button>
            <button type="button" className="ops-secondary" disabled={busy || !root.trim()} onClick={runAdvise}>
              Düzen öner
            </button>
          </div>

          {error && <p className="workstation-error" role="alert">{error}</p>}

          {stats && (
            <div className="workstation-stats" data-testid="workstation-stats">
              <p>
                <strong>{stats.files_seen}</strong> dosya · {formatBytes(stats.total_bytes || 0)}
                {stats.truncated ? " · limit kesildi" : ""}
              </p>
              <ul>
                {Object.entries(stats.by_kind || {}).map(([kind, count]) => (
                  <li key={kind}>
                    {KIND_LABELS[kind] || kind}: {count}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <form
            className="workstation-search"
            onSubmit={(event) => {
              event.preventDefault();
              void runSearch();
            }}
          >
            <label className="workstation-field">
              <span>Dosya bul</span>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="C kodu, firma, tarih…"
                autoComplete="off"
              />
            </label>
            <button type="submit" className="ops-secondary" disabled={busy || !query.trim()}>
              Ara
            </button>
          </form>

          {hits.length > 0 && (
            <ul className="workstation-hits" data-testid="workstation-hits">
              {hits.map((hit) => (
                <li key={hit.path}>
                  <strong>{hit.name}</strong>
                  <span>{hit.path}</span>
                  <em>{KIND_LABELS[hit.kind] || hit.kind}</em>
                </li>
              ))}
            </ul>
          )}

          <label className="workstation-field">
            <span>Danışmana sor (yerel, modelsiz)</span>
            <input
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder="Kaç dosya var? Düzeni nasıl kurarım?"
              autoComplete="off"
            />
          </label>

          {advice && (
            <div className="workstation-advice" data-testid="workstation-advice">
              <p className="workstation-answer">{advice.answer}</p>
              <ul>
                {advice.items.slice(0, 6).map((item) => (
                  <li key={`${item.kind}-${item.title}`}>
                    <strong>{item.title}</strong>
                    <span>{item.detail}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  );
}
