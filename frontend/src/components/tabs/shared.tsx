"use client";

import { downloadUrl } from "@/lib/api";
import { useAuth } from "@/lib/auth";

export function EmptyState({
  onNavigate,
  title = "Henüz operasyon yok",
  subtitle = "Toplu Aktarım bölümünden yolcu listelerini ekleyerek başlayın.",
}: {
  onNavigate?: (tab: string) => void;
  title?: string;
  subtitle?: string;
}) {
  const { user } = useAuth();
  return (
    <div className="tab-body">
      <div className="empty-hero">
        <span className="empty-mark">GV</span>
        <h3>{title}</h3>
        <p className="muted">{subtitle}</p>
      </div>
      <div className="action-grid">
        {onNavigate && user.role !== "viewer" && (
          <button className="primary-btn" onClick={() => onNavigate("import")}>
            Toplu aktarıma geç
          </button>
        )}
        <a className="soft-btn" href={downloadUrl("/api/template")}>
          Şablon indir
        </a>
      </div>
    </div>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { key: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="segmented" role="tablist">
      {options.map((opt) => (
        <button
          key={opt.key}
          className={opt.key === value ? "seg active" : "seg"}
          onClick={() => onChange(opt.key)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
