"use client";

import { useCallback, useEffect, useState } from "react";

import {
  type DriveAuditState,
  type DriveReport,
  fetchDriveAuditStatus,
  scanDriveFolder,
} from "@/lib/driveAudit/client";
import { HoloBars } from "@/components/charts/Holo";

const UNAVAILABLE: Record<Exclude<DriveAuditState, "ready">, { title: string; body: string }> = {
  disabled: {
    title: "Klasör taraması kapalı",
    body: "Açmak için sunucudaki .env dosyasına EXCELBASE_DRIVE_AUDIT=1 ekleyip yeniden başlatın.",
  },
  blocked_open_network: {
    title: "Bu sunucu açık olduğu için tarama kapalı",
    body:
      "Herhangi bir klasörü okuyabilen bir uç nokta, sunucuya başkası da ulaşabiliyorsa "
      + "dosya sızdırma aracıdır. Önce erişimi kapatın veya IP kısıtı ekleyin.",
  },
};

const KIND_LABELS: Record<string, string> = {
  tablo: "Tablo",
  belge: "Belge",
  gorsel: "Görsel",
  diger: "Diğer",
};

/**
 * Reads a work folder and shows what the application is missing.
 *
 * The scan is local and deterministic: no model, and only header names and
 * counts leave the folder. That is what makes it safe to point at a Drive full
 * of passport scans, and it is stated on the panel because the operator cannot
 * otherwise tell.
 *
 * Each finding carries a sentence ready for the development panel. Approving
 * one sends that sentence -- never the folder.
 */
export function DriveAuditPanel({
  csrfToken,
  onDevelop,
}: {
  csrfToken: string;
  onDevelop?: (instruction: string) => void;
}) {
  const [state, setState] = useState<DriveAuditState | null>(null);
  const [root, setRoot] = useState("");
  const [report, setReport] = useState<DriveReport | null>(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!csrfToken) return;
    const controller = new AbortController();
    fetchDriveAuditStatus(csrfToken, controller.signal)
      .then((status) => {
        setState(status.state);
        setRoot((current) => current || status.default_root);
      })
      .catch(() => { if (!controller.signal.aborted) setState(null); });
    return () => controller.abort();
  }, [csrfToken]);

  /**
   * Hands a finding to the development panel and gets out of its way.
   *
   * Both panels share one column, so leaving this one open pushes the
   * instruction box -- the thing the operator now has to read and approve --
   * off the bottom of a phone screen. One tap reopens the report.
   */
  const develop = useCallback((suggestion: string) => {
    onDevelop?.(suggestion);
    setOpen(false);
  }, [onDevelop]);

  const scan = useCallback(async () => {
    const target = root.trim();
    if (!target || scanning) return;
    setScanning(true);
    setError("");
    try {
      setReport(await scanDriveFolder(target, csrfToken));
    } catch (cause) {
      setReport(null);
      setError(cause instanceof Error ? cause.message : "Klasör taranamadı.");
    } finally {
      setScanning(false);
    }
  }, [csrfToken, root, scanning]);

  if (state === null) return null;

  return (
    <section className={`assistant-dev-agent${open ? " open" : ""}`} aria-label="Çalışma klasörü analizi">
      <button
        type="button"
        className="assistant-dev-agent-toggle"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span>Çalışma klasörünü analiz et</span>
        {scanning && <small>taranıyor…</small>}
        <span aria-hidden="true">{open ? "▾" : "▸"}</span>
      </button>

      {open && (
        <div className="assistant-dev-agent-body">
          {state !== "ready" ? (
            <>
              <h3>{UNAVAILABLE[state].title}</h3>
              <p className="assistant-dev-agent-note">{UNAVAILABLE[state].body}</p>
            </>
          ) : (
            <>
              <p className="assistant-dev-agent-note">
                Klasörünüz bu makinede taranır. Yalnızca <strong>sütun başlıkları ve
                sayılar</strong> okunur; hücre içeriği, PDF ve fotoğraflar açılmaz ve
                hiçbir şey dışarı gönderilmez. Yapay zekâ kullanılmaz.
              </p>

              <label className="ic-drive-root">
                <span>KLASÖR YOLU</span>
                <input
                  type="text"
                  value={root}
                  placeholder="G:\\Drive'ım\\Operasyon"
                  onChange={(event) => setRoot(event.target.value)}
                  disabled={scanning}
                />
              </label>

              <div className="assistant-dev-agent-actions">
                <button type="button" onClick={() => void scan()} disabled={scanning || !root.trim()}>
                  {scanning ? "TARANIYOR…" : "TARA"}
                </button>
              </div>

              {error && <p className="assistant-dev-agent-error" role="alert">{error}</p>}

              {report && (
                <div className="ic-stats">
                  <p className="ic-stats-scope">
                    {`${report.files_seen} dosya · ${report.dated_folders} tarihli klasör`}
                    {report.truncated ? " · sınıra ulaşıldı, kısmi sonuç" : ""}
                  </p>

                  {Object.keys(report.by_kind).length > 0 && (
                    <div className="ic-stats-card">
                      <h4>Klasördeki dosyalar</h4>
                      <HoloBars
                        entries={Object.entries(report.by_kind).map(([kind, count]) => ({
                          label: KIND_LABELS[kind] ?? kind,
                          value: count,
                        }))}
                        formatValue={(value) => `${value}`}
                      />
                    </div>
                  )}

                  {report.entities.length === 0 && (
                    <p className="assistant-dev-agent-note">
                      Tekrar eden bir tablo şablonu bulunamadı. Klasörde en az üç kez
                      kullanılan bir Excel düzeni yoksa bu beklenen sonuçtur.
                    </p>
                  )}

                  {report.entities.map((entity) => (
                    <div className="ic-stats-card" key={entity.name}>
                      <h4>{entity.name}<em>{entity.files} dosya</em></h4>
                      <p className="assistant-dev-agent-note">
                        {`Alanlar: ${entity.columns.join(", ")}`}
                      </p>
                      {entity.missing.length > 0 && (
                        <p className="assistant-dev-agent-note">
                          <strong>Uygulamada yok:</strong> {entity.missing.join(", ")}
                        </p>
                      )}
                      {onDevelop && (
                        <button
                          type="button"
                          className="ic-drive-develop"
                          onClick={() => develop(entity.suggestion)}
                        >
                          BUNU GELİŞTİR
                        </button>
                      )}
                    </div>
                  ))}

                  {report.findings.map((finding) => (
                    <div className="ic-stats-card" key={`${finding.kind}-${finding.title}`}>
                      <h4>{finding.title}</h4>
                      <p className="assistant-dev-agent-note">{finding.detail}</p>
                      {finding.evidence.map((line) => (
                        <p className="ic-drive-evidence" key={line}>{line}</p>
                      ))}
                      {onDevelop && finding.suggestion && (
                        <button
                          type="button"
                          className="ic-drive-develop"
                          onClick={() => develop(finding.suggestion)}
                        >
                          BUNU GELİŞTİR
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
