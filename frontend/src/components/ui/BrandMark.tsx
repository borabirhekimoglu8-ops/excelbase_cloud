/** Exact İDO logo from the user’s upload — never redrawn or cropped. */
export function BrandMark({
  size = 32,
  tone = "on-brand",
}: {
  size?: number;
  tone?: "on-brand" | "on-light";
}) {
  void tone;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className="ido-logo-exact"
      src="/brand/ido-logo.png"
      alt=""
      width={size}
      height={size}
      draggable={false}
      aria-hidden="true"
    />
  );
}
