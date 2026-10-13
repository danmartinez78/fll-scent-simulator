import type {
  FieldSettings,
  HistoryPoint,
  Metrics,
  Rect,
  Settings,
  SurveyResult,
  TreatmentPlan,
  Vec
} from '../models/types';
import { childSeed, Random } from '../utils/random';
import { inRect } from '../utils/geometry';
import { galPerAcreToLPerM2, lToGal } from '../utils/units';
import { computeCost } from './CostModel';
import { Drone } from './Drone';
import { PestSwarm, type PestEnvironment } from './Pest';
import { ScentField } from './ScentField';
import { SurveyRun } from './Survey';
import {
  activePlan,
  buildDroneTasks,
  deviceActive,
  DEVICE_BASE_EMISSION,
  sprayTasksForZone,
  zoneKey,
  type DeviceState
} from './Treatment';
import { diffusionFor, scentDrift } from './Wind';

/** Simulated seconds per step. */
export const DEFAULT_DT = 0.5;
/** How often (simulated seconds) the charts record a point. */
export const HISTORY_EVERY_SEC = 10;
/**
 * A crop square counts as "affected" after this much feeding: pest-seconds
 * per square meter (for example, one pest feeding for 60 seconds on 3 square
 * meters is 20).
 */
export const AFFECTED_DAMAGE = 12;
/**
 * Application rate that makes a fresh spray reach concentration equal to the
 * scent strength. Twice the rate gives twice the concentration.
 */
export const REFERENCE_RATE_L_PER_M2 = galPerAcreToLPerM2(2);

export function cropRect(f: FieldSettings): Rect {
  return { x: f.border, y: f.border, w: f.width - 2 * f.border, h: f.height - 2 * f.border };
}

/** Where the drone takes off, refills and swaps batteries. */
export function homePoint(f: FieldSettings): Vec {
  return { x: f.width / 2, y: f.height - Math.max(2, f.border / 2) };
}

export function gridCellSize(f: FieldSettings): number {
  return Math.max(2.5, f.width / 64);
}

export interface SimOptions {
  /** Use fewer pests (the optimizer does this to run faster). */
  pestCount?: number;
  /** Start pests at these positions instead of the scenario's pattern. */
  initialPests?: Vec[];
  dt?: number;
  /** Use bigger grid squares (faster, blurrier). */
  cellSize?: number;
}

export class Simulation {
  settings: Settings;
  plan: TreatmentPlan;
  readonly map: Rect;
  readonly crop: Rect;
  readonly home: Vec;
  readonly dt: number;
  time = 0;
  repellent: ScentField;
  attractant: ScentField;
  /** Feeding so far in each grid square (pest-seconds per square meter). */
  damage: Float32Array;
  /** 1 for grid squares that are crop. */
  cropMask: Uint8Array;
  cropCells: number;
  /** 1 for grid squares the spray has touched. */
  sprayed: Uint8Array;
  pests: PestSwarm;
  drone: Drone;
  devices: DeviceState[] = [];
  survey: SurveyRun | null = null;
  surveys: SurveyResult[] = [];
  history: HistoryPoint[] = [];
  finished = false;
  private awaySum = 0;
  private awayN = 0;
  private nextHistory = 0;
  private rngMotion: Random;
  private rngSurvey: Random;
  private zoneKeys = new Set<string>();

  constructor(settings: Settings, plan: TreatmentPlan, opts: SimOptions = {}) {
    this.settings = structuredClone(settings);
    this.plan = structuredClone(plan);
    this.dt = opts.dt ?? DEFAULT_DT;
    const f = settings.field;
    this.map = { x: 0, y: 0, w: f.width, h: f.height };
    this.crop = cropRect(f);
    this.home = homePoint(f);
    const cell = opts.cellSize ?? gridCellSize(f);
    this.repellent = new ScentField(f.width, f.height, cell);
    this.attractant = new ScentField(f.width, f.height, cell);
    const n = this.repellent.cols * this.repellent.rows;
    this.damage = new Float32Array(n);
    this.sprayed = new Uint8Array(n);
    this.cropMask = new Uint8Array(n);
    this.cropCells = 0;
    for (let r = 0; r < this.repellent.rows; r++) {
      for (let c = 0; c < this.repellent.cols; c++) {
        if (inRect((c + 0.5) * cell, (r + 0.5) * cell, this.crop)) {
          this.cropMask[r * this.repellent.cols + c] = 1;
          this.cropCells++;
        }
      }
    }
    const seed = settings.run.seed;
    const rngStart = new Random(childSeed(seed, 1));
    this.rngMotion = new Random(childSeed(seed, 2));
    this.rngSurvey = new Random(childSeed(seed, 3));
    this.pests = opts.initialPests
      ? PestSwarm.fromPositions(opts.initialPests, rngStart)
      : PestSwarm.create(settings.pests, f.width, f.height, this.crop, rngStart, opts.pestCount);
    this.pests.assignToughness(new Random(childSeed(seed, 4)));
    this.drone = new Drone(settings.drone, this.home);
    this.setPlan(plan);
    this.recordHistory();
  }

  /** The plan pieces that matter for the current treatment method. */
  get effectivePlan(): TreatmentPlan {
    return activePlan(this.plan, this.settings.treatment);
  }

  /**
   * Change the plan. New zones and devices are added to the drone's to-do
   * list; ones that were removed before the drone got to them are dropped.
   */
  setPlan(plan: TreatmentPlan): void {
    this.plan = structuredClone(plan);
    const eff = this.effectivePlan;
    const s = this.settings;

    // Spray zones
    const keys = new Set(eff.sprayZones.map(zoneKey));
    this.drone.tasks = this.drone.tasks.filter((t) => t.kind !== 'spray' || keys.has(t.zoneKey));
    if (this.drone.spraying && this.drone.tasks[0]?.kind !== 'spray') this.drone.spraying = false;
    for (const z of eff.sprayZones) {
      const k = zoneKey(z);
      if (this.zoneKeys.has(k)) continue;
      this.zoneKeys.add(k);
      this.drone.tasks.push(...sprayTasksForZone(z, this.map, s.drone));
    }
    for (const k of [...this.zoneKeys]) if (!keys.has(k)) this.zoneKeys.delete(k);

    // Devices
    const ids = new Set(eff.devices.map((d) => d.id));
    this.devices = this.devices.filter((d) => ids.has(d.id));
    this.drone.tasks = this.drone.tasks.filter((t) => t.kind !== 'drop' || ids.has(t.deviceId));
    const known = new Set(this.devices.map((d) => d.id));
    const fresh = eff.devices.filter((d) => !known.has(d.id));
    for (const d of fresh) {
      this.devices.push({ ...d, activatedAt: s.devices.deployByDrone ? null : this.time });
    }
    if (s.devices.deployByDrone && fresh.length) {
      const drops = buildDroneTasks(
        { sprayZones: [], devices: fresh },
        this.map,
        this.home,
        s.drone,
        s.devices
      );
      this.drone.tasks.push(...drops);
    }
    // Keep devices' kind/trap in sync with edits.
    for (const d of this.devices) {
      const p = eff.devices.find((e) => e.id === d.id);
      if (p) {
        d.kind = p.kind;
        d.trap = p.trap;
      }
    }
  }

  /**
   * Apply settings that can change while running (wind, scent, pest
   * reactions, drone limits, costs). Map size, pest count and starting
   * pattern need a reset.
   */
  updateSettings(settings: Settings): void {
    const methodChanged = settings.treatment !== this.settings.treatment;
    const oldStock = this.settings.drone.productAvailableGal;
    this.settings = structuredClone(settings);
    const keepStock = this.drone.stockL;
    this.drone.settings = { ...settings.drone };
    this.drone.stockL = Math.max(0, keepStock + (settings.drone.productAvailableGal - oldStock) * 3.78541);
    if (methodChanged) this.setPlan(this.plan);
  }

  /** Send the survey drone over the map. */
  startSurvey(): void {
    if (this.survey && !this.survey.done) return;
    const id = this.surveys.length + 1;
    this.survey = new SurveyRun(
      id,
      `Survey ${id}`,
      this.time,
      this.settings.field.width,
      this.settings.field.height,
      this.settings.survey
    );
  }

  get surveying(): boolean {
    return !!this.survey && !this.survey.done;
  }

  get durationSec(): number {
    return this.settings.run.durationMin * 60;
  }

  private pestEnvironment(): PestEnvironment {
    const s = this.settings;
    const traps: Vec[] = [];
    for (const d of this.devices) {
      if (d.kind === 'attractant' && d.trap && d.activatedAt !== null) traps.push({ x: d.x, y: d.y });
    }
    return {
      width: s.field.width,
      height: s.field.height,
      crop: this.crop,
      repellent: this.repellent,
      attractant: this.attractant,
      threshold: s.scent.threshold,
      sensitivity: s.pests.sensitivity,
      // Setups saved before this setting existed keep their old behavior.
      effectiveness: (s.scent.effectivenessPct ?? 100) / 100,
      cropAttraction: s.pests.cropAttraction,
      speed: s.pests.speed,
      traps
    };
  }

  /** Advance one time step. */
  step(): void {
    const dt = this.dt;
    const s = this.settings;
    const cell = this.repellent.cell;
    const cols = this.repellent.cols;

    // Drone: flies its jobs, sprays and drops devices.
    const sprayed = this.sprayed;
    this.drone.step(dt, {
      devicesMassKg: s.devices.massKg,
      spray: (x, y, liters, swath) => {
        const amount = (liters / REFERENCE_RATE_L_PER_M2) * s.scent.strength;
        this.repellent.addGaussian(x, y, amount, swath / 2.5);
        const half = swath / 2;
        for (let yy = y - half; yy <= y + half; yy += cell / 2) {
          for (let xx = x - half; xx <= x + half; xx += cell / 2) {
            const c = Math.floor(xx / cell);
            const r = Math.floor(yy / cell);
            if (c >= 0 && r >= 0 && c < cols && r < this.repellent.rows) sprayed[r * cols + c] = 1;
          }
        }
      },
      dropDevice: (id) => {
        const d = this.devices.find((e) => e.id === id);
        if (d && d.activatedAt === null) d.activatedAt = this.time;
      }
    });

    // Slow-release devices: steady scent while they last.
    const emit = DEVICE_BASE_EMISSION * s.scent.strength * s.devices.releaseRate * dt;
    for (const d of this.devices) {
      if (!deviceActive(d, this.time, s.devices.lifetimeMin)) continue;
      const field = d.kind === 'repellent' ? this.repellent : this.attractant;
      field.addGaussian(d.x, d.y, emit, s.scent.rangeM / 2);
    }

    // Scent drifts, spreads and fades.
    const drift = scentDrift(s.wind, this.time);
    const diff = diffusionFor(s.wind);
    const life = s.scent.lifetimeMin * 60;
    this.repellent.step(dt, drift.x, drift.y, diff, life);
    this.attractant.step(dt, drift.x, drift.y, diff, life);

    // Pests move and feed.
    this.pests.step(dt, this.pestEnvironment(), this.rngMotion);
    const area = cell * cell;
    const p = this.pests;
    for (let i = 0; i < p.n; i++) {
      if (!p.feeding[i]) continue;
      const c = Math.min(cols - 1, Math.floor(p.x[i] / cell));
      const r = Math.min(this.repellent.rows - 1, Math.floor(p.y[i] / cell));
      this.damage[r * cols + c] += dt / area;
    }

    // Survey drone.
    if (this.survey && !this.survey.done) {
      this.survey.step(dt, this.pests, this.rngSurvey);
      if (this.survey.done) {
        this.surveys.push(
          this.survey.result(this.crop, (sq) => this.damageLevelIn(sq), this.rngSurvey, this.time + dt)
        );
      }
    }

    this.time += dt;
    if (this.time + 1e-9 >= this.nextHistory) this.recordHistory();
    if (this.time + 1e-9 >= this.durationSec) this.finished = true;
  }

  /** Run for a number of simulated seconds. */
  advance(seconds: number): void {
    const steps = Math.round(seconds / this.dt);
    for (let i = 0; i < steps; i++) this.step();
  }

  /** Run to the end of the planned duration. */
  runToEnd(): void {
    while (!this.finished) this.step();
  }

  /** Average damage level (1 = "affected") in a rectangle of crop. */
  damageLevelIn(r: Rect): number {
    const cell = this.repellent.cell;
    let sum = 0;
    let k = 0;
    for (let y = r.y + cell / 2; y < r.y + r.h; y += cell) {
      for (let x = r.x + cell / 2; x < r.x + r.w; x += cell) {
        const c = Math.floor(x / cell);
        const rr = Math.floor(y / cell);
        if (c < 0 || rr < 0 || c >= this.repellent.cols || rr >= this.repellent.rows) continue;
        const i = rr * this.repellent.cols + c;
        if (!this.cropMask[i]) continue;
        sum += this.damage[i] / AFFECTED_DAMAGE;
        k++;
      }
    }
    return k ? sum / k : 0;
  }

  /**
   * Pests feeding right now: on the crop, not trapped, and not bothered by
   * repellent above the threshold.
   */
  feedingCount(): number {
    const p = this.pests;
    const th = this.settings.scent.threshold;
    let k = 0;
    for (let i = 0; i < p.n; i++) {
      if (p.trapped[i] || !inRect(p.x[i], p.y[i], this.crop)) continue;
      if (this.settings.pests.sensitivity > 0 && this.repellent.sample(p.x[i], p.y[i]) > th) continue;
      k++;
    }
    return k;
  }

  private pestsFeedingNow(): number {
    if (this.pests.n === 0) return 0;
    return (this.feedingCount() / this.pests.n) * 100;
  }

  private recordHistory(): void {
    const m = this.coreMetrics();
    this.history.push({
      t: this.time,
      pestsFeedingPct: m.pestsFeedingPct,
      cropAffectedPct: m.cropAffectedPct,
      productUsedGal: m.productUsedGal,
      scentCoveragePct: m.scentCoveragePct
    });
    this.awaySum += 100 - m.pestsFeedingPct;
    this.awayN++;
    this.nextHistory += HISTORY_EVERY_SEC;
  }

  private coreMetrics() {
    let affected = 0;
    let covered = 0;
    const th = this.settings.scent.threshold;
    for (let i = 0; i < this.damage.length; i++) {
      if (!this.cropMask[i]) continue;
      if (this.damage[i] >= AFFECTED_DAMAGE) affected++;
      if (this.repellent.data[i] > th) covered++;
    }
    const cells = Math.max(1, this.cropCells);
    return {
      cropAffectedPct: (affected / cells) * 100,
      pestsFeedingPct: this.pestsFeedingNow(),
      productUsedGal: lToGal(this.drone.litersSprayed),
      scentCoveragePct: (covered / cells) * 100
    };
  }

  metrics(): Metrics {
    const core = this.coreMetrics();
    const d = this.drone;
    const devicesUsed = this.devices.filter((e) => e.activatedAt !== null).length;
    const cost = computeCost(
      { sprayedAreaM2: d.sprayedAreaM2, litersUsed: d.litersSprayed, devicesUsed },
      this.settings.cost
    );
    return {
      timeSec: this.time,
      cropAffectedPct: core.cropAffectedPct,
      cropProtectedPct: 100 - core.cropAffectedPct,
      pestsFeedingPct: core.pestsFeedingPct,
      pestsDeterredPct: 100 - core.pestsFeedingPct,
      pestsDeterredAvgPct: this.awayN ? this.awaySum / this.awayN : 100 - core.pestsFeedingPct,
      pestsTrapped: this.pests.countTrapped(),
      productUsedGal: core.productUsedGal,
      productLeftGal: lToGal(d.stockL + d.payloadL),
      flightTimeMin: d.airborneSec / 60,
      flights: d.flights,
      refills: Math.max(0, d.tankFills - 1),
      batterySwaps: d.batterySwaps,
      distanceKm: d.distanceM / 1000,
      devicesUsed,
      acresSprayed: cost.acresSprayed,
      scentCoveragePct: core.scentCoveragePct,
      cost
    };
  }
}
