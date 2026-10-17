import type {
  DevicePlan,
  Metrics,
  Rect,
  ScoreWeights,
  Settings,
  SurveyResult,
  TreatmentPlan,
  Vec
} from '../models/types';
import { clamp, inRect } from '../utils/geometry';
import { childSeed, Random } from '../utils/random';
import { cropRect, DEVICE_PLUME_LIFETIME_MIN, Simulation } from './Simulation';
import { activePlan, allowedKinds, estimateSprayLiters } from './Treatment';
import { estimatePlanCost } from './PlanCost';
import { productLimitL } from './Drone';
import { scentDrift } from './Wind';

export interface ScorePart {
  label: string;
  /** The measured value, in its own units. */
  value: number;
  unit: string;
  weight: number;
  points: number;
}

export interface ScoreBreakdown {
  total: number;
  parts: ScorePart[];
}

/**
 * The optimizer's goal, written out so students can see (and change) it:
 *
 *   score = protection weight x % crop protected
 *         + deterred weight x % pests kept off the crop (run average)
 *         - material weight x gallons used
 *         - flight weight x minutes of drone flight
 *         - cost weight x (estimated cost / $10)
 */
export function scoreMetrics(m: Metrics, w: ScoreWeights): ScoreBreakdown {
  const parts: ScorePart[] = [
    { label: 'Crop protected', value: m.cropProtectedPct, unit: '%', weight: w.protection, points: w.protection * m.cropProtectedPct },
    { label: 'Pests kept off the crop (average)', value: m.pestsDeterredAvgPct, unit: '%', weight: w.pestsDeterred, points: w.pestsDeterred * m.pestsDeterredAvgPct },
    { label: 'Product used', value: m.productUsedGal, unit: 'gal', weight: w.material, points: -w.material * m.productUsedGal },
    { label: 'Drone flight time', value: m.flightTimeMin, unit: 'min', weight: w.flightTime, points: -w.flightTime * m.flightTimeMin },
    { label: 'Estimated cost', value: m.cost.total, unit: '$', weight: w.cost, points: (-w.cost * m.cost.total) / 10 }
  ];
  return { total: parts.reduce((a, p) => a + p.points, 0), parts };
}

/** What the computer is allowed to know about where the pests are. */
export type Knowledge = { kind: 'none' } | { kind: 'survey'; survey: SurveyResult };

/** Pests used to test plans: from survey detections, or spread evenly when nothing is known. */
export function knowledgePests(settings: Settings, knowledge: Knowledge, n: number, rng: Random): Vec[] {
  const crop = cropRect(settings.field);
  const det = knowledge.kind === 'survey' ? knowledge.survey.detections : [];
  const out: Vec[] = [];
  for (let i = 0; i < n; i++) {
    if (det.length) {
      const d = det[Math.floor(rng.next() * det.length)];
      out.push({
        x: clamp(d.x + rng.gaussian() * 3, 0.5, settings.field.width - 0.5),
        y: clamp(d.y + rng.gaussian() * 3, 0.5, settings.field.height - 0.5)
      });
    } else {
      out.push({ x: rng.range(crop.x, crop.x + crop.w), y: rng.range(crop.y, crop.y + crop.h) });
    }
  }
  return out;
}

/** Check a plan against the run's limits (product, number of devices and budget). */
export function planWithinLimits(plan: TreatmentPlan, settings: Settings): boolean {
  const eff = activePlan(plan, settings.treatment);
  const map = { x: 0, y: 0, w: settings.field.width, h: settings.field.height };
  const liters = estimateSprayLiters(eff.sprayZones, map, settings.drone);
  if (liters > productLimitL(settings.drone) + 1e-6) return false;
  if (eff.devices.length > settings.devices.maxDevices) return false;
  return withinBudget(eff, settings);
}

/** True when the whole plan costs no more than the budget (or there is no budget). */
export function withinBudget(plan: TreatmentPlan, settings: Settings): boolean {
  const budget = settings.cost.budget ?? 0;
  return budget <= 0 || estimatePlanCost(settings, plan).total <= budget;
}

/** Spray "blocks": the crop cut into a grid of pieces the computer can choose from. */
export function sprayBlocks(settings: Settings): Rect[] {
  const crop = cropRect(settings.field);
  const nx = Math.max(2, Math.round(crop.w / 30));
  const ny = Math.max(2, Math.round(crop.h / 30));
  const out: Rect[] = [];
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      out.push({ x: crop.x + (crop.w * i) / nx, y: crop.y + (crop.h * j) / ny, w: crop.w / nx, h: crop.h / ny });
    }
  }
  return out;
}

/**
 * Merge chosen blocks into as few rectangles as possible (neighbors in a row
 * first, then equal rows stacked), so the drone flies long passes the way it
 * would over a hand-drawn zone instead of many short ones with a turn each.
 */
export function mergeBlocks(blocks: Rect[]): Rect[] {
  const eq = (a: number, b: number) => Math.abs(a - b) < 1e-6;
  // Rows: same y and height, sorted by x, joined where they touch.
  const rows = new Map<string, Rect[]>();
  for (const b of blocks) {
    const key = `${b.y.toFixed(3)}|${b.h.toFixed(3)}`;
    rows.set(key, [...(rows.get(key) ?? []), b]);
  }
  let out: Rect[] = [];
  for (const list of rows.values()) {
    list.sort((a, b) => a.x - b.x);
    let cur = { ...list[0] };
    for (let i = 1; i < list.length; i++) {
      const b = list[i];
      if (eq(cur.x + cur.w, b.x)) cur.w += b.w;
      else {
        out.push(cur);
        cur = { ...b };
      }
    }
    out.push(cur);
  }
  // Stack rows that have the same x and width and touch top to bottom.
  out.sort((a, b) => a.x - b.x || a.w - b.w || a.y - b.y);
  const stacked: Rect[] = [];
  for (const r of out) {
    const last = stacked[stacked.length - 1];
    if (last && eq(last.x, r.x) && eq(last.w, r.w) && eq(last.y + last.h, r.y)) last.h += r.h;
    else stacked.push({ ...r });
  }
  return stacked;
}

/** Which blocks a set of zones covers (at least 40% of the block's area). */
export function coveredBlocks(zones: Rect[], blocks: Rect[]): number[] {
  const out: number[] = [];
  blocks.forEach((b, i) => {
    let area = 0;
    for (const z of zones) {
      const w = Math.min(b.x + b.w, z.x + z.w) - Math.max(b.x, z.x);
      const h = Math.min(b.y + b.h, z.y + z.h) - Math.max(b.y, z.y);
      if (w > 0 && h > 0) area += w * h;
    }
    if (area >= 0.4 * b.w * b.h) out.push(i);
  });
  return out;
}

/**
 * Run a plan quickly. The quick run keeps the real grid and the real number
 * of pests (crop damage is a fixed amount of feeding per square, so fewer
 * pests or bigger squares would make every plan look better than it is) and
 * only takes bigger time steps. With fewer test pests than the scenario has,
 * each one stands for several when it feeds (`pestWeight`).
 */
export function evaluatePlan(settings: Settings, plan: TreatmentPlan, pests: Vec[]): Metrics {
  const sim = new Simulation(settings, plan, {
    initialPests: pests,
    dt: 1,
    pestWeight: pests.length ? settings.pests.count / pests.length : 1
  });
  sim.runToEnd();
  return sim.metrics();
}

/** Run a plan in the full simulation with the real pests (for comparing plans fairly). */
export function runFull(settings: Settings, plan: TreatmentPlan): Metrics {
  const sim = new Simulation(settings, plan);
  sim.runToEnd();
  return sim.metrics();
}

/** Group points into k clusters (Lloyd's k-means) and return the cluster centers. */
export function kMeans(points: Vec[], k: number, rng: Random, iterations = 10): Vec[] {
  if (!points.length || k <= 0) return [];
  k = Math.min(k, points.length);
  // Start from k different random points.
  const idx = points.map((_, i) => i);
  for (let i = idx.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  return lloyd(points, idx.slice(0, k).map((i) => ({ x: points[i].x, y: points[i].y })), iterations);
}

/**
 * Move each center to the middle of the points nearest to it, a few times
 * (Lloyd's method). Run over points spread evenly on the crop, this spaces
 * devices out so each one looks after about the same amount of crop.
 */
export function lloyd(points: Vec[], start: Vec[], iterations: number): Vec[] {
  const centers = start.map((c) => ({ ...c }));
  const k = centers.length;
  if (!points.length || !k) return centers;
  const assign = new Int32Array(points.length);
  for (let it = 0; it < iterations; it++) {
    for (let i = 0; i < points.length; i++) {
      let best = 0;
      let bestD = Infinity;
      for (let c = 0; c < k; c++) {
        const dx = points[i].x - centers[c].x;
        const dy = points[i].y - centers[c].y;
        const d = dx * dx + dy * dy;
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
      assign[i] = best;
    }
    const sx = new Float64Array(k);
    const sy = new Float64Array(k);
    const n = new Int32Array(k);
    for (let i = 0; i < points.length; i++) {
      sx[assign[i]] += points[i].x;
      sy[assign[i]] += points[i].y;
      n[assign[i]]++;
    }
    for (let c = 0; c < k; c++) if (n[c]) centers[c] = { x: sx[c] / n[c], y: sy[c] / n[c] };
  }
  return centers;
}

export interface OptimizerProgress {
  tried: number;
  total: number;
  bestScore: number;
  done: boolean;
}

/** A named plan the computer tried first, with the score it got in the quick run. */
export interface StartingIdea {
  label: string;
  plan: TreatmentPlan;
  score: number;
  metrics: Metrics | null;
  /** False when the plan broke a limit and was skipped. */
  allowed: boolean;
}

/**
 * Searches for a good plan the way a careful person would: first try the
 * obvious ideas (treat everything, treat the border, treat the worst areas,
 * spread devices evenly, put devices where the pests are), then keep the best
 * one and improve it with small changes, keeping each change only if the
 * score goes up. Every plan is tested against the same "test pests", built
 * from what the computer knows.
 */
export class Optimizer {
  readonly settings: Settings;
  readonly total: number;
  readonly knowledge: Knowledge;
  tried = 0;
  best: TreatmentPlan | null = null;
  bestScore = -Infinity;
  bestMetrics: Metrics | null = null;
  /** The label of the idea the best plan grew from. */
  bestFrom = '';
  /** Best score after each try (for a small progress chart). */
  trace: number[] = [];
  /** The named ideas tried first, in order, with their scores. */
  starts: StartingIdea[] = [];
  /** How many small improvements were kept after the starting ideas. */
  improvements = 0;
  private rng: Random;
  private pests: Vec[];
  private blocks: Rect[];
  /** Block indices sorted by how many test pests they hold, worst first. */
  private blocksByLoad: number[];
  private queue: Array<{ label: string; plan: TreatmentPlan }> = [];
  private nextId = 1000;

  constructor(settings: Settings, knowledge: Knowledge, total = 60, evalPests = Infinity) {
    this.settings = structuredClone(settings);
    this.knowledge = knowledge;
    this.total = total;
    this.rng = new Random(childSeed(settings.run.seed, 77));
    // Every plan is tested against the same pests so scores are comparable.
    const n = Math.max(1, Math.min(evalPests, settings.pests.count));
    this.pests = knowledgePests(settings, knowledge, n, this.rng);
    this.blocks = sprayBlocks(settings);
    const load = this.blocks.map((b) => this.pests.filter((p) => inRect(p.x, p.y, b)).length);
    this.blocksByLoad = this.blocks.map((_, i) => i).sort((u, v) => load[v] - load[u]);
    if (settings.treatment !== 'none') this.queue = this.startingIdeas();
  }

  get done(): boolean {
    return this.tried >= this.total || this.settings.treatment === 'none';
  }

  get progress(): OptimizerProgress {
    return { tried: this.tried, total: this.total, bestScore: this.bestScore, done: this.done };
  }

  /** Try plans until the time budget (ms) runs out (at least one); call again to continue. */
  work(budgetMs = 30): OptimizerProgress {
    const start = performance.now();
    do {
      if (this.done) break;
      this.tryOne();
    } while (performance.now() - start < budgetMs);
    return this.progress;
  }

  runAll(): OptimizerProgress {
    while (!this.done) this.tryOne();
    return this.progress;
  }

  private tryOne(): void {
    this.tried++;
    const next = this.queue.shift();
    if (next) {
      const allowed = planWithinLimits(next.plan, this.settings);
      const m = allowed ? evaluatePlan(this.settings, next.plan, this.pests) : null;
      const score = m ? scoreMetrics(m, this.settings.weights).total : -Infinity;
      this.starts.push({ label: next.label, plan: next.plan, score, metrics: m, allowed });
      if (score > this.bestScore) {
        this.bestScore = score;
        this.best = next.plan;
        this.bestMetrics = m;
        this.bestFrom = next.label;
      }
    } else {
      // Improve the best plan so far with a small change; keep it only if it scores higher.
      const plan = this.best ? this.mutate(this.best) : this.randomPlan();
      if (planWithinLimits(plan, this.settings)) {
        const m = evaluatePlan(this.settings, plan, this.pests);
        const score = scoreMetrics(m, this.settings.weights).total;
        if (score > this.bestScore) {
          if (this.best) this.improvements++;
          this.bestScore = score;
          this.best = plan;
          this.bestMetrics = m;
        }
      }
    }
    this.trace.push(this.bestScore);
  }

  // ---- Starting ideas -------------------------------------------------

  /** The obvious plans a person would try first, in the order they are tested. */
  startingIdeas(): Array<{ label: string; plan: TreatmentPlan }> {
    const s = this.settings;
    const ideas = s.treatment === 'spray' ? this.sprayIdeas() : this.deviceIdeas();
    // The baseline, so the computer can say honestly when nothing beats it.
    ideas.push({ label: 'Do nothing', plan: { sprayZones: [], devices: [] } });
    return ideas;
  }

  /** Zones for a set of block indices, merged into long passes. */
  private zonesFor(indices: number[]): Rect[] {
    return mergeBlocks(indices.map((i) => this.blocks[i]));
  }

  private sprayIdeas(): Array<{ label: string; plan: TreatmentPlan }> {
    const crop = cropRect(this.settings.field);
    const ideas: Array<{ label: string; plan: TreatmentPlan }> = [];
    const seen = new Set<string>();
    const add = (label: string, zones: Rect[]) => {
      const key = zones
        .map((z) => `${z.x.toFixed(1)},${z.y.toFixed(1)},${z.w.toFixed(1)},${z.h.toFixed(1)}`)
        .sort()
        .join('|');
      if (!zones.length || seen.has(key)) return;
      seen.add(key);
      ideas.push({ label, plan: { sprayZones: zones, devices: [] } });
    };
    const affordable = this.worstBlocks(this.blocks.length).length;
    if (this.zonesFit([crop])) add('Whole field', [crop]);
    else add(`As much as the product allows (worst ${affordable} areas first)`, this.zonesFor(this.worstBlocks(affordable)));
    const border = Math.max(this.settings.drone.swathM * 2, 8);
    const strips = [
      { x: crop.x, y: crop.y, w: crop.w, h: border },
      { x: crop.x, y: crop.y + crop.h - border, w: crop.w, h: border },
      { x: crop.x, y: crop.y + border, w: border, h: crop.h - 2 * border },
      { x: crop.x + crop.w - border, y: crop.y + border, w: border, h: crop.h - 2 * border }
    ];
    if (this.zonesFit(strips)) add('Border strips', strips);
    // Treat the worst areas first: a few sizes between "a little" and "all we can afford".
    const fractions = [0.25, 0.5, 0.75];
    for (const f of fractions) {
      const k = Math.max(1, Math.round(affordable * f));
      if (k < affordable) add(`Worst ${k} area${k === 1 ? '' : 's'}`, this.zonesFor(this.worstBlocks(k)));
    }
    if (affordable > 1) add('Worst area only', this.zonesFor(this.worstBlocks(1)));
    return ideas;
  }

  /** The k blocks (indices) with the most test pests that fit the product limit together. */
  private worstBlocks(k: number): number[] {
    const out: number[] = [];
    for (const i of this.blocksByLoad) {
      if (out.length >= k) break;
      if (this.zonesFit(this.zonesFor([...out, i]))) out.push(i);
    }
    return out;
  }

  private deviceIdeas(): Array<{ label: string; plan: TreatmentPlan }> {
    const s = this.settings;
    // With a budget, "all the devices" means as many as the money pays for.
    const max = this.affordableDevices();
    const pushPull = s.treatment === 'pushPull';
    const ideas: Array<{ label: string; plan: TreatmentPlan }> = [];
    const counts = [...new Set([max, Math.max(1, Math.round(max / 2))])];
    for (const k of counts) {
      const some =
        k === s.devices.maxDevices ? 'all the devices' : k === max ? `as many devices as the budget pays for (${k})` : `${k} devices`;
      ideas.push({ label: `Spread ${some} evenly over the crop`, plan: this.devicePlan(this.evenPoints(k)) });
      ideas.push({ label: `Put ${some} where the pests are`, plan: this.devicePlan(this.clusterPoints(k)) });
    }
    const drift = this.plumeDrift();
    const windy = Math.hypot(drift.x, drift.y) > 1;
    if (windy) {
      ideas.push({ label: 'Put devices upwind of the pests, so the wind carries the scent over them', plan: this.devicePlan(this.clusterPoints(max).map((p) => ({ x: p.x - drift.x, y: p.y - drift.y }))) });
      ideas.push({ label: 'A row of devices along the upwind edge of the crop', plan: this.devicePlan(this.upwindRow(max, drift)) });
    }
    if (pushPull && max > 1) {
      // Push-pull: repellent to push, traps to pull. Traps can go in the grass
      // border or right where the pests are (a trap catches them for good).
      const trapCounts = [...new Set([1, 2, 3, Math.round(max / 3)])].filter((t) => t >= 1 && t < max);
      const plural = (t: number) => `${t} attractant trap${t === 1 ? '' : 's'}`;
      for (const t of trapCounts) {
        ideas.push({ label: `Repellent spread evenly, ${plural(t)} spaced around the border`, plan: this.devicePlan(this.evenPoints(max - t), this.ringTraps(t)) });
        ideas.push({ label: `Repellent spread evenly, ${plural(t)} where the pests are`, plan: this.devicePlan(this.evenPoints(max - t), this.clusterPoints(t)) });
      }
      const t = Math.max(1, Math.round(max / 4));
      ideas.push({ label: `Repellent where the pests are, ${plural(t)} spaced around the border`, plan: this.devicePlan(this.clusterPoints(max - t), this.ringTraps(t)) });
      ideas.push({ label: `Only traps: all ${max} where the pests are`, plan: this.devicePlan([], this.clusterPoints(max)) });
      ideas.push({ label: `Only traps: all ${max} spread evenly`, plan: this.devicePlan([], this.evenPoints(max)) });
      if (windy) ideas.push({ label: `Repellent spread evenly, ${plural(t)} on the downwind side`, plan: this.devicePlan(this.evenPoints(max - t), this.borderTraps(t, drift)) });
    }
    return ideas;
  }

  /** How far a device's scent is carried downwind while it lingers (meters, as a vector). */
  private plumeDrift(): Vec {
    const v = scentDrift(this.settings.wind, 0);
    const sec = DEVICE_PLUME_LIFETIME_MIN * 60;
    return { x: v.x * sec * 0.6, y: v.y * sec * 0.6 };
  }

  private devicePlan(repellents: Vec[], traps: Vec[] = []): TreatmentPlan {
    return {
      sprayZones: [],
      devices: [...repellents.map((p) => this.placed(p, 'repellent')), ...traps.map((p) => this.placed(p, 'attractant'))]
    };
  }

  /** k points spread evenly over the crop. */
  private gridPoints(k: number): Vec[] {
    const crop = cropRect(this.settings.field);
    const cols = Math.max(1, Math.round(Math.sqrt((k * crop.w) / crop.h)));
    const rows = Math.max(1, Math.ceil(k / cols));
    const out: Vec[] = [];
    for (let r = 0; r < rows && out.length < k; r++) {
      const inRow = Math.min(cols, k - out.length);
      for (let c = 0; c < inRow; c++) {
        out.push({ x: crop.x + (crop.w * (c + 0.5)) / inRow, y: crop.y + (crop.h * (r + 0.5)) / rows });
      }
    }
    return out;
  }

  /** Most devices the budget pays for (spread evenly), up to the device limit. */
  private affordableDevices(): number {
    const s = this.settings;
    if (!s.cost.budget || s.cost.budget <= 0) return s.devices.maxDevices;
    const fits = (k: number) => withinBudget(this.devicePlan(this.evenPoints(k)), s);
    let lo = 0;
    let hi = s.devices.maxDevices;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (fits(mid)) lo = mid;
      else hi = mid - 1;
    }
    return Math.max(1, lo);
  }

  /**
   * k points spaced out over the crop so each looks after about the same
   * area: start from a grid, then even out the spacing (Lloyd's method).
   */
  private evenPoints(k: number): Vec[] {
    return lloyd(this.cropSamples(), this.gridPoints(k), 25);
  }

  private samples: Vec[] | null = null;
  /** Points every 3 m over the crop. */
  private cropSamples(): Vec[] {
    if (this.samples) return this.samples;
    const crop = cropRect(this.settings.field);
    const out: Vec[] = [];
    for (let y = crop.y + 1.5; y < crop.y + crop.h; y += 3) for (let x = crop.x + 1.5; x < crop.x + crop.w; x += 3) out.push({ x, y });
    return (this.samples = out);
  }

  /** The loop through the grass border, halfway between the crop and the map edge. */
  private ring(): Rect {
    const f = this.settings.field;
    const crop = cropRect(f);
    const gap = Math.max(3, f.border / 2);
    return { x: crop.x - gap, y: crop.y - gap, w: crop.w + 2 * gap, h: crop.h + 2 * gap };
  }

  /** A point on the border loop, t from 0 to 1 going around (0 = middle of the top side). */
  private ringPoint(t: number): Vec {
    const r = this.ring();
    const per = 2 * (r.w + r.h);
    let d = ((((t * per + r.w / 2) % per) + per) % per);
    if (d < r.w) return { x: r.x + d, y: r.y };
    d -= r.w;
    if (d < r.h) return { x: r.x + r.w, y: r.y + d };
    d -= r.h;
    if (d < r.w) return { x: r.x + r.w - d, y: r.y + r.h };
    d -= r.w;
    return { x: r.x, y: r.y + r.h - d };
  }

  /** The closest point on the border loop. */
  private toRing(p: Vec): Vec {
    const r = this.ring();
    const x = clamp(p.x, r.x, r.x + r.w);
    const y = clamp(p.y, r.y, r.y + r.h);
    const dl = x - r.x;
    const dr = r.x + r.w - x;
    const dt = y - r.y;
    const db = r.y + r.h - y;
    const m = Math.min(dl, dr, dt, db);
    if (m === dl) return { x: r.x, y };
    if (m === dr) return { x: r.x + r.w, y };
    if (m === dt) return { x, y: r.y };
    return { x, y: r.y + r.h };
  }

  /** k traps spaced evenly around the border loop (two traps face each other across the field). */
  private ringTraps(k: number): Vec[] {
    return Array.from({ length: k }, (_, i) => this.ringPoint(i / k));
  }

  /**
   * Where a new repellent would help most: a test pest that no repellent
   * reaches yet (or any test pest, if all are covered).
   */
  private gapSpot(devices: DevicePlan[]): Vec {
    const r2 = this.settings.scent.rangeM ** 2;
    const reps = devices.filter((d) => d.kind === 'repellent');
    const crop = cropRect(this.settings.field);
    const open = this.pests.filter(
      (p) => inRect(p.x, p.y, crop) && !reps.some((d) => (d.x - p.x) ** 2 + (d.y - p.y) ** 2 <= r2)
    );
    const pool = open.length ? open : this.pests;
    const p = pool[this.rng.int(0, pool.length - 1)];
    return p ? { x: p.x, y: p.y } : { x: crop.x + crop.w / 2, y: crop.y + crop.h / 2 };
  }

  /** k points at the centers of the pest clusters the computer knows about. */
  private clusterPoints(k: number): Vec[] {
    const pts = kMeans(this.pests, k, this.rng);
    while (pts.length < k) pts.push(...this.gridPoints(k - pts.length));
    return pts;
  }

  /** k points in a line along the crop edge the wind comes from. */
  private upwindRow(k: number, drift: Vec): Vec[] {
    const crop = cropRect(this.settings.field);
    const out: Vec[] = [];
    const alongX = Math.abs(drift.x) >= Math.abs(drift.y);
    for (let i = 0; i < k; i++) {
      const t = (i + 0.5) / k;
      if (alongX) out.push({ x: drift.x > 0 ? crop.x + 2 : crop.x + crop.w - 2, y: crop.y + crop.h * t });
      else out.push({ x: crop.x + crop.w * t, y: drift.y > 0 ? crop.y + 2 : crop.y + crop.h - 2 });
    }
    return out;
  }

  /** Trap spots in the grass border, on the side the wind blows toward (or the long sides in calm air). */
  private borderTraps(k: number, drift: Vec): Vec[] {
    const f = this.settings.field;
    const crop = cropRect(f);
    const gap = Math.max(4, f.border / 2);
    const out: Vec[] = [];
    const windy = Math.hypot(drift.x, drift.y) > 1;
    for (let i = 0; i < k; i++) {
      const t = (i + 0.5) / k;
      if (windy && Math.abs(drift.x) >= Math.abs(drift.y)) {
        out.push({ x: drift.x > 0 ? crop.x + crop.w + gap : crop.x - gap, y: crop.y + crop.h * t });
      } else if (windy) {
        out.push({ x: crop.x + crop.w * t, y: drift.y > 0 ? crop.y + crop.h + gap : crop.y - gap });
      } else {
        // Calm: alternate between the two long sides.
        const side = i % 2 === 0 ? crop.y - gap : crop.y + crop.h + gap;
        out.push({ x: crop.x + crop.w * ((Math.floor(i / 2) + 0.5) / Math.ceil(k / 2)), y: side });
      }
    }
    return out;
  }

  // ---- Random plans and small changes -----------------------------------

  private literLimit(): number {
    return productLimitL(this.settings.drone);
  }

  private zonesFit(zones: Rect[]): boolean {
    const map = { x: 0, y: 0, w: this.settings.field.width, h: this.settings.field.height };
    if (estimateSprayLiters(zones, map, this.settings.drone) > this.literLimit()) return false;
    return withinBudget({ sprayZones: zones, devices: [] }, this.settings);
  }

  /**
   * A new device, usually near a known pest. An attractant trap sometimes goes
   * in the grass border instead, to pull pests off the crop.
   */
  private randomDevice(kind?: 'repellent' | 'attractant'): DevicePlan {
    const kinds = allowedKinds(this.settings.treatment);
    const attract = kind ? kind === 'attractant' : kinds.includes('attractant') && this.rng.chance(0.25);
    const crop = cropRect(this.settings.field);
    let p: Vec;
    if (attract && this.rng.chance(0.4)) p = this.ringPoint(this.rng.next());
    else {
      const near = this.pests.length && this.rng.chance(0.7) ? this.pests[this.rng.int(0, this.pests.length - 1)] : null;
      p = near
        ? { x: near.x + this.rng.gaussian() * 6, y: near.y + this.rng.gaussian() * 6 }
        : { x: this.rng.range(crop.x, crop.x + crop.w), y: this.rng.range(crop.y, crop.y + crop.h) };
    }
    return this.placed(p, attract ? 'attractant' : 'repellent');
  }

  /** A device at a point, kept on the map. */
  private placed(p: Vec, kind: 'repellent' | 'attractant'): DevicePlan {
    const f = this.settings.field;
    const q = p;
    return {
      id: this.nextId++,
      x: clamp(q.x, 3, f.width - 3),
      y: clamp(q.y, 3, f.height - 3),
      kind,
      trap: kind === 'attractant'
    };
  }

  randomPlan(): TreatmentPlan {
    const s = this.settings;
    if (s.treatment === 'spray') {
      const order = this.blocks.map((_, i) => i);
      for (let i = order.length - 1; i > 0; i--) {
        const j = this.rng.int(0, i);
        [order[i], order[j]] = [order[j], order[i]];
      }
      const want = this.rng.int(1, order.length);
      const chosen: number[] = [];
      for (const i of order) {
        if (chosen.length >= want) break;
        if (this.zonesFit(this.zonesFor([...chosen, i]))) chosen.push(i);
      }
      return { sprayZones: this.zonesFor(chosen), devices: [] };
    }
    const max = s.devices.maxDevices;
    const n = this.rng.int(Math.max(1, Math.ceil(max / 2)), max);
    const devices: DevicePlan[] = [];
    for (let i = 0; i < n; i++) devices.push(this.randomDevice());
    return { sprayZones: [], devices };
  }

  /** A small change to a plan: one block or device added, removed, moved or swapped (sometimes two). */
  mutate(plan: TreatmentPlan): TreatmentPlan {
    let out = this.mutateOnce(plan);
    if (this.rng.chance(0.25)) out = this.mutateOnce(out);
    return out;
  }

  private mutateOnce(plan: TreatmentPlan): TreatmentPlan {
    const s = this.settings;
    const rng = this.rng;
    if (s.treatment === 'spray') {
      // Work on the set of blocks the plan covers, then merge back into long passes.
      const chosen = coveredBlocks(plan.sprayZones, this.blocks);
      const unused = this.blocksByLoad.filter((i) => !chosen.includes(i));
      // Blocks with more pests are picked more often when adding (unused is worst-first).
      const pickUnused = () => unused[Math.min(unused.length - 1, Math.floor(Math.abs(rng.gaussian()) * unused.length * 0.4))];
      const r = rng.next();
      if ((r < 0.35 || unused.length === 0) && chosen.length > 1) {
        chosen.splice(rng.int(0, chosen.length - 1), 1);
      } else if (r < 0.7 && unused.length) {
        const add = pickUnused();
        if (this.zonesFit(this.zonesFor([...chosen, add]))) chosen.push(add);
        else if (chosen.length) chosen[rng.int(0, chosen.length - 1)] = add;
      } else if (unused.length && chosen.length) {
        chosen[rng.int(0, chosen.length - 1)] = pickUnused();
      } else if (unused.length) {
        chosen.push(pickUnused());
      }
      const zones = this.zonesFor(chosen);
      return { sprayZones: zones.length && this.zonesFit(zones) ? zones : plan.sprayZones, devices: [] };
    }
    const devices = plan.devices.map((d) => ({ ...d }));
    const move = (i: number, dx: number, dy: number) => {
      const d = devices[i];
      devices[i] = { ...this.placed({ x: d.x + dx, y: d.y + dy }, d.kind), id: d.id };
    };
    const pick = () => rng.int(0, devices.length - 1);
    const r = rng.next();
    if (r < 0.25 && devices.length) {
      // Nudge one device a few meters.
      move(pick(), rng.gaussian() * 5, rng.gaussian() * 5);
    } else if (r < 0.4 && devices.length) {
      // Move one device a long way.
      move(pick(), rng.gaussian() * 20, rng.gaussian() * 20);
    } else if (r < 0.6 && devices.length) {
      // Move a repellent to a spot no repellent reaches yet; a trap to another spot on the border.
      const i = pick();
      const d = devices[i];
      const others = devices.filter((_, k) => k !== i);
      devices[i] = { ...(d.kind === 'repellent' ? this.placed(this.gapSpot(others), 'repellent') : this.randomDevice('attractant')), id: d.id };
    } else if (r < 0.72 && allowedKinds(s.treatment).length > 1 && devices.length) {
      // Swap a repellent for a trap (in the same spot or the nearest border spot), or a trap for a repellent in a gap.
      const i = pick();
      const d = devices[i];
      const others = devices.filter((_, k) => k !== i);
      devices[i] =
        d.kind === 'repellent'
          ? { ...this.placed(rng.chance(0.5) ? d : this.toRing(d), 'attractant'), id: d.id }
          : { ...this.placed(this.gapSpot(others), 'repellent'), id: d.id };
    } else if (r < 0.88 && devices.length < s.devices.maxDevices) {
      devices.push(rng.chance(0.6) ? this.placed(this.gapSpot(devices), 'repellent') : this.randomDevice());
    } else if (devices.length > 1) {
      devices.splice(pick(), 1);
    }
    return { sprayZones: [], devices };
  }
}
