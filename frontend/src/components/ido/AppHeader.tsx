"use client";

import { ReactNode } from "react";

const LOGO_SRC = "/brand/ido-logo.jpg";

type HeaderUtilitiesProps = {
  onAssistant?: () => void;
  onSettings?: () => void;
};

function HeaderUtilities({ onAssistant, onSettings }: HeaderUtilitiesProps) {
  if (!onAssistant && !onSettings) return null;
  return (
    <div className="operations-header-utilities">
      {onAssistant ? (
        <button
          className="ido-header-action operations-header-icon"
          type="button"
          aria-label="Excelbase Asistanını aç"
          title="Excelbase Asistanı"
          onClick={onAssistant}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 3.8 13.5 8l4.2 1.5-4.2 1.5-1.5 4.2-1.5-4.2-4.2-1.5L10.5 8zM18.5 14.2l.8 2.1 2.1.8-2.1.8-.8 2.1-.8-2.1-2.1-.8 2.1-.8z" />
          </svg>
        </button>
      ) : null}
      {onSettings ? (
        <button
          className="ido-header-action operations-header-icon"
          type="button"
          aria-label="Ayarları aç"
          title="Ayarlar"
          onClick={onSettings}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="8" r="3.2" />
            <path d="M5.2 20c.4-4 2.8-6.2 6.8-6.2s6.4 2.2 6.8 6.2" />
          </svg>
        </button>
      ) : null}
    </div>
  );
}

/** Ana ekranda gösterilen Excelbase Operations şemsiye kimliği. */
export function AppHeaderHome({
  statusLabel = "ÇEVRİMDIŞI HAZIR",
  onAssistant,
  onSettings,
}: {
  statusLabel?: string;
  onAssistant?: () => void;
  onSettings?: () => void;
}) {
  return (
    <header className="ido-header">
      <span className="ido-header-logo lg operations-header-mark" aria-hidden="true">XB</span>
      <div className="ido-header-identity">
        <p className="ido-header-brand">EXCELBASE</p>
        <p className="ido-header-sub">OPERATIONS</p>
      </div>
      {!onAssistant && !onSettings ? <span className="ido-header-badge">{statusLabel}</span> : null}
      <HeaderUtilities onAssistant={onAssistant} onSettings={onSettings} />
    </header>
  );
}

/** Alt ekranlarda gösterilen geri butonlu, başlıklı üst çubuk. */
export function AppHeaderScreen({
  title,
  onBack,
  action,
  compact = false,
  brand = "ido",
  onAssistant,
  onSettings,
}: {
  title: string;
  onBack?: () => void;
  action?: ReactNode;
  compact?: boolean;
  brand?: "ido" | "operations" | "none";
  onAssistant?: () => void;
  onSettings?: () => void;
}) {
  return (
    <header className="ido-header">
      {onBack ? (
        <button className="ido-header-back" onClick={onBack} type="button" aria-label="Geri">
          ‹
        </button>
      ) : (
        <span style={{ width: 44, height: 44, flex: "0 0 auto" }} aria-hidden="true" />
      )}
      <p className="ido-header-title">{title}</p>
      {brand === "ido" ? (
        <span className={`ido-header-logo${compact ? " compact" : ""}`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={LOGO_SRC} alt="İDO" />
        </span>
      ) : brand === "operations" ? (
        <span className={`ido-header-logo operations-header-mark${compact ? " compact" : ""}`} aria-hidden="true">XB</span>
      ) : null}
      <HeaderUtilities onAssistant={onAssistant} onSettings={onSettings} />
      {action}
    </header>
  );
}
