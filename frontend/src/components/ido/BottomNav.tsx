"use client";

export type NavKey = "home" | "passengers" | "import" | "settings";

const ITEMS: Array<{ key: NavKey; label: string }> = [
  { key: "home", label: "ANA" },
  { key: "passengers", label: "YOLCULAR" },
  { key: "import", label: "YÜKLE" },
  { key: "settings", label: "AYARLAR" },
];

export function BottomNav({ active, onSelect }: { active: NavKey; onSelect: (key: NavKey) => void }) {
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
          <span className="ido-nav-marker" />
          <span className="ido-nav-label">{item.label}</span>
        </button>
      ))}
    </nav>
  );
}
