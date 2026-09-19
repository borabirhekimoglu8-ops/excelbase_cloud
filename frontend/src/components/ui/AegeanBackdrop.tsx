"use client";

/**
 * Living ferry stage: the vessel drifts in atmosphere — not a flat wallpaper.
 * No map lines, no ship name overlays.
 */
export function AegeanBackdrop() {
  return (
    <div className="aegean-stage" aria-hidden="true">
      <div className="aegean-stage-sky" />
      <div className="aegean-stage-ferry-layer">
        <div className="aegean-stage-ferry-glow" />
        <div className="aegean-stage-ferry" />
        <div className="aegean-stage-water" />
      </div>
      <div className="aegean-stage-haze" />
      <div className="aegean-stage-vignette" />
    </div>
  );
}
