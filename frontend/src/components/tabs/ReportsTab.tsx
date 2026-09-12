"use client";

import { LocalDownloadButton } from "@/components/LocalDownloadButton";
import { useStore } from "@/lib/store";

export type ReportDestination = "issues" | "records" | "archive" | "package";

const REPORTS: Array<{
  key: ReportDestination;
  title: string;
  detail: string;
  code: string;
}> = [
  {
    key: "issues",
    title: "Kontrol Merkezi",
    detail: "Eksik alan, fotoğraf ve zorunlu evrakları inceleyin.",
    code: "KNT",
  },
  {
    key: "records",
    title: "Günlük Kayıt Klasörleri",
    detail: "Yolcuları oluşturulma tarihine göre klasörleyin.",
    code: "KLS",
  },
  {
    key: "archive",
    title: "Sefer ve Tarih Arşivi",
    detail: "Geçmiş operasyonları tarih bazında görüntüleyin.",
    code: "ARŞ",
  },
  {
    key: "package",
    title: "Çıktılar ve Şifreli Yedek",
    detail: "Excel, CSV, ZIP ve cihaz yedeği oluşturun.",
    code: "ÇKT",
  },
];

export function ReportsTab({ onOpen }: { onOpen: (destination: ReportDestination) => void }) {
  const { summary } = useStore();
  const issueTotal = Object.values(summary.issue_counts).reduce((total, count) => total + count, 0);

  return (
    <div className="ops-page">
      <div className="ops-metric-grid">
        <article>
          <span>Yolcu</span>
          <strong>{summary.passenger_count}</strong>
          <small>{summary.today_count} bugünkü sefer</small>
        </article>
        <article>
          <span>Hazır kayıt</span>
          <strong>{summary.ready_count}</strong>
          <small>%{summary.readiness_percent} operasyon hazırlığı</small>
        </article>
        <article className={summary.missing_count ? "attention" : ""}>
          <span>Eksik kayıt</span>
          <strong>{summary.missing_count}</strong>
          <small>{issueTotal} kontrol işareti</small>
        </article>
        <article>
          <span>Toplam ücret</span>
          <strong>{new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 2 }).format(summary.total_fee)}</strong>
          <small>Yetişkin + çocuk</small>
        </article>
      </div>

      <section className="ops-module-card">
        <div className="ops-module-head">
          <div>
            <p className="ops-eyebrow">GATE VISA</p>
            <h2>Operasyon raporları</h2>
          </div>
        </div>
        <div className="ops-link-list">
          {REPORTS.map((report) => (
            <button type="button" key={report.key} onClick={() => onOpen(report.key)}>
              <span className="ops-file-code">{report.code}</span>
              <span>
                <strong>{report.title}</strong>
                <small>{report.detail}</small>
              </span>
              <b aria-hidden="true">›</b>
            </button>
          ))}
        </div>
      </section>

      <section className="ops-module-card">
        <div className="ops-section-heading">
          <div>
            <p className="ops-eyebrow">HIZLI ÇIKTI</p>
            <h2>Güncel yolcu listesi</h2>
          </div>
          <span>{summary.passenger_count} kayıt</span>
        </div>
        <div className="ops-export-grid">
          <LocalDownloadButton kind="daily-list">İDO GÜNLÜK LİSTE</LocalDownloadButton>
          <LocalDownloadButton kind="excel">EXCEL İNDİR</LocalDownloadButton>
        </div>
      </section>
    </div>
  );
}
