/** Excelbase mark: two stacked bars and a stem — an E that still reads at 24 px. */
export function BrandMark({
  size = 32,
  tone = "on-brand",
}: {
  size?: number;
  tone?: "on-brand" | "on-light";
}) {
  const ink = tone === "on-brand" ? "#ffffff" : "#053b52";
  const fill = tone === "on-brand" ? "#053b52" : "#e5f2f6";
  const stroke = tone === "on-brand" ? "rgba(255,255,255,.28)" : "#cdd8de";
  return (
    <svg
      className="xb-mark"
      width={size}
      height={size}
      viewBox="0 0 32 32"
      aria-hidden="true"
    >
      <rect x="1" y="1" width="30" height="30" rx="8" fill={fill} stroke={stroke} strokeWidth="1.5" />
      <path
        d="M10 9.2h12.2M10 9.2v13.6M10 16h9.4M10 22.8h12.2"
        fill="none"
        stroke={ink}
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
