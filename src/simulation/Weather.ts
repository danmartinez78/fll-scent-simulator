import type { Settings } from '../models/types';
import { SECONDS_PER_DAY, START_HOUR } from '../utils/fieldTime';

/**
 * Rain, on the farm clock. Each rain day it rains in the afternoon for a few
 * hours. Rain washes most of the sprayed scent off the leaves, keeps the
 * drone on the ground and thins device scent while it lasts. Slow-release
 * devices keep the scent inside, so they keep working afterwards.
 */

/** Hour of day the rain starts. */
export const RAIN_START_HOUR = 12;
/** How long each rain lasts, in hours, unless a mission says otherwise. */
export const DEFAULT_RAIN_HOURS = 6;
/** Share of the spray on the plants that one rain washes off. */
export const RAIN_WASHOFF = 0.7;
/** Device scent released while it rains, as a share of normal (rain knocks scent out of the air). */
export const RAIN_DEVICE_FACTOR = 0.5;
/** "How often to spray" value meaning: spray again each time a rain ends. */
export const RESPRAY_AFTER_RAIN = -1;

export interface RainSpan {
  day: number;
  /** Farm seconds since the run started. */
  start: number;
  end: number;
}

/** The rains in a run, in order (empty when it stays dry). */
export function rainSpans(s: Pick<Settings, 'weather'>): RainSpan[] {
  const days = [...new Set(s.weather?.rainDays ?? [])].filter((d) => d >= 1).sort((a, b) => a - b);
  const hours = s.weather?.rainHours ?? DEFAULT_RAIN_HOURS;
  return days.map((day) => {
    const start = (day - 1) * SECONDS_PER_DAY + (RAIN_START_HOUR - START_HOUR) * 3600;
    return { day, start, end: start + hours * 3600 };
  });
}

/** Is it raining at this farm time? */
export function rainingAt(spans: RainSpan[], fieldSec: number): boolean {
  return spans.some((r) => fieldSec >= r.start && fieldSec < r.end);
}

/** "Rain on Day 6 and Day 13", or '' when dry. */
export function forecastText(s: Pick<Settings, 'weather'>): string {
  const days = rainSpans(s).map((r) => `Day ${r.day}`);
  if (!days.length) return '';
  const list = days.length === 1 ? days[0] : `${days.slice(0, -1).join(', ')} and ${days[days.length - 1]}`;
  return `Rain on ${list} (afternoon, about ${s.weather?.rainHours ?? DEFAULT_RAIN_HOURS} hours)`;
}

/** Fade lifetime (farm seconds) that washes RAIN_WASHOFF of the residue off over one rain. */
export function washoffLifetimeSec(s: Pick<Settings, 'weather'>): number {
  const hours = s.weather?.rainHours ?? DEFAULT_RAIN_HOURS;
  return (hours * 3600) / -Math.log(1 - RAIN_WASHOFF);
}
