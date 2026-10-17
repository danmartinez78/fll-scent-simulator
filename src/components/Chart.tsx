export interface Series {
  label: string;
  color: string;
  values: number[];
}

interface Props {
  xs: number[];
  series: Series[];
  yMax?: number;
  yLabel?: string;
  xLabel?: string;
  height?: number;
  /** A dashed vertical line at this x value, with a short label. */
  marker?: { x: number; label: string };
  /** Shaded stretches of x (for example, rain), drawn behind the lines. */
  bands?: Array<{ from: number; to: number; label?: string }>;
}

/** A small, plain line chart (no library needed). */
export function LineChart({ xs, series, yMax, yLabel, xLabel = 'minutes', height = 150, marker, bands }: Props) {
  const W = 320;
  const H = height;
  const pad = { l: 34, r: 8, t: 8, b: 24 };
  const xMax = Math.max(1, xs[xs.length - 1] ?? 1);
  const top = yMax ?? Math.max(1, ...series.flatMap((s) => s.values)) * 1.1;
  const x = (v: number) => pad.l + (v / xMax) * (W - pad.l - pad.r);
  const y = (v: number) => H - pad.b - (v / top) * (H - pad.t - pad.b);
  const ticks = [0, top / 2, top];
  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={series.map((s) => s.label).join(', ') + ' over time'}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} className="grid" />
            <text x={pad.l - 4} y={y(t) + 3} className="axis" textAnchor="end">
              {t === 0 ? 0 : t >= 10 ? Math.round(t) : t.toFixed(1)}
            </text>
          </g>
        ))}
        <text x={W - pad.r} y={H - 6} className="axis" textAnchor="end">
          {xMax.toFixed(0)} {xLabel}
        </text>
        <text x={pad.l} y={H - 6} className="axis">
          0
        </text>
        {yLabel && (
          <text x={10} y={pad.t + 4} className="axis" transform={`rotate(-90 10 ${pad.t + 4})`} textAnchor="end">
            {yLabel}
          </text>
        )}
        {bands?.filter((b) => b.from < xMax).map((b) => (
          <g key={b.from} className="band">
            <rect x={x(b.from)} y={pad.t} width={Math.max(2, x(Math.min(b.to, xMax)) - x(b.from))} height={H - pad.b - pad.t} fill="#bfdbfe" opacity={0.7} />
            {b.label && (
              <text x={x(b.from) + 1} y={H - pad.b - 3} className="axis">
                {b.label}
              </text>
            )}
          </g>
        ))}
        {marker && marker.x > 0 && marker.x <= xMax && (
          <g className="marker">
            <line x1={x(marker.x)} x2={x(marker.x)} y1={pad.t} y2={H - pad.b} stroke="#475569" strokeDasharray="4 3" />
            <text x={x(marker.x) + 3} y={pad.t + 9} className="axis">
              {marker.label}
            </text>
          </g>
        )}
        {series.map((s) =>
          s.values.length > 1 ? (
            <polyline
              key={s.label}
              fill="none"
              stroke={s.color}
              strokeWidth={2}
              strokeLinejoin="round"
              points={s.values.map((v, i) => `${x(xs[i]).toFixed(1)},${y(v).toFixed(1)}`).join(' ')}
            />
          ) : null
        )}
      </svg>
      <figcaption className="legend">
        {series.map((s) => (
          <span key={s.label}>
            <i style={{ background: s.color }} /> {s.label}
          </span>
        ))}
      </figcaption>
    </figure>
  );
}
