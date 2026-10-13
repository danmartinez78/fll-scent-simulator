import type { WindSettings } from '../models/types';
import { mphToMps } from '../utils/units';

/**
 * Near the crop canopy, air moves slower than the wind measured higher up,
 * so scent drifts at a fraction of the wind speed. This also keeps plumes
 * on screen long enough to watch.
 */
export const SCENT_DRIFT_FACTOR = 0.3;

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
