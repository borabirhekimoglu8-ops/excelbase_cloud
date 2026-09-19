"use client";

/**
 * Full-bleed holographic Aegean stage: photographic night sea + vector island HUD.
 * Fixed behind the app shell so every screen inherits the same cinematic plane.
 */
export function AegeanBackdrop() {
  return (
    <div className="aegean-stage" aria-hidden="true">
      <div className="aegean-stage-photo" />
      <div className="aegean-stage-wash" />
      <img
        className="aegean-stage-map"
        src="/brand/aegean-map.svg"
        alt=""
        draggable={false}
      />
      <div className="aegean-stage-scan" />
      <div className="aegean-stage-vignette" />
      <div className="aegean-stage-sun" />
    </div>
  );
}
