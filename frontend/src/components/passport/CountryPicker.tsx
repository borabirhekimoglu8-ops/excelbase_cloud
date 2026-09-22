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
  const matches = useMemo(() => searchCountries(query, 10), [query]);

  return (
    <div className="xb-country-picker">
      <input
        role="combobox"
        aria-label="Uyruk"
        aria-autocomplete="list"
        aria-controls={listId}
        aria-expanded={Boolean(query && matches.length)}
        value={query}
        disabled={disabled}
        autoComplete="off"
        onChange={(event) => setQuery(event.target.value)}
        onBlur={() => {
          const direct = resolveCountrySelection(query);
          if (!direct) {
            setQuery(value);
            return;
          }
          setQuery(direct.alpha3);
          onChange(direct.alpha3);
        }}
      />
      {query && matches.length ? (
        <ul id={listId} role="listbox">
          {matches.filter((entry) => entry.kind !== "special").map((entry) => (
            <li key={`${entry.kind}-${entry.alpha3}`}>
              <button
                type="button"
                role="option"
                aria-selected={entry.alpha3 === value}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  setQuery(entry.alpha3);
                  onChange(entry.alpha3);
                }}
              >
                <strong>{entry.alpha3} · {entry.alpha2}</strong>
                <span>{entry.nameTr}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
