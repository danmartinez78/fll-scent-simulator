import type { Rect, SurveyResult, Vec, ViewOptions } from '../models/types';
import { AFFECTED_DAMAGE, type Simulation } from '../simulation/Simulation';
import { SURVEY_DRONE } from '../simulation/Survey';
import { deviceActive } from '../simulation/Treatment';
import { scentDrift, windDirectionAt } from '../simulation/Wind';
import { compassLabel } from '../utils/geometry';

export type SurveyLayer = 'camera' | 'estimate' | 'truth';

export interface Viewport {
  scale: number;
  ox: number;
  oy: number;
}

export interface DrawOptions {
  view: ViewOptions;
  surveyLayer: SurveyLayer;
  survey: SurveyResult | null;
  draftZone: Rect | null;
  /** Real seconds, for little animations (propellers, wind streaks). */
  clock: number;
}

export const COLORS = {
  grass: '#cfe3b0',
  grassDark: '#b9d396',
  crop: '#5fa75a',
  cropRow: '#4e9649',
  damage: [150, 105, 50] as const,
  repellent: [128, 70, 214] as const,
  attractant: [240, 150, 20] as const,
  pest: '#2b2118',
  pestAgitated: '#c2410c',
  zone: '#2563eb',
  drone: '#1f2937',
  survey: {
    healthy: 'rgba(34,197,94,0.30)',
    possible: 'rgba(250,204,21,0.55)',
    high: 'rgba(220,38,38,0.6)',
    uncertain: 'rgba(100,116,139,0.55)'
  }
};

export function computeViewport(cw: number, ch: number, w: number, h: number, pad = 10): Viewport {
  const scale = Math.min((cw - 2 * pad) / w, (ch - 2 * pad) / h);
  return { scale, ox: (cw - w * scale) / 2, oy: (ch - h * scale) / 2 };
}

export function toScreen(vp: Viewport, x: number, y: number): Vec {
  return { x: vp.ox + x * vp.scale, y: vp.oy + y * vp.scale };
}

export function toWorld(vp: Viewport, sx: number, sy: number): Vec {
  return { x: (sx - vp.ox) / vp.scale, y: (sy - vp.oy) / vp.scale };
}

// Small offscreen canvases for the grid layers (one pixel per grid square,
// then stretched with smoothing so the scent looks soft).
const layerCache = new Map<string, HTMLCanvasElement>();
function layerCanvas(key: string, w: number, h: number): HTMLCanvasElement {
  let c = layerCache.get(key);
  if (!c || c.width !== w || c.height !== h) {
    c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    layerCache.set(key, c);
  }
  return c;
}

// Floating streaks that show which way the wind blows.
interface Streak {
  x: number;
  y: number;
  age: number;
}
let streaks: Streak[] = [];
let lastClock = 0;

export function drawScene(ctx: CanvasRenderingContext2D, sim: Simulation, o: DrawOptions, vp: Viewport): void {
  const { width: W, height: H } = sim.settings.field;
  const s = vp.scale;
  const cw = ctx.canvas.width / (window.devicePixelRatio || 1);
  const ch = ctx.canvas.height / (window.devicePixelRatio || 1);
  ctx.clearRect(0, 0, cw, ch);

  ctx.save();
  ctx.translate(vp.ox, vp.oy);
  ctx.scale(s, s);

  // Ground: grass border with a soft pattern, then crop rows.
  ctx.fillStyle = COLORS.grass;
  ctx.fillRect(0, 0, W, H);
  const crop = sim.crop;
  ctx.fillStyle = COLORS.crop;
  ctx.fillRect(crop.x, crop.y, crop.w, crop.h);
  ctx.strokeStyle = COLORS.cropRow;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  for (let y = crop.y + 2; y < crop.y + crop.h; y += 4) {
    ctx.moveTo(crop.x, y);
    ctx.lineTo(crop.x + crop.w, y);
  }
  ctx.stroke();

  const field = sim.repellent;
  // Crop damage (brown)
  if (o.view.showDamage) {
    const c = layerCanvas('damage', field.cols, field.rows);
    const g = c.getContext('2d')!;
    const img = g.createImageData(field.cols, field.rows);
    const [r, gg, b] = COLORS.damage;
    for (let i = 0; i < sim.damage.length; i++) {
      if (!sim.cropMask[i]) continue;
      const level = Math.min(1, sim.damage[i] / AFFECTED_DAMAGE);
      img.data[i * 4] = r;
      img.data[i * 4 + 1] = gg;
      img.data[i * 4 + 2] = b;
      img.data[i * 4 + 3] = Math.round(level * level * 200);
    }
    g.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.save();
    ctx.beginPath();
    ctx.rect(crop.x, crop.y, crop.w, crop.h);
    ctx.clip();
    ctx.drawImage(c, 0, 0, field.cols * field.cell, field.rows * field.cell);
    ctx.restore();
  }

  // Scent clouds
  if (o.view.showScent) {
    const th = sim.settings.scent.threshold;
    for (const [key, f, color] of [
      ['rep', sim.repellent, COLORS.repellent],
      ['att', sim.attractant, COLORS.attractant]
    ] as const) {
      const c = layerCanvas(key, f.cols, f.rows);
      const g = c.getContext('2d')!;
      const img = g.createImageData(f.cols, f.rows);
      let any = false;
      for (let i = 0; i < f.data.length; i++) {
        const v = f.data[i];
        if (v <= th * 0.05) continue;
        any = true;
        const a = v < th ? 0.05 + (v / th) * 0.35 : 0.45 + Math.min(1, (v - th) / (th * 5)) * 0.4;
        img.data[i * 4] = color[0];
        img.data[i * 4 + 1] = color[1];
        img.data[i * 4 + 2] = color[2];
        img.data[i * 4 + 3] = Math.round(a * 255);
      }
      if (!any) continue;
      g.putImageData(img, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(c, 0, 0, f.cols * f.cell, f.rows * f.cell);
    }
  }

  // Survey map
  if (o.view.showSurvey && o.survey) drawSurvey(ctx, o.survey, o.surveyLayer);

  // Planned spray zones
  ctx.lineWidth = 1.5 / s;
  for (const z of sim.effectivePlan.sprayZones) {
    ctx.fillStyle = 'rgba(37,99,235,0.08)';
    ctx.fillRect(z.x, z.y, z.w, z.h);
    ctx.setLineDash([6 / s, 4 / s]);
    ctx.strokeStyle = COLORS.zone;
    ctx.strokeRect(z.x, z.y, z.w, z.h);
  }
  ctx.setLineDash([]);
  if (o.draftZone) {
    const z = o.draftZone;
    ctx.fillStyle = 'rgba(37,99,235,0.18)';
    ctx.fillRect(z.x, z.y, z.w, z.h);
    ctx.strokeStyle = COLORS.zone;
    ctx.strokeRect(z.x, z.y, z.w, z.h);
  }

  // Drone path: what's left to fly, and where it has been.
  const d = sim.drone;
  if (o.view.showPath) {
    if (d.trail.length > 1) {
      ctx.strokeStyle = 'rgba(30,41,59,0.25)';
      ctx.lineWidth = 1.2 / s;
      ctx.beginPath();
      ctx.moveTo(d.trail[0].x, d.trail[0].y);
      for (const p of d.trail) ctx.lineTo(p.x, p.y);
      ctx.lineTo(d.x, d.y);
      ctx.stroke();
    }
    if (d.tasks.length) {
      ctx.strokeStyle = 'rgba(37,99,235,0.55)';
      ctx.setLineDash([3 / s, 3 / s]);
      ctx.lineWidth = 1.2 / s;
      ctx.beginPath();
      ctx.moveTo(d.x, d.y);
      for (const t of d.tasks) {
        if (t.kind === 'spray') {
          ctx.lineTo(t.from.x, t.from.y);
          ctx.lineTo(t.to.x, t.to.y);
        } else ctx.lineTo(t.at.x, t.at.y);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  // Home pad
  ctx.fillStyle = '#f8fafc';
  ctx.strokeStyle = '#334155';
  ctx.lineWidth = 1 / s;
  const pr = Math.max(3.5, 9 / s);
  ctx.beginPath();
  ctx.arc(sim.home.x, sim.home.y, pr, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#334155';
  ctx.font = `bold ${pr * 1.2}px system-ui`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('H', sim.home.x, sim.home.y + pr * 0.05);

  // Devices
  const lifetime = sim.settings.devices.lifetimeMin;
  for (const dev of sim.devices) {
    const active = deviceActive(dev, sim.time, lifetime);
    const waiting = dev.activatedAt === null;
    const col = dev.kind === 'repellent' ? COLORS.repellent : COLORS.attractant;
    const r = Math.max(2.2, 7 / s);
    ctx.globalAlpha = waiting ? 0.55 : active ? 1 : 0.35;
    ctx.fillStyle = waiting ? '#ffffff' : `rgb(${col[0]},${col[1]},${col[2]})`;
    ctx.strokeStyle = `rgb(${col[0] * 0.6},${col[1] * 0.6},${col[2] * 0.6})`;
    ctx.lineWidth = 1.5 / s;
    if (waiting) ctx.setLineDash([2 / s, 2 / s]);
    ctx.beginPath();
    ctx.arc(dev.x, dev.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.setLineDash([]);
    if (dev.trap) {
      ctx.beginPath();
      ctx.arc(dev.x, dev.y, r * 1.6, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.fillStyle = waiting ? ctx.strokeStyle : '#fff';
    ctx.font = `bold ${r * 1.2}px system-ui`;
    ctx.fillText(dev.kind === 'repellent' ? 'R' : 'A', dev.x, dev.y + r * 0.05);
    ctx.globalAlpha = 1;
  }

  // Pests
  if (o.view.showPests) {
    const p = sim.pests;
    const pr2 = Math.max(0.55, 1.6 / s);
    ctx.fillStyle = COLORS.pest;
    ctx.beginPath();
    for (let i = 0; i < p.n; i++) {
      if (p.trapped[i] || p.repelled[i]) continue;
      ctx.moveTo(p.x[i] + pr2, p.y[i]);
      ctx.arc(p.x[i], p.y[i], pr2, 0, Math.PI * 2);
    }
    ctx.fill();
    ctx.fillStyle = COLORS.pestAgitated;
    ctx.beginPath();
    for (let i = 0; i < p.n; i++) {
      if (p.trapped[i] || !p.repelled[i]) continue;
      ctx.moveTo(p.x[i] + pr2, p.y[i]);
      ctx.arc(p.x[i], p.y[i], pr2, 0, Math.PI * 2);
    }
    ctx.fill();
  }

  // Survey drone and its camera footprint
  if (sim.survey && !sim.survey.done) {
    const sv = sim.survey;
    const half = SURVEY_DRONE.swathM / 2;
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = 1 / s;
    ctx.fillRect(sv.x - half, sv.y - half, half * 2, half * 2);
    ctx.strokeRect(sv.x - half, sv.y - half, half * 2, half * 2);
    drawDroneIcon(ctx, sv.x, sv.y, 0, Math.max(3, 9 / s), '#0e7490', o.clock);
  }

  // Spray drone
  if (d.spraying) {
    ctx.fillStyle = 'rgba(147,197,253,0.45)';
    ctx.beginPath();
    ctx.arc(d.x, d.y, d.settings.swathM / 2, 0, Math.PI * 2);
    ctx.fill();
  }
  if (sim.settings.treatment !== 'none' || d.mode !== 'parked') drawDroneIcon(ctx, d.x, d.y, d.heading, Math.max(3.5, 11 / s), COLORS.drone, o.clock);

  // Wind streaks
  drawWindStreaks(ctx, sim, o.clock, s);

  ctx.restore();

  drawCompass(ctx, sim, cw);
  drawScaleBar(ctx, vp, ch);
}

function drawSurvey(ctx: CanvasRenderingContext2D, sv: SurveyResult, layer: SurveyLayer): void {
  const cs = sv.cellSize;
  let max = 1;
  const values = layer === 'truth' ? sv.truth : sv.estimate;
  for (const v of values) max = Math.max(max, v);
  for (let r = 0; r < sv.rows; r++) {
    for (let c = 0; c < sv.cols; c++) {
      const i = r * sv.cols + c;
      const x = c * cs;
      const y = r * cs;
      if (layer === 'camera') {
        const cat = sv.category[i];
        if (cat === 'none') continue;
        ctx.fillStyle = COLORS.survey[cat];
        ctx.fillRect(x + 0.4, y + 0.4, cs - 0.8, cs - 0.8);
        if (cat === 'uncertain') {
          ctx.strokeStyle = 'rgba(255,255,255,0.7)';
          ctx.lineWidth = 0.6;
          ctx.beginPath();
          ctx.moveTo(x + 2, y + cs - 2);
          ctx.lineTo(x + cs - 2, y + 2);
          ctx.stroke();
        }
      } else {
        const v = values[i];
        if (v <= 0) continue;
        const t = Math.min(1, v / max);
        ctx.fillStyle = `rgba(${Math.round(250 - 30 * t)},${Math.round(200 - 170 * t)},${Math.round(60 - 30 * t)},${0.25 + 0.55 * t})`;
        ctx.fillRect(x + 0.4, y + 0.4, cs - 0.8, cs - 0.8);
      }
    }
  }
}

function drawDroneIcon(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  heading: number,
  size: number,
  color: string,
  clock: number
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(heading + Math.PI / 4);
  ctx.strokeStyle = color;
  ctx.lineWidth = size * 0.18;
  ctx.beginPath();
  ctx.moveTo(-size, -size);
  ctx.lineTo(size, size);
  ctx.moveTo(size, -size);
  ctx.lineTo(-size, size);
  ctx.stroke();
  for (const [px, py] of [
    [-size, -size],
    [size, -size],
    [size, size],
    [-size, size]
  ]) {
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.beginPath();
    ctx.arc(px, py, size * 0.55, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = size * 0.08;
    ctx.beginPath();
    const a = clock * 30;
    ctx.moveTo(px + Math.cos(a) * size * 0.5, py + Math.sin(a) * size * 0.5);
    ctx.lineTo(px - Math.cos(a) * size * 0.5, py - Math.sin(a) * size * 0.5);
    ctx.stroke();
  }
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(0, 0, size * 0.45, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawWindStreaks(ctx: CanvasRenderingContext2D, sim: Simulation, clock: number, s: number): void {
  const w = sim.settings.wind;
  const { width: W, height: H } = sim.settings.field;
  const dtReal = Math.min(0.1, Math.max(0, clock - lastClock));
  lastClock = clock;
  if (w.speedMph <= 0.1) {
    streaks = [];
    return;
  }
  const v = scentDrift(w, sim.time);
  const speed = Math.hypot(v.x, v.y);
  const target = Math.round(Math.min(70, 15 + w.speedMph * 3));
  while (streaks.length < target) streaks.push({ x: Math.random() * W, y: Math.random() * H, age: Math.random() * 3 });
  if (streaks.length > target) streaks.length = target;
  const visualSpeed = 8 + speed * 10;
  const ux = v.x / (speed || 1);
  const uy = v.y / (speed || 1);
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.lineWidth = 1.3 / s;
  ctx.beginPath();
  for (const st of streaks) {
    st.x += ux * visualSpeed * dtReal;
    st.y += uy * visualSpeed * dtReal;
    st.age += dtReal;
    if (st.age > 3 || st.x < -5 || st.y < -5 || st.x > W + 5 || st.y > H + 5) {
      st.x = Math.random() * W;
      st.y = Math.random() * H;
      st.age = 0;
    }
    const len = 4 + w.speedMph * 0.6;
    ctx.moveTo(st.x, st.y);
    ctx.lineTo(st.x - ux * len, st.y - uy * len);
  }
  ctx.stroke();
}

function drawCompass(ctx: CanvasRenderingContext2D, sim: Simulation, cw: number): void {
  const w = sim.settings.wind;
  const r = 30;
  const cx = cw - r - 14;
  const cy = r + 14;
  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.strokeStyle = '#94a3b8';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#64748b';
  ctx.font = 'bold 10px system-ui';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('N', cx, cy - r + 8);
  ctx.fillText('S', cx, cy + r - 8);
  ctx.fillText('E', cx + r - 8, cy);
  ctx.fillText('W', cx - r + 8, cy);
  if (w.speedMph > 0.1) {
    const dir = (windDirectionAt(w, sim.time) * Math.PI) / 180;
    const ux = Math.sin(dir);
    const uy = -Math.cos(dir);
    ctx.strokeStyle = '#0369a1';
    ctx.fillStyle = '#0369a1';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cx - ux * (r - 14), cy - uy * (r - 14));
    ctx.lineTo(cx + ux * (r - 16), cy + uy * (r - 16));
    ctx.stroke();
    ctx.beginPath();
    const tx = cx + ux * (r - 10);
    const ty = cy + uy * (r - 10);
    ctx.moveTo(tx, ty);
    ctx.lineTo(tx - ux * 9 - uy * 6, ty - uy * 9 + ux * 6);
    ctx.lineTo(tx - ux * 9 + uy * 6, ty - uy * 9 - ux * 6);
    ctx.fill();
  }
  ctx.fillStyle = '#0f172a';
  ctx.font = 'bold 12px system-ui';
  const label =
    w.speedMph > 0.1 ? `${Math.round(w.speedMph)} mph → ${compassLabel(windDirectionAt(w, sim.time))}` : 'No wind';
  ctx.fillText(label, cx, cy + r + 12);
  ctx.restore();
}

function drawScaleBar(ctx: CanvasRenderingContext2D, vp: Viewport, ch: number): void {
  const options = [10, 20, 25, 50, 100, 200];
  const meters = options.find((m) => m * vp.scale >= 60) ?? 200;
  const px = meters * vp.scale;
  const x = 14;
  const y = ch - 14;
  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fillRect(x - 6, y - 18, px + 12, 24);
  ctx.strokeStyle = '#0f172a';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x, y - 4);
  ctx.lineTo(x, y);
  ctx.lineTo(x + px, y);
  ctx.lineTo(x + px, y - 4);
  ctx.stroke();
  ctx.fillStyle = '#0f172a';
  ctx.font = '11px system-ui';
  ctx.textAlign = 'center';
  ctx.fillText(`${meters} m`, x + px / 2, y - 8);
  ctx.restore();
}
