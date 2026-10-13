// Seeded random numbers so the same seed always gives the same experiment.

/** mulberry32: tiny, fast, good enough for a classroom simulation. */
export class Random {
  private state: number;

  constructor(seed: number) {
    this.state = (Math.floor(seed) ^ 0x9e3779b9) >>> 0;
  }

  /** Uniform number in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  int(min: number, maxInclusive: number): number {
    return Math.floor(this.range(min, maxInclusive + 1));
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  /** Standard normal via Box-Muller. */
  gaussian(): number {
    let u = 0;
    while (u === 0) u = this.next();
    const v = this.next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /** Poisson count with the given mean (Knuth; fine for small means). */
  poisson(mean: number): number {
    if (mean <= 0) return 0;
    if (mean > 30) return Math.max(0, Math.round(mean + Math.sqrt(mean) * this.gaussian()));
    const limit = Math.exp(-mean);
    let k = 0;
    let p = this.next();
    while (p > limit) {
      k++;
      p *= this.next();
    }
    return k;
  }
}

/** Derive an independent stream from a seed, so e.g. surveys don't change pest motion. */
export function childSeed(seed: number, salt: number): number {
  let h = (Math.floor(seed) * 2654435761) ^ (salt * 40503);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  return (h ^ (h >>> 16)) >>> 0;
}
