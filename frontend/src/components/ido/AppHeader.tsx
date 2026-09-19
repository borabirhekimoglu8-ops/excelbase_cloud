"use client";

import { ReactNode } from "react";
import { BrandMark } from "@/components/ui/BrandMark";

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

/** Ana ekranın üst çubuğu: uygulama adı ve yardımcı düğmeler. */
export function AppHeaderHome({
  onAssistant,
  onSettings,
}: {
  onAssistant?: () => void;
  onSettings?: () => void;
}) {
  return (
    <header className="ido-header">
      <span className="ido-header-mark" aria-hidden="true"><BrandMark size={40} /></span>
      <div className="ido-header-identity">
        <p className="ido-header-brand">Excelbase</p>
        <p className="ido-header-sub">Operasyon</p>
      </div>
      <HeaderUtilities onAssistant={onAssistant} onSettings={onSettings} />
    </header>
  );
}

/** Alt ekranların üst çubuğu: geri, başlık ve varsa eylemler. Marka
 * görseli taşımaz; başlık tek başına yeterlidir. */
export function AppHeaderScreen({
  title,
  onBack,
  action,
  onAssistant,
  onSettings,
}: {
  title: string;
  onBack?: () => void;
  action?: ReactNode;
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
        <span className="ido-header-mark" aria-hidden="true"><BrandMark size={40} /></span>
      )}
      <p className="ido-header-title">{title}</p>
      <HeaderUtilities onAssistant={onAssistant} onSettings={onSettings} />
      {action}
    </header>
  );
}
