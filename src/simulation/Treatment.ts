import type {
  DevicePlan,
  DeviceSettings,
  DroneSettings,
  Rect,
  ScentKind,
  TreatmentMethod,
  TreatmentPlan,
  Vec
} from '../models/types';
import { dist, intersectRect, lawnmower } from '../utils/geometry';
import { litersForLength, type DroneTask } from './Drone';

/**
 * Scent released by one standard slow-release device with a
 * DEVICE_REFERENCE_RANGE_M range, in scent units x square meters per second,
 * before multiplying by scent strength and release rate. Chosen so a device in
 * still air builds a patch pests notice that reaches about its "effective
 * range" from the device.
 */
export const DEVICE_BASE_EMISSION = 8;
/** Effective range (meters) that DEVICE_BASE_EMISSION is calibrated for. */
export const DEVICE_REFERENCE_RANGE_M = 12;

/**
 * An attractant lure is noticed much farther away than a repellent: insects
 * follow faint attractant smells (like pheromones) from a long way off. Its
 * scent spreads this many times wider than the effective range, with release
 * scaled up to match, so a trap can pull pests in from across part of the field.
 */
export const ATTRACTANT_REACH_FACTOR = 3;

/** How far a device's scent reaches in still air, in meters. */
export function deviceReachM(kind: ScentKind, rangeM: number): number {
  return kind === 'attractant' ? rangeM * ATTRACTANT_REACH_FACTOR : rangeM;
}

/**
 * Scent one device releases per model second. A longer range spreads the
 * scent over a bigger circle, so the release grows with that circle's area
 * (twice the range, four times the scent). Without this, a longer range would
 * spread the same scent thinner and the patch pests notice would shrink.
 */
export function deviceEmissionRate(strength: number, releaseRate: number, rangeM: number): number {
  const areaScale = (rangeM / DEVICE_REFERENCE_RANGE_M) ** 2;
  return DEVICE_BASE_EMISSION * strength * releaseRate * areaScale;
}

/** A device placed on the map and whether it is working yet. */
export interface DeviceState extends DevicePlan {
  /** Sim time it started releasing scent, or null while waiting for the drone. */
  activatedAt: number | null;
}

export function zoneKey(z: Rect): string {
  return `${Math.round(z.x * 10)},${Math.round(z.y * 10)},${Math.round(z.w * 10)},${Math.round(z.h * 10)}`;
}

/** Keep only the plan pieces the chosen treatment method uses. */
export function activePlan(plan: TreatmentPlan, method: TreatmentMethod): TreatmentPlan {
  switch (method) {
    case 'spray':
      return { sprayZones: plan.sprayZones, devices: [] };
    case 'slowRelease':
      return { sprayZones: [], devices: plan.devices.filter((d) => d.kind === 'repellent') };
    case 'pushPull':
      return { sprayZones: [], devices: plan.devices };
    default:
      return { sprayZones: [], devices: [] };
  }
}

/** Which device kinds students may place for a method. */
export function allowedKinds(method: TreatmentMethod): ScentKind[] {
  if (method === 'slowRelease') return ['repellent'];
  if (method === 'pushPull') return ['repellent', 'attractant'];
  return [];
}

/** Spray passes for one zone, clipped to the map. */
export function sprayTasksForZone(zone: Rect, map: Rect, drone: DroneSettings): DroneTask[] {
  const z = intersectRect(zone, map);
  if (!z || z.w < 1 || z.h < 1) return [];
  const key = zoneKey(zone);
  return lawnmower(z, drone.swathM).map(([from, to]) => ({ kind: 'spray', from, to, zoneKey: key }));
}

/** Visit points in a sensible order: always go to the nearest one next. */
export function nearestNeighborOrder<T extends Vec>(start: Vec, points: T[]): T[] {
  const left = [...points];
  const out: T[] = [];
  let cur = start;
  while (left.length) {
    let best = 0;
    let bestD = Infinity;
    left.forEach((p, i) => {
      const d = dist(cur.x, cur.y, p.x, p.y);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    cur = left[best];
    out.push(left.splice(best, 1)[0]);
  }
  return out;
}

/** The drone's full to-do list for a plan. */
export function buildDroneTasks(
  plan: TreatmentPlan,
  map: Rect,
  home: Vec,
  drone: DroneSettings,
  devices: DeviceSettings
): DroneTask[] {
  const tasks: DroneTask[] = [];
  const zones = nearestNeighborOrder(
    home,
    plan.sprayZones.map((z) => ({ x: z.x + z.w / 2, y: z.y + z.h / 2, z }))
  );
  for (const { z } of zones) tasks.push(...sprayTasksForZone(z, map, drone));
  if (devices.deployByDrone) {
    for (const d of nearestNeighborOrder(home, plan.devices)) {
      tasks.push({ kind: 'drop', at: { x: d.x, y: d.y }, deviceId: d.id });
    }
  }
  return tasks;
}

/** Liters a set of spray zones would need at the current application rate. */
export function estimateSprayLiters(zones: Rect[], map: Rect, drone: DroneSettings): number {
  let l = 0;
  for (const z of zones) {
    for (const t of sprayTasksForZone(z, map, drone)) {
      if (t.kind === 'spray') l += litersForLength(drone, dist(t.from.x, t.from.y, t.to.x, t.to.y));
    }
  }
  return l;
}

/** Is a device releasing scent at this moment? */
export function deviceActive(d: DeviceState, timeSec: number, lifetimeMin: number): boolean {
  return d.activatedAt !== null && timeSec >= d.activatedAt && timeSec - d.activatedAt < lifetimeMin * 60;
}

/** How much of the crop a plan's scent reaches on paper, before wind and fading. */
export interface PlanCoverage {
  /** Percent of the crop inside at least one spray zone or repellent device circle. */
  coveredPct: number;
  /**
   * Percent of the devices' circles (inside the crop) that land on crop another
   * repellent circle already covers. 0 for spray, or with fewer than two devices.
   */
  overlapPct: number;
}

/**
 * Share of the crop a plan covers in still air: inside a spray zone, or within
 * the effective range of a repellent device. Checked on a 2 m grid, so it is
 * quick enough to show while students plan.
 */
export function planCoverage(plan: TreatmentPlan, crop: Rect, rangeM: number): PlanCoverage {
  const step = 2;
  const repellers = plan.devices.filter((d) => d.kind === 'repellent');
  const r2 = rangeM * rangeM;
  let points = 0;
  let covered = 0;
  let deviceCovered = 0;
  let circleHits = 0;
  for (let y = crop.y + step / 2; y < crop.y + crop.h; y += step) {
    for (let x = crop.x + step / 2; x < crop.x + crop.w; x += step) {
      points++;
      let hits = 0;
      for (const d of repellers) if ((x - d.x) ** 2 + (y - d.y) ** 2 <= r2) hits++;
      circleHits += hits;
      if (hits > 0) deviceCovered++;
      if (hits > 0 || plan.sprayZones.some((z) => x >= z.x && x <= z.x + z.w && y >= z.y && y <= z.y + z.h)) covered++;
    }
  }
  return {
    coveredPct: points ? (covered / points) * 100 : 0,
    overlapPct: repellers.length > 1 && circleHits > 0 ? (1 - deviceCovered / circleHits) * 100 : 0
  };
}
