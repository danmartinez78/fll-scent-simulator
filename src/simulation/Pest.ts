import type { PestSettings, Rect, Vec } from '../models/types';
import type { Random } from '../utils/random';
import { clamp, closestInRect, inRect } from '../utils/geometry';
import type { ScentField } from './ScentField';

/**
 * Pest behavior weights. A pest that is not bothered by repellent picks a
 * direction from a weighted mix of: keep wandering, head for the crop, move
 * toward attractant, and stay inside the map. A pest bothered by repellent
 * flees: it checks which way smells better over a longer distance, flies that
 * way for a while, then checks again (a "run and check" rule, like real
 * insects casting through a plume). Exposed here so the README can show
 * exactly what the pests "think".
 */
export const PEST_RULES = {
  /** How much a pest's random heading changes per second (radians). */
  wanderTurn: 1.1,
  /** Weight of the pull toward the crop when a pest is off the crop. */
  cropPull: 1.4,
  /** Weight of the push away from repellent a pest can smell but is not yet bothered by (the edge of a cloud). */
  repelPush: 2.6,
  /** Weight of moving up the attractant slope. */
  attractPull: 2.2,
  /** Attractant is noticed at this fraction of the threshold. */
  attractNoticeFraction: 0.5,
  /** Speed multiplier while feeding on the crop. */
  feedingSpeed: 0.2,
  /** Speed multiplier while fleeing repellent. */
  agitatedSpeed: 1.6,
  /** A trap catches pests that come within this many meters. */
  trapRadius: 4,
  /** Pests within this many meters of the map edge get nudged back in. */
  edgeMargin: 4,
  /** Distance (meters) over which a bothered pest compares smells to decide which way to flee. */
  fleeLookM: 10,
  /** The smell must change by at least this fraction over `fleeLookM` for the pest to trust that direction. */
  fleeMinChange: 0.15,
  /** Seconds a bothered pest flies in its chosen direction before checking again (give or take half). */
  fleeRunSec: 20,
  /** Scatter (radians) added to a chosen flee direction. Pests are not robots. */
  fleeScatter: 0.5,
  /** Random turning per second while on a flee run (radians). Small, so runs are nearly straight. */
  fleeTurn: 0.12,
  /** Smell rising to this multiple of what it was when the run began means "wrong way": turn around now. */
  fleeWorseFactor: 1.5,
  /** After escaping repellent, seconds a pest keeps flying (not feeding) and is only weakly drawn back to the crop. */
  warySec: 60,
  /** Crop pull while wary, as a fraction of the normal pull. */
  waryCropPull: 0.25,
  /** Fraction of pests already in the field on Day 1 when pests build up over time. */
  startingFraction: 0.1
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
  /**
   * Working attractant devices (with or without a trap). A pest that notices
   * attractant flies toward the nearest one, the way insects follow a smell
   * to where it comes from. Missing = follow the smell's slope instead.
   */
  lures?: Vec[];
}

/**
 * Which way a pest that notices attractant flies (unit vector): toward the
 * nearest lure. Heading for the source, not just up the smell's slope, keeps
 * pests from hovering between two lures where their smells add up.
 */
function lureDirection(px: number, py: number, env: PestEnvironment): Vec | null {
  if (env.lures && env.lures.length) {
    let best = env.lures[0];
    let bestD = Infinity;
    for (const l of env.lures) {
      const d = (l.x - px) ** 2 + (l.y - py) ** 2;
      if (d < bestD) {
        bestD = d;
        best = l;
      }
    }
    const d = Math.sqrt(bestD);
    return d > 1e-6 ? { x: (best.x - px) / d, y: (best.y - py) / d } : null;
  }
  const g = env.attractant.gradient(px, py);
  const gl = Math.hypot(g.x, g.y);
  return gl > 1e-7 ? { x: g.x / gl, y: g.y / gl } : null;
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
  /** Seconds left on the current flee run (0 = not fleeing). */
  fleeLeft: Float32Array;
  /** Repellent concentration when the current flee run began. */
  fleeStartRep: Float32Array;
  /**
   * Seconds left of moving on after escaping repellent. A wary pest flies on
   * at normal speed without feeding and is only weakly pulled back to the
   * crop, so it lands somewhere else instead of settling at the cloud's edge.
   */
  wary: Float32Array;
  /**
   * A fixed random number (0 to 1) per pest. Pests whose toughness is at or
   * above the scent effectiveness ignore scent completely.
   */
  toughness: Float32Array;
  /** Model time (seconds) each pest arrives in the field. 0 = there from the start. */
  arriveAt: Float32Array;
  /** Current model time, set by the simulation before each step. */
  now = 0;

  constructor(n: number) {
    this.n = n;
    this.x = new Float32Array(n);
    this.y = new Float32Array(n);
    this.heading = new Float32Array(n);
    this.trapped = new Uint8Array(n);
    this.feeding = new Uint8Array(n);
    this.repelled = new Uint8Array(n);
    this.fleeLeft = new Float32Array(n);
    this.fleeStartRep = new Float32Array(n);
    this.wary = new Float32Array(n);
    this.toughness = new Float32Array(n);
    this.arriveAt = new Float32Array(n);
  }

  /** Give every pest its toughness (uses its own random stream so starting positions don't change). */
  assignToughness(rng: Random): void {
    for (let i = 0; i < this.n; i++) this.toughness[i] = rng.next();
  }

  /**
   * Spread arrivals over `buildUpSec` model seconds: a few pests are there at
   * the start and the rest land at their starting spots at random times.
   * Uses its own random stream so starting positions don't change.
   */
  assignArrivals(buildUpSec: number, rng: Random): void {
    for (let i = 0; i < this.n; i++) {
      const late = buildUpSec > 0 && rng.next() >= PEST_RULES.startingFraction;
      this.arriveAt[i] = late ? rng.range(0, buildUpSec) : 0;
    }
  }

  /** True once this pest has arrived in the field. */
  present(i: number): boolean {
    return this.arriveAt[i] <= this.now;
  }

  countPresent(): number {
    let k = 0;
    for (let i = 0; i < this.n; i++) if (this.arriveAt[i] <= this.now) k++;
    return k;
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
    const sqrtDt = Math.sqrt(dt);
    const wanderTurn = R.wanderTurn * sqrtDt;
    const fleeTurn = R.fleeTurn * sqrtDt;
    for (let i = 0; i < this.n; i++) {
      if (this.trapped[i] || this.arriveAt[i] > this.now) continue;
      const sens = this.reacts(i, env.effectiveness) ? env.sensitivity : 0;
      const px = this.x[i];
      const py = this.y[i];
      const onCrop = inRect(px, py, env.crop);
      const rep = env.repellent.sample(px, py);
      const att = env.attractant.sample(px, py);
      const repelled = sens > 0 && rep > th;
      const wasRepelled = this.repelled[i] === 1;
      let h: number;
      let dx: number;
      let dy: number;

      if (repelled) {
        // Fleeing. Pick a direction when a run starts, when it ends, or when
        // the smell has clearly gotten worse along the way.
        const worse = wasRepelled && this.fleeLeft[i] > 0 && rep > this.fleeStartRep[i] * R.fleeWorseFactor;
        if (!wasRepelled || this.fleeLeft[i] <= 0 || worse) {
          const g = env.repellent.gradient(px, py, R.fleeLookM);
          const gl = Math.hypot(g.x, g.y);
          // How much the smell changes over the look distance, relative to here.
          const change = (gl * R.fleeLookM) / rep;
          if (change >= R.fleeMinChange) {
            // The slope is clear: go down it, with some scatter.
            h = Math.atan2(-g.y, -g.x) + rng.gaussian() * R.fleeScatter;
          } else if (worse) {
            // Flat here, but it got worse this way: turn around.
            h = this.heading[i] + Math.PI + rng.gaussian() * (R.fleeScatter * 1.5);
          } else {
            // Flat cloud: a straight line gets out fastest, so keep going.
            h = this.heading[i] + rng.gaussian() * R.fleeScatter;
          }
          this.fleeLeft[i] = R.fleeRunSec * rng.range(0.5, 1.5);
          this.fleeStartRep[i] = rep;
        } else {
          h = this.heading[i] + rng.gaussian() * fleeTurn;
        }
        this.fleeLeft[i] = Math.max(0, this.fleeLeft[i] - dt);
        dx = Math.cos(h);
        dy = Math.sin(h);
        // Attractant still pulls while fleeing (push-pull: the "pull" side).
        if (att > th * R.attractNoticeFraction) {
          const g = lureDirection(px, py, env);
          if (g) {
            const w = R.attractPull * sens * Math.min(2, att / th);
            dx += g.x * w;
            dy += g.y * w;
          }
        }
      } else {
        this.fleeLeft[i] = 0;
        // Just escaped: fly on for a while instead of settling at the cloud's edge.
        if (wasRepelled && sens > 0) this.wary[i] = R.warySec;
        if (this.wary[i] > 0) this.wary[i] = Math.max(0, this.wary[i] - dt);
        const wary = this.wary[i] > 0;

        // 1. Random wandering: the heading drifts a little each step (less while moving on).
        h = this.heading[i] + rng.gaussian() * wanderTurn * (wary ? 0.5 : 1);
        dx = Math.cos(h);
        dy = Math.sin(h);

        // 2. Attraction toward the crop (only matters once off the crop).
        if (!onCrop && env.cropAttraction > 0) {
          const t = closestInRect(px, py, env.crop);
          const ddx = t.x - px;
          const ddy = t.y - py;
          const d = Math.hypot(ddx, ddy) || 1;
          const w = R.cropPull * env.cropAttraction * (wary ? R.waryCropPull : 1);
          dx += (ddx / d) * w;
          dy += (ddy / d) * w;
        }

        // 3. The edge of a repellent cloud: it can smell it coming and steers away.
        if (sens > 0 && rep > th * 0.5) {
          const g = env.repellent.gradient(px, py);
          const gl = Math.hypot(g.x, g.y);
          if (gl > 1e-7) {
            const w = R.repelPush * sens * (rep / th);
            dx -= (g.x / gl) * w;
            dy -= (g.y / gl) * w;
          }
        }

        // 4. Follow attractant up the slope.
        if (sens > 0 && att > th * R.attractNoticeFraction) {
          const g = lureDirection(px, py, env);
          if (g) {
            const w = R.attractPull * sens * Math.min(2, att / th);
            dx += g.x * w;
            dy += g.y * w;
          }
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

      const feeding = onCrop && !repelled && !(this.wary[i] > 0);
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
      if (!this.trapped[i] && this.present(i) && inRect(this.x[i], this.y[i], crop)) k++;
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
      if (this.trapped[i] || !this.present(i)) continue;
      sx += this.x[i];
      sy += this.y[i];
      k++;
    }
    return k ? { x: sx / k, y: sy / k } : { x: NaN, y: NaN };
  }
}
