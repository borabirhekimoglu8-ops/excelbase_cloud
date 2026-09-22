"use client";

import type { CSSProperties } from "react";

import type { FieldValue } from "@/lib/passport/candidates";

function boxStyle(box: number[][] | null, width: number, height: number): CSSProperties | null {
  if (!box || box.length < 2 || !width || !height) return null;
  const xs = box.map((point) => point[0]);
  const ys = box.map((point) => point[1]);
  const left = (Math.min(...xs) / width) * 100;
  const top = (Math.min(...ys) / height) * 100;
  const boxWidth = ((Math.max(...xs) - Math.min(...xs)) / width) * 100;
  const boxHeight = ((Math.max(...ys) - Math.min(...ys)) / height) * 100;
  return { left: `${left}%`, top: `${top}%`, width: `${Math.max(boxWidth, 2)}%`, height: `${Math.max(boxHeight, 2)}%` };
}

export function PassportPageViewer({
  imageUrl,
  width,
  height,
  focus,
}: {
  imageUrl: string;
  width: number;
  height: number;
  focus: FieldValue | null;
}) {
  const highlight = focus ? boxStyle(focus.box, width, height) : null;
  return (
    <div className="xb-passport-page">
      <img src={imageUrl} alt="Kaynak pasaport sayfası" />
      {highlight ? <i className="xb-passport-hotspot" style={highlight} aria-hidden="true" /> : null}
    </div>
  );
}
