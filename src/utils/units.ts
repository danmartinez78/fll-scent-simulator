// Unit conversions. The simulation works in meters, seconds and liters;
// the interface shows gallons, acres, mph and minutes because that's
// what US farmers (and the team) use.

export const LITERS_PER_GALLON = 3.78541;
export const SQ_METERS_PER_ACRE = 4046.86;
export const MPS_PER_MPH = 0.44704;

export const galToL = (gal: number) => gal * LITERS_PER_GALLON;
export const lToGal = (l: number) => l / LITERS_PER_GALLON;
export const m2ToAcres = (m2: number) => m2 / SQ_METERS_PER_ACRE;
export const acresToM2 = (acres: number) => acres * SQ_METERS_PER_ACRE;
export const mphToMps = (mph: number) => mph * MPS_PER_MPH;

/** Gallons per acre to liters per square meter. */
export const galPerAcreToLPerM2 = (gpa: number) => galToL(gpa) / SQ_METERS_PER_ACRE;

/** "12:05" style clock from seconds. */
export function formatClock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, '0')}`;
}

export function round(v: number, digits = 1): number {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

export function formatMoney(v: number): string {
  return `$${v.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}
