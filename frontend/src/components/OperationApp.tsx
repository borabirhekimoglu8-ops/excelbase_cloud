"use client";

import { ChangeEvent, useEffect, useMemo, useState } from "react";
import {
  OperationSummary,
  Passenger,
  fetchPassengers,
  fetchSummary,
  uploadPassengerFiles,
} from "@/lib/api";

const emptySummary: OperationSummary = {
  passenger_count: 0,
  adult_total: 0,
  child_total: 0,
  total_fee: 0,
  with_photo: 0,
  missing_photo: 0,
  missing_passport: 0,
  missing_voucher: 0,
  readiness_percent: 0,
  loaded_files: [],
};

type Status = "idle" | "loading" | "error";

function passengerIssues(passenger: Passenger) {
  const issues = [];
  if (!passenger.photo) issues.push("Foto yok");
  if (!passenger.passport_no) issues.push("Pasaport yok");
  if (!passenger.voucher) issues.push("Voucher yok");
  return issues;
}

export function OperationApp() {
  const [summary, setSummary] = useState<OperationSummary>(emptySummary);
  const [passengers, setPassengers] = useState<Passenger[]>([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);

  async function refresh(nextSearch = search) {
    setStatus("loading");
    setError("");
    try {
      const [summaryData, passengerData] = await Promise.all([
        fetchSummary(),
        fetchPassengers(nextSearch),
      ]);
      setSummary(summaryData);
      setPassengers(passengerData);
      setStatus("idle");
    } catch (err) {
      setError(err instanceof Error ? err.message : "API bağlantısı kurulamadı.");
      setStatus("error");
    }
  }

  useEffect(() => {
    refresh("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      refresh(search);
    }, 280);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const filteredMeta = useMemo(() => {
    const riskCount = passengers.filter((passenger) => passengerIssues(passenger).length > 0).length;
    return { riskCount };
  }, [passengers]);

  async function handleUpload(event: ChangeEvent<HTMLInputElement>) {
    if (!event.target.files?.length) return;
    setUploading(true);
    setError("");
    try {
      await uploadPassengerFiles(event.target.files);
      await refresh(search);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import başarısız.");
    } finally {
      setUploading(false);
      event.target.value = "";
    }
  }

  return (
    <main className="app-shell">
      <section className="hero-card">
        <div className="brand-mark" aria-hidden="true">
          <span>⛴</span>
        </div>
        <div>
          <p className="eyebrow">GATE VISA PAX 6.0</p>
          <h1>Deniz laciverti operasyon merkezi</h1>
          <p className="hero-copy">
            Next.js PWA + FastAPI temeli. iPhone odaklı hızlı kartlar, sade filtreler ve API tabanlı veri akışı.
          </p>
        </div>
      </section>

      <section className="status-grid" aria-label="Operasyon özeti">
        <div className="readiness-card">
          <p>Operasyon hazırlığı</p>
          <strong>%{summary.readiness_percent}</strong>
          <div className="progress">
            <span style={{ width: `${summary.readiness_percent}%` }} />
          </div>
        </div>
        <Metric label="Yolcu" value={summary.passenger_count} />
        <Metric label="Toplam ücret" value={summary.total_fee} />
        <Metric label="Risk" value={filteredMeta.riskCount} />
      </section>

      <section className="control-card">
        <label className="search-label" htmlFor="pax-search">
          Ara
        </label>
        <input
          id="pax-search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Ad, pasaport, voucher, tarih..."
        />
        <div className="filter-chips">
          <span>{passengers.length} görünür</span>
          <span>{summary.loaded_files.length} kaynak</span>
          <span>{summary.missing_photo} fotosuz</span>
        </div>
      </section>

      <section className="upload-card">
        <div>
          <p className="eyebrow">Import</p>
          <h2>Excel dosyası yükle</h2>
          <p>Mevcut GATE VISA PAX LIST parser’ı FastAPI üzerinden çalışır.</p>
        </div>
        <label className="upload-button">
          {uploading ? "Yükleniyor..." : "Excel seç"}
          <input type="file" accept=".xlsx,.xls,.xlsm,.ods,.csv" multiple onChange={handleUpload} />
        </label>
      </section>

      {status === "error" && <div className="error-card">{error}</div>}

      <section className="passenger-list">
        <div className="section-heading">
          <p className="eyebrow">Yolcular</p>
          <h2>Operasyon kartları</h2>
        </div>
        {status === "loading" && <p className="muted">Yükleniyor...</p>}
        {status !== "loading" && passengers.length === 0 && (
          <div className="empty-card">Henüz yolcu yok. Excel import ederek başlayın.</div>
        )}
        {passengers.map((passenger) => (
          <PassengerCard key={`${passenger.no}-${passenger.passport_no}-${passenger.full_name}`} passenger={passenger} />
        ))}
      </section>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="metric-card">
      <p>{label}</p>
      <strong>{value}</strong>
    </div>
  );
}

function PassengerCard({ passenger }: { passenger: Passenger }) {
  const issues = passengerIssues(passenger);
  return (
    <article className="passenger-card">
      <div className="photo-slot" aria-hidden="true">
        {passenger.photo ? "✓" : "◎"}
      </div>
      <div className="passenger-main">
        <div className="passenger-top">
          <span className="number">#{passenger.no || "—"}</span>
          <span className={issues.length ? "tone warn" : "tone ok"}>{issues.length ? "Kontrol" : "Hazır"}</span>
        </div>
        <h3>{passenger.full_name || "İsimsiz yolcu"}</h3>
        <p className="passport">{passenger.passport_no || "Pasaport yok"}</p>
        <div className="passenger-tags">
          {passenger.voucher && <span>{passenger.voucher}</span>}
          {passenger.departure_date && <span>{passenger.departure_date}</span>}
          {passenger.arrival_date && <span>{passenger.arrival_date}</span>}
          {passenger.adult_fee && <span>Yetişkin {passenger.adult_fee}</span>}
        </div>
        {issues.length > 0 && (
          <div className="issue-row">
            {issues.map((issue) => (
              <span key={issue}>{issue}</span>
            ))}
          </div>
        )}
      </div>
    </article>
  );
}
