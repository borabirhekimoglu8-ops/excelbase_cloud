"use client";

import { useEffect, useMemo, useState } from "react";
import { Passenger, bulkDelete, downloadUrl, fetchPassengers, scopedPath } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useStore } from "@/lib/store";
import { PassengerCard } from "@/components/PassengerCard";
import { PassengerDetail } from "@/components/PassengerDetail";
import { EmptyState, Segmented } from "@/components/tabs/shared";

const STATUS_OPTS = [
  { key: "", label: "Tümü" },
  { key: "Hazır", label: "Hazır" },
  { key: "Eksik", label: "Eksik" },
  { key: "Fotosuz", label: "Fotosuz" },
  { key: "Pasaportsuz", label: "Pasaportsuz" },
  { key: "Tekrarlı", label: "Tekrarlı" },
] as const;

const SORT_OPTS = [
  { key: "", label: "Sıra" },
  { key: "name", label: "Ada göre" },
  { key: "departure", label: "Gidişe göre" },
  { key: "passport", label: "Pasaport" },
] as const;

const PAGE_SIZE = 20;

export function PassengersTab({ initialStatus = "" }: { initialStatus?: string }) {
  const { summary, version, notify, bump, dateScope } = useStore();
  const { user } = useAuth();
  const canWrite = user.role !== "viewer";
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<string>(initialStatus);
  const [sort, setSort] = useState<string>("");
  const [passengers, setPassengers] = useState<Passenger[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [detailId, setDetailId] = useState<number | null>(null);

  useEffect(() => {
    setStatus(initialStatus);
  }, [initialStatus]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    const timer = window.setTimeout(() => {
      fetchPassengers({ search, status, sort, scope: dateScope })
        .then((data) => {
          if (!active) return;
          setPassengers(data);
          setPage(0);
        })
        .finally(() => active && setLoading(false));
    }, 220);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [search, status, sort, version, dateScope]);

  const pages = Math.max(1, Math.ceil(passengers.length / PAGE_SIZE));
  const current = Math.min(page, pages - 1);
  const chunk = useMemo(
    () => passengers.slice(current * PAGE_SIZE, current * PAGE_SIZE + PAGE_SIZE),
    [passengers, current],
  );

  if (summary.passenger_count === 0) {
    return <EmptyState />;
  }

  function toggle(id: number, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function handleBulkDelete() {
    if (!selected.size) return;
    if (!window.confirm(`${selected.size} yolcu silinsin mi?`)) return;
    await bulkDelete(Array.from(selected));
    notify(`${selected.size} yolcu silindi`, "warn");
    setSelected(new Set());
    bump();
  }

  return (
    <div className="tab-body">
      <input
        type="text"
        className="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Ad, pasaport, voucher, tarih ara..."
      />

      <Segmented options={STATUS_OPTS.map((o) => ({ ...o }))} value={status} onChange={setStatus} />
      <Segmented options={SORT_OPTS.map((o) => ({ ...o }))} value={sort} onChange={setSort} />

      <div className="filter-summary">
        <span>{passengers.length} görünür</span>
        <span>{summary.passenger_count} toplam</span>
        <span>{summary.missing_photo} fotosuz</span>
        <a href={downloadUrl(scopedPath("/api/export?kind=excel", dateScope))} className="chip-link">
          Excel indir
        </a>
      </div>

      {canWrite && selected.size > 0 && (
        <div className="bulk-bar">
          <span>{selected.size} seçili</span>
          <button className="soft-btn danger" onClick={handleBulkDelete}>
            Seçilenleri sil
          </button>
          <button className="ghost-btn" onClick={() => setSelected(new Set())}>
            Temizle
          </button>
        </div>
      )}

      {loading && <p className="muted">Yükleniyor...</p>}
      {!loading && passengers.length === 0 && <div className="empty-card">Sonuç bulunamadı.</div>}

      <div className="passenger-list">
        {chunk.map((p) => (
          <PassengerCard
            key={p.id}
            passenger={p}
            selectable={canWrite}
            selected={selected.has(p.id)}
            onToggle={toggle}
            onOpen={setDetailId}
          />
        ))}
      </div>

      {pages > 1 && (
        <div className="pager">
          <button className="soft-btn" disabled={current === 0} onClick={() => setPage(current - 1)}>
            Önceki
          </button>
          <span>
            {current + 1} / {pages}
          </span>
          <button className="soft-btn" disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>
            Sonraki
          </button>
        </div>
      )}

      {detailId !== null && <PassengerDetail id={detailId} onClose={() => setDetailId(null)} />}
    </div>
  );
}
