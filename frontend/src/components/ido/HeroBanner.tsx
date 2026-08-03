"use client";

/**
 * The branded backdrop behind the home screen's greeting.
 *
 * An operator opens this screen more than any other, so it is where the
 * İDO identity actually needs to live -- not as a static logo in a corner,
 * but as a scene: sky, sea, a ferry underway. The waves drift and the ferry
 * bobs on a slow CSS loop ("canlı interaktif") rather than sitting frozen
 * like a screenshot.
 *
 * Drawn in code rather than embedding a photograph: a vector scene scales
 * losslessly at any width, never adds a network request, and matches the
 * palette of the real İDO mark (navy hull, white superstructure, orange
 * accent) that already ships in /brand/ido-logo.jpg -- which appears here
 * too, as the one genuine brand asset, badge-mounted on the scene it sits in
 * front of.
 */
export function IdoHeroBanner() {
  return (
    <div className="ido-hero-scene" aria-hidden="true">
      <svg
        className="ido-hero-sky"
        viewBox="0 0 400 160"
        preserveAspectRatio="none"
        focusable="false"
      >
        <defs>
          <linearGradient id="ido-hero-sky-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#0a4b68" />
            <stop offset="55%" stopColor="#0d5a7a" />
            <stop offset="100%" stopColor="#0b3a52" />
          </linearGradient>
        </defs>
        <rect width="400" height="160" fill="url(#ido-hero-sky-grad)" />
        <circle className="ido-hero-glint" cx="330" cy="34" r="46" fill="#ffffff" opacity=".07" />
      </svg>

      <svg
        className="ido-hero-ferry"
        viewBox="0 0 120 70"
        preserveAspectRatio="xMidYMid meet"
        focusable="false"
      >
        <ellipse cx="60" cy="60" rx="34" ry="4" fill="#04283b" opacity=".4" />
        {/* The hull is a distinctly lighter, bluer navy than the sky gradient
            behind it (which trends toward this same dark tone at the
            waterline) -- without that gap, and the white keel line marking
            the silhouette's edge, the whole ferry disappeared into the
            backdrop it was meant to sit in front of. */}
        <path
          d="M14 52 L20 40 L100 40 L106 52 L96 58 L24 58 Z"
          fill="#1c6688"
          stroke="#eaf6fb"
          strokeOpacity=".5"
          strokeWidth="1"
        />
        <rect x="30" y="22" width="52" height="20" rx="2" fill="#fdfefe" />
        <rect x="30" y="34" width="52" height="4" fill="#f47721" />
        <rect x="52" y="10" width="6" height="14" rx="1" fill="#c9dce3" />
        <rect x="46" y="6" width="18" height="6" rx="1.5" fill="#1c6688" />
        <rect x="34" y="27" width="8" height="6" rx="1" fill="#8fd0e8" />
        <rect x="46" y="27" width="8" height="6" rx="1" fill="#8fd0e8" />
        <rect x="58" y="27" width="8" height="6" rx="1" fill="#8fd0e8" />
        <rect x="70" y="27" width="8" height="6" rx="1" fill="#8fd0e8" />
      </svg>

      <svg
        className="ido-hero-waves"
        viewBox="0 0 400 40"
        preserveAspectRatio="none"
        focusable="false"
      >
        {/* Each wave is drawn twice, side by side, so the track can shift by
            exactly one tile width and loop with no visible seam -- a
            percentage-based transform on a bare <path> resolves against the
            element's rendered box, which varies by browser and is not worth
            the risk on something purely decorative. */}
        <g className="ido-hero-wave-track ido-hero-wave-back">
          <path
            d="M0 20 Q 25 8 50 20 T 100 20 T 150 20 T 200 20 T 250 20 T 300 20 T 350 20 T 400 20 V40 H0 Z"
            fill="#ffffff"
            opacity=".16"
          />
          <path
            transform="translate(400 0)"
            d="M0 20 Q 25 8 50 20 T 100 20 T 150 20 T 200 20 T 250 20 T 300 20 T 350 20 T 400 20 V40 H0 Z"
            fill="#ffffff"
            opacity=".16"
          />
        </g>
        <g className="ido-hero-wave-track ido-hero-wave-front">
          <path
            d="M0 26 Q 25 16 50 26 T 100 26 T 150 26 T 200 26 T 250 26 T 300 26 T 350 26 T 400 26 V40 H0 Z"
            fill="#ffffff"
            opacity=".22"
          />
          <path
            transform="translate(400 0)"
            d="M0 26 Q 25 16 50 26 T 100 26 T 150 26 T 200 26 T 250 26 T 300 26 T 350 26 T 400 26 V40 H0 Z"
            fill="#ffffff"
            opacity=".22"
          />
        </g>
      </svg>

      <span className="ido-hero-badge">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/ido-logo.jpg" alt="İDO" />
      </span>
    </div>
  );
}
