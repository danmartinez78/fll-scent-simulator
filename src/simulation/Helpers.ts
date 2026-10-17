import type { HelperSettings, Rect, Vec } from '../models/types';
import type { Random } from '../utils/random';
import { clamp, closestInRect, inRect } from '../utils/geometry';
import { FATE_EATEN, type PestSwarm } from './Pest';
import type { ScentField } from './ScentField';

/**
 * Helpful insects: bees and ladybugs that live in and around the field. They
 * don't eat the crop and they ignore the scents. Ladybugs eat pests, which is
 * free pest control. Pesticide kills them like it kills pests, and sticky
 * traps catch a few by accident. Scent devices and repellent sprays leave
 * them alone. Exposed here so the README can show exactly what they do.
 */
export const HELPER_RULES = {
  /** Cruising speed, meters per model second. */
  speed: 0.6,
  /** How much the heading changes per second (radians). */
  wanderTurn: 1.2,
  /** Pull back toward the crop when off it (they live on the plants and flowers). */
  cropPull: 0.6,
  /** A ladybug eats a free pest within this many meters... */
  eatRadiusM: 2,
  /** ...at most once per this many model seconds (1 model minute = 1 farm day). */
  eatEverySec: 240,
  /** A helper this close to a sticky trap can get stuck on it... */
  bycatchRadiusM: 4,
  /** ...with this chance per model second it spends there. */
  bycatchPerSec: 0.004
};

/** Kind of helpful insect. */
export const BEE = 0;
export const LADYBUG = 1;

/** Why a helpful insect died. */
export const DIED_PESTICIDE = 1;
export const DIED_TRAP = 2;

/** What the helpers need from the field each step. */
export interface HelperEnvironment {
  width: number;
  height: number;
  crop: Rect;
  /** Pesticide on the plants, or null when none has been used. */
  pesticide: ScentField | null;
  /** Kill chance per model second at a given pesticide concentration. */
  killRate: (concentration: number) => number;
  traps: Vec[];
  pests: PestSwarm;
}

/** All helpful insects in flat arrays. */
export class HelperSwarm {
  readonly n: number;
  x: Float32Array;
  y: Float32Array;
  heading: Float32Array;
  kind: Uint8Array;
  /** 0 = alive, otherwise DIED_PESTICIDE or DIED_TRAP. */
  died: Uint8Array;
  /** Seconds until a ladybug is hungry again. */
  full: Float32Array;
  /** Pests eaten by ladybugs so far. */
  pestsEaten = 0;

  constructor(n: number) {
    this.n = n;
    this.x = new Float32Array(n);
    this.y = new Float32Array(n);
    this.heading = new Float32Array(n);
    this.kind = new Uint8Array(n);
    this.died = new Uint8Array(n);
    this.full = new Float32Array(n);
  }

  /** Spread the helpers over the field: mostly on the crop, some in the border. */
  static create(s: HelperSettings | undefined, width: number, height: number, crop: Rect, rng: Random): HelperSwarm {
    const n = Math.max(0, Math.round(s?.count ?? 0));
    const share = clamp(s?.ladybugShare ?? 0.5, 0, 1);
    const h = new HelperSwarm(n);
    for (let i = 0; i < n; i++) {
      const onCrop = rng.chance(0.8);
      h.x[i] = onCrop ? rng.range(crop.x, crop.x + crop.w) : rng.range(0, width);
      h.y[i] = onCrop ? rng.range(crop.y, crop.y + crop.h) : rng.range(0, height);
      h.heading[i] = rng.range(0, Math.PI * 2);
      h.kind[i] = i < Math.round(n * share) ? LADYBUG : BEE;
    }
    return h;
  }

  alive(i: number): boolean {
    return this.died[i] === 0;
  }

  countAlive(): number {
    let k = 0;
    for (let i = 0; i < this.n; i++) if (!this.died[i]) k++;
    return k;
  }

  countDied(cause: number): number {
    let k = 0;
    for (let i = 0; i < this.n; i++) if (this.died[i] === cause) k++;
    return k;
  }

  /** Move, eat pests (ladybugs), and die from pesticide or sticky traps. */
  step(dt: number, env: HelperEnvironment, rng: Random): void {
    const R = HELPER_RULES;
    const sqrtDt = Math.sqrt(dt);
    const pests = env.pests;
    // Free pests sorted into a coarse grid, so each ladybug only looks nearby.
    const bin = Math.max(R.eatRadiusM, 4);
    const cols = Math.ceil(env.width / bin) + 1;
    const rows = Math.ceil(env.height / bin) + 1;
    let buckets: number[][] | null = null;

    for (let i = 0; i < this.n; i++) {
      if (this.died[i]) continue;
      const px = this.x[i];
      const py = this.y[i];

      // Wander, staying near the crop.
      let h = this.heading[i] + rng.gaussian() * R.wanderTurn * sqrtDt;
      let dx = Math.cos(h);
      let dy = Math.sin(h);
      if (!inRect(px, py, env.crop)) {
        const t = closestInRect(px, py, env.crop);
        const d = Math.hypot(t.x - px, t.y - py) || 1;
        dx += ((t.x - px) / d) * R.cropPull;
        dy += ((t.y - py) / d) * R.cropPull;
      }
      if (px < 4) dx += 1;
      if (px > env.width - 4) dx -= 1;
      if (py < 4) dy += 1;
      if (py > env.height - 4) dy -= 1;
      h = Math.atan2(dy, dx);
      this.heading[i] = h;
      this.x[i] = clamp(px + Math.cos(h) * R.speed * dt, 0.1, env.width - 0.1);
      this.y[i] = clamp(py + Math.sin(h) * R.speed * dt, 0.1, env.height - 0.1);

      // Pesticide on the plants kills on contact.
      if (env.pesticide && !env.pesticide.empty) {
        const rate = env.killRate(env.pesticide.sample(this.x[i], this.y[i]));
        if (rate > 0 && rng.chance(1 - Math.exp(-rate * dt))) {
          this.died[i] = DIED_PESTICIDE;
          continue;
        }
      }
      // Sticky traps catch a few by accident.
      for (const t of env.traps) {
        if ((t.x - this.x[i]) ** 2 + (t.y - this.y[i]) ** 2 < R.bycatchRadiusM ** 2 && rng.chance(1 - Math.exp(-R.bycatchPerSec * dt))) {
          this.died[i] = DIED_TRAP;
          break;
        }
      }
      if (this.died[i]) continue;

      // Ladybugs eat pests.
      if (this.kind[i] !== LADYBUG) continue;
      if (this.full[i] > 0) {
        this.full[i] -= dt;
        continue;
      }
      if (!buckets) {
        buckets = Array.from({ length: cols * rows }, () => []);
        for (let p = 0; p < pests.n; p++) {
          if (pests.trapped[p] || !pests.present(p)) continue;
          buckets[Math.floor(pests.y[p] / bin) * cols + Math.floor(pests.x[p] / bin)]?.push(p);
        }
      }
      const bc = Math.floor(this.x[i] / bin);
      const br = Math.floor(this.y[i] / bin);
      let meal = -1;
      for (let r = br - 1; r <= br + 1 && meal < 0; r++) {
        for (let c = bc - 1; c <= bc + 1 && meal < 0; c++) {
          if (r < 0 || c < 0 || r >= rows || c >= cols) continue;
          for (const p of buckets[r * cols + c]) {
            if (pests.trapped[p]) continue;
            if ((pests.x[p] - this.x[i]) ** 2 + (pests.y[p] - this.y[i]) ** 2 < R.eatRadiusM ** 2) {
              meal = p;
              break;
            }
          }
        }
      }
      if (meal >= 0) {
        pests.remove(meal, FATE_EATEN);
        this.pestsEaten++;
        this.full[i] = R.eatEverySec;
      }
    }
  }
}
