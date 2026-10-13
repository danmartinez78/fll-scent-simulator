import type { DroneSettings, Vec } from '../models/types';
import { dist } from '../utils/geometry';
import { galPerAcreToLPerM2, galToL } from '../utils/units';

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
  productAvailableGal: 20
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

  get busy(): boolean {
    return this.mode !== 'parked' || this.tasks.length > 0;
  }

  /** Battery fraction needed to fly home from here, plus the reserve. */
  private batteryNeededToReturn(devicesMassKg: number): number {
    const t = dist(this.x, this.y, this.home.x, this.home.y) / this.settings.speed;
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
  private loadUp(devicesMassKg: number): void {
    const s = this.settings;
    if (this.battery < 0.98 && this.flights > 0) this.batterySwaps++;
    this.battery = 1;

    const dropsLeft = this.tasks.filter((t) => t.kind === 'drop').length;
    const mass = Math.max(0.001, devicesMassKg);
    const wantDevices = Math.max(0, dropsLeft - this.devicesOnboard);
    const fitDevices = Math.floor((s.maxPayloadKg - this.payloadKg) / mass - this.devicesOnboard);
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

  private launchIfReady(devicesMassKg: number): void {
    if (this.tasks.length === 0) return;
    this.loadUp(devicesMassKg);
    if (this.tasks.length === 0) return;
    this.mode = 'flying';
    this.flights++;
    this.progressThisFlight = false;
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
        this.launchIfReady(mass);
      }
      return;
    }
    if (this.mode === 'parked') {
      this.launchIfReady(mass);
      if (this.mode === 'parked') return;
    }

    // Airborne: use battery. Heavier loads drain it faster.
    this.airborneSec += dt;
    this.battery -= dt / enduranceSec(s, this.payloadFraction(mass));
    if (this.trail.length === 0 || this.airborneSec % 2 < dt) this.trail.push({ x: this.x, y: this.y });
    if (this.trail.length > 4000) this.trail.splice(0, 1000);

    const stepLen = s.speed * dt;

    if (this.mode === 'returning') {
      if (this.moveToward(this.home.x, this.home.y, stepLen)) {
        this.mode = 'turnaround';
        this.turnaroundLeft = s.turnaroundSec;
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

    if (task.kind === 'drop') {
      if (this.devicesOnboard <= 0) {
        this.goHome('reload devices');
        return;
      }
      if (this.moveToward(task.at.x, task.at.y, stepLen)) {
        this.devicesOnboard--;
        this.devicesDropped++;
        this.progressThisFlight = true;
        world.dropDevice(task.deviceId);
        this.tasks.shift();
      }
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
    } else if (ranOut || this.payloadL <= 0.01) {
      // Pick up later from here.
      task.from = { x: this.x, y: this.y };
      this.goHome('refill');
    }
  }
}
