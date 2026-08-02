"use client";

import { useId } from "react";

/**
 * Holographic charts, drawn as inline SVG.
 *
 * No chart library: this app is offline-first and serves a strict static
 * bundle, so a runtime CDN is not available and a heavy dependency would be
 * carried by every phone that opens the vault. These three shapes cover what
 * the statistics pages actually ask -- a share of a whole, a ranking, and a
 * movement over time.
 *
 * Gradient and filter ids are generated per instance. Two charts on one page
 * with the same id would silently share a definition, and the second one would
 * be painted with the first one's colours.
 */

/** The iridescent sweep used for strokes and gradients. */
const HOLO_STOPS = ["#00e5ff", "#4f8cff", "#b06cff", "#ff5ea8"] as const;

/**
 * Distinct colours for slices, wider than the gradient sweep.
 *
 * With only the four gradient stops, a seven-slice ring gave two slices the
 * same colour and the legend could not be matched back to the ring. Eight
 * hues cover the largest ring actually drawn (six values plus "Diğer").
 */
const SLICE_COLORS = [
  "#00e5ff",
  "#4f8cff",
  "#b06cff",
  "#ff5ea8",
  "#ffb547",
  "#2ee6a8",
  "#7c5cff",
  "#ff8a5c",
] as const;

/** A stable colour per slice, so a value keeps its colour as data changes. */
export function holoColor(index: number): string {
  return SLICE_COLORS[index % SLICE_COLORS.length];
}

function Defs({ id }: { id: string }) {
  return (
    <defs>
      <linearGradient id={`${id}-stroke`} x1="0" y1="0" x2="1" y2="1">
        {HOLO_STOPS.map((stop, index) => (
          <stop key={stop} offset={index / (HOLO_STOPS.length - 1)} stopColor={stop} />
        ))}
      </linearGradient>
      <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#4f8cff" stopOpacity="0.45" />
        <stop offset="1" stopColor="#4f8cff" stopOpacity="0" />
      </linearGradient>
      <filter id={`${id}-glow`} x="-30%" y="-30%" width="160%" height="160%">
        <feGaussianBlur stdDeviation="2.4" result="blur" />
        <feMerge>
          <feMergeNode in="blur" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
    </defs>
  );
}

export type HoloSlice = { label: string; value: number };

/**
 * A ring showing how a whole divides.
 *
 * Slices below a visible angle are folded into "Diğer" rather than drawn as
 * hairlines that cannot be pointed at or read.
 */
export function HoloDonut({
  slices,
  total,
  centreLabel,
  centreValue,
}: {
  slices: HoloSlice[];
  total: number;
  centreLabel: string;
  centreValue: string;
}) {
  const id = useId().replace(/:/g, "");
  const size = 168;
  const radius = 62;
  const stroke = 20;
  const circumference = 2 * Math.PI * radius;

  if (total <= 0 || slices.length === 0) {
    return <p className="ic-holo-empty">Grafik için yeterli veri yok.</p>;
  }

  let offset = 0;
  const drawn = slices.map((slice, index) => {
    const share = slice.value / total;
    const length = Math.max(0, share * circumference);
    const segment = {
      key: `${slice.label}-${index}`,
      label: slice.label,
      color: holoColor(index),
      dash: `${length} ${circumference - length}`,
      offset: -offset,
      share,
    };
    offset += length;
    return segment;
  });

  return (
    <div className="ic-holo-donut">
      <svg viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${centreLabel}: ${centreValue}`}>
        <Defs id={id} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="rgba(120,160,190,.18)"
          strokeWidth={stroke}
        />
        <g transform={`rotate(-90 ${size / 2} ${size / 2})`} filter={`url(#${id}-glow)`}>
          {drawn.map((segment) => (
            <circle
              key={segment.key}
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke={segment.color}
              strokeWidth={stroke}
              strokeDasharray={segment.dash}
              strokeDashoffset={segment.offset}
              strokeLinecap="butt"
            >
              <title>{`${segment.label} · %${(segment.share * 100).toFixed(1)}`}</title>
            </circle>
          ))}
        </g>
        <text x={size / 2} y={size / 2 - 4} className="ic-holo-centre-value">{centreValue}</text>
        <text x={size / 2} y={size / 2 + 14} className="ic-holo-centre-label">{centreLabel}</text>
      </svg>
      <ul className="ic-holo-legend">
        {drawn.map((segment) => (
          <li key={segment.key}>
            <i style={{ background: segment.color }} aria-hidden="true" />
            <span>{segment.label}</span>
            <b>%{(segment.share * 100).toFixed(1)}</b>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A ranked bar chart; the caller decides the order. */
export function HoloBars({
  entries,
  formatValue,
}: {
  entries: HoloSlice[];
  formatValue: (value: number) => string;
}) {
  const id = useId().replace(/:/g, "");
  const peak = entries.reduce((highest, entry) => Math.max(highest, entry.value), 0);

  if (entries.length === 0) return <p className="ic-holo-empty">Grafik için yeterli veri yok.</p>;

  return (
    <div className="ic-holo-bars">
      <svg width="0" height="0" aria-hidden="true"><Defs id={id} /></svg>
      {entries.map((entry, index) => (
        <div key={`${entry.label}-${index}`}>
          <span title={entry.label}>{entry.label}</span>
          <div className="ic-holo-track">
            <i
              style={{
                // A zero-width bar looks like a rendering fault; a hairline
                // reads as "present but small", which is the truth.
                width: `${peak > 0 ? Math.max(1.5, (entry.value / peak) * 100) : 1.5}%`,
                background: `linear-gradient(90deg, ${holoColor(index)}, ${holoColor(index + 1)})`,
              }}
            />
          </div>
          <b>{formatValue(entry.value)}</b>
        </div>
      ))}
    </div>
  );
}

export type HoloPoint = { label: string; value: number };

/** A movement over ordered points, as a glowing line over a soft area. */
export function HoloTrend({
  points,
  formatValue,
}: {
  points: HoloPoint[];
  formatValue: (value: number) => string;
}) {
  const id = useId().replace(/:/g, "");
  const width = 320;
  const height = 120;
  const padding = { top: 12, right: 8, bottom: 20, left: 8 };

  if (points.length < 2) {
    return <p className="ic-holo-empty">Eğilim için en az iki gün gerekiyor.</p>;
  }

  const peak = points.reduce((highest, point) => Math.max(highest, point.value), 0);
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;
  const x = (index: number) => padding.left + (index / (points.length - 1)) * innerWidth;
  // A flat series at zero would otherwise divide by zero and vanish.
  const y = (value: number) => padding.top + innerHeight - (peak > 0 ? (value / peak) * innerHeight : 0);

  const line = points.map((point, index) => `${index === 0 ? "M" : "L"}${x(index)},${y(point.value)}`).join(" ");
  const area = `${line} L${x(points.length - 1)},${padding.top + innerHeight} L${x(0)},${padding.top + innerHeight} Z`;

  return (
    <div className="ic-holo-trend">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Günlük eğilim">
        <Defs id={id} />
        <path d={area} fill={`url(#${id}-fill)`} />
        <path
          d={line}
          fill="none"
          stroke={`url(#${id}-stroke)`}
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          filter={`url(#${id}-glow)`}
        />
        {points.map((point, index) => (
          <circle key={`${point.label}-${index}`} cx={x(index)} cy={y(point.value)} r="3" fill="#fff" stroke={holoColor(index)} strokeWidth="2">
            <title>{`${point.label}: ${formatValue(point.value)}`}</title>
          </circle>
        ))}
      </svg>
      <div className="ic-holo-axis">
        <span>{points[0].label}</span>
        <span>{points[points.length - 1].label}</span>
      </div>
    </div>
  );
}
