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
import { clamp } from '../utils/geometry';
import { childSeed, Random } from '../utils/random';
import { galToL } from '../utils/units';
import { cropRect, gridCellSize, Simulation } from './Simulation';
import { activePlan, allowedKinds, estimateSprayLiters } from './Treatment';

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

/** Check a plan against the run's limits (product and number of devices). */
export function planWithinLimits(plan: TreatmentPlan, settings: Settings): boolean {
  const eff = activePlan(plan, settings.treatment);
  const map = { x: 0, y: 0, w: settings.field.width, h: settings.field.height };
  const liters = estimateSprayLiters(eff.sprayZones, map, settings.drone);
  if (liters > galToL(settings.drone.productAvailableGal) + 1e-6) return false;
  if (eff.devices.length > settings.devices.maxDevices) return false;
  return true;
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

/** Run a plan quickly with a smaller, blurrier copy of the simulation. */
export function evaluatePlan(settings: Settings, plan: TreatmentPlan, pests: Vec[]): Metrics {
  const sim = new Simulation(settings, plan, {
    initialPests: pests,
    dt: 1,
    cellSize: gridCellSize(settings.field) * 2
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

export interface OptimizerProgress {
  tried: number;
  total: number;
  bestScore: number;
  done: boolean;
}

export class Optimizer {
  readonly settings: Settings;
  readonly total: number;
  readonly knowledge: Knowledge;
  tried = 0;
  best: TreatmentPlan | null = null;
  bestScore = -Infinity;
  bestMetrics: Metrics | null = null;
  /** Best score after each try (for a small progress chart). */
  trace: number[] = [];
  private rng: Random;
  private pests: Vec[];
  private blocks: Rect[];
  private nextId = 1000;

  constructor(settings: Settings, knowledge: Knowledge, total = 150, evalPests = 200) {
    this.settings = structuredClone(settings);
    this.knowledge = knowledge;
    this.total = total;
    this.rng = new Random(childSeed(settings.run.seed, 77));
    // Every plan is tested against the same pests so scores are comparable.
    this.pests = knowledgePests(settings, knowledge, Math.min(evalPests, settings.pests.count), this.rng);
    this.blocks = sprayBlocks(settings);
  }

  get done(): boolean {
    return this.tried >= this.total || this.settings.treatment === 'none';
  }

  get progress(): OptimizerProgress {
    return { tried: this.tried, total: this.total, bestScore: this.bestScore, done: this.done };
  }

  /** Try strategies until the time budget (ms) runs out; call again to continue. */
  work(budgetMs = 30): OptimizerProgress {
    const start = performance.now();
    while (!this.done && performance.now() - start < budgetMs) this.tryOne();
    return this.progress;
  }

  runAll(): OptimizerProgress {
    while (!this.done) this.tryOne();
    return this.progress;
  }

  private tryOne(): void {
    // First explore at random, then improve the best plan with small changes.
    const explore = this.best === null || this.tried < this.total * 0.35;
    const plan = explore ? this.randomPlan() : this.mutate(this.best!);
    this.tried++;
    if (planWithinLimits(plan, this.settings)) {
      const m = evaluatePlan(this.settings, plan, this.pests);
      const score = scoreMetrics(m, this.settings.weights).total;
      if (score > this.bestScore) {
        this.bestScore = score;
        this.best = plan;
        this.bestMetrics = m;
      }
    }
    this.trace.push(this.bestScore);
  }

  private literLimit(): number {
    return galToL(this.settings.drone.productAvailableGal);
  }

  private zonesFit(zones: Rect[]): boolean {
    const map = { x: 0, y: 0, w: this.settings.field.width, h: this.settings.field.height };
    return estimateSprayLiters(zones, map, this.settings.drone) <= this.literLimit();
  }

  private randomDevice(): DevicePlan {
    const kinds = allowedKinds(this.settings.treatment);
    const f = this.settings.field;
    const attract = kinds.includes('attractant') && this.rng.chance(0.3);
    return {
      id: this.nextId++,
      x: this.rng.range(3, f.width - 3),
      y: this.rng.range(3, f.height - 3),
      kind: attract ? 'attractant' : 'repellent',
      trap: attract
    };
  }

  randomPlan(): TreatmentPlan {
    const s = this.settings;
    if (s.treatment === 'spray') {
      const order = [...this.blocks];
      for (let i = order.length - 1; i > 0; i--) {
        const j = this.rng.int(0, i);
        [order[i], order[j]] = [order[j], order[i]];
      }
      const want = this.rng.int(1, order.length);
      const zones: Rect[] = [];
      for (const b of order) {
        if (zones.length >= want) break;
        if (this.zonesFit([...zones, b])) zones.push(b);
      }
      return { sprayZones: zones, devices: [] };
    }
    const max = s.devices.maxDevices;
    const n = this.rng.int(Math.max(1, Math.ceil(max / 2)), max);
    const devices: DevicePlan[] = [];
    for (let i = 0; i < n; i++) devices.push(this.randomDevice());
    return { sprayZones: [], devices };
  }

  mutate(plan: TreatmentPlan): TreatmentPlan {
    const s = this.settings;
    const rng = this.rng;
    if (s.treatment === 'spray') {
      const zones = [...plan.sprayZones];
      const unused = this.blocks.filter((b) => !zones.some((z) => z.x === b.x && z.y === b.y));
      const r = rng.next();
      if ((r < 0.35 || unused.length === 0) && zones.length > 1) {
        zones.splice(rng.int(0, zones.length - 1), 1);
      } else if (r < 0.7 && unused.length) {
        const add = unused[rng.int(0, unused.length - 1)];
        if (this.zonesFit([...zones, add])) zones.push(add);
        else if (zones.length) zones[rng.int(0, zones.length - 1)] = add;
      } else if (unused.length && zones.length) {
        zones[rng.int(0, zones.length - 1)] = unused[rng.int(0, unused.length - 1)];
      }
      return { sprayZones: this.zonesFit(zones) ? zones : plan.sprayZones, devices: [] };
    }
    const f = s.field;
    const devices = plan.devices.map((d) => ({ ...d }));
    const r = rng.next();
    if (r < 0.55 && devices.length) {
      const d = devices[rng.int(0, devices.length - 1)];
      d.x = clamp(d.x + rng.gaussian() * 15, 3, f.width - 3);
      d.y = clamp(d.y + rng.gaussian() * 15, 3, f.height - 3);
    } else if (r < 0.7 && devices.length) {
      devices[rng.int(0, devices.length - 1)] = { ...this.randomDevice() };
    } else if (r < 0.8 && allowedKinds(s.treatment).length > 1 && devices.length) {
      const d = devices[rng.int(0, devices.length - 1)];
      d.kind = d.kind === 'repellent' ? 'attractant' : 'repellent';
      d.trap = d.kind === 'attractant';
    } else if (r < 0.9 && devices.length < s.devices.maxDevices) {
      devices.push(this.randomDevice());
    } else if (devices.length > 1) {
      devices.splice(rng.int(0, devices.length - 1), 1);
    }
    return { sprayZones: [], devices };
  }
}
