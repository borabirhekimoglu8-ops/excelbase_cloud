"use client";

import { ReactNode } from "react";

const LOGO_SRC = "/brand/ido-logo.jpg";

/** Ana ekranda gösterilen tam portal kimliği (logo + marka adı + yetkili rozeti). */
export function AppHeaderHome({ statusLabel = "SİSTEM AKTİF" }: { statusLabel?: string }) {
  return (
    <header className="ido-header">
      <span className="ido-header-logo lg">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={LOGO_SRC} alt="İDO" />
      </span>
      <div className="ido-header-identity">
        <p className="ido-header-brand">İDO EGE ADALARI</p>
        <p className="ido-header-sub">GATE VISA CHECKLIST</p>
      </div>
      <span className="ido-header-badge">{statusLabel}</span>
    </header>
  );
}

/** Alt ekranlarda gösterilen geri butonlu, başlıklı üst çubuk. */
export function AppHeaderScreen({
  title,
  onBack,
  action,
  compact = false,
}: {
  title: string;
  onBack?: () => void;
  action?: ReactNode;
  compact?: boolean;
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
      <span className={`ido-header-logo${compact ? "" : ""}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={LOGO_SRC} alt="İDO" />
      </span>
      {action}
    </header>
  );
}
