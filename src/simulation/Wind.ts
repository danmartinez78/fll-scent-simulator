import type { WindSettings } from '../models/types';
import { mphToMps } from '../utils/units';

/**
 * Near the crop canopy, air moves slower than the wind measured higher up,
 * so scent drifts at a fraction of the wind speed. This also keeps plumes
 * on screen long enough to watch.
 */
export const SCENT_DRIFT_FACTOR = 0.3;

/**
 * Spray drift while it falls. Drops take about this long (seconds) to fall
 * from the drone to the crop, pushed down by the rotor wash, so the spray
 * lands about wind speed x this time downwind: about 2 m at 6 mph.
 */
export const SPRAY_FALL_SEC = 0.75;
/** Share of the spray made of fine drops that drift much farther, per mph of wind. */
export const SPRAY_FINE_SHARE_PER_MPH = 0.015;
/** Most of the spray that can be fine, drifting drops. */
export const SPRAY_FINE_SHARE_MAX = 0.3;
/** Fine drops travel this many times farther than the main spray. */
export const SPRAY_FINE_REACH = 5;

/**
 * Where spray released at a point lands: the main part shifted a little
 * downwind and a small share of fine drops carried farther. Shares add up to 1.
 * `driftFactor` scales how far the wind moves it and how much blows away
 * (1 for the drone; the groomba sprays from just above the plants).
 */
export function sprayLanding(
  w: WindSettings,
  timeSec: number,
  driftFactor = 1
): Array<{ dx: number; dy: number; share: number; spread: number }> {
  const v = windVector(w, timeSec);
  const dx = v.x * SPRAY_FALL_SEC * driftFactor;
  const dy = v.y * SPRAY_FALL_SEC * driftFactor;
  const off = Math.hypot(dx, dy);
  const fine = Math.min(SPRAY_FINE_SHARE_MAX, SPRAY_FINE_SHARE_PER_MPH * w.speedMph) * driftFactor;
  const parts = [{ dx, dy, share: 1 - fine, spread: 0.3 * off }];
  if (fine > 0) parts.push({ dx: dx * SPRAY_FINE_REACH, dy: dy * SPRAY_FINE_REACH, share: fine, spread: 1.5 * off });
  return parts;
}

/**
 * Spray residue stuck to the plants doesn't move, but the smell it gives off
 * does. This share of what pests sense from residue is that smell, carried
 * downwind; it lingers about this many seconds in the air.
 */
export const RESIDUE_VAPOR_SHARE = 0.5;
export const RESIDUE_VAPOR_LIFETIME_SEC = 6;

/** How far (degrees) a "changing" wind swings either side of its setting. */
export const CHANGING_SWING_DEG = 40;
/** Seconds for one full swing of a changing wind. */
export const CHANGING_PERIOD_SEC = 360;

/** Wind direction in degrees at a moment in time. */
export function windDirectionAt(w: WindSettings, timeSec: number): number {
  if (!w.changing) return w.direction;
  const swing =
    CHANGING_SWING_DEG * Math.sin((2 * Math.PI * timeSec) / CHANGING_PERIOD_SEC) +
    0.35 * CHANGING_SWING_DEG * Math.sin((2 * Math.PI * timeSec) / (CHANGING_PERIOD_SEC * 0.37));
  return w.direction + swing;
}

/**
 * Wind velocity in meters per second in map coordinates (x right, y down).
 * Direction is where the wind blows toward: 0 = up (north), 90 = right (east).
 */
export function windVector(w: WindSettings, timeSec: number): { x: number; y: number } {
  const rad = (windDirectionAt(w, timeSec) * Math.PI) / 180;
  const s = mphToMps(w.speedMph);
  return { x: Math.sin(rad) * s, y: -Math.cos(rad) * s };
}

/** Velocity the scent drifts at (a fraction of the wind). */
export function scentDrift(w: WindSettings, timeSec: number): { x: number; y: number } {
  const v = windVector(w, timeSec);
  return { x: v.x * SCENT_DRIFT_FACTOR, y: v.y * SCENT_DRIFT_FACTOR };
}

/** Turbulent mixing grows with wind speed (square meters per second). */
export function diffusionFor(w: WindSettings): number {
  return 0.5 + 0.15 * mphToMps(w.speedMph);
}
