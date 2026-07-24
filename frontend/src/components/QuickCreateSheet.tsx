"use client";

import { useEffect, useRef } from "react";

type QuickCreateSheetProps = {
  open: boolean;
  onClose: () => void;
  onNewWorkFile?: () => void;
  onNewPassenger?: () => void;
  onUploadDocument?: () => void;
  onBulkImport?: () => void;
  onNewPetition?: () => void;
  onNewTask?: () => void;
};

type QuickAction = {
  key: string;
  label: string;
  detail: string;
  mark: string;
  run?: () => void;
};

export function QuickCreateSheet({
  open,
  onClose,
  onNewWorkFile,
  onNewPassenger,
  onUploadDocument,
  onBulkImport,
  onNewPetition,
  onNewTask,
}: QuickCreateSheetProps) {
  const sheetRef = useRef<HTMLElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    sheetRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab" || !sheetRef.current) return;
      const controls = Array.from(
        sheetRef.current.querySelectorAll<HTMLElement>(
          'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
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

  const actions: QuickAction[] = [
    { key: "work-file", label: "Yeni iş dosyası", detail: "C kodu, tarih ve operasyon bilgisi", mark: "İŞ", run: onNewWorkFile },
    { key: "passenger", label: "Yeni yolcu", detail: "Bilgi, biyometrik fotoğraf ve PDF", mark: "YO", run: onNewPassenger },
    { key: "document", label: "Evrak yükle", detail: "İşe, yolcuya veya arşive bağla", mark: "EV", run: onUploadDocument },
    { key: "bulk-import", label: "Toplu yolcu listesi", detail: "Excel, CSV, ODS veya ZIP içe aktar", mark: "XL", run: onBulkImport },
    { key: "petition", label: "Yeni dilekçe", detail: "Kayıttan resmi belge oluştur", mark: "Dİ", run: onNewPetition },
    { key: "task", label: "Yeni görev", detail: "Son tarih ve öncelik belirle", mark: "GR", run: onNewTask },
  ];

  return (
    <div
      className="operations-sheet-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <section
        ref={sheetRef}
        className="operations-quick-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="quick-create-title"
        tabIndex={-1}
      >
        <header className="operations-quick-sheet-head">
          <div>
            <p>HIZLI İŞLEM</p>
            <h2 id="quick-create-title">Yeni oluştur</h2>
          </div>
          <button type="button" aria-label="Hızlı ekle penceresini kapat" onClick={onClose}>×</button>
        </header>
        <div className="operations-quick-grid">
          {actions.map((action) => (
            <button
              key={action.key}
              className="operations-quick-action"
              type="button"
              aria-label={action.label}
              disabled={!action.run}
              onClick={() => {
                if (!action.run) return;
                onClose();
                action.run();
              }}
            >
              <span className="operations-quick-action-mark" aria-hidden="true">{action.mark}</span>
              <span className="operations-quick-action-copy">
                <strong>{action.label}</strong>
                <small>{action.run ? action.detail : "Yakında"}</small>
              </span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
