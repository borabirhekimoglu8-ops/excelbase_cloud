"use client";

/**
 * Full-bleed stage built from the user's İDO Ege ferry photo + island HUD.
 * The ferry is the real visual anchor; the map and sun wash sit on top.
 */
export function AegeanBackdrop() {
  return (
    <div className="aegean-stage" aria-hidden="true">
      <div className="aegean-stage-photo aegean-stage-ferry" />
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
