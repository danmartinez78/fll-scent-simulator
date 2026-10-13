import type { PestSettings, Rect, Vec } from '../models/types';
import type { Random } from '../utils/random';
import { clamp, closestInRect, inRect } from '../utils/geometry';
import type { ScentField } from './ScentField';

/**
 * Pest behavior weights. Each step a pest picks a direction from a weighted
 * mix of: keep wandering, head for the crop, move away from repellent, move
 * toward attractant, and stay inside the map. Exposed here so the README can
 * show exactly what the pests "think".
 */
export const PEST_RULES = {
  /** How much a pest's random heading changes per second (radians). */
  wanderTurn: 1.1,
  /** Weight of the pull toward the crop when a pest is off the crop. */
  cropPull: 1.4,
  /** Weight of moving down the repellent slope. */
  repelPush: 2.6,
  /** Weight of moving up the attractant slope. */
  attractPull: 2.2,
  /** Attractant is noticed at this fraction of the threshold. */
  attractNoticeFraction: 0.5,
  /** Speed multiplier while feeding on the crop. */
  feedingSpeed: 0.2,
  /** Speed multiplier while bothered by repellent. */
  agitatedSpeed: 1.6,
  /** A trap catches pests that come within this many meters. */
  trapRadius: 4,
  /** Pests within this many meters of the map edge get nudged back in. */
  edgeMargin: 4,
  /**
   * Chance per second that a pest bothered by repellent gives up and flies
   * off in a random direction instead of fleeing straight down the slope.
   */
  giveUpPerSec: 0.1,
  /** How long a pest that gave up keeps flying before it heads for the crop again (seconds). */
  giveUpSec: 60
};

export interface PestEnvironment {
  width: number;
  height: number;
  crop: Rect;
  repellent: ScentField;
  attractant: ScentField;
  threshold: number;
  sensitivity: number;
  /** Fraction of pests (0 to 1) that react to scent; see PestSwarm.toughness. */
  effectiveness: number;
  cropAttraction: number;
  speed: number;
  traps: Vec[];
}

/** All pests stored in flat arrays (fast with hundreds of pests). */
export class PestSwarm {
  readonly n: number;
  x: Float32Array;
  y: Float32Array;
  heading: Float32Array;
  /** 0 = flying free, 1 = caught in a trap. */
  trapped: Uint8Array;
  /** 1 while sitting on the crop, feeding (and not bothered by repellent). */
  feeding: Uint8Array;
  /** 1 while repellent above the threshold is bothering this pest. */
  repelled: Uint8Array;
  /** Seconds left flying off after giving up on the repellent (0 = not leaving). */
  leaving: Float32Array;
  /**
   * A fixed random number (0 to 1) per pest. Pests whose toughness is at or
   * above the scent effectiveness ignore scent completely.
   */
  toughness: Float32Array;

  constructor(n: number) {
    this.n = n;
    this.x = new Float32Array(n);
    this.y = new Float32Array(n);
    this.heading = new Float32Array(n);
    this.trapped = new Uint8Array(n);
    this.feeding = new Uint8Array(n);
    this.repelled = new Uint8Array(n);
    this.leaving = new Float32Array(n);
    this.toughness = new Float32Array(n);
  }

  /** Give every pest its toughness (uses its own random stream so starting positions don't change). */
  assignToughness(rng: Random): void {
    for (let i = 0; i < this.n; i++) this.toughness[i] = rng.next();
  }

  /** True if this pest reacts to scent at the given effectiveness (0 to 1). */
  reacts(i: number, effectiveness: number): boolean {
    return this.toughness[i] < effectiveness;
  }

  /** Place pests according to the chosen starting pattern. */
  static create(
    settings: PestSettings,
    width: number,
    height: number,
    crop: Rect,
    rng: Random,
    countOverride?: number
  ): PestSwarm {
    const n = Math.max(0, Math.round(countOverride ?? settings.count));
    const swarm = new PestSwarm(n);
    const centers: Vec[] = [];
    if (settings.distribution === 'hotspots') {
      const k = Math.max(1, Math.round(settings.hotspotCount));
      for (let i = 0; i < k; i++) {
        centers.push({
          x: crop.x + crop.w * rng.range(0.12, 0.88),
          y: crop.y + crop.h * rng.range(0.15, 0.85)
        });
      }
    }
    const spread = Math.min(crop.w, crop.h) * 0.09;
    for (let i = 0; i < n; i++) {
      let px: number;
      let py: number;
      switch (settings.distribution) {
        case 'hotspots':
          if (rng.chance(0.15)) {
            px = rng.range(crop.x, crop.x + crop.w);
            py = rng.range(crop.y, crop.y + crop.h);
          } else {
            const c = centers[i % centers.length];
            px = c.x + rng.gaussian() * spread;
            py = c.y + rng.gaussian() * spread;
          }
          break;
        case 'edge':
          // Arriving from the west edge of the field.
          px = rng.range(0, crop.x + crop.w * 0.18);
          py = rng.range(crop.y, crop.y + crop.h);
          break;
        case 'scattered':
          px = rng.range(0, width);
          py = rng.range(0, height);
          break;
        default:
          px = rng.range(crop.x, crop.x + crop.w);
          py = rng.range(crop.y, crop.y + crop.h);
      }
      swarm.x[i] = clamp(px, 0.5, width - 0.5);
      swarm.y[i] = clamp(py, 0.5, height - 0.5);
      swarm.heading[i] = rng.range(0, Math.PI * 2);
    }
    return swarm;
  }

  /** Start from known positions (used by the optimizer's best guess). */
  static fromPositions(points: Vec[], rng: Random): PestSwarm {
    const swarm = new PestSwarm(points.length);
    points.forEach((p, i) => {
      swarm.x[i] = p.x;
      swarm.y[i] = p.y;
      swarm.heading[i] = rng.range(0, Math.PI * 2);
    });
    return swarm;
  }

  /** Move every pest one time step. */
  step(dt: number, env: PestEnvironment, rng: Random): void {
    const R = PEST_RULES;
    const th = Math.max(1e-4, env.threshold);
    const turn = R.wanderTurn * Math.sqrt(dt);
    for (let i = 0; i < this.n; i++) {
      if (this.trapped[i]) continue;
      const sens = this.reacts(i, env.effectiveness) ? env.sensitivity : 0;
      const px = this.x[i];
      const py = this.y[i];
      const onCrop = inRect(px, py, env.crop);

      // 1. Random wandering: the heading drifts a little each step.
      let h = this.heading[i] + rng.gaussian() * turn;
      let dx = Math.cos(h);
      let dy = Math.sin(h);
      const leaving = this.leaving[i] > 0;
      if (leaving) this.leaving[i] = Math.max(0, this.leaving[i] - dt);

      // 2. Attraction toward the crop (only matters once off the crop).
      if (!onCrop && !leaving && env.cropAttraction > 0) {
        const t = closestInRect(px, py, env.crop);
        const ddx = t.x - px;
        const ddy = t.y - py;
        const d = Math.hypot(ddx, ddy) || 1;
        dx += (ddx / d) * R.cropPull * env.cropAttraction;
        dy += (ddy / d) * R.cropPull * env.cropAttraction;
      }

      // 3. Avoid repellent: move down the slope, harder where it's stronger.
      const rep = env.repellent.sample(px, py);
      const repelled = rep > th && sens > 0;
      if (repelled && !leaving && R.giveUpPerSec > 0 && rng.chance(R.giveUpPerSec * dt)) {
        // Give up on this patch: pick a random direction and go.
        this.leaving[i] = R.giveUpSec;
        h = rng.range(0, Math.PI * 2);
        dx = Math.cos(h);
        dy = Math.sin(h);
      } else if (!leaving && rep > th * 0.5 && sens > 0) {
        const g = env.repellent.gradient(px, py);
        const gl = Math.hypot(g.x, g.y);
        if (gl > 1e-7) {
          const w = R.repelPush * sens * Math.min(2, rep / th);
          dx -= (g.x / gl) * w;
          dy -= (g.y / gl) * w;
        }
      }

      // 4. Follow attractant up the slope.
      const att = env.attractant.sample(px, py);
      if (!leaving && att > th * R.attractNoticeFraction && sens > 0) {
        const g = env.attractant.gradient(px, py);
        const gl = Math.hypot(g.x, g.y);
        if (gl > 1e-7) {
          const w = R.attractPull * sens * Math.min(2, att / th);
          dx += (g.x / gl) * w;
          dy += (g.y / gl) * w;
        }
      }

      // 5. Map edges: nudge back inside.
      const m = R.edgeMargin;
      if (px < m) dx += ((m - px) / m) * 3;
      if (px > env.width - m) dx -= ((px - (env.width - m)) / m) * 3;
      if (py < m) dy += ((m - py) / m) * 3;
      if (py > env.height - m) dy -= ((py - (env.height - m)) / m) * 3;

      h = Math.atan2(dy, dx);
      this.heading[i] = h;

      const feeding = onCrop && !repelled && !(this.leaving[i] > 0);
      this.feeding[i] = feeding ? 1 : 0;
      this.repelled[i] = repelled ? 1 : 0;
      const speed = env.speed * (feeding ? R.feedingSpeed : repelled ? R.agitatedSpeed : 1);
      this.x[i] = clamp(px + Math.cos(h) * speed * dt, 0.1, env.width - 0.1);
      this.y[i] = clamp(py + Math.sin(h) * speed * dt, 0.1, env.height - 0.1);

      for (const t of env.traps) {
        const ddx = this.x[i] - t.x;
        const ddy = this.y[i] - t.y;
        if (ddx * ddx + ddy * ddy < R.trapRadius * R.trapRadius) {
          this.trapped[i] = 1;
          this.feeding[i] = 0;
          break;
        }
      }
    }
  }

  countOnCrop(crop: Rect): number {
    let k = 0;
    for (let i = 0; i < this.n; i++) {
      if (!this.trapped[i] && inRect(this.x[i], this.y[i], crop)) k++;
    }
    return k;
  }

  countTrapped(): number {
    let k = 0;
    for (let i = 0; i < this.n; i++) k += this.trapped[i];
    return k;
  }

  /** Average position of free pests. */
  center(): Vec {
    let sx = 0;
    let sy = 0;
    let k = 0;
    for (let i = 0; i < this.n; i++) {
      if (this.trapped[i]) continue;
      sx += this.x[i];
      sy += this.y[i];
      k++;
    }
    return k ? { x: sx / k, y: sy / k } : { x: NaN, y: NaN };
  }
}
