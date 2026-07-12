"use client";

import { useStore } from "@/lib/store";

const RANGES = ["Tümü", "Bugün", "Bu hafta", "Bu ay", "Aralık"];

export function DateScopeBar() {
  const { dateScope, setDateScope } = useStore();

  return (
    <section className="scope-bar" aria-label="Tarih filtresi">
      <div className="scope-options">
        {RANGES.map((range) => (
          <button
            key={range}
            className={dateScope.range === range ? "scope-option active" : "scope-option"}
            onClick={() =>
              setDateScope({
                range,
                start: range === "Aralık" ? dateScope.start : "",
                end: range === "Aralık" ? dateScope.end : "",
              })
            }
            type="button"
          >
            {range}
          </button>
        ))}
      </div>
      {dateScope.range === "Aralık" && (
        <div className="scope-dates">
          <label>
            <span>Başlangıç</span>
            <input
              type="date"
              max={dateScope.end || undefined}
              value={dateScope.start}
              onChange={(event) => setDateScope({ ...dateScope, start: event.target.value })}
            />
          </label>
          <label>
            <span>Bitiş</span>
            <input
              type="date"
              min={dateScope.start || undefined}
              value={dateScope.end}
              onChange={(event) => setDateScope({ ...dateScope, end: event.target.value })}
            />
          </label>
        </div>
      )}
    </section>
  );
}
