"use client";

import { useEffect, useState } from "react";
import { ArchiveGroup, downloadUrl, fetchArchive, saveOperationMeta } from "@/lib/api";
import { formatAmount, useStore } from "@/lib/store";
import { EmptyState, Segmented } from "@/components/tabs/shared";

const RANGES = [
  { key: "Tümü", label: "Tümü" },
  { key: "Bugün", label: "Bugün" },
  { key: "Bu hafta", label: "Bu hafta" },
  { key: "Bu ay", label: "Bu ay" },
] as const;

const STATUS_OPTS = ["Hazırlanıyor", "Foto kontrol", "Evrak kontrol", "Tamamlandı"];

export function ArchiveTab() {
  const { summary, version } = useStore();
  const [range, setRange] = useState<string>("Tümü");
  const [groups, setGroups] = useState<ArchiveGroup[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetchArchive(range)
      .then((res) => {
        if (!active) return;
        setGroups(res.groups);
        setTotal(res.total_count);
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [range, version]);

  if (summary.passenger_count === 0) {
    return <EmptyState emoji="📁" title="Arşiv boş" subtitle="Import sekmesinden Excel yükleyin." />;
  }

  return (
    <div className="tab-body">
      <p className="section-label">Tarihe göre arşiv</p>
      <Segmented options={RANGES.map((r) => ({ ...r }))} value={range} onChange={setRange} />

      <div className="filter-summary">
        <span>{total} yolcu</span>
        <span>{groups.length} tarih</span>
        <a href={downloadUrl(`/api/photos-zip?range=${encodeURIComponent(range)}`)} className="chip-link">
          Foto ZIP
        </a>
      </div>

      {loading && <p className="muted">Yükleniyor...</p>}
      {!loading && groups.length === 0 && <div className="empty-card">Seçilen aralıkta yolcu yok.</div>}

      {groups.map((group) => (
        <ArchiveCard key={group.date_key} group={group} />
      ))}
    </div>
  );
}

function ArchiveCard({ group }: { group: ArchiveGroup }) {
  const { notify, bump } = useStore();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState(group.meta?.status ?? "Hazırlanıyor");
  const [staff, setStaff] = useState(group.meta?.staff ?? "");
  const [note, setNote] = useState(group.meta?.note ?? "");
  const idsParam = group.passenger_ids.join(",");

  async function handleSave() {
    await saveOperationMeta({ date_key: group.date_key, status, staff, note });
    notify("Operasyon bilgisi kaydedildi");
    bump();
  }

  return (
    <div className="archive-card">
      <button className="archive-head" onClick={() => setOpen((o) => !o)}>
        <div>
          <p className="qf-title">{group.date_key}</p>
          <p className="qf-sub">
            {group.count} yolcu · {group.with_photo} fotolu · {formatAmount(group.total)} ücret
          </p>
        </div>
        <span className={`badge ${group.meta ? "" : "muted"}`}>{group.meta?.status ?? "—"}</span>
      </button>

      {open && (
        <div className="archive-body">
          <div className="action-grid">
            <a className="soft-btn" href={downloadUrl(`/api/export?kind=excel&ids=${idsParam}`)}>
              Excel indir
            </a>
            <a className="soft-btn" href={downloadUrl(`/api/export?kind=csv&ids=${idsParam}`)}>
              CSV indir
            </a>
          </div>
          <label className="field">
            <span>Durum</span>
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              {STATUS_OPTS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Görevli</span>
            <input type="text" value={staff} onChange={(e) => setStaff(e.target.value)} />
          </label>
          <label className="field">
            <span>Not</span>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
          </label>
          <button className="primary-btn wide" onClick={handleSave}>
            Operasyon bilgisini kaydet
          </button>
        </div>
      )}
    </div>
  );
}
