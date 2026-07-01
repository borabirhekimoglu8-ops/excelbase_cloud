"use client";

import { downloadUrl, loadDemo } from "@/lib/api";
import { formatAmount, useStore } from "@/lib/store";
import { EmptyState } from "@/components/tabs/shared";

export function HomeTab({ onNavigate }: { onNavigate: (tab: string) => void }) {
  const { summary, notify, bump } = useStore();

  if (summary.passenger_count === 0) {
    return <EmptyState onNavigate={onNavigate} />;
  }

  const risk = summary.missing_passport + summary.duplicates;

  return (
    <div className="tab-body">
      <p className="section-label">Operasyon Kokpiti</p>

      {summary.today_count > 0 && (
        <div className="banner">
          <strong>Bugün {summary.today_count} yolcu</strong> için operasyon var.
          <button className="link-btn" onClick={() => onNavigate("archive")}>
            Arşivde aç →
          </button>
        </div>
      )}

      <div className="readiness-card">
        <p>Operasyon hazırlığı</p>
        <strong>%{summary.readiness_percent}</strong>
        <div className="progress">
          <span style={{ width: `${summary.readiness_percent}%` }} />
        </div>
        <p className="mini">
          {summary.with_photo}/{summary.passenger_count} foto · {summary.passenger_count - summary.missing_passport}/
          {summary.passenger_count} pasaport · {summary.passenger_count - summary.missing_voucher}/
          {summary.passenger_count} voucher
        </p>
      </div>

      <div className="cc-grid">
        <Stat label="Yolcu" value={summary.passenger_count} sub="Toplam kayıt" />
        <Stat label="Toplam ücret" value={formatAmount(summary.total_fee)} sub="Yetişkin + çocuk" />
        <Stat label="Fotosuz" value={summary.missing_photo} sub="Düzeltilecek" tone="warn" />
        <Stat label="Risk" value={risk} sub="Pasaport/duplicate" tone={risk ? "bad" : "ok"} />
      </div>

      <p className="section-label">Hızlı aksiyonlar</p>
      <div className="action-grid">
        <button className="soft-btn" onClick={() => onNavigate("issues")}>
          Eksikleri düzelt
        </button>
        <button className="soft-btn" onClick={() => onNavigate("passengers")}>
          Yolcu listesi
        </button>
        <a className="soft-btn" href={downloadUrl("/api/export?kind=excel")}>
          Tüm Excel indir
        </a>
        <button className="soft-btn" onClick={() => onNavigate("import")}>
          Import / foto
        </button>
      </div>

      {summary.import_history.length > 0 && (
        <>
          <p className="section-label">Son hareketler</p>
          <div className="timeline">
            {summary.import_history.slice(0, 6).map((item, i) => (
              <div key={i} className="timeline-item">
                <strong>{item.time}</strong> · {item.files} · {item.rows} yolcu · {item.mode}
              </div>
            ))}
          </div>
        </>
      )}

      <button
        className="soft-btn wide"
        onClick={async () => {
          await loadDemo();
          notify("Demo veri yeniden yüklendi");
          bump();
        }}
      >
        Demo veriyi yükle
      </button>
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  tone = "neutral",
}: {
  label: string;
  value: number | string;
  sub: string;
  tone?: "neutral" | "warn" | "bad" | "ok";
}) {
  return (
    <div className={`cc-card tone-${tone}`}>
      <p className="cc-kicker">{label}</p>
      <p className="cc-value">{value}</p>
      <p className="cc-sub">{sub}</p>
    </div>
  );
}
