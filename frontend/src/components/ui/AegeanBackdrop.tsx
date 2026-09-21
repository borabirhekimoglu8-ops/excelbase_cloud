"use client";

/**
 * Full-bleed Aegean ferry stage: dusk crossing as the product's atmosphere.
 * Signature motion is the slow vessel drift — not neon HUD chrome.
 */
export function AegeanBackdrop() {
  return (
    <div className="aegean-stage" aria-hidden="true">
      <div className="aegean-stage-sky" />
      <div className="aegean-stage-sunband" />
      <div className="aegean-stage-ferry-layer">
        <div className="aegean-stage-ferry-glow" />
        <div className="aegean-stage-ferry" />
        <div className="aegean-stage-water" />
        <div className="aegean-stage-wake" />
      </div>
      <div className="aegean-stage-haze" />
      <div className="aegean-stage-vignette" />
    </div>
  );
}
