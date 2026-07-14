"use client";

import { useEffect, useMemo, useState } from "react";
import { Passenger, bulkDelete, fetchPassengers } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useStore } from "@/lib/store";
import { PassengerCard } from "@/components/PassengerCard";
import { PassengerDetail } from "@/components/PassengerDetail";

const FILTER_CHIPS: { key: string; label: (n: number) => string; tone?: "ok" | "warn" }[] = [
  { key: "", label: (n) => `TÜM KAYITLAR ${n}` },
  { key: "Hazır", label: (n) => `HAZIR ${n}`, tone: "ok" },
  { key: "Eksik", label: (n) => `BELGE EKSİK ${n}`, tone: "warn" },
];

const PAGE_SIZE = 20;

export function PassengersTab({ initialStatus = "" }: { initialStatus?: string }) {
  const { summary, version, notify, bump, dateScope } = useStore();
  const { user } = useAuth();
  const canWrite = user.role !== "viewer";
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<string>(initialStatus);
  const [passengers, setPassengers] = useState<Passenger[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [selectMode, setSelectMode] = useState(false);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [chipCounts, setChipCounts] = useState<{ ready: number; missing: number }>({ ready: 0, missing: 0 });

  useEffect(() => {
    setStatus(initialStatus);
  }, [initialStatus]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    const timer = window.setTimeout(() => {
      fetchPassengers({ search, status, sort: "name", scope: dateScope })
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
  }, [search, status, version, dateScope]);

  useEffect(() => {
    let active = true;
    Promise.all([
      fetchPassengers({ status: "Hazır", scope: dateScope }),
      fetchPassengers({ status: "Eksik", scope: dateScope }),
    ]).then(([ready, missing]) => {
      if (!active) return;
      setChipCounts({ ready: ready.length, missing: missing.length });
    });
    return () => {
      active = false;
    };
  }, [version, dateScope]);

  const pages = Math.max(1, Math.ceil(passengers.length / PAGE_SIZE));
  const current = Math.min(page, pages - 1);
  const chunk = useMemo(
    () => passengers.slice(current * PAGE_SIZE, current * PAGE_SIZE + PAGE_SIZE),
    [passengers, current],
  );

  const chipCount = (key: string) => {
    if (key === "") return summary.passenger_count;
    if (key === "Hazır") return chipCounts.ready;
    if (key === "Eksik") return chipCounts.missing;
    return 0;
  };

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

  if (summary.passenger_count === 0) {
    return (
      <div className="ic-empty">
        <h3>Henüz yolcu kaydı yok</h3>
        <p>Yükle sekmesinden yolcu listelerini içeri aktararak başlayın.</p>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <label className="ic-search">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Ad soyad, pasaport veya rezervasyon numarası"
          aria-label="Yolcu ara"
        />
      </label>

      <div className="ic-chips" role="tablist" aria-label="Durum filtresi">
        {FILTER_CHIPS.map((chip) => (
          <button
            key={chip.key}
            type="button"
            className={`ic-chip${chip.tone ? ` tone-${chip.tone}` : ""}${status === chip.key ? " active" : ""}`}
            onClick={() => setStatus(chip.key)}
          >
            {chip.label(chipCount(chip.key))}
          </button>
        ))}
        {canWrite && (
          <button
            type="button"
            className={`ic-chip${selectMode ? " active" : ""}`}
            onClick={() => {
              setSelectMode((v) => !v);
              setSelected(new Set());
            }}
          >
            {selectMode ? "SEÇİMİ BİTİR" : "SEÇ"}
          </button>
        )}
      </div>

      {dateScope.range !== "Tümü" && (
        <div className="ic-date-filter">
          <span>
            {dateScope.range === "Aralık" && dateScope.start && dateScope.end
              ? `${dateScope.start} – ${dateScope.end}`
              : dateScope.range.toUpperCase()}
          </span>
          <span>Değiştir</span>
        </div>
      )}

      {canWrite && selectMode && selected.size > 0 && (
        <div className="ic-callout amber">
          <div className="ic-callout-copy">
            <p className="ic-callout-title">{selected.size} kayıt seçildi</p>
            <p className="ic-callout-detail">Toplu işlem uygulanacak</p>
          </div>
          <button className="ic-callout-action" onClick={handleBulkDelete} type="button">
            Sil
          </button>
        </div>
      )}

      {loading && <p className="muted">Yükleniyor…</p>}
      {!loading && passengers.length === 0 && (
        <div className="ic-card ic-card-pad" style={{ textAlign: "center", color: "var(--ido-muted)" }}>
          Sonuç bulunamadı.
        </div>
      )}

      <div style={{ display: "grid", gap: 9 }}>
        {chunk.map((p) => (
          <PassengerCard
            key={p.id}
            passenger={p}
            selectable={canWrite && selectMode}
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

      <div className="ic-actions-row">
        <span style={{ color: "var(--ido-muted)", fontWeight: 600, fontSize: 9, letterSpacing: ".02em" }}>
          TOPLAM {summary.passenger_count} KAYIT
        </span>
        {canWrite && (
          <button type="button" onClick={() => setSelectMode((v) => !v)}>
            {selectMode ? "Vazgeç" : "Seç"}
          </button>
        )}
      </div>

      {detailId !== null && <PassengerDetail id={detailId} onClose={() => setDetailId(null)} />}
    </div>
  );
}
