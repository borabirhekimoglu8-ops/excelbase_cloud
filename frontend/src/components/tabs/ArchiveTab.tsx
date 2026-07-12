"use client";

import { useEffect, useState } from "react";
import { ArchiveGroup, downloadUrl, fetchArchive } from "@/lib/api";
import { formatAmount, useStore } from "@/lib/store";
import { EmptyState } from "@/components/tabs/shared";

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
  const ids = encodeURIComponent(group.passenger_ids.join(","));

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
            <a className="soft-btn" href={downloadUrl(`/api/export?kind=excel&ids=${ids}`)}>Excel indir</a>
            <a className="soft-btn" href={downloadUrl(`/api/export?kind=csv&ids=${ids}`)}>CSV indir</a>
            <a className="primary-btn" href={downloadUrl(`/api/package?ids=${ids}`)}>Gün paketini indir</a>
          </div>
        </div>
      )}
    </article>
  );
}
