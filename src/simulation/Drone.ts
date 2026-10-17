import type { DroneSettings, Vec } from '../models/types';
import { dist } from '../utils/geometry';
import { galPerAcreToLPerM2, galToL } from '../utils/units';

/** Default seconds to take off and climb, and again to descend and land, on each flight. */
export const TAKEOFF_LANDING_SEC = 30;
/** Seconds to slow down, turn and speed back up at the end of each spray pass. */
export const PASS_TURN_SEC = 6;
/** Default seconds loitering over a spot to descend, steady, release one device and climb back. */
export const DROP_LOITER_SEC = 30;

/**
 * Educational reference values loosely based on the published DJI Agras T50
 * spec sheet. They are reference numbers, not guaranteed mission endurance.
 */
export const T50_REFERENCE: DroneSettings = {
  tankL: 40,
  maxPayloadKg: 40,
  hoverEmptyMin: 16.5,
  hoverFullMin: 7,
  reservePct: 20,
  speed: 6,
  swathM: 7,
  appRateGalPerAcre: 2,
  turnaroundSec: 60,
  // Enough to spray the standard field every 3 days for the whole run, so
  // product only runs short in missions that limit it on purpose.
  productAvailableGal: 70,
  takeoffLandingSec: TAKEOFF_LANDING_SEC,
  dropLoiterSec: DROP_LOITER_SEC
};

/** The spray tank liquid is treated as water-like: 1 liter weighs 1 kg. */
export const KG_PER_LITER = 1;

/** One job in the drone's to-do list. */
export type DroneTask =
  | { kind: 'spray'; from: Vec; to: Vec; zoneKey: string }
  | { kind: 'drop'; at: Vec; deviceId: number };

export type DroneMode = 'parked' | 'flying' | 'returning' | 'turnaround';

/** What the drone needs from the world while it works. */
export interface DroneWorld {
  /** Put `liters` of spray down at a point, spread across `swath` meters. */
  spray(x: number, y: number, liters: number, swath: number): void;
  /** A device was dropped and should start working. */
  dropDevice(deviceId: number): void;
  devicesMassKg: number;
  /** Most devices the drop rack holds on one trip (no limit if left out). */
  devicesPerTrip?: number;
  /** Money and prices, when the run has a budget (see CostSettings.budget). */
  budget?: DroneBudget;
}

/** What the drone needs to know to stay within a budget. */
export interface DroneBudget {
  /** Dollars not spent yet. */
  left(): number;
  /** Flight cost, dollars per second in the air. */
  perSec: number;
  /** Dollars per liter of spray. */
  perLiter: number;
  /** Dollars per device dropped. */
  perDevice: number;
}

/** How many devices fit on one trip: the drop rack's slots or the weight limit, whichever is smaller. */
export function devicesPerTrip(s: DroneSettings, massKg: number, rackSlots = Infinity): number {
  return Math.max(0, Math.min(rackSlots, Math.floor(s.maxPayloadKg / Math.max(0.001, massKg))));
}

/**
 * Hover endurance (seconds) for a given payload fraction (0 = empty, 1 = full).
 * A straight line between the two reference hover times.
 */
export function enduranceSec(s: DroneSettings, payloadFraction: number): number {
  const p = Math.min(1, Math.max(0, payloadFraction));
  return (s.hoverEmptyMin + (s.hoverFullMin - s.hoverEmptyMin) * p) * 60;
}

/** Liters needed to spray a strip of the given length. */
export function litersForLength(s: DroneSettings, lengthM: number): number {
  return galPerAcreToLPerM2(s.appRateGalPerAcre) * s.swathM * lengthM;
}

export class Drone {
  settings: DroneSettings;
  home: Vec;
  x: number;
  y: number;
  heading = 0;
  mode: DroneMode = 'parked';
  tasks: DroneTask[] = [];
  /** Spray currently in the tank, liters. */
  payloadL = 0;
  devicesOnboard = 0;
  /** Battery charge, 0 to 1. */
  battery = 1;
  /** Product still in storage at home (not yet loaded), liters. */
  stockL: number;
  spraying = false;
  turnaroundLeft = 0;
  /** Why the drone came home last time (shown to students). */
  lastReturnReason = '';
  outOfProduct = false;
  gaveUp = false;
  /** The money ran out, so the rest of the jobs were dropped. */
  outOfBudget = false;

  // Logbook
  distanceM = 0;
  airborneSec = 0;
  flights = 0;
  tankFills = 0;
  batterySwaps = 0;
  litersSprayed = 0;
  sprayedAreaM2 = 0;
  devicesDropped = 0;
  /** Path flown, for drawing (sampled points). */
  trail: Vec[] = [];

  /** Seconds left hovering in place (taking off, landing or dropping a device). */
  hoverLeft = 0;
  hoverFor: 'takeoff' | 'landing' | 'drop' | 'turn' | null = null;

  private progressThisFlight = false;
  private idleFlights = 0;

  constructor(settings: DroneSettings, home: Vec) {
    this.settings = { ...settings };
    this.home = { ...home };
    this.x = home.x;
    this.y = home.y;
    this.stockL = galToL(settings.productAvailableGal);
  }

  get payloadKg(): number {
    return this.payloadL * KG_PER_LITER;
  }

  payloadFraction(devicesMassKg: number): number {
    return (this.payloadKg + this.devicesOnboard * devicesMassKg) / this.settings.maxPayloadKg;
  }

  /** Minutes of flying left before the reserve, at the current load. */
  minutesLeft(devicesMassKg: number): number {
    const usable = Math.max(0, this.battery - this.settings.reservePct / 100);
    return (usable * enduranceSec(this.settings, this.payloadFraction(devicesMassKg))) / 60;
  }

  /** Seconds to take off (and, separately, to land). */
  private get landingSec(): number {
    return this.settings.takeoffLandingSec ?? TAKEOFF_LANDING_SEC;
  }

  get busy(): boolean {
    return this.mode !== 'parked' || this.tasks.length > 0;
  }

  /** Battery fraction needed to fly home from here, plus the reserve. */
  private batteryNeededToReturn(devicesMassKg: number): number {
    const t = dist(this.x, this.y, this.home.x, this.home.y) / this.settings.speed + this.landingSec;
    const endurance = enduranceSec(this.settings, this.payloadFraction(devicesMassKg));
    return this.settings.reservePct / 100 + (t / endurance) * 1.15 + 0.005;
  }

  private remainingSprayLiters(): number {
    let l = 0;
    for (const t of this.tasks) {
      if (t.kind === 'spray') l += litersForLength(this.settings, dist(t.from.x, t.from.y, t.to.x, t.to.y));
    }
    return l;
  }

  /** Fill up at home: battery, tank and devices. */
  private loadUp(devicesMassKg: number, rackSlots: number): void {
    const s = this.settings;
    if (this.battery < 0.98 && this.flights > 0) this.batterySwaps++;
    this.battery = 1;

    const dropsLeft = this.tasks.filter((t) => t.kind === 'drop').length;
    const mass = Math.max(0.001, devicesMassKg);
    const wantDevices = Math.max(0, dropsLeft - this.devicesOnboard);
    const fitDevices = Math.min(
      Math.floor((s.maxPayloadKg - this.payloadKg) / mass - this.devicesOnboard),
      rackSlots - this.devicesOnboard
    );
    this.devicesOnboard += Math.max(0, Math.min(wantDevices, fitDevices));

    // Drop slivers of strips too short to matter (left over from rounding).
    this.tasks = this.tasks.filter(
      (t) => t.kind !== 'spray' || dist(t.from.x, t.from.y, t.to.x, t.to.y) > 0.5
    );
    // A little extra over the exact need covers rounding along the way.
    const needL = this.remainingSprayLiters() * 1.02 + 0.2 - this.payloadL;
    if (this.remainingSprayLiters() > 0 && needL > 0.01) {
      const roomL = Math.min(
        s.tankL - this.payloadL,
        (s.maxPayloadKg - this.devicesOnboard * devicesMassKg) / KG_PER_LITER - this.payloadL
      );
      const add = Math.max(0, Math.min(needL, roomL, this.stockL));
      if (add > 0.01) {
        this.payloadL += add;
        this.stockL -= add;
        this.tankFills++;
      }
    }
    // Nothing left to spray with: drop the remaining spray jobs.
    if (this.payloadL < 0.01 && this.stockL < 0.01 && this.tasks.some((t) => t.kind === 'spray')) {
      this.tasks = this.tasks.filter((t) => t.kind !== 'spray');
      this.outOfProduct = true;
    }
  }

  /** Seconds to fly from here to a point, then home, and land. */
  private secViaHome(p: Vec | null): number {
    const leg = p ? dist(this.x, this.y, p.x, p.y) + dist(p.x, p.y, this.home.x, this.home.y) : dist(this.x, this.y, this.home.x, this.home.y);
    return leg / this.settings.speed + this.landingSec;
  }

  /** Drop every job and stop: the money is used up. */
  private stopForBudget(): void {
    this.tasks = [];
    this.outOfBudget = true;
  }

  private launchIfReady(world: DroneWorld): void {
    if (this.tasks.length === 0) return;
    // A flight costs at least a takeoff and a landing; don't start one the budget can't pay for.
    const b = world.budget;
    if (b && b.left() < 2 * this.landingSec * b.perSec + 1) {
      this.stopForBudget();
      return;
    }
    this.loadUp(world.devicesMassKg, world.devicesPerTrip ?? Infinity);
    if (this.tasks.length === 0) return;
    this.mode = 'flying';
    this.flights++;
    this.progressThisFlight = false;
    this.hover('takeoff', this.landingSec);
  }

  private hover(kind: 'takeoff' | 'landing' | 'drop' | 'turn', sec: number): void {
    this.hoverFor = sec > 0 ? kind : null;
    this.hoverLeft = sec;
  }

  /** Back on the ground at home: refill and swap the battery, or park if the work is done. */
  private landed(): void {
    this.mode = 'turnaround';
    this.turnaroundLeft = this.settings.turnaroundSec;
    if (!this.progressThisFlight) this.idleFlights++;
    else this.idleFlights = 0;
    // Safety: if two flights in a row got nothing done, the job is out of reach.
    if (this.idleFlights >= 2) {
      this.tasks = [];
      this.gaveUp = true;
    }
    if (this.tasks.length === 0) {
      this.mode = 'parked';
      this.turnaroundLeft = 0;
    }
  }

  /** Move toward a point; returns true when it got there this step. */
  private moveToward(tx: number, ty: number, maxStep: number): boolean {
    const dx = tx - this.x;
    const dy = ty - this.y;
    const d = Math.hypot(dx, dy);
    if (d < 1e-6) return true;
    this.heading = Math.atan2(dy, dx);
    if (d <= maxStep) {
      this.x = tx;
      this.y = ty;
      this.distanceM += d;
      // Mark every turn point (drops, strip ends, home) so the drawn path passes through it.
      this.trail.push({ x: tx, y: ty });
      return true;
    }
    this.x += (dx / d) * maxStep;
    this.y += (dy / d) * maxStep;
    this.distanceM += maxStep;
    return false;
  }

  private goHome(reason: string): void {
    this.mode = 'returning';
    this.spraying = false;
    this.lastReturnReason = reason;
  }

  step(dt: number, world: DroneWorld): void {
    const s = this.settings;
    const mass = world.devicesMassKg;

    if (this.mode === 'turnaround') {
      this.turnaroundLeft -= dt;
      if (this.turnaroundLeft <= 0) {
        this.mode = 'parked';
        this.launchIfReady(world);
      }
      return;
    }
    if (this.mode === 'parked') {
      this.launchIfReady(world);
      if (this.mode === 'parked') return;
    }

    // Airborne: use battery. Heavier loads drain it faster.
    this.airborneSec += dt;
    this.battery -= dt / enduranceSec(s, this.payloadFraction(mass));
    if (this.trail.length === 0 || this.airborneSec % 2 < dt) this.trail.push({ x: this.x, y: this.y });
    if (this.trail.length > 4000) this.trail.splice(0, 1000);

    const stepLen = s.speed * dt;

    // Taking off, landing or hovering over a drop spot.
    if (this.hoverFor) {
      this.hoverLeft -= dt;
      if (this.hoverLeft > 1e-9) return;
      const done = this.hoverFor;
      this.hoverFor = null;
      this.hoverLeft = 0;
      if (done === 'landing') this.landed();
      else if (done === 'drop') {
        const task = this.tasks[0];
        if (task?.kind === 'drop') {
          this.devicesOnboard--;
          this.devicesDropped++;
          this.progressThisFlight = true;
          world.dropDevice(task.deviceId);
          this.tasks.shift();
        }
      }
      return;
    }

    if (this.mode === 'returning') {
      if (this.moveToward(this.home.x, this.home.y, stepLen)) {
        if (this.landingSec > 0) this.hover('landing', this.landingSec);
        else this.landed();
      }
      return;
    }

    // Flying a job.
    if (this.battery <= this.batteryNeededToReturn(mass)) {
      const current = this.tasks[0];
      if (this.spraying && current?.kind === 'spray') current.from = { x: this.x, y: this.y };
      this.goHome('battery');
      return;
    }
    const task = this.tasks[0];
    if (!task) {
      this.goHome('done');
      return;
    }
    // Budget: keep enough money to finish this job (a drop) or this bit of spray, and fly home.
    const b = world.budget;
    if (b) {
      const need =
        task.kind === 'drop'
          ? (this.secViaHome(task.at) + (this.settings.dropLoiterSec ?? DROP_LOITER_SEC)) * b.perSec + b.perDevice
          : this.secViaHome(null) * b.perSec + (dt * b.perSec + litersForLength(s, stepLen) * b.perLiter) * 2;
      if (b.left() < need) {
        if (this.spraying && task.kind === 'spray') task.from = { x: this.x, y: this.y };
        this.stopForBudget();
        this.goHome('budget');
        return;
      }
    }

    if (task.kind === 'drop') {
      if (this.devicesOnboard <= 0) {
        this.goHome('reload devices');
        return;
      }
      if (this.moveToward(task.at.x, task.at.y, stepLen)) this.hover('drop', this.settings.dropLoiterSec ?? DROP_LOITER_SEC);
      return;
    }

    // Spray task: fly to the start of the strip, then spray along it.
    if (!this.spraying) {
      if (this.payloadL <= 0.01) {
        this.goHome('refill');
        return;
      }
      if (this.moveToward(task.from.x, task.from.y, stepLen)) this.spraying = true;
      return;
    }
    const sx = this.x;
    const sy = this.y;
    const remaining = dist(sx, sy, task.to.x, task.to.y);
    let move = Math.min(stepLen, remaining);
    let liters = litersForLength(s, move);
    let ranOut = false;
    if (liters > this.payloadL) {
      // Only enough for part of this step.
      move *= this.payloadL / liters;
      liters = this.payloadL;
      ranOut = true;
    }
    this.moveToward(
      sx + ((task.to.x - sx) / (remaining || 1)) * move,
      sy + ((task.to.y - sy) / (remaining || 1)) * move,
      move + 1e-9
    );
    if (liters > 0) {
      world.spray((sx + this.x) / 2, (sy + this.y) / 2, liters, s.swathM);
      this.payloadL -= liters;
      this.litersSprayed += liters;
      this.sprayedAreaM2 += move * s.swathM;
      this.progressThisFlight = true;
    }
    if (dist(this.x, this.y, task.to.x, task.to.y) < 0.5) {
      this.tasks.shift();
      this.spraying = false;
      // Slow down and turn around before the next pass.
      if (this.tasks[0]?.kind === 'spray') this.hover('turn', PASS_TURN_SEC);
    } else if (ranOut || this.payloadL <= 0.01) {
      // Pick up later from here.
      task.from = { x: this.x, y: this.y };
      this.goHome('refill');
    }
  }
}
