"use client";

/**
 * Concept H — serious spatial bridge volume.
 * Depth layers: ferry plate + soft chart + atmospheric haze.
 */
export function AegeanBackdrop() {
  return (
    <div className="aegean-stage" aria-hidden="true">
      <div className="aegean-stage-sky" />
      <div className="aegean-stage-ferry-layer">
        <div className="aegean-stage-ferry" />
      </div>
      <div className="aegean-stage-map" />
      <div className="aegean-stage-haze" />
      <div className="aegean-stage-vignette" />
    </div>
  );
}
