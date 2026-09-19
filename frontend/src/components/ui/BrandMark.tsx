/** Header mark: dolphin + sun, no wordmark, no speed lines — blends into glass header. */
export function BrandMark({
  size = 32,
  tone = "on-brand",
}: {
  size?: number;
  tone?: "on-brand" | "on-light";
}) {
  void tone;
  return (
    <span className="xb-mark-wrap" style={{ width: size, height: size }} aria-hidden="true">
      <svg
        className="xb-mark"
        width={size}
        height={size}
        viewBox="0 0 64 56"
        aria-hidden="true"
      >
        <circle cx="34" cy="28" r="22" fill="#f47721" />
        <path
          d="M12 36c8-14 18-20 30-18 3.5.5 7 2 10 4-9 1.5-16 7-20 15-2.5 5-3.5 9-3.5 13-7-2.5-12.5-7.5-16.5-14z"
          fill="#053b52"
        />
        <path
          d="M16 40c8-10 18-14 28-12 3 .5 6 1.5 8.5 3-8 1.5-14 6-18 12.5-2.2 3.5-3 7-3 10-6-2-11-6.5-15.5-13.5z"
          fill="#4aa8d8"
        />
      </svg>
    </span>
  );
}
