// The simulator runs on two clocks. While a drone is flying, time runs at
// real speed, so flight times are real minutes. The rest of the time the
// field runs as a time-lapse: pests, crop damage and fading scent play out
// over days, the way they do on a real farm.
//
// Inside the model, pest, scent and damage rules are written in "model
// seconds". One model second stands for TIME_LAPSE seconds on the farm.
// While a drone flies, the model clock slows down by the same factor, so the
// field barely changes during a flight.

/** Farm seconds per model second during the time-lapse (1 model minute = 6 hours). */
export const TIME_LAPSE = 360;

export const SECONDS_PER_DAY = 86400;

/** Hour of day the run starts on Day 1. */
export const START_HOUR = 8;

/** Model seconds to farm seconds. */
export const modelToFieldSec = (modelSec: number) => modelSec * TIME_LAPSE;

/** Model minutes (as stored in settings) to farm hours. */
export const modelMinToHours = (min: number) => (min * 60 * TIME_LAPSE) / 3600;

/** Model minutes (as stored in settings) to farm days. */
export const modelMinToDays = (min: number) => modelMinToHours(min) / 24;

/** "Day 2, 3:30 PM" from farm seconds since the start. */
export function formatFieldClock(fieldSec: number): string {
  const totalMin = Math.floor(fieldSec / 60) + START_HOUR * 60;
  const day = Math.floor(totalMin / 1440) + 1;
  const minOfDay = totalMin % 1440;
  const h24 = Math.floor(minOfDay / 60);
  const m = minOfDay % 60;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `Day ${day}, ${h12}:${m.toString().padStart(2, '0')} ${h24 < 12 ? 'AM' : 'PM'}`;
}

/** "5 days", "2 days 6 hours", "9 hours" or "40 min" from farm seconds. */
export function formatFieldSpan(fieldSec: number): string {
  const totalMin = Math.round(fieldSec / 60);
  if (totalMin < 60) return `${totalMin} min`;
  const totalH = Math.round(totalMin / 60);
  if (totalH < 24) return `${totalH} hour${totalH === 1 ? '' : 's'}`;
  const d = Math.floor(totalH / 24);
  const h = totalH % 24;
  const days = `${d} day${d === 1 ? '' : 's'}`;
  return h ? `${days} ${h} hour${h === 1 ? '' : 's'}` : days;
}

/** A setting stored in model minutes, shown as farm time ("48 hours", "7.5 days"). */
export function formatModelMin(min: number): string {
  const h = modelMinToHours(min);
  if (h < 48) return `${+h.toFixed(1)} hours`;
  return `${+(h / 24).toFixed(1)} days`;
}
