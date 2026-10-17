import type { Rect, SurveyResult, Vec, ViewOptions } from '../models/types';
import { AFFECTED_DAMAGE, type Simulation } from '../simulation/Simulation';
import { SURVEY_DRONE } from '../simulation/Survey';
import { deviceActive, deviceReachM } from '../simulation/Treatment';
import { BEE, LADYBUG } from '../simulation/Helpers';
import { FATE_POISONED } from '../simulation/Pest';
import { PESTICIDE_RULES } from '../simulation/Pesticide';
import { scentDrift, windDirectionAt } from '../simulation/Wind';
import { compassLabel } from '../utils/geometry';
import { usesGroomba } from '../simulation/Groomba';

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
  /** Pesticide on the plants: a bright warning yellow that stands out on the green crop. */
  pesticide: [234, 214, 0] as const,
  bee: '#facc15',
  ladybug: '#dc2626',
  /** Marks where an insect was killed. */
  dead: '#111827',
  pest: '#2b2118',
  // Light orange, so a pest being pushed away never looks like a red ladybug.
  pestAgitated: '#fb923c',
  /** Pests that ignore scent (shown only when a treatment is in use). */
  pestIgnores: '#1d4ed8',
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
    const scentTh = sim.settings.scent.threshold;
    for (const [key, f, color, th] of [
      ['rep', sim.repellent, COLORS.repellent, scentTh],
      ['att', sim.attractant, COLORS.attractant, scentTh],
      ['pst', sim.pesticide, COLORS.pesticide, PESTICIDE_RULES.lethal]
    ] as const) {
      if (f.empty) continue;
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
  const groomba = usesGroomba(sim.settings);
  if (o.view.showPath) {
    if (groomba && d.trail.length > 1) drawWheelTracks(ctx, [...d.trail, { x: d.x, y: d.y }], s);
    else if (d.trail.length > 1) {
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

  // How far each device's scent reaches in still air (its effective range),
  // so students can see gaps and overlaps while they plan.
  ctx.lineWidth = 1.2 / s;
  ctx.setLineDash([4 / s, 3 / s]);
  for (const dev of sim.devices) {
    const reach = deviceReachM(dev.kind, sim.settings);
    const col = dev.kind === 'repellent' ? COLORS.repellent : COLORS.attractant;
    ctx.strokeStyle = `rgba(${col[0] * 0.7},${col[1] * 0.7},${col[2] * 0.7},0.7)`;
    ctx.fillStyle = `rgba(${col[0]},${col[1]},${col[2]},0.06)`;
    ctx.beginPath();
    ctx.arc(dev.x, dev.y, reach, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.setLineDash([]);

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

  // Insects. Tapping a group in the map key fades the other group.
  const spot = o.view.spotlight ?? null;
  // Helpful insects: bees and ladybugs, and a small × where one was killed.
  ctx.globalAlpha = spot === 'pests' ? FADED : 1;
  drawHelpers(ctx, sim, s);

  // Pests: small bugs with two feelers, so they never look like the round bees and ladybugs.
  ctx.globalAlpha = spot === 'helpers' ? FADED : 1;
  if (o.view.showPests) {
    const p = sim.pests;
    const eff = (sim.settings.scent.effectivenessPct ?? 100) / 100;
    const markIgnorers = sim.settings.treatment !== 'none' && eff < 1;
    // Blue only while a pest sits in repellent strong enough to push others away and stays put,
    // so pests aren't blue before any scent is out (or where there is none).
    const th = Math.max(1e-4, sim.settings.scent.threshold);
    const ignores = (i: number) => markIgnorers && !p.reacts(i, eff) && sim.repellent.sample(p.x[i], p.y[i]) > th;
    const usual = (i: number) => !p.trapped[i] && p.present(i);
    drawPests(ctx, p, s, COLORS.pest, (i) => usual(i) && !p.repelled[i] && !ignores(i));
    if (markIgnorers) drawPests(ctx, p, s, COLORS.pestIgnores, (i) => usual(i) && ignores(i));
    drawPests(ctx, p, s, COLORS.pestAgitated, (i) => usual(i) && p.repelled[i] === 1);
  }
  ctx.globalAlpha = 1;

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
  if (groomba) drawGroombaIcon(ctx, d.x, d.y, d.heading, Math.max(2.5, 8 / s), d.spraying);
  else if (sim.settings.treatment !== 'none' || d.mode !== 'parked') drawDroneIcon(ctx, d.x, d.y, d.heading, Math.max(3.5, 11 / s), COLORS.drone, o.clock);

  // Wind streaks
  drawWindStreaks(ctx, sim, o.clock, s);
  // Rain: a gray-blue wash and falling streaks while it rains.
  if (sim.raining) drawRain(ctx, sim, o.clock, s);

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

/** The groomba's path: two brown wheel tracks side by side. */
function drawWheelTracks(ctx: CanvasRenderingContext2D, pts: Vec[], s: number): void {
  const gap = Math.max(0.6, 2.2 / s);
  ctx.strokeStyle = 'rgba(120,72,32,0.55)';
  ctx.lineWidth = Math.max(0.35, 1.1 / s);
  ctx.beginPath();
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 1e-6) continue;
    // Offset each wheel to either side of the robot's path.
    const nx = (-(b.y - a.y) / len) * gap;
    const ny = ((b.x - a.x) / len) * gap;
    for (const k of [1, -1]) {
      ctx.moveTo(a.x + nx * k, a.y + ny * k);
      ctx.lineTo(b.x + nx * k, b.y + ny * k);
    }
  }
  ctx.stroke();
}

/** The groomba: a small white rover with four wheels, seen from above, with a spray bar that glows blue while spraying. */
function drawGroombaIcon(ctx: CanvasRenderingContext2D, x: number, y: number, heading: number, size: number, spraying: boolean): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(heading);
  const L = size * 1.3;
  const W = size;
  // Wheels
  ctx.fillStyle = '#334155';
  for (const wx of [-L * 0.6, L * 0.6]) for (const wy of [-W * 0.62, W * 0.62]) ctx.fillRect(wx - L * 0.22, wy - W * 0.16, L * 0.44, W * 0.32);
  // Body
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#1f2937';
  ctx.lineWidth = size * 0.14;
  ctx.beginPath();
  ctx.roundRect(-L * 0.75, -W * 0.5, L * 1.5, W, W * 0.3);
  ctx.fill();
  ctx.stroke();
  // Spray bar at the front
  ctx.fillStyle = spraying ? '#3b82f6' : '#94a3b8';
  ctx.fillRect(L * 0.45, -W * 0.42, L * 0.18, W * 0.84);
  ctx.restore();
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

/** × marks where insects were killed: helpful ones where they fell, and pests killed by pesticide. */
function drawKilled(ctx: CanvasRenderingContext2D, sim: Simulation, s: number): void {
  const h = sim.helpers;
  // Killed insects: helpful ones where they fell, and pests killed by pesticide.
  const m = Math.max(0.8, 2.2 / s);
  const cross = (x: number, y: number) => {
    ctx.moveTo(x - m, y - m);
    ctx.lineTo(x + m, y + m);
    ctx.moveTo(x + m, y - m);
    ctx.lineTo(x - m, y + m);
  };
  ctx.lineWidth = 1.2 / s;
  ctx.strokeStyle = COLORS.ladybug;
  ctx.beginPath();
  for (let i = 0; i < h.n; i++) if (h.died[i]) cross(h.x[i], h.y[i]);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(17,24,39,0.6)';
  ctx.beginPath();
  const p = sim.pests;
  for (let i = 0; i < p.n; i++) if (p.fate[i] === FATE_POISONED) cross(p.x[i], p.y[i]);
  ctx.stroke();
}

/** How see-through the faded insects are while the other group is in the spotlight. */
const FADED = 0.12;

/** Pests matching `which`, in one color: a small oval body with two feelers, like an aphid. */
function drawPests(ctx: CanvasRenderingContext2D, p: Simulation['pests'], s: number, color: string, which: (i: number) => boolean): void {
  // About the size of the old dots; the feelers only show when the map is big enough to see them.
  const pr = Math.max(0.6, 1.7 / s);
  const rx = pr * 0.75;
  const ry = pr * 1.15;
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let i = 0; i < p.n; i++) {
    if (!which(i)) continue;
    const x = p.x[i];
    const y = p.y[i] + pr * 0.2;
    ctx.moveTo(x + rx, y);
    ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  }
  ctx.fill();
  if (pr * s < 2.2) return;
  ctx.strokeStyle = color;
  ctx.lineWidth = 0.6 / s;
  ctx.beginPath();
  for (let i = 0; i < p.n; i++) {
    if (!which(i)) continue;
    const x = p.x[i];
    const y = p.y[i];
    ctx.moveTo(x - pr * 0.25, y - pr * 0.8);
    ctx.lineTo(x - pr * 0.8, y - pr * 1.7);
    ctx.moveTo(x + pr * 0.25, y - pr * 0.8);
    ctx.lineTo(x + pr * 0.8, y - pr * 1.7);
  }
  ctx.stroke();
}

/** Bees (yellow with a black stripe) and ladybugs (red with spots), plus × marks where insects were killed. */
function drawHelpers(ctx: CanvasRenderingContext2D, sim: Simulation, s: number): void {
  const h = sim.helpers;
  // A little bigger than a pest, but not much, so they don't crowd the map.
  const r = Math.max(0.8, 2.3 / s);
  const alive = (kind: number) => (i: number) => !h.died[i] && h.kind[i] === kind;
  const isBee = alive(BEE);
  const isLadybug = alive(LADYBUG);
  // Bodies with a thin outline.
  ctx.strokeStyle = 'rgba(17,24,39,0.45)';
  ctx.lineWidth = 0.5 / s;
  for (const [is, color, rx, ry] of [
    [isBee, COLORS.bee, r * 1.25, r * 0.85],
    [isLadybug, COLORS.ladybug, r, r]
  ] as const) {
    ctx.fillStyle = color;
    ctx.beginPath();
    for (let i = 0; i < h.n; i++) {
      if (!is(i)) continue;
      ctx.moveTo(h.x[i] + rx, h.y[i]);
      ctx.ellipse(h.x[i], h.y[i], rx, ry, 0, 0, Math.PI * 2);
    }
    ctx.fill();
    ctx.stroke();
  }
  // Markings, when the map is big enough to see them: a stripe across each bee, two spots and a wing line on each ladybug.
  if (r * s < 2.8) return drawKilled(ctx, sim, s);
  ctx.fillStyle = '#111827';
  ctx.beginPath();
  for (let i = 0; i < h.n; i++) {
    const x = h.x[i];
    const y = h.y[i];
    if (isBee(i)) ctx.rect(x - r * 0.18, y - r * 0.8, r * 0.36, r * 1.6);
    else if (isLadybug(i)) {
      ctx.moveTo(x - r * 0.18, y + r * 0.1);
      ctx.arc(x - r * 0.4, y + r * 0.1, r * 0.22, 0, Math.PI * 2);
      ctx.moveTo(x + r * 0.62, y + r * 0.1);
      ctx.arc(x + r * 0.4, y + r * 0.1, r * 0.22, 0, Math.PI * 2);
    }
  }
  ctx.fill();
  ctx.beginPath();
  for (let i = 0; i < h.n; i++) {
    if (!isLadybug(i)) continue;
    ctx.moveTo(h.x[i], h.y[i] - r);
    ctx.lineTo(h.x[i], h.y[i] + r);
  }
  ctx.stroke();
  drawKilled(ctx, sim, s);
}

/** Rain over the map: a dim wash and slanted streaks that move with the clock. */
function drawRain(ctx: CanvasRenderingContext2D, sim: Simulation, clock: number, s: number): void {
  const { width: W, height: H } = sim.settings.field;
  ctx.fillStyle = 'rgba(71,85,105,0.18)';
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(219,234,254,0.75)';
  ctx.lineWidth = 1.1 / s;
  ctx.beginPath();
  const n = 140;
  const fall = 60; // meters per real second, for looks only
  for (let i = 0; i < n; i++) {
    // Fixed pseudo-random columns, each streak sliding down and wrapping around.
    const x0 = ((i * 97.13) % 1) * W + ((i * 0.618) % 1) * W;
    const x = x0 % W;
    const y = (((i * 53.7) % H) + clock * fall) % (H + 10) - 5;
    ctx.moveTo(x, y);
    ctx.lineTo(x - 1.5, y + 5);
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
