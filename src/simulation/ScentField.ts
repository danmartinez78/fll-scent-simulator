/**
 * A grid of scent concentration over the map. This is NOT fluid dynamics:
 * each step the scent is
 *   1. carried downwind (shifted by wind velocity x time),
 *   2. spread a little to neighboring squares (diffusion),
 *   3. faded (exponential decay with the scent lifetime).
 * Concentration is in made-up "scent units"; pests notice it above a threshold.
 */
export class ScentField {
  readonly cols: number;
  readonly rows: number;
  /** Square size in meters. */
  readonly cell: number;
  data: Float32Array;
  private tmp: Float32Array;
  /**
   * True while every square is 0, so stepping and fading can be skipped.
   * Code that writes to `data` directly must call `touch()`.
   */
  empty = true;

  constructor(width: number, height: number, cell: number) {
    this.cell = cell;
    this.cols = Math.max(2, Math.ceil(width / cell));
    this.rows = Math.max(2, Math.ceil(height / cell));
    this.data = new Float32Array(this.cols * this.rows);
    this.tmp = new Float32Array(this.cols * this.rows);
  }

  clear(): void {
    this.data.fill(0);
    this.empty = true;
  }

  /** Tell the field its data was written to directly. */
  touch(): void {
    this.empty = false;
  }

  /** Value stored at a grid square (0 outside the map). */
  at(c: number, r: number): number {
    if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) return 0;
    return this.data[r * this.cols + c];
  }

  /** Smoothly interpolated concentration at a point in meters. */
  sample(x: number, y: number): number {
    if (this.empty) return 0;
    const gx = x / this.cell - 0.5;
    const gy = y / this.cell - 0.5;
    const c0 = Math.floor(gx);
    const r0 = Math.floor(gy);
    const fx = gx - c0;
    const fy = gy - r0;
    const a = this.edgeAt(c0, r0);
    const b = this.edgeAt(c0 + 1, r0);
    const c = this.edgeAt(c0, r0 + 1);
    const d = this.edgeAt(c0 + 1, r0 + 1);
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
  }

  /** Like `at`, but clamps to the edge so sampling near the border isn't pulled to 0. */
  private edgeAt(c: number, r: number): number {
    const cc = c < 0 ? 0 : c >= this.cols ? this.cols - 1 : c;
    const rr = r < 0 ? 0 : r >= this.rows ? this.rows - 1 : r;
    return this.data[rr * this.cols + cc];
  }

  /**
   * Direction of increasing scent at a point (units per meter), measured over
   * `h` meters each way (default one grid square; longer smooths out small bumps).
   */
  gradient(x: number, y: number, h = this.cell): { x: number; y: number } {
    if (this.empty) return { x: 0, y: 0 };
    return {
      x: (this.sample(x + h, y) - this.sample(x - h, y)) / (2 * h),
      y: (this.sample(x, y + h) - this.sample(x, y - h)) / (2 * h)
    };
  }

  /**
   * Add scent spread in a soft circle (Gaussian) around a point. `amount` is
   * concentration x area (scent units x square meters), so the same amount
   * spread wider gives a lower peak.
   */
  addGaussian(x: number, y: number, amount: number, sigma: number): void {
    if (amount <= 0) return;
    const stamp = this.stampFor(x, y, sigma);
    if (!stamp.index.length) return;
    this.empty = false;
    const d = this.data;
    const k = amount / (this.cell * this.cell);
    for (let i = 0; i < stamp.index.length; i++) d[stamp.index[i]] += k * stamp.weight[i];
  }

  /**
   * Which squares a soft circle covers and how much each gets (adding up to 1
   * over the whole circle, so scent that would land off the map is lost).
   * Devices add scent at the same spot every step, so the last few are kept.
   */
  private stamps = new Map<string, { index: Int32Array; weight: Float32Array }>();
  private stampFor(x: number, y: number, sigma: number): { index: Int32Array; weight: Float32Array } {
    const key = `${x},${y},${sigma}`;
    const hit = this.stamps.get(key);
    if (hit) return hit;
    const s = Math.max(sigma, this.cell * 0.5);
    const reach = Math.ceil((2.5 * s) / this.cell);
    const cc = Math.floor(x / this.cell);
    const cr = Math.floor(y / this.cell);
    let wsum = 0;
    const index: number[] = [];
    const weight: number[] = [];
    for (let r = cr - reach; r <= cr + reach; r++) {
      for (let c = cc - reach; c <= cc + reach; c++) {
        const dx = (c + 0.5) * this.cell - x;
        const dy = (r + 0.5) * this.cell - y;
        const w = Math.exp(-(dx * dx + dy * dy) / (2 * s * s));
        wsum += w;
        if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) continue;
        index.push(r * this.cols + c);
        weight.push(w);
      }
    }
    const stamp = { index: Int32Array.from(index), weight: Float32Array.from(weight, (w) => (wsum > 0 ? w / wsum : 0)) };
    // Spray adds at a new spot every step; keep the cache small.
    if (this.stamps.size >= 64) this.stamps.delete(this.stamps.keys().next().value!);
    this.stamps.set(key, stamp);
    return stamp;
  }

  /**
   * Move the field forward in time.
   * @param windX scent drift velocity, m/s
   * @param diffusion spreading, square meters per second
   * @param lifetimeSec time for scent to fade to about 37%
   */
  step(dt: number, windX: number, windY: number, diffusion: number, lifetimeSec: number, fadeDt = dt): void {
    // Nothing here: nothing to carry, spread or fade.
    if (this.empty) return;
    const { cols, rows, cell } = this;
    const src = this.data;
    const dst = this.tmp;

    // 1. Carry downwind: each square takes the scent that was upwind of it.
    const sx = (windX * dt) / cell;
    const sy = (windY * dt) / cell;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const gx = c - sx;
        const gy = r - sy;
        const c0 = Math.floor(gx);
        const r0 = Math.floor(gy);
        const fx = gx - c0;
        const fy = gy - r0;
        const a = this.at(c0, r0);
        const b = this.at(c0 + 1, r0);
        const d = this.at(c0, r0 + 1);
        const e = this.at(c0 + 1, r0 + 1);
        dst[r * cols + c] = (a * (1 - fx) + b * fx) * (1 - fy) + (d * (1 - fx) + e * fx) * fy;
      }
    }

    // 2. Spread to neighbors. Capped so the simple method stays stable.
    const k = Math.min(0.24, (diffusion * dt) / (cell * cell));
    // 3. Fade over time.
    const fade = lifetimeSec > 0 ? Math.exp(-fadeDt / lifetimeSec) : 0;
    let any = false;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        const v = dst[i];
        // Scent leaving the map edge is lost (neighbors outside count as 0).
        const n = r > 0 ? dst[i - cols] : 0;
        const s = r < rows - 1 ? dst[i + cols] : 0;
        const w = c > 0 ? dst[i - 1] : 0;
        const e = c < cols - 1 ? dst[i + 1] : 0;
        const next = v + k * (n + s + w + e - 4 * v);
        if (next > 1e-6) {
          src[i] = next * fade;
          any = true;
        } else src[i] = 0;
      }
    }
    this.empty = !any;
  }

  /** Fade in place without moving (for spray residue stuck to plants). */
  fade(dt: number, lifetimeSec: number): void {
    if (this.empty) return;
    const f = lifetimeSec > 0 ? Math.exp(-dt / lifetimeSec) : 0;
    const d = this.data;
    let any = false;
    for (let i = 0; i < d.length; i++) {
      if (d[i] > 1e-6) {
        d[i] *= f;
        any = true;
      } else d[i] = 0;
    }
    this.empty = !any;
  }

  /** Set this field to the sum of two others of the same size. */
  sumOf(a: ScentField, b: ScentField): void {
    const d = this.data;
    for (let i = 0; i < d.length; i++) d[i] = a.data[i] + b.data[i];
    this.empty = a.empty && b.empty;
  }

  /** Total scent on the map (concentration x area). */

  total(): number {
    let sum = 0;
    for (let i = 0; i < this.data.length; i++) sum += this.data[i];
    return sum * this.cell * this.cell;
  }

  max(): number {
    let m = 0;
    for (let i = 0; i < this.data.length; i++) if (this.data[i] > m) m = this.data[i];
    return m;
  }

  /** Concentration-weighted center of the scent (meters). */
  centerOfMass(): { x: number; y: number } {
    let sx = 0;
    let sy = 0;
    let sum = 0;
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const v = this.data[r * this.cols + c];
        sx += v * (c + 0.5) * this.cell;
        sy += v * (r + 0.5) * this.cell;
        sum += v;
      }
    }
    return sum > 0 ? { x: sx / sum, y: sy / sum } : { x: NaN, y: NaN };
  }
}
