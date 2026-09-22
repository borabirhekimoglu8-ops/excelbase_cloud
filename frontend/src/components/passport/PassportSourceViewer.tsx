"use client";

import type { SourceRect } from "@/lib/passport/passportTypes";

export function PassportSourceViewer({
  src,
  alt,
  rect,
  width,
  height,
}: {
  src: string;
  alt: string;
  rect?: SourceRect;
  width?: number;
  height?: number;
}) {
  const style = rect && width && height ? {
    left: `${(rect.x / width) * 100}%`,
    top: `${(rect.y / height) * 100}%`,
    width: `${(rect.width / width) * 100}%`,
    height: `${(rect.height / height) * 100}%`,
  } : undefined;

  return (
    <figure className="xb-passport-viewer">
      <div>
        {/* Source remains a local object URL or encrypted-vault URL. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={alt} />
        {style ? <span className="xb-passport-field-rect" style={style} aria-hidden="true" /> : null}
      </div>
      <figcaption>Kaynak sayfa · yalnız bu cihazdaki şifreli kasada</figcaption>
    </figure>
  );
}
