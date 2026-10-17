import type { RunCharts } from './notebook';
import { dayName, EVENT_STYLE, isEventKind, MAX_LISTED_EVENTS, type ChartEvent } from '../utils/chartEvents';

function escText(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** One line on a report chart. */
interface Line {
  label: string;
  color: string;
  values: number[];
  /** Its own x values, when lines on one chart come from different runs. */
  xs?: number[];
}

interface ChartSpec {
  title: string;
  xs: number[];
  lines: Line[];
  yMax?: number;
  yLabel: string;
  marker?: number;
  rains?: Array<[number, number]>;
  events?: ChartEvent[];
  /** Last x to show (so charts of different runs share a scale). */
  xMax?: number;
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function numbers(v: unknown, length: number): number[] | null {
  if (!Array.isArray(v) || v.length !== length) return null;
  const out = v.map(num);
  return out.every((x) => x !== null) ? (out as number[]) : null;
}

/** Saved charts checked number by number, since a notebook can come from an imported file. */
export function safeCharts(c: unknown): RunCharts | null {
  if (!c || typeof c !== 'object') return null;
  const r = c as Record<string, unknown>;
  const days = Array.isArray(r.days) ? numbers(r.days, r.days.length) : null;
  if (!days || days.length < 2) return null;
  const keys = ['arrived', 'feeding', 'crop', 'helpers', 'killed', 'scent', 'product'] as const;
  const lines = {} as Record<(typeof keys)[number], number[]>;
  for (const k of keys) {
    const v = numbers(r[k], days.length);
    if (!v) return null;
    lines[k] = v;
  }
  const rains = Array.isArray(r.rains)
    ? r.rains.filter((x): x is [number, number] => Array.isArray(x) && num(x[0]) !== null && num(x[1]) !== null).map(([a, b]) => [a, b] as [number, number])
    : [];
  const events: ChartEvent[] = Array.isArray(r.events)
    ? r.events.flatMap((e) => {
        const o = e as Record<string, unknown> | null;
        const day = num(o?.day);
        return o && day !== null && isEventKind(o.kind) && typeof o.label === 'string' ? [{ day, kind: o.kind, label: o.label.slice(0, 60) }] : [];
      })
    : [];
  return { days, ...lines, treatStartDay: num(r.treatStartDay) ?? 0, rains, events };
}

function tick(t: number): string {
  return t === 0 ? '0' : t >= 10 ? String(Math.round(t)) : t.toFixed(1);
}

/** A small line chart as SVG text, drawn like the Results charts in the app. */
function svgChart(c: ChartSpec): string {
  const W = 420;
  const H = 170;
  const pad = { l: 34, r: 8, t: 10, b: 22 };
  const xMax = Math.max(0.01, c.xMax ?? c.xs[c.xs.length - 1] ?? 1);
  const top = c.yMax ?? Math.max(1, ...c.lines.flatMap((l) => l.values)) * 1.1;
  const x = (v: number) => pad.l + (Math.min(v, xMax) / xMax) * (W - pad.l - pad.r);
  const y = (v: number) => H - pad.b - (v / top) * (H - pad.t - pad.b);
  const parts: string[] = [];
  for (const t of [0, top / 2, top]) {
    parts.push(`<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(t).toFixed(1)}" y2="${y(t).toFixed(1)}" class="grid"/>`);
    parts.push(`<text x="${pad.l - 4}" y="${(y(t) + 3).toFixed(1)}" text-anchor="end">${tick(t)}</text>`);
  }
  parts.push(`<text x="${pad.l}" y="${H - 6}">Day 0</text>`);
  parts.push(`<text x="${W - pad.r}" y="${H - 6}" text-anchor="end">${xMax < 10 ? xMax.toFixed(1) : Math.round(xMax)} days</text>`);
  parts.push(`<text x="10" y="${pad.t + 4}" text-anchor="end" transform="rotate(-90 10 ${pad.t + 4})">${c.yLabel}</text>`);
  for (const [from, to] of c.rains ?? []) {
    if (from >= xMax) continue;
    const w = Math.max(2, x(to) - x(from));
    parts.push(`<rect x="${x(from).toFixed(1)}" y="${pad.t}" width="${w.toFixed(1)}" height="${H - pad.b - pad.t}" class="rain"/>`);
  }
  if (c.marker && c.marker > 0 && c.marker <= xMax) {
    const mx = x(c.marker).toFixed(1);
    parts.push(`<line x1="${mx}" x2="${mx}" y1="${pad.t}" y2="${H - pad.b}" class="marker"/>`);
    // Below the event icons, which sit along the top.
    parts.push(`<text x="${(x(c.marker) + 3).toFixed(1)}" y="${pad.t + 20}">treatment starts</text>`);
  }
  const events = (c.events ?? []).filter((e) => e.day >= 0 && e.day <= xMax);
  for (const e of events) {
    const ex = x(e.day).toFixed(1);
    const st = EVENT_STYLE[e.kind];
    parts.push(`<line x1="${ex}" x2="${ex}" y1="${pad.t + 10}" y2="${H - pad.b}" stroke="${st.color}" stroke-width="1.2" stroke-dasharray="2 2"/>`);
    parts.push(`<text x="${ex}" y="${pad.t + 8}" text-anchor="middle">${st.icon}</text>`);
  }
  for (const l of c.lines) {
    const xs = l.xs ?? c.xs;
    const pts = l.values.map((v, i) => `${x(xs[i]).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    parts.push(`<polyline fill="none" stroke="${l.color}" stroke-width="2" stroke-linejoin="round" points="${pts}"/>`);
  }
  const legend = c.lines.map((l) => `<span><i style="background:${l.color}"></i>${l.label}</span>`).join('');
  const rainNote = c.rains?.some(([from]) => from < xMax) ? '<span><i class="rain-key"></i>Rain</span>' : '';
  const eventList = events.length
    ? `<ul class="events">${events
        .slice(0, MAX_LISTED_EVENTS)
        .map((e) => `<li>${EVENT_STYLE[e.kind].icon} ${dayName(e.day)}: ${escText(e.label)}</li>`)
        .join('')}${events.length > MAX_LISTED_EVENTS ? `<li>and ${events.length - MAX_LISTED_EVENTS} more</li>` : ''}</ul>`
    : '';
  return `<figure class="chart"><figcaption>${c.title}</figcaption><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${c.title}">${parts.join('')}</svg><div class="legend">${legend}${rainNote}</div>${eventList}</figure>`;
}

/** The four Results charts for one run, as a 2 by 2 grid. */
export function runChartsHtml(raw: unknown): string {
  const c = safeCharts(raw);
  if (!c) return '';
  const common = { xs: c.days, rains: c.rains, marker: c.treatStartDay, events: c.events };
  return `<div class="charts">${[
    svgChart({
      ...common,
      title: 'Pests and crop',
      yMax: 100,
      yLabel: '%',
      lines: [
        { label: 'Pests that have arrived', color: '#94a3b8', values: c.arrived },
        { label: 'Pests eating the crop', color: '#b45309', values: c.feeding },
        { label: 'Crop damaged', color: '#7c2d12', values: c.crop }
      ]
    }),
    svgChart({
      ...common,
      title: 'Insects',
      yMax: 100,
      yLabel: '%',
      lines: [
        { label: 'Helpful insects alive', color: '#ca8a04', values: c.helpers },
        { label: 'Pests killed by people', color: '#111827', values: c.killed }
      ]
    }),
    svgChart({ ...common, title: 'Scent', yMax: 100, yLabel: '%', lines: [{ label: 'Crop with noticeable repellent', color: '#7c3aed', values: c.scent }] }),
    svgChart({ ...common, title: 'Product used', yLabel: 'gal', lines: [{ label: 'Product used (gal)', color: '#2563eb', values: c.product }] })
  ].join('')}</div>`;
}

/** Colors that stay apart from each other in print (one per experiment). */
const RUN_COLORS = ['#2563eb', '#dc2626', '#16a34a', '#9333ea', '#ea580c', '#0891b2', '#be185d', '#4d7c0f'];

/** Crop damage for every run on one chart, for the overview (needs at least two runs with charts). */
export function compareChartHtml(runs: Array<{ name: string; charts: unknown }>, esc: (s: string) => string): string {
  const ok = runs.map((r) => ({ name: r.name, c: safeCharts(r.charts) })).filter((r): r is { name: string; c: RunCharts } => r.c !== null);
  if (ok.length < 2) return '';
  const xMax = Math.max(...ok.map((r) => r.c.days[r.c.days.length - 1]));
  const lines = ok.slice(0, RUN_COLORS.length).map((r, i) => ({ label: esc(r.name), color: RUN_COLORS[i], xs: r.c.days, values: r.c.crop }));
  return `<div class="compare-chart">${svgChart({ title: 'Crop damaged in each experiment', xs: [0, xMax], lines, yMax: 100, yLabel: '%', xMax })}</div>`;
}
