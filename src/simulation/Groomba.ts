import type { CostSettings, DroneSettings, GroombaSettings, Settings, Sprayer } from '../models/types';
import { DEFAULT_COSTS } from './CostModel';
import { usesSprayZones } from './Treatment';

/**
 * The groomba: a ground robot the team dreamed up that drives the lanes
 * between crop rows and sprays right onto the plants. It is much slower than
 * the drone and sprays a narrower strip, but its nozzles sit just above the
 * crop, so the wind barely moves the spray. These are guesses, not the
 * numbers of a real machine.
 */
export const GROOMBA_REFERENCE: GroombaSettings = {
  speed: 1,
  swathM: 3,
  driftFactor: 0.1,
  costPerMin: 0.5,
  tankL: 60,
  batteryHours: 4
};

/** The groomba drives this many times faster on screen than the drone flies, so nobody waits hours. */
export const GROOMBA_PLAYBACK = 10;

/** Which machine sprays (missing in setups saved before the groomba = the drone). */
export function sprayerOf(s: Pick<Settings, 'sprayer'>): Sprayer {
  return s.sprayer === 'groomba' ? 'groomba' : 'drone';
}

/** The groomba does the work only for spray and pesticide; devices are always flown out by the drone. */
export function usesGroomba(s: Pick<Settings, 'sprayer' | 'treatment'>): boolean {
  return sprayerOf(s) === 'groomba' && usesSprayZones(s.treatment);
}

export function groombaSettings(s: Pick<Settings, 'groomba'>): GroombaSettings {
  return { ...GROOMBA_REFERENCE, ...s.groomba };
}

/**
 * The numbers the sprayer works with. For the groomba, the drone's settings
 * with the groomba's speed, strip, tank and battery: it has no takeoff or
 * landing, and the spray plan (rate, product, how often) stays the same.
 */
export function sprayerSettings(s: Pick<Settings, 'sprayer' | 'treatment' | 'drone' | 'groomba'>): DroneSettings {
  if (!usesGroomba(s)) return s.drone;
  const g = groombaSettings(s);
  return {
    ...s.drone,
    speed: g.speed,
    swathM: g.swathM,
    tankL: g.tankL,
    maxPayloadKg: g.tankL,
    hoverEmptyMin: g.batteryHours * 60,
    hoverFullMin: g.batteryHours * 60,
    reservePct: 10,
    takeoffLandingSec: 0
  };
}

/** Costs with the groomba's driving cost in place of the drone's flying cost when the groomba sprays. */
export function sprayerCosts(s: Pick<Settings, 'sprayer' | 'treatment' | 'cost' | 'groomba'>): CostSettings {
  if (!usesGroomba(s)) return s.cost;
  return { ...s.cost, flightCostPerMin: groombaSettings(s).costPerMin ?? DEFAULT_COSTS.flightCostPerMin };
}

/** How much the wind moves the spray: 1 for the drone, much less for the groomba. */
export function sprayDriftFactor(s: Pick<Settings, 'sprayer' | 'treatment' | 'groomba'>): number {
  return usesGroomba(s) ? groombaSettings(s).driftFactor : 1;
}
