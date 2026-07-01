"use client";

import { useEffect, useState } from "react";
import { Passenger, downloadUrl, fetchPassengers } from "@/lib/api";
import { useStore } from "@/lib/store";
import { PassengerDetail } from "@/components/PassengerDetail";
import { EmptyState } from "@/components/tabs/shared";

export function GalleryTab() {
  const { summary, version } = useStore();
  const [rows, setRows] = useState<Passenger[]>([]);
  const [loading, setLoading] = useState(true);
  const [detailId, setDetailId] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetchPassengers()
      .then((data) => active && setRows(data.filter((p) => p.photo)))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [version]);

  if (summary.passenger_count === 0) {
    return (
      <EmptyState
        emoji="📷"
        title="Galeri boş"
        subtitle="Önce yolcu ekleyin, ardından Import sekmesinden foto/ZIP yükleyin."
      />
    );
  }

  return (
    <div className="tab-body">
      <div className="filter-summary">
        <span>{rows.length} eşleşmiş foto</span>
        <span>{summary.missing_photo} fotosuz</span>
        {rows.length > 0 && (
          <a href={downloadUrl("/api/photos-zip?range=Tümü")} className="chip-link">
            Foto ZIP indir
          </a>
        )}
      </div>

      {loading && <p className="muted">Yükleniyor...</p>}
      {!loading && rows.length === 0 && (
        <div className="empty-card">Henüz eşleşmiş fotoğraf yok. Import sekmesinden yükleyin.</div>
      )}

      <div className="gallery-grid">
        {rows.map((p) => (
          <button key={p.id} className="gallery-card" onClick={() => setDetailId(p.id)}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.photo_url} alt={p.full_name} loading="lazy" decoding="async" />
            <p>
              {p.full_name || "Yolcu"}
              <br />
              <span>{p.passport_no}</span>
            </p>
          </button>
        ))}
      </div>

      {detailId !== null && <PassengerDetail id={detailId} onClose={() => setDetailId(null)} />}
    </div>
  );
}
