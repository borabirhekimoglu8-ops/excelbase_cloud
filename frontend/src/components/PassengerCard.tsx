"use client";

import { Passenger } from "@/lib/api";

export function PassengerPhoto({ passenger }: { passenger: Passenger }) {
  if (passenger.photo_url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        className="pax-photo"
        src={passenger.photo_url}
        alt={passenger.full_name || "Yolcu"}
        loading="lazy"
        decoding="async"
      />
    );
  }
  return (
    <div className="photo-slot" aria-hidden="true">
      {passenger.full_name ? passenger.full_name.slice(0, 1).toUpperCase() : "◎"}
    </div>
  );
}

export function PassengerCard({
  passenger,
  onOpen,
  selectable = false,
  selected = false,
  onToggle,
}: {
  passenger: Passenger;
  onOpen?: (id: number) => void;
  selectable?: boolean;
  selected?: boolean;
  onToggle?: (id: number, checked: boolean) => void;
}) {
  const issues = passenger.issues;
  const tone = issues.length === 0 ? "ok" : issues.some((i) => ["Pasaport yok", "İsim yok", "Tarih hatalı"].includes(i)) ? "bad" : "warn";
  const toneLabel = issues.length === 0 ? "Hazır" : tone === "bad" ? "Eksik" : "Kontrol";

  return (
    <article className={`passenger-card${selected ? " is-selected" : ""}`}>
      {selectable && (
        <input
          type="checkbox"
          className="pax-check"
          checked={selected}
          onChange={(e) => onToggle?.(passenger.id, e.target.checked)}
          aria-label="Seç"
        />
      )}
      <button
        className="pax-photo-btn"
        onClick={() => onOpen?.(passenger.id)}
        aria-label={`${passenger.full_name} detay`}
      >
        <PassengerPhoto passenger={passenger} />
      </button>
      <div className="passenger-main" onClick={() => onOpen?.(passenger.id)}>
        <div className="passenger-top">
          <span className="number">#{passenger.no || "—"}</span>
          <span className={`tone ${tone === "bad" ? "bad" : tone === "warn" ? "warn" : "ok"}`}>{toneLabel}</span>
        </div>
        <h3>{passenger.full_name || "İsimsiz yolcu"}</h3>
        <p className="passport">{passenger.passport_no || "Pasaport yok"}</p>
        <div className="passenger-tags">
          {passenger.voucher && <span>{passenger.voucher}</span>}
          {passenger.departure_date && <span>Gidiş {passenger.departure_date}</span>}
          {passenger.arrival_date && <span>Varış {passenger.arrival_date}</span>}
          {passenger.adult_fee && <span>Yetişkin {passenger.adult_fee}</span>}
          {passenger.child_fee && passenger.child_fee !== "0" && <span>Çocuk {passenger.child_fee}</span>}
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
