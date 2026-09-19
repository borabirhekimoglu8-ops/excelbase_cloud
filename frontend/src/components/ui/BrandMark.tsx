/** Excelbase mark — holographic tablet with an orange ferry-stripe accent. */
export function BrandMark({
  size = 32,
  tone = "on-brand",
}: {
  size?: number;
  tone?: "on-brand" | "on-light";
}) {
  const deep = "#0a1f33";
  const cyan = "#4fd1e8";
  const orange = "#f47721";
  const ink = tone === "on-brand" ? "#f4fbff" : deep;
  const fill = tone === "on-brand" ? "rgba(10,31,51,.72)" : "rgba(232,244,248,.92)";
  const rim = tone === "on-brand" ? "rgba(79,209,232,.55)" : "rgba(5,59,82,.35)";
  return (
    <svg
      className="xb-mark"
      width={size}
      height={size}
      viewBox="0 0 32 32"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="xbMarkGlass" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={cyan} stopOpacity="0.35" />
          <stop offset="100%" stopColor={deep} stopOpacity="0.9" />
        </linearGradient>
      </defs>
      <rect x="1.5" y="1.5" width="29" height="29" rx="9" fill={fill} stroke={rim} strokeWidth="1.4" />
      <rect x="1.5" y="1.5" width="29" height="29" rx="9" fill="url(#xbMarkGlass)" opacity="0.55" />
      <rect x="1.5" y="26" width="29" height="4.5" rx="0" fill={orange} opacity="0.95" />
      <path
        d="M10 9h12.4M10 9v12.8M10 15.4h9.2M10 21.8h12.4"
        fill="none"
        stroke={ink}
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="24.2" cy="8.2" r="1.35" fill={cyan} opacity="0.9" />
    </svg>
  );
}
