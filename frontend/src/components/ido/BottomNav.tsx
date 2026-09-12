"use client";

export type PrimaryNavKey =
  | "home"
  | "gate-visa"
  | "work-files"
  | "passengers"
  | "documents";
/** Eski ekran yönlendiricisi yeni kabuğa geçirilirken aktif anahtarı kabul eder. */
export type NavKey = PrimaryNavKey | "records" | "import" | "settings";

// Five daily destinations. Sales data and reports are reached from the home
// screen instead: they are consulted, not worked in, and a seventh 55px tab
// made every label wrap on a phone.
const ITEMS: Array<{ key: PrimaryNavKey; label: string }> = [
  { key: "home", label: "ANA" },
  { key: "gate-visa", label: "KAPI" },
  { key: "work-files", label: "İŞLER" },
  { key: "passengers", label: "YOLCULAR" },
  { key: "documents", label: "EVRAKLAR" },
];

/**
 * Whether a routing string names one of the tabs.
 *
 * Derived from ITEMS so the nav has one source of truth. The router previously
 * repeated the key list inline in two places, which is precisely what goes
 * stale the first time a tab is added.
 */
export function isPrimaryNavKey(value: string): value is PrimaryNavKey {
  return ITEMS.some((item) => item.key === value);
}

function NavIcon({ kind }: { kind: PrimaryNavKey }) {
  if (kind === "home") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M3.5 10.7 12 3.8l8.5 6.9v9.1h-6v-5.6h-5v5.6h-6z" />
      </svg>
    );
  }
  if (kind === "work-files") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M8.2 6V4.8h7.6V6M4 7.5h16v11.7H4zM4 11.4c4.7 2.2 11.3 2.2 16 0M10 12.2h4" />
      </svg>
    );
  }
  if (kind === "passengers") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="9" cy="8" r="3.2" />
        <path d="M3.8 19.4v-1.8c0-3 2.3-5.1 5.2-5.1s5.2 2.1 5.2 5.1v1.8M15.5 5.5a3 3 0 0 1 0 5.8M16.2 13c2.4.5 4 2.3 4 4.7v1.7" />
      </svg>
    );
  }
  if (kind === "documents") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M6 3.8h8.2l3.8 3.8v12.6H6zM14 3.8v4h4M9 12h6M9 15.5h6" />
      </svg>
    );
  }
  // gate-visa: a passport-style booklet with a stamp.
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5.5 4.2h13v15.6h-13zM8.5 4.2v15.6" />
      <circle cx="14" cy="10" r="2.4" />
      <path d="M11.6 15h4.8" />
    </svg>
  );
}

type BottomNavProps = {
  active: NavKey;
  onSelect: (key: NavKey) => void;
  onQuickCreate?: () => void;
};

export function BottomNav({ active, onSelect, onQuickCreate }: BottomNavProps) {
  return (
    <nav className="ido-bottom-nav" aria-label="Ana gezinme">
      {ITEMS.map((item) => (
        <button
          key={item.key}
          type="button"
          className={item.key === active ? "ido-nav-item active" : "ido-nav-item"}
          onClick={() => onSelect(item.key)}
          aria-current={item.key === active ? "page" : undefined}
        >
          <span className="ido-nav-marker" aria-hidden="true" />
          <span className="ido-nav-icon">
            <NavIcon kind={item.key} />
          </span>
          <span className="ido-nav-label">{item.label}</span>
        </button>
      ))}
      {onQuickCreate ? (
        <button
          className="operations-quick-create"
          type="button"
          aria-label="Hızlı ekle"
          title="Hızlı ekle"
          onClick={onQuickCreate}
        >
          <span aria-hidden="true">+</span>
        </button>
      ) : null}
    </nav>
  );
}
