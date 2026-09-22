"use client";

import type { BatchPageView } from "@/lib/passport/batch";

const LABELS: Record<string, string> = {
  queued: "Sırada",
  processing: "İşleniyor",
  review: "Kontrol bekliyor",
  conflict: "Eksik veya çelişkili",
  done: "Tamam",
  error: "Hata",
  cancelled: "İptal",
};

export function PassportBatchProgress({
  pages,
  onRetry,
  onCancel,
}: {
  pages: BatchPageView[];
  onRetry: (pageId: string) => void;
  onCancel: () => void;
}) {
  if (!pages.length) return null;
  const busy = pages.some((page) => page.status === "queued" || page.status === "processing");
  return (
    <section className="ops-module-card xb-passport-batch">
      <div className="ops-section-heading">
        <div>
          <p className="ops-eyebrow">Parti</p>
          <h2>{pages.filter((page) => page.status === "processing" || page.status === "queued").length} sayfa işleniyor</h2>
        </div>
        {busy ? <button type="button" onClick={onCancel}>İptal</button> : null}
      </div>
      <ul className="xb-passport-batch-list">
        {pages.map((page) => (
          <li key={page.pageId} data-status={page.status}>
            <strong>{page.label}</strong>
            <span>{LABELS[page.status] ?? page.status}</span>
            {page.error ? <em>{page.error}</em> : null}
            {page.status === "error" ? (
              <button type="button" onClick={() => onRetry(page.pageId)}>Yeniden dene</button>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
