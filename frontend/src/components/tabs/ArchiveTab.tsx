"use client";

import { useEffect, useState } from "react";
import { ArchiveGroup, fetchArchive } from "@/lib/api";
import { formatAmount, useStore } from "@/lib/store";
import { EmptyState } from "@/components/tabs/shared";
import { LocalDownloadButton } from "@/components/LocalDownloadButton";

export function ArchiveTab() {
  const { summary, version, dateScope } = useStore();
  const [groups, setGroups] = useState<ArchiveGroup[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetchArchive(dateScope)
      .then((res) => {
        if (!active) return;
        setGroups(res.groups);
        setTotal(res.total_count);
      })
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [dateScope, version]);

  if (summary.passenger_count === 0) {
    return <EmptyState title="Arşiv boş" subtitle="Seçili tarih aralığında yolcu kaydı bulunmuyor." />;
  }

  return (
    <div className="tab-body">
      <div className="section-heading">
        <div>
          <p className="overline">TARİH ARŞİVİ</p>
          <h2>Gün bazında dosyalar</h2>
          <p>Operasyon formu olmadan, kayıtları tarihe göre inceleyin ve hazır çıktıları indirin.</p>
        </div>
      </div>

      <div className="filter-summary">
        <span>{total} yolcu</span>
        <span>{groups.length} tarih</span>
      </div>

      {loading && <p className="muted">Arşiv yükleniyor…</p>}
      {!loading && groups.length === 0 && <div className="empty-card">Seçilen aralıkta yolcu yok.</div>}
      {groups.map((group) => <ArchiveCard key={group.date_key} group={group} />)}
    </div>
  );
}

function ArchiveCard({ group }: { group: ArchiveGroup }) {
  const [open, setOpen] = useState(false);
  return (
    <article className="archive-card">
      <button className="archive-head" onClick={() => setOpen((value) => !value)} type="button">
        <div>
          <p className="qf-title">{group.date_key}</p>
          <p className="qf-sub">
            {group.count} yolcu · {group.with_photo} fotoğraf · {formatAmount(group.total)} toplam ücret
          </p>
        </div>
        <span className="badge">{open ? "Kapat" : "Dosyaları aç"}</span>
      </button>
      {open && (
        <div className="archive-body">
          <div className="action-grid">
            <LocalDownloadButton className="primary-btn" kind="daily-list" ids={group.passenger_ids}>İDO günlük liste</LocalDownloadButton>
            <LocalDownloadButton className="soft-btn" kind="excel" ids={group.passenger_ids}>Excel indir</LocalDownloadButton>
            <LocalDownloadButton className="soft-btn" kind="csv" ids={group.passenger_ids}>CSV indir</LocalDownloadButton>
            <LocalDownloadButton className="primary-btn" kind="package" ids={group.passenger_ids}>Gün paketini indir</LocalDownloadButton>
          </div>
        </div>
      )}
    </article>
  );
}
