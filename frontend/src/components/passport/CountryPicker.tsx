"use client";

import { useId, useMemo, useState } from "react";

import { resolveCountrySelection, searchCountries } from "@/lib/passport/icaoCountries";

export function CountryPicker({
  value,
  onChange,
  disabled = false,
}: {
  value: string;
  onChange: (alpha3: string) => void;
  disabled?: boolean;
}) {
  const listId = useId();
  const [query, setQuery] = useState(value);
  const [open, setOpen] = useState(false);
  const matches = useMemo(
    () => searchCountries(query, 10),
    [query],
  );
  const showList = open && Boolean(query) && matches.length > 0 && query.toUpperCase() !== value;

  function choose(alpha3: string) {
    setQuery(alpha3);
    setOpen(false);
    onChange(alpha3);
  }

  return (
    <div className="xb-country-picker">
      <input
        role="combobox"
        aria-label="Uyruk"
        aria-autocomplete="list"
        aria-controls={listId}
        aria-expanded={showList}
        value={query}
        disabled={disabled}
        autoComplete="off"
        onFocus={() => setOpen(true)}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") setOpen(false);
          if (event.key === "Enter") {
            event.preventDefault();
            const resolved = resolveCountrySelection(query);
            if (resolved) choose(resolved.alpha3);
          }
        }}
        onBlur={() => {
          const resolved = resolveCountrySelection(query);
          if (resolved) choose(resolved.alpha3);
          else setQuery(value);
          setOpen(false);
        }}
      />
      {showList ? (
        <ul id={listId} role="listbox">
          {matches.map((entry) => (
            <li key={`${entry.kind}-${entry.alpha3}`}>
              <button
                type="button"
                role="option"
                aria-selected={entry.alpha3 === value}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(entry.alpha3)}
              >
                <strong>{entry.alpha3}{entry.alpha2 ? ` · ${entry.alpha2}` : " · Ülke Kodu 2 yok"}</strong>
                <span>{entry.nameTr}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
