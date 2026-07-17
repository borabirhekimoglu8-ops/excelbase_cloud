"use client";

import { Passenger } from "@/lib/api";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "—";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function PassengerPhoto({ passenger }: { passenger: Passenger }) {
  if (passenger.photo_url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={passenger.photo_url}
        alt={passenger.full_name || "Yolcu"}
        loading="lazy"
        decoding="async"
      />
    );
  }
  return <span aria-hidden="true">{initials(passenger.full_name || "?")}</span>;
}

export function passengerStatusTone(passenger: Passenger): { tone: "ok" | "warn" | "bad"; label: string } {
  const issues = passenger.issues;
  if (issues.length === 0) return { tone: "ok", label: "HAZIR" };
  const critical = issues.some((i) => ["Pasaport yok", "İsim yok", "Tarih hatalı"].includes(i));
  return critical ? { tone: "bad", label: "EKSİK" } : { tone: "warn", label: "KONTROL" };
}

export function PassengerCard({
  passenger,
  onOpen,
  selectable = false,
  selected = false,
  onToggle,
  canAddDocuments = false,
  documentBusy = false,
  onAddDocuments,
}: {
  passenger: Passenger;
  onOpen?: (id: number) => void;
  selectable?: boolean;
  selected?: boolean;
  onToggle?: (id: number, checked: boolean) => void;
  canAddDocuments?: boolean;
  documentBusy?: boolean;
  onAddDocuments?: (id: number, files: File[]) => Promise<void> | void;
}) {
  const { tone, label } = passengerStatusTone(passenger);
  const documentCount = passenger.documents?.length ?? 0;
  const metaParts = [
    passenger.passport_no || "Pasaport yok",
    passenger.voucher,
    passenger.departure_date && `Gidiş ${passenger.departure_date}`,
    `${documentCount} PDF`,
  ].filter(Boolean);

  return (
    <div
      className="ic-row as-btn"
      style={{ minHeight: 76 }}
      onClick={() => onOpen?.(passenger.id)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen?.(passenger.id);
        }
      }}
      role="button"
      tabIndex={0}
    >
      <div className="ic-row-id">
        {selectable && (
          <input
            type="checkbox"
            checked={selected}
            onChange={(e) => {
              e.stopPropagation();
              onToggle?.(passenger.id, e.target.checked);
            }}
            onClick={(e) => e.stopPropagation()}
            aria-label={`${passenger.full_name || "Yolcu"} seç`}
            style={{ width: 17, height: 17, accentColor: "var(--ido-primary)", flex: "0 0 auto" }}
          />
        )}
        <span className="ic-avatar">
          <PassengerPhoto passenger={passenger} />
        </span>
        <div className="ic-row-copy">
          <p className="ic-row-title">{passenger.full_name || "İsimsiz yolcu"}</p>
          <p className="ic-row-meta">{metaParts.join(" · ")}</p>
        </div>
      </div>
      <div className="ic-passenger-actions">
        <span className={`ic-pill lg ic-pill-${tone}`}>{label}</span>
        {canAddDocuments && (
          <label
            className={`ic-inline-pdf${documentBusy ? " disabled" : ""}`}
            onClick={(event) => event.stopPropagation()}
          >
            {documentBusy ? "EKLENİYOR…" : "PDF EKLE"}
            <input
              type="file"
              accept=".pdf,application/pdf"
              multiple
              disabled={documentBusy}
              aria-label={`${passenger.full_name || "Yolcu"} için PDF evrak seç`}
              onClick={(event) => event.stopPropagation()}
              onChange={async (event) => {
                const input = event.currentTarget;
                const files = Array.from(input.files ?? []);
                if (files.length) await onAddDocuments?.(passenger.id, files);
                input.value = "";
              }}
            />
          </label>
        )}
      </div>
    </div>
  );
}
