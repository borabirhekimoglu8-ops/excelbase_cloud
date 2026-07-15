"use client";

import { useEffect, useState } from "react";
import { Passenger, bulkDelete, fetchImportQueue, fetchPassengerPage } from "@/lib/api";
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
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [retryNonce, setRetryNonce] = useState(0);
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [selectMode, setSelectMode] = useState(false);
  const [detailId, setDetailId] = useState<number | null>(null);

  useEffect(() => {
    setStatus(initialStatus);
  }, [initialStatus]);

  useEffect(() => {
    setPage(0);
  }, [search, status, dateScope]);

  useEffect(() => {
    // Kullanıcı aktarım sürerken bu sekmeye geçerse ImportTab unmount olur ve
    // onun poll'u durur. Kuyruğu burada yalnız aktif olduğu sürece izleyip son
    // kayıt tamamlanınca hem özeti hem görünür sayfayı kesin olarak yenileriz.
    let mounted = true;
    let timer: number | undefined;
    let sawActive = false;
    let firstCheck = true;
    const checkQueue = async () => {
      try {
        const state = await fetchImportQueue();
        if (!mounted) return;
        const nextActive = state.active || state.jobs.some(
          (job) => job.status === "waiting" || job.status === "pending" || job.status === "processing",
        );
        if (firstCheck) {
          // İlk yolcu sorgusu ile yarışan hızlı tamamlanmayı da yakala.
          firstCheck = false;
          setRetryNonce((value) => value + 1);
        }
        if (sawActive && !nextActive) {
          bump();
          setRetryNonce((value) => value + 1);
        }
        sawActive = sawActive || nextActive;
        if (nextActive) timer = window.setTimeout(() => void checkQueue(), 4_000);
      } catch {
        if (mounted) timer = window.setTimeout(() => void checkQueue(), 6_000);
      }
    };
    void checkQueue();
    return () => {
      mounted = false;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [bump]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError("");
    const timer = window.setTimeout(() => {
      fetchPassengerPage({
        search,
        status,
        sort: "name",
        scope: dateScope,
        offset: page * PAGE_SIZE,
        limit: PAGE_SIZE,
      })
        .then((data) => {
          if (!active) return;
          const lastPage = Math.max(0, Math.ceil(data.total / PAGE_SIZE) - 1);
          if (page > lastPage) {
            setPage(lastPage);
            return;
          }
          setPassengers(data.items);
          setTotal(data.total);
        })
        .catch((error) => {
          if (!active) return;
          setLoadError(error instanceof Error ? error.message : "Yolcular yüklenemedi.");
        })
        .finally(() => active && setLoading(false));
    }, 220);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [search, status, version, dateScope, page, retryNonce]);

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const current = Math.min(page, pages - 1);

  const chipCount = (key: string) => {
    if (key === "") return summary.passenger_count || (!search && !status ? total : 0);
    if (key === "Hazır") return summary.ready_count ?? 0;
    if (key === "Eksik") return summary.missing_count ?? 0;
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

  if (!loading && !loadError && !search && !status && total === 0) {
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
      {loadError && (
        <div className="ic-callout amber" role="alert">
          <div className="ic-callout-copy">
            <p className="ic-callout-title">Yolcular yüklenemedi</p>
            <p className="ic-callout-detail" style={{ whiteSpace: "normal", wordBreak: "break-word" }}>
              {loadError}
            </p>
          </div>
          <button className="ic-callout-action" onClick={() => setRetryNonce((value) => value + 1)} type="button">
            Tekrar dene
          </button>
        </div>
      )}
      {!loading && !loadError && passengers.length === 0 && (
        <div className="ic-card ic-card-pad" style={{ textAlign: "center", color: "var(--ido-muted)" }}>
          Sonuç bulunamadı.
        </div>
      )}

      <div style={{ display: "grid", gap: 9 }}>
        {passengers.map((p) => (
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
          TOPLAM {summary.passenger_count || (!search && !status ? total : 0)} KAYIT
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
