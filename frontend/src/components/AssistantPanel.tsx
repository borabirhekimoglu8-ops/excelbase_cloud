"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { buildAssistantContext } from "@/lib/assistant/context";
import { AssistantStatus, fetchAssistantStatus } from "@/lib/assistant/client";
import { formatAmount, useStore } from "@/lib/store";

const RANGE_LABELS = {
  all: "Tüm kayıtlar",
  today: "Bugün",
  week: "Bu hafta",
  month: "Bu ay",
  custom: "Özel tarih aralığı",
} as const;

const ISSUE_LABELS = {
  missing_photo: "Fotoğraf eksik",
  missing_passport: "Pasaport eksik",
  missing_voucher: "Voucher eksik",
  missing_fee: "Ücret eksik",
  duplicate: "Tekrarlı kayıt",
  missing_name: "İsim eksik",
  invalid_date: "Tarih hatası",
} as const;

type AssistantPanelProps = {
  open: boolean;
  onClose: () => void;
};

export function AssistantPanel({ open, onClose }: AssistantPanelProps) {
  const { summary, dateScope } = useStore();
  const [status, setStatus] = useState<AssistantStatus | null>(null);
  const [statusError, setStatusError] = useState(false);
  const panelRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const safeContext = useMemo(
    () => buildAssistantContext(summary, dateScope),
    [dateScope, summary],
  );

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setStatus(null);
    setStatusError(false);
    fetchAssistantStatus(controller.signal)
      .then(setStatus)
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setStatusError(true);
      });
    return () => controller.abort();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;
      const controls = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(
          'button:not(:disabled), summary, [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (!controls.length) {
        event.preventDefault();
        return;
      }
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocusRef.current?.focus();
    };
  }, [onClose, open]);

  if (!open) return null;

  const available = status?.available === true;
  const scopeDetail = safeContext.scope.range === "custom"
    ? [safeContext.scope.start, safeContext.scope.end].filter(Boolean).join(" – ")
    : "";
  const statusCopy = statusError
    ? "KAPALI · DURUM HİZMETİNE ULAŞILAMADI"
    : status === null
      ? "GÜVENLİK DURUMU KONTROL EDİLİYOR"
      : available
        ? "SALT OKUNUR ÖNİZLEME HAZIR"
        : "KAPALI · SAĞLAYICI YAPILANDIRILMADI";
  const issueEntries = Object.entries(safeContext.issues) as Array<
    [keyof typeof ISSUE_LABELS, number]
  >;

  return (
    <div
      className="ops-sheet-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <section
        ref={panelRef}
        className="ops-assistant-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="assistant-panel-title"
        aria-describedby="assistant-panel-description"
      >
        <header className="ops-sheet-head">
          <div>
            <p>EXCELBASE OPERATIONS</p>
            <h2 id="assistant-panel-title">Excelbase Asistanı</h2>
          </div>
          <button
            ref={closeButtonRef}
            className="ops-sheet-close"
            type="button"
            aria-label="Excelbase Asistanını kapat"
            onClick={onClose}
          >
            ×
          </button>
        </header>

        <div
          className={`ops-assistant-status${available && !statusError ? "" : " offline"}`}
          role="status"
          aria-live="polite"
        >
          <span className="ops-assistant-status-dot" aria-hidden="true" />
          {statusCopy}
        </div>

        <div className="ops-assistant-lead">
          <h3>Güvenli operasyon bağlamı</h3>
          <p id="assistant-panel-description">
            Yalnızca aşağıdaki toplu sayılar hazırlanır. Yolcu adı, pasaport, dosya adı,
            evrak içeriği, not ve iletişim bilgisi bu bağlama eklenmez.
          </p>
        </div>

        <div className="ops-assistant-scope">
          <span>AKTİF KAPSAM</span>
          <strong>{RANGE_LABELS[safeContext.scope.range]}</strong>
          <small>
            {safeContext.scope.field === "created" ? "Kayıt tarihi" : "Sefer tarihi"}
            {scopeDetail ? ` · ${scopeDetail}` : ""}
          </small>
        </div>

        <div className="ops-assistant-metrics" aria-label="Asistana hazırlanmış toplu operasyon verileri">
          <div>
            <strong>{safeContext.metrics.passenger_count}</strong>
            <span>Toplam yolcu</span>
          </div>
          <div>
            <strong>{safeContext.metrics.ready_count}</strong>
            <span>Hazır kayıt</span>
          </div>
          <div>
            <strong>{safeContext.metrics.missing_count}</strong>
            <span>Eksik kayıt</span>
          </div>
          <div>
            <strong>%{safeContext.metrics.readiness_percent}</strong>
            <span>Hazırlık</span>
          </div>
          <div>
            <strong>{safeContext.metrics.today_count}</strong>
            <span>Bugünkü kayıt</span>
          </div>
          <div>
            <strong>{formatAmount(safeContext.metrics.total_fee)}</strong>
            <span>Toplam ücret</span>
          </div>
        </div>

        <div className="ops-assistant-context">
          <p><strong>Kontrol özeti</strong></p>
          <div className="ops-assistant-issues">
            {issueEntries.map(([key, count]) => (
              <span key={key} className={count > 0 ? "has-issue" : ""}>
                {ISSUE_LABELS[key]} <b>{count}</b>
              </span>
            ))}
          </div>
          <details className="ops-assistant-details">
            <summary>Gönderime uygun bağlamı görüntüle</summary>
            <pre>{JSON.stringify(safeContext, null, 2)}</pre>
          </details>
        </div>

        <div className={`ops-assistant-guard${available ? " ready" : ""}`}>
          <strong>{available ? "Mesaj gönderimi bu sürümde kapalı" : "Asistan güvenli bekleme modunda"}</strong>
          <p>
            {available
              ? "Durum hizmeti hazır; ancak ücretli model çağrısı ve mesaj endpoint’i bilinçli olarak etkinleştirilmedi."
              : "Bağlantı kurulamadığı için hiçbir operasyon verisi dışarı gönderilmedi. Yapılandırma tamamlanana kadar soru gönderilemez."}
          </p>
        </div>

        <form className="ops-assistant-composer" onSubmit={(event) => event.preventDefault()}>
          <label htmlFor="assistant-prompt">Asistana mesaj yaz</label>
          <textarea
            id="assistant-prompt"
            rows={3}
            disabled
            placeholder="Güvenli mesaj servisi etkinleştirildiğinde kullanıma açılacak."
          />
          <button type="submit" disabled>Gönder</button>
        </form>
      </section>
    </div>
  );
}
