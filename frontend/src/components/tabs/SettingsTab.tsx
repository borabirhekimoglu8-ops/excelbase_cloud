"use client";

import { useAuth } from "@/lib/auth";
import { useStore } from "@/lib/store";
import { UI_VERSION } from "@/lib/version";

export type SettingsSub = "issues" | "gallery" | "archive" | "package" | "management";

const ROLE_LABELS: Record<string, string> = {
  admin: "Yerel yönetici",
  operator: "Operasyon",
  viewer: "Görüntüleme",
};

export function SettingsTab({ onOpen }: { onOpen: (sub: SettingsSub) => void }) {
  const { user, signOut } = useAuth();
  const { summary, connected } = useStore();
  const issueTotal = Object.values(summary.issue_counts).reduce((a, b) => a + b, 0);

  const items: Array<{ key: SettingsSub; title: string; sub: string; badge?: number; roles?: string[] }> = [
    { key: "issues", title: "Kontrol Merkezi", sub: "Eksik alan ve belgeleri düzelt", badge: issueTotal },
    { key: "gallery", title: "Fotoğraf Galerisi", sub: "Yüklenen biyometrik fotoğraflar" },
    { key: "archive", title: "Tarih Arşivi", sub: "Gün bazında dosyalar ve çıktılar" },
    { key: "package", title: "Çıktılar ve Yedek", sub: "Excel, CSV, fotoğraf paketi ve cihaz yedeği" },
    { key: "management", title: "Cihaz ve Güvenlik", sub: "Depolama, çevrimdışı durum ve şifreli yedek", roles: ["admin"] },
  ];

  return (
    <>
      <div className="ic-profile">
        <div className="ic-profile-id">
          <div className="ic-profile-photo" style={{ width: 48, height: 48 }}>
            <span aria-hidden="true">{user.name.slice(0, 1).toUpperCase()}</span>
          </div>
          <div className="ic-profile-copy">
            <p className="ic-profile-name" style={{ fontSize: 15 }}>{user.name}</p>
            <p className="ic-profile-meta">{ROLE_LABELS[user.role] ?? user.role}</p>
          </div>
        </div>
        <button className="ic-pill ic-pill-bad" style={{ border: 0, cursor: "pointer" }} onClick={() => void signOut()} type="button">
          ÇIKIŞ
        </button>
      </div>

      <div className="ic-section-head">
        <p className="ic-section-title">Veri Araçları</p>
      </div>

      <div style={{ display: "grid", gap: 8 }}>
        {items
          .filter((item) => !item.roles || item.roles.includes(user.role))
          .map((item) => (
            <button key={item.key} className="ic-row as-btn compact" onClick={() => onOpen(item.key)} type="button">
              <div className="ic-row-id">
                <div className="ic-row-copy">
                  <p className="ic-row-title">{item.title}</p>
                  <p className="ic-row-meta">{item.sub}</p>
                </div>
              </div>
              {item.badge ? <span className="ic-pill ic-pill-warn">{item.badge}</span> : <span className="ic-map-arrow">›</span>}
            </button>
          ))}
      </div>

      <div className="ic-info-note">
        <span className="ic-info-mark">i</span>
        <div className="ic-info-note-copy">
          <p className="ic-info-note-title">Excelbase Çevrimdışı Yolcu Yönetimi · v{UI_VERSION}</p>
          <p className="ic-info-note-detail">
            {connected ? "Çevrimdışı kullanıma hazır" : "Yerel kasa okunamadı"} · Veriler bu cihazda şifreli saklanıyor.
          </p>
        </div>
      </div>
    </>
  );
}
