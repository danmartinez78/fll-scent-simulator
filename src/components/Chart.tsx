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
}

/** A small, plain line chart (no library needed). */
export function LineChart({ xs, series, yMax, yLabel, xLabel = 'minutes', height = 150 }: Props) {
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
