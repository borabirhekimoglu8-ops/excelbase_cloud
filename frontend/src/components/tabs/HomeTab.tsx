"use client";

import { useEffect, useState } from "react";
import { ArchiveGroup, fetchArchive } from "@/lib/api";
import { useStore } from "@/lib/store";

function fileKind(name: string): "xls" | "zip" | "pdf" {
  const lower = name.toLowerCase();
  if (lower.endsWith(".zip")) return "zip";
  if (lower.endsWith(".pdf")) return "pdf";
  return "xls";
}

export function HomeTab({ onNavigate }: { onNavigate: (tab: string) => void }) {
  const { summary, connected, dateScope } = useStore();
  const [voyage, setVoyage] = useState<ArchiveGroup | null>(null);

  useEffect(() => {
    let active = true;
    fetchArchive({ range: "Tümü", start: "", end: "" }).then((res) => {
      if (!active) return;
      const today = new Date().toISOString().slice(0, 10);
      const upcoming = res.groups
        .filter((g) => g.date_key >= today)
        .sort((a, b) => a.date_key.localeCompare(b.date_key));
      setVoyage(upcoming[0] ?? res.groups[0] ?? null);
    });
    return () => {
      active = false;
    };
  }, []);

  if (!connected) {
    return (
      <div className="ic-empty">
        <h3>Sunucuya ulaşılamıyor</h3>
        <p>Kayıtlar yüklenemedi. Bağlantınızı kontrol edip tekrar deneyin.</p>
      </div>
    );
  }

  if (summary.passenger_count === 0) {
    return (
      <div className="ic-empty">
        <h3>Henüz operasyon yok</h3>
        <p>Yükle sekmesinden yolcu listelerini içeri aktararak başlayın.</p>
        <button className="ic-btn-primary" style={{ width: "auto", padding: "0 20px" }} onClick={() => onNavigate("import")} type="button">
          Yüklemeye Başla
        </button>
      </div>
    );
  }

  const missingDocs = summary.missing_photo;
  const readyCount = Math.max(0, summary.passenger_count - missingDocs);
  const voyageReady = voyage ? voyage.with_photo : 0;
  const voyageTotal = voyage ? voyage.count : 0;
  const voyagePct = voyageTotal ? Math.round((voyageReady / voyageTotal) * 100) : 0;
  const scopeLabel = dateScope.range === "Tümü" ? "TÜM KAYITLAR" : dateScope.range.toUpperCase();
  const today = new Date().toLocaleDateString("tr-TR", { day: "2-digit", month: "short", year: "numeric" }).toUpperCase();

  return (
    <>
      <div className="ic-section-head">
        <div>
          <p style={{ margin: 0, color: "var(--ido-ink)", fontWeight: 600, fontSize: 22, lineHeight: "31px" }}>
            Vize Operasyon Özeti
          </p>
          <p style={{ margin: 0, color: "var(--ido-muted)", fontWeight: 500, fontSize: 11 }}>
            {today} · {scopeLabel}
          </p>
        </div>
        <span className="ic-pill ic-pill-info">SİSTEM AKTİF</span>
      </div>

      <div className="ic-card ic-metrics">
        <div className="ic-metric">
          <p className="ic-metric-value" style={{ color: "var(--ido-primary-deep)" }}>{summary.passenger_count}</p>
          <p className="ic-metric-label">TOPLAM KAYIT</p>
        </div>
        <span className="ic-metric-divider" />
        <div className="ic-metric">
          <p className="ic-metric-value" style={{ color: "var(--ido-success)" }}>{readyCount}</p>
          <p className="ic-metric-label">HAZIR</p>
        </div>
        <span className="ic-metric-divider" />
        <div className="ic-metric">
          <p className="ic-metric-value" style={{ color: "var(--ido-amber)" }}>{missingDocs}</p>
          <p className="ic-metric-label">EKSİK EVRAK</p>
        </div>
      </div>

      {voyage && (
        <div className="ic-dark" style={{ display: "grid", gap: 9 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <p style={{ margin: 0, fontWeight: 600, fontSize: 16 }}>{voyage.date_key}</p>
              <p style={{ margin: 0, color: "#c9dce3", fontWeight: 500, fontSize: 9, letterSpacing: ".02em" }}>
                SEFER TARİHİ · {voyage.count} YOLCU
              </p>
            </div>
            <span className="ic-pill ic-pill-ok">İŞLEME AÇIK</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 11 }}>
            <span style={{ fontWeight: 500 }}>{voyageReady} / {voyageTotal} yolcu hazır</span>
            <span style={{ color: "#80cfe4", fontWeight: 600 }}>%{voyagePct}</span>
          </div>
          <div className="ic-progress on-dark">
            <span style={{ width: `${voyagePct}%` }} />
          </div>
        </div>
      )}

      <div className="ic-section-head">
        <p className="ic-section-title">Son Dosya Aktarımları</p>
        <button className="ic-section-link" onClick={() => onNavigate("import")} type="button">
          Tümünü gör
        </button>
      </div>

      {summary.import_history.length === 0 && (
        <div className="ic-card ic-card-pad" style={{ color: "var(--ido-muted)", fontSize: 12 }}>
          Henüz dosya aktarımı yapılmadı.
        </div>
      )}
      {summary.import_history.slice(0, 4).map((item, i) => {
        const kind = fileKind(item.files || "");
        return (
          <div className="ic-row compact" key={item.batch_id || i}>
            <div className="ic-row-id">
              <span className={`ic-filetype ${kind}`}>{kind.toUpperCase()}</span>
              <div className="ic-row-copy">
                <p className="ic-row-title">{item.files || "Dosya"}</p>
                <p className="ic-row-meta">{item.time} · {item.rows ?? 0} yolcu</p>
              </div>
            </div>
            <span className="ic-pill ic-pill-ok">{item.undone ? "GERİ ALINDI" : "TAMAM"}</span>
          </div>
        );
      })}

      {missingDocs > 0 && (
        <div className="ic-callout amber">
          <div className="ic-callout-copy">
            <p className="ic-callout-title">{missingDocs} kayıt belge kontrolü bekliyor</p>
            <p className="ic-callout-detail">Sefer kapanmadan kontrol edin</p>
          </div>
          <button className="ic-callout-action" onClick={() => onNavigate("passengers-fotosuz")} type="button">
            İncele
          </button>
        </div>
      )}
    </>
  );
}
