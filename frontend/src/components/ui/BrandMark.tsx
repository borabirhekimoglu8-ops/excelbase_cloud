/** Excelbase mark — İDO dolphin + sun DNA from the user's logo reference. */
export function BrandMark({
  size = 32,
  tone = "on-brand",
}: {
  size?: number;
  tone?: "on-brand" | "on-light";
}) {
  const deep = "#053b52";
  const cyan = "#4aa8d8";
  const orange = "#f47721";
  const showWord = size >= 40;
  return (
    <span className="xb-mark-wrap" style={{ width: size, height: size }} aria-hidden="true">
      {/* Prefer the real logo asset the user attached; SVG is a crisp fallback. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        className="xb-mark-photo"
        src="/brand/ido-logo.png"
        alt=""
        width={size}
        height={size}
        draggable={false}
      />
      <svg
        className="xb-mark xb-mark-fallback"
        width={size}
        height={size}
        viewBox="0 0 64 64"
        aria-hidden="true"
      >
        <circle cx="32" cy="28" r="22" fill={orange} />
        <path
          d="M14 34c6-10 14-16 24-16 4 0 8 1 12 3-8 2-14 7-18 14-2 4-3 8-3 12-6-2-11-7-15-13z"
          fill={deep}
        />
        <path
          d="M18 38c7-8 15-12 24-11 3 0 6 1 9 2-7 2-12 6-16 12-2 3-3 6-3 9-5-2-10-6-14-12z"
          fill={cyan}
        />
        <path d="M12 42h30M14 46h24M16 50h18" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" opacity=".85" />
        {showWord ? (
          <text x="32" y="62" textAnchor="middle" fill={tone === "on-brand" ? "#e8f4f8" : deep} fontSize="8" fontWeight="800" fontStyle="italic">
            ido
          </text>
        ) : null}
      </svg>
    </span>
  );
}
