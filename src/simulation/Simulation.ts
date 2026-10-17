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
import { computeCost, DEFAULT_COSTS } from './CostModel';
import { Drone, productLimitL, type DroneBudget } from './Drone';
import { FATE_EATEN, FATE_POISONED, FATE_TRAPPED, PestSwarm, type PestEnvironment } from './Pest';
import { ScentField } from './ScentField';
import { SurveyRun } from './Survey';
import {
  activePlan,
  buildDroneTasks,
  deviceActive,
  deviceEmissionRate,
  deviceReachM,
  sprayTasksForZone,
  usesSprayZones,
  zoneKey,
  type DeviceState
} from './Treatment';
import { HelperSwarm } from './Helpers';
import { sprayDriftFactor, sprayerCosts, sprayerSettings, usesGroomba } from './Groomba';
import { pesticideKillRate, PESTICIDE_RULES } from './Pesticide';
import { RAIN_DEVICE_FACTOR, rainingAt, rainSpans, RESPRAY_AFTER_RAIN, washoffLifetimeSec, type RainSpan } from './Weather';
import { diffusionFor, RESIDUE_VAPOR_LIFETIME_SEC, RESIDUE_VAPOR_SHARE, scentDrift, sprayLanding } from './Wind';
import { SECONDS_PER_DAY, TIME_LAPSE } from '../utils/fieldTime';

/**
 * How long scent from a slow-release device lingers in the air, in model
 * minutes. It sets how big a device's steady scent patch grows; the wind
 * carries the rest away.
 */
export const DEVICE_PLUME_LIFETIME_MIN = 0.5;

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
 * A crop square with this many times the "affected" amount of feeding is
 * eaten bare: no food is left, so pests there move on to find more. Without
 * this, pests piled onto a few squares (around a lure, or in a hotspot) could
 * feed there for weeks without harming the rest of the crop.
 */
export const BARE_DAMAGE_FACTOR = 6;
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

/**
 * While a drone flies, pests are moved only once this much model time has
 * built up (about 2.4 farm minutes), instead of a hair's breadth every step.
 */
export const PEST_STEP_MIN_SEC = 0.1;

export interface SimOptions {
  /** Use fewer pests (the optimizer does this to run faster). */
  pestCount?: number;
  /** Start pests at these positions instead of the scenario's pattern. */
  initialPests?: Vec[];
  dt?: number;
  /** Use bigger grid squares (faster, blurrier). */
  cellSize?: number;
  /**
   * How many real pests each simulated pest stands for when feeding on the
   * crop (default 1). With fewer pests than the scenario has, set this to
   * scenario count / simulated count so crop damage builds up at the real rate.
   */
  pestWeight?: number;
}

export class Simulation {
  settings: Settings;
  plan: TreatmentPlan;
  readonly map: Rect;
  readonly crop: Rect;
  readonly home: Vec;
  readonly dt: number;
  /**
   * Model clock in seconds. Pests, scent and damage run on it. It slows to
   * 1/TIME_LAPSE while a drone flies (see utils/fieldTime.ts).
   */
  time = 0;
  /** Farm clock in seconds: real time while a drone flies, time-lapse otherwise. */
  fieldTime = 0;
  /** All repellent pests can sense: device plumes plus spray residue. */
  repellent: ScentField;
  /** Repellent in the air from slow-release devices (drifts with the wind). */
  repellentAir: ScentField;
  /** Sprayed repellent left on the plants (stays put and slowly wears off). */
  sprayResidue: ScentField;
  /** Smell given off by the spray residue, carried downwind by the wind. */
  residueVapor: ScentField;
  attractant: ScentField;
  /** Pesticide on the plants (stays put, wears off over days, kills on contact). */
  pesticide: ScentField;
  /** Helpful insects: bees and ladybugs. */
  helpers: HelperSwarm;
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
  /**
   * True once the run itself has begun. A survey flown before the run moves
   * the clock a little but does not start the run.
   */
  runStarted = false;
  /**
   * False until the treatment starts. A survey flown before the first Run
   * keeps the treatment drone and devices waiting until the run starts.
   */
  treatmentStarted = false;
  private holdTreatment = false;
  /** Farm time of the next repeat spray (see DroneSettings.resprayEveryDays). */
  private nextRespray = 0;
  /** Was it raining last step (to notice when a rain ends). */
  private wasRaining = false;
  /** Repeat sprays started so far. */
  resprays = 0;
  /** Real pests per simulated pest for crop damage (see SimOptions.pestWeight). */
  readonly pestWeight: number;
  /** Pest time saved up while a drone flies (see PEST_STEP_MIN_SEC). */
  private pestDtOwed = 0;
  private awaySum = 0;
  private awayN = 0;
  private nextHistory = 0;
  private rngMotion: Random;
  private rngSurvey: Random;
  private rngHelpers: Random;
  private rngPoison: Random;
  private zoneKeys = new Set<string>();

  constructor(settings: Settings, plan: TreatmentPlan, opts: SimOptions = {}) {
    this.settings = structuredClone(settings);
    this.plan = structuredClone(plan);
    this.dt = opts.dt ?? DEFAULT_DT;
    this.pestWeight = opts.pestWeight ?? 1;
    const f = settings.field;
    this.map = { x: 0, y: 0, w: f.width, h: f.height };
    this.crop = cropRect(f);
    this.home = homePoint(f);
    const cell = opts.cellSize ?? gridCellSize(f);
    this.repellent = new ScentField(f.width, f.height, cell);
    this.repellentAir = new ScentField(f.width, f.height, cell);
    this.sprayResidue = new ScentField(f.width, f.height, cell);
    this.residueVapor = new ScentField(f.width, f.height, cell);
    this.attractant = new ScentField(f.width, f.height, cell);
    this.pesticide = new ScentField(f.width, f.height, cell);
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
    this.rngHelpers = new Random(childSeed(seed, 7));
    this.rngPoison = new Random(childSeed(seed, 8));
    this.helpers = HelperSwarm.create(settings.helpers, f.width, f.height, this.crop, new Random(childSeed(seed, 6)));
    this.pests = opts.initialPests
      ? PestSwarm.fromPositions(opts.initialPests, rngStart)
      : PestSwarm.create(settings.pests, f.width, f.height, this.crop, rngStart, opts.pestCount);
    this.pests.assignToughness(new Random(childSeed(seed, 4)));
    // Days stored in settings are farm days; pest rules run in model seconds.
    const buildUpSec = ((settings.pests.buildUpDays ?? 0) * SECONDS_PER_DAY) / TIME_LAPSE;
    this.pests.assignArrivals(buildUpSec, new Random(childSeed(seed, 5)));
    // The groomba does the spraying when it is chosen; it works the same jobs as the drone.
    this.drone = new Drone(sprayerSettings(settings), this.home);
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
      this.drone.tasks.push(...sprayTasksForZone(z, this.map, sprayerSettings(s)));
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
    this.settings = structuredClone(settings);
    this.drone.settings = { ...sprayerSettings(settings) };
    // What is left in storage: the new limit minus what is already sprayed or in the tank.
    this.drone.stockL = Math.max(0, productLimitL(settings.drone) - this.drone.litersSprayed - this.drone.payloadL);
    if (methodChanged) this.setPlan(this.plan);
  }

  /**
   * Send the survey drone over the map. With `holdTreatment`, a survey flown
   * before the treatment has started leaves the treatment waiting until
   * startTreatment() is called, so only the survey drone flies.
   */
  startSurvey(holdTreatment = false): void {
    if (holdTreatment && !this.treatmentStarted) this.holdTreatment = true;
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

  /**
   * Let the treatment go: it starts now, or on the planned start day if that
   * is later (see RunSettings.treatStartDay).
   */
  startTreatment(): void {
    this.holdTreatment = false;
    if (this.fieldTime + 1e-6 >= this.treatStartFieldSec) this.beginTreatment();
  }

  /** The drone takes off and hand-placed devices start releasing now. */
  private beginTreatment(): void {
    if (this.treatmentStarted) return;
    this.treatmentStarted = true;
    if (!this.settings.devices.deployByDrone) {
      for (const d of this.devices) if (d.activatedAt !== null) d.activatedAt = this.time;
    }
  }

  /**
   * Keep the surveys another run of the same field flew before it started, so
   * starting over does not mean flying the survey again. Only used when the
   * pests start the same way (same field, pests and seed), so the map still fits.
   */
  adoptSurveysFrom(old: Simulation): number {
    const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
    const s = this.settings;
    const o = old.settings;
    if (!same(s.field, o.field) || !same(s.pests, o.pests) || s.run.seed !== o.run.seed || !same(s.survey, o.survey)) return 0;
    this.surveys = old.surveys.filter((r) => r.beforeRun).map((r) => ({ ...r }));
    return this.surveys.length;
  }

  /** True while a survey flown before the first Run is keeping the treatment waiting. */
  get treatmentWaiting(): boolean {
    return this.holdTreatment && !this.treatmentStarted;
  }

  /** Farm time the treatment is planned to start (see RunSettings.treatStartDay). */
  get treatStartFieldSec(): number {
    return Math.max(0, (this.settings.run.treatStartDay ?? 1) - 1) * SECONDS_PER_DAY;
  }

  /** True while the run is waiting for the planned treatment day. */
  get treatmentScheduled(): boolean {
    return !this.treatmentStarted && !this.holdTreatment && this.settings.treatment !== 'none';
  }

  /** True while the treatment drone or the survey drone is working (the field clock runs in real time). */
  get droneFlying(): boolean {
    // A drone waiting on the ground for rain to stop is not flying: the field keeps its time-lapse.
    const waitingOutRain = this.drone.mode === 'parked' && this.raining;
    return (this.treatmentStarted && this.drone.busy && !waitingOutRain) || this.surveying;
  }

  /** The rains in this run (farm clock). */
  get rains(): RainSpan[] {
    return rainSpans(this.settings);
  }

  /** Is it raining right now? */
  get raining(): boolean {
    return rainingAt(this.rains, this.fieldTime);
  }

  /** Is the crop square at this point eaten bare (see BARE_DAMAGE_FACTOR)? */
  isBare(x: number, y: number): boolean {
    const cell = this.repellent.cell;
    const c = Math.min(this.repellent.cols - 1, Math.max(0, Math.floor(x / cell)));
    const r = Math.min(this.repellent.rows - 1, Math.max(0, Math.floor(y / cell)));
    return this.damage[r * this.repellent.cols + c] >= BARE_DAMAGE_FACTOR * AFFECTED_DAMAGE;
  }

  /** Spray again when a rain ends, if the plan says so (see RESPRAY_AFTER_RAIN). */
  private maybeSprayAfterRain(raining: boolean): void {
    const ended = this.wasRaining && !raining;
    this.wasRaining = raining;
    const s = this.settings;
    if (!ended || !usesSprayZones(s.treatment) || s.drone.resprayEveryDays !== RESPRAY_AFTER_RAIN || !this.treatmentStarted) return;
    const zones = this.effectivePlan.sprayZones;
    if (zones.length && this.drone.stockL > 0.01 && !this.drone.outOfBudget) {
      for (const z of zones) this.drone.tasks.push(...sprayTasksForZone(z, this.map, sprayerSettings(s)));
      this.resprays++;
    }
  }

  /** True while the groomba (not the drone) is out driving its jobs. */
  get groombaDriving(): boolean {
    return usesGroomba(this.settings) && this.treatmentStarted && this.drone.mode !== 'parked' && !this.surveying;
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
    const lures: Vec[] = [];
    const plainLures: Vec[] = [];
    for (const d of this.devices) {
      if (d.kind !== 'attractant' || !this.treatmentStarted || !deviceActive(d, this.time, s.devices.lifetimeMin)) continue;
      lures.push({ x: d.x, y: d.y });
      if (d.trap) traps.push({ x: d.x, y: d.y });
      else plainLures.push({ x: d.x, y: d.y });
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
      traps,
      lures,
      plainLures,
      bareAt: (x, y) => this.isBare(x, y)
    };
  }

  /** Dollars spent so far (flight time, product sprayed and devices put out). */
  spentSoFar(): number {
    const d = this.drone;
    const devicesUsed = this.devices.filter((e) => e.activatedAt !== null).length;
    return computeCost(
      { sprayedAreaM2: d.sprayedAreaM2, litersUsed: d.litersSprayed, devicesUsed, flightMin: d.airborneSec / 60 },
      sprayerCosts(this.settings)
    ).total;
  }

  /** The budget the drone works within, or undefined when there is none. */
  private droneBudget(): DroneBudget | undefined {
    const c = sprayerCosts(this.settings);
    if (!c.budget || c.budget <= 0) return undefined;
    return {
      left: () => c.budget! - this.spentSoFar(),
      perSec: (c.flightCostPerMin ?? DEFAULT_COSTS.flightCostPerMin) / 60,
      perLiter: lToGal(1) * c.materialCostPerGal,
      perDevice: c.deviceCost
    };
  }

  private maybeRespray(): void {
    const s = this.settings;
    const every = s.drone.resprayEveryDays ?? 0;
    if (!usesSprayZones(s.treatment) || every <= 0 || !this.treatmentStarted || this.finished) return;
    if (this.nextRespray === 0) this.nextRespray = this.fieldTime + every * SECONDS_PER_DAY;
    // Wait for the drone to finish its current work before starting the next round.
    if (this.fieldTime < this.nextRespray || this.drone.busy) return;
    const zones = this.effectivePlan.sprayZones;
    if (zones.length && this.drone.stockL > 0.01 && !this.drone.outOfBudget) {
      for (const z of zones) this.drone.tasks.push(...sprayTasksForZone(z, this.map, sprayerSettings(s)));
      this.resprays++;
    }
    this.nextRespray += every * SECONDS_PER_DAY;
  }

  /** Advance one time step. */
  step(): void {
    const dt = this.dt;
    const s = this.settings;
    const cell = this.repellent.cell;
    const cols = this.repellent.cols;
    if (!this.holdTreatment) {
      this.runStarted = true;
      this.startTreatment();
    }
    const treating = this.treatmentStarted;
    // While a drone flies, the field clock runs in real time and the field
    // itself barely changes; otherwise it runs as a time-lapse.
    const flying = this.droneFlying;
    const raining = this.raining;
    const fieldDt = flying ? dt : dt * TIME_LAPSE;
    const bioDt = flying ? dt / TIME_LAPSE : dt;

    // Repeat sprays: send the drone over every spray zone again on schedule.
    this.maybeRespray();
    this.maybeSprayAfterRain(raining);

    // Drone: flies its jobs, sprays and drops devices.
    const sprayed = this.sprayed;
    if (treating) this.drone.step(dt, {
      budget: this.droneBudget(),
      grounded: raining,
      devicesMassKg: s.devices.massKg,
      // Setups saved before this setting existed keep their old behavior (no rack limit).
      devicesPerTrip: s.devices.perTrip,
      spray: (x, y, liters, swath) => {
        // Pesticide goes into its own grid; scent strength doesn't apply to it.
        const isPesticide = s.treatment === 'pesticide';
        const amount = (liters / REFERENCE_RATE_L_PER_M2) * (isPesticide ? 1 : s.scent.strength);
        const target = isPesticide ? this.pesticide : this.sprayResidue;
        // Wind pushes the falling drops downwind; drops that land off the map are lost.
        for (const part of sprayLanding(s.wind, this.time, sprayDriftFactor(s))) {
          target.addGaussian(x + part.dx, y + part.dy, amount * part.share, swath / 2.5 + part.spread);
        }
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
    const lureRange = deviceReachM('attractant', s);
    // Rain knocks device scent out of the air while it lasts.
    const rainFactor = raining ? RAIN_DEVICE_FACTOR : 1;
    const emitRep = deviceEmissionRate(s.scent.strength, s.devices.releaseRate, s.scent.rangeM) * bioDt * rainFactor;
    const emitAtt = deviceEmissionRate(s.scent.strength, s.devices.releaseRate, lureRange) * bioDt * rainFactor;
    for (const d of this.devices) {
      if (!treating || !deviceActive(d, this.time, s.devices.lifetimeMin)) continue;
      if (d.kind === 'repellent') this.repellentAir.addGaussian(d.x, d.y, emitRep, s.scent.rangeM / 2);
      else this.attractant.addGaussian(d.x, d.y, emitAtt, lureRange / 2);
    }

    // Scent drifts, spreads and fades.
    const drift = scentDrift(s.wind, this.time);
    const diff = diffusionFor(s.wind);
    const plumeLife = DEVICE_PLUME_LIFETIME_MIN * 60;
    this.repellentAir.step(dt, drift.x, drift.y, diff, plumeLife, bioDt);
    this.attractant.step(dt, drift.x, drift.y, diff, plumeLife, bioDt);
    // Spray residue sits on the plants and wears off over the spray's lifetime.
    this.sprayResidue.fade(bioDt, s.scent.lifetimeMin * 60);
    // Rain washes most of the spray off the leaves (RAIN_WASHOFF over one rain).
    if (raining) this.sprayResidue.fade(fieldDt, washoffLifetimeSec(s));
    // The residue's smell drifts downwind. Fed so that with no wind it matches
    // RESIDUE_VAPOR_SHARE of the residue; it runs on the farm clock like the residue.
    const vapor = this.residueVapor;
    if (!this.sprayResidue.empty) {
      const feed = RESIDUE_VAPOR_SHARE * (1 - Math.exp(-bioDt / RESIDUE_VAPOR_LIFETIME_SEC));
      for (let i = 0; i < vapor.data.length; i++) vapor.data[i] += this.sprayResidue.data[i] * feed;
      vapor.touch();
    }
    vapor.step(bioDt, drift.x, drift.y, diff, RESIDUE_VAPOR_LIFETIME_SEC);
    // Pesticide wears off the plants over days, and rain washes it off too.
    this.pesticide.fade(bioDt, PESTICIDE_RULES.lifetimeMin * 60);
    if (raining) this.pesticide.fade(fieldDt, washoffLifetimeSec(s));
    const rep = this.repellent.data;
    const air = this.repellentAir.data;
    const res = this.sprayResidue.data;
    for (let i = 0; i < rep.length; i++) rep[i] = air[i] + res[i] * (1 - RESIDUE_VAPOR_SHARE) + vapor.data[i];
    this.repellent.empty = this.repellentAir.empty && this.sprayResidue.empty && vapor.empty;

    // Pests arrive, move and feed. While a drone flies the field clock
    // barely moves, so pest time is saved up and spent in one step once
    // enough has built up: the same movement and feeding, far fewer steps.
    this.pestDtOwed += bioDt;
    if (!flying || this.pestDtOwed >= PEST_STEP_MIN_SEC) {
      this.stepPests(this.pestDtOwed);
      this.pestDtOwed = 0;
    }

    // Survey drone.
    if (this.survey && !this.survey.done) {
      this.survey.step(dt, this.pests, this.rngSurvey);
      if (this.survey.done) {
        const result = this.survey.result(this.crop, (sq) => this.damageLevelIn(sq), this.rngSurvey, this.fieldTime + dt);
        this.surveys.push(this.runStarted ? result : { ...result, beforeRun: true });
      }
    }

    this.time += bioDt;
    this.fieldTime += flying ? dt : dt * TIME_LAPSE;
    if (this.time + 1e-9 >= this.nextHistory) this.recordHistory();
    if (this.time + 1e-9 >= this.durationSec) this.finished = true;
  }

  /** Move the pests `dt` model seconds and add their feeding to the crop damage. */
  private stepPests(dt: number): void {
    const cell = this.repellent.cell;
    const cols = this.repellent.cols;
    this.pests.now = this.time;
    const env = this.pestEnvironment();
    this.pests.step(dt, env, this.rngMotion);
    // Pesticide kills pests it touches, even the ones that ignore scent.
    if (!this.pesticide.empty) {
      const p = this.pests;
      for (let i = 0; i < p.n; i++) {
        // A few pests are resistant (a fixed random share, separate from those that ignore scent).
        if (p.trapped[i] || !p.present(i) || p.toughness[i] < PESTICIDE_RULES.resistantShare) continue;
        const rate = pesticideKillRate(this.pesticide.sample(p.x[i], p.y[i]));
        if (rate > 0 && this.rngPoison.chance(1 - Math.exp(-rate * dt))) p.remove(i, FATE_POISONED);
      }
    }
    // Helpful insects: move, eat pests (ladybugs), and die from pesticide or sticky traps.
    if (this.helpers.n) {
      this.helpers.step(
        dt,
        {
          width: env.width,
          height: env.height,
          crop: this.crop,
          pesticide: this.pesticide,
          killRate: pesticideKillRate,
          traps: env.traps,
          pests: this.pests
        },
        this.rngHelpers
      );
    }
    const area = cell * cell;
    const p = this.pests;
    const weight = this.pestWeight / area;
    for (let i = 0; i < p.n; i++) {
      if (!p.feeding[i]) continue;
      const c = Math.min(cols - 1, Math.floor(p.x[i] / cell));
      const r = Math.min(this.repellent.rows - 1, Math.floor(p.y[i] / cell));
      this.damage[r * cols + c] += dt * weight;
    }
  }

  /** Run this many seconds' worth of steps (the model clock moves less while a drone flies). */
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
   * Pests feeding right now: on the crop, not trapped, not flying on after
   * escaping repellent, and not bothered by repellent above the threshold.
   * Pests that ignore the scent keep feeding inside it, the same rule crop
   * damage uses.
   */
  feedingCount(): number {
    const p = this.pests;
    const th = this.settings.scent.threshold;
    const effectiveness = (this.settings.scent.effectivenessPct ?? 100) / 100;
    let k = 0;
    for (let i = 0; i < p.n; i++) {
      if (p.trapped[i] || !p.present(i) || p.wary[i] > 0 || !inRect(p.x[i], p.y[i], this.crop) || this.isBare(p.x[i], p.y[i])) continue;
      if (
        this.settings.pests.sensitivity > 0 &&
        p.reacts(i, effectiveness) &&
        this.repellent.sample(p.x[i], p.y[i]) > th
      )
        continue;
      k++;
    }
    return k;
  }

  /** Percent of the pests in the field right now that are feeding. */
  private pestsFeedingNow(): number {
    const present = this.pests.countPresent();
    if (present === 0) return 0;
    return (this.feedingCount() / present) * 100;
  }

  /** Insects killed and kept alive (the biodiversity numbers). */
  lifeCounts() {
    const p = this.pests;
    const h = this.helpers;
    const trapped = p.countFate(FATE_TRAPPED);
    const poisoned = p.countFate(FATE_POISONED);
    const helpersAlive = h.countAlive();
    return {
      pestsKilled: trapped + poisoned,
      pestsPoisoned: poisoned,
      pestsEaten: p.countFate(FATE_EATEN),
      helpersTotal: h.n,
      helpersAlive,
      helpersAlivePct: h.n ? (helpersAlive / h.n) * 100 : 100,
      helpersKilled: h.n - helpersAlive
    };
  }

  private recordHistory(): void {
    const m = this.coreMetrics();
    const life = this.lifeCounts();
    this.history.push({
      t: this.time,
      pestsFeedingPct: m.pestsFeedingPct,
      pestsPresentPct: this.pests.n ? (this.pests.countPresent() / this.pests.n) * 100 : 0,
      cropAffectedPct: m.cropAffectedPct,
      productUsedGal: m.productUsedGal,
      scentCoveragePct: m.scentCoveragePct,
      helpersAlivePct: life.helpersAlivePct,
      pestsKilledPct: this.pests.n ? (life.pestsKilled / this.pests.n) * 100 : 0
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
      { sprayedAreaM2: d.sprayedAreaM2, litersUsed: d.litersSprayed, devicesUsed, flightMin: d.airborneSec / 60 },
      sprayerCosts(this.settings)
    );
    return {
      timeSec: this.time,
      fieldTimeSec: this.fieldTime,
      cropAffectedPct: core.cropAffectedPct,
      cropProtectedPct: 100 - core.cropAffectedPct,
      pestsFeedingPct: core.pestsFeedingPct,
      pestsDeterredPct: 100 - core.pestsFeedingPct,
      pestsDeterredAvgPct: this.awayN ? this.awaySum / this.awayN : 100 - core.pestsFeedingPct,
      pestsTrapped: this.pests.countTrapped(),
      ...this.lifeCounts(),
      productUsedGal: core.productUsedGal,
      productLeftGal: Number.isFinite(d.stockL) ? lToGal(d.stockL + d.payloadL) : null,
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
