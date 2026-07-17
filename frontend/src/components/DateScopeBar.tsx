"use client";

import type { DateField } from "@/lib/api";
import { useStore } from "@/lib/store";

const RANGES = ["Tümü", "Bugün", "Bu hafta", "Bu ay", "Aralık"];

const FIELD_OPTIONS: Array<{ key: DateField; label: string; hint: string }> = [
  { key: "created", label: "Kayıt tarihi", hint: "Yolcu kaydının açıldığı gün" },
  { key: "departure", label: "Sefer tarihi", hint: "Yolcunun gidiş günü" },
];

export function DateScopeBar({ fixedField }: { fixedField?: DateField } = {}) {
  const { dateScope, setDateScope } = useStore();
  const activeField = fixedField ?? dateScope.field ?? "departure";

  function updateField(field: DateField) {
    setDateScope({ ...dateScope, field });
  }

  return (
    <section className="scope-bar ic-scope-control" aria-label={`${activeField === "created" ? "Kayıt" : "Sefer"} tarihi filtresi`}>
      {fixedField ? (
        <div className="ic-scope-fixed">
          <span>KAYIT TARİHİ</span>
          <small>Günlük klasör tarihi</small>
        </div>
      ) : (
        <div className="ic-date-basis" role="tablist" aria-label="Filtrenin tarih türü">
          {FIELD_OPTIONS.map((option) => (
            <button
              key={option.key}
              className={activeField === option.key ? "active" : ""}
              onClick={() => updateField(option.key)}
              type="button"
              role="tab"
              aria-selected={activeField === option.key}
              title={option.hint}
            >
              <span>{option.label}</span>
              <small>{option.hint}</small>
            </button>
          ))}
        </div>
      )}
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
                field: activeField,
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
              onChange={(event) => setDateScope({ ...dateScope, field: activeField, start: event.target.value })}
            />
          </label>
          <label>
            <span>Bitiş</span>
            <input
              type="date"
              min={dateScope.start || undefined}
              value={dateScope.end}
              onChange={(event) => setDateScope({ ...dateScope, field: activeField, end: event.target.value })}
            />
          </label>
        </div>
      )}
    </section>
  );
}
