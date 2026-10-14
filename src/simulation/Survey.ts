import type { Rect, SurveyCategory, SurveyResult, SurveySettings, Vec } from '../models/types';
import { clamp, inRect, lawnmower } from '../utils/geometry';
import type { Random } from '../utils/random';
import type { PestSwarm } from './Pest';

/** A generic camera ("survey") drone: light, fast, no tank. */
export const SURVEY_DRONE = {
  speed: 12,
  /** Width of ground the camera sees on each pass, meters. */
  swathM: 24,
  /** Size of each square on the survey map, meters. */
  cellSize: 10
};

/**
 * Pretend computer-vision thresholds, in estimated pests per 100 square
 * meters. Real software would need training data and testing to choose these.
 */
export const VISION_RULES = {
  possiblePer100m2: 1.5,
  highPer100m2: 4.5,
  /** Visible damage level (0 to 1) that also counts as "possible damage". */
  damageSeen: 0.6
};

/**
 * The survey drone flies back and forth over the whole map. Each square is
 * looked at once, at the moment the drone passes over it, so pests that move
 * can be missed or counted in the wrong square, just like a real survey.
 */
export class SurveyRun {
  readonly id: number;
  readonly label: string;
  readonly startedAt: number;
  readonly cols: number;
  readonly rows: number;
  readonly cellSize: number;
  x: number;
  y: number;
  done = false;
  estimate: number[];
  truth: number[];
  observed: Uint8Array;
  uncertain: Uint8Array;
  detections: Vec[] = [];
  private legs: Array<[Vec, Vec]>;
  private leg = 0;
  private atStart = false;
  private settings: SurveySettings;
  private width: number;
  private height: number;

  constructor(
    id: number,
    label: string,
    startedAt: number,
    width: number,
    height: number,
    settings: SurveySettings
  ) {
    this.id = id;
    this.label = label;
    this.startedAt = startedAt;
    this.width = width;
    this.height = height;
    this.settings = { ...settings };
    this.cellSize = SURVEY_DRONE.cellSize;
    this.cols = Math.ceil(width / this.cellSize);
    this.rows = Math.ceil(height / this.cellSize);
    const n = this.cols * this.rows;
    this.estimate = new Array(n).fill(0);
    this.truth = new Array(n).fill(0);
    this.observed = new Uint8Array(n);
    this.uncertain = new Uint8Array(n);
    this.legs = lawnmower({ x: 0, y: 0, w: width, h: height }, SURVEY_DRONE.swathM);
    this.x = this.legs[0][0].x;
    this.y = this.legs[0][0].y;
  }

  /** Fraction of the map scanned so far, 0 to 1. */
  get progress(): number {
    let k = 0;
    for (let i = 0; i < this.observed.length; i++) k += this.observed[i];
    return k / this.observed.length;
  }

  step(dt: number, pests: PestSwarm, rng: Random): void {
    if (this.done) return;
    let budget = SURVEY_DRONE.speed * dt;
    while (budget > 0 && this.leg < this.legs.length) {
      const [from, to] = this.legs[this.leg];
      const target = this.atStart ? to : from;
      const d = Math.hypot(target.x - this.x, target.y - this.y);
      if (d <= budget) {
        this.x = target.x;
        this.y = target.y;
        budget -= d;
        if (this.atStart) {
          this.leg++;
          this.atStart = false;
        } else {
          this.atStart = true;
        }
      } else {
        this.x += ((target.x - this.x) / d) * budget;
        this.y += ((target.y - this.y) / d) * budget;
        budget = 0;
      }
    }
    this.observeAround(pests, rng, false);
    if (this.leg >= this.legs.length) {
      this.observeAround(pests, rng, true);
      this.done = true;
    }
  }

  /** Look at every square under the camera that hasn't been looked at yet. */
  private observeAround(pests: PestSwarm, rng: Random, everything: boolean): void {
    const radius = SURVEY_DRONE.swathM / 2 + 1;
    const fresh = new Set<number>();
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const i = r * this.cols + c;
        if (this.observed[i]) continue;
        const cx = (c + 0.5) * this.cellSize;
        const cy = (r + 0.5) * this.cellSize;
        if (everything || Math.hypot(cx - this.x, cy - this.y) <= radius) fresh.add(i);
      }
    }
    if (fresh.size === 0) return;
    const s = this.settings;
    const p = clamp(s.detectionPct / 100, 0, 1);
    for (let k = 0; k < pests.n; k++) {
      if (pests.trapped[k] || !pests.present(k)) continue;
      const i = this.cellIndex(pests.x[k], pests.y[k]);
      if (!fresh.has(i)) continue;
      this.truth[i]++;
      if (rng.chance(p)) {
        const dx = clamp(pests.x[k] + rng.gaussian() * s.positionNoiseM, 0, this.width - 0.01);
        const dy = clamp(pests.y[k] + rng.gaussian() * s.positionNoiseM, 0, this.height - 0.01);
        this.estimate[this.cellIndex(dx, dy)]++;
        this.detections.push({ x: dx, y: dy });
      }
    }
    const cellArea = this.cellSize * this.cellSize;
    for (const i of fresh) {
      this.observed[i] = 1;
      // Fake detections: leaves, shadows and rocks that look like pests.
      const fakes = rng.poisson((s.falsePositivesPer1000m2 * cellArea) / 1000);
      const c = i % this.cols;
      const r = Math.floor(i / this.cols);
      for (let f = 0; f < fakes; f++) {
        this.estimate[i]++;
        this.detections.push({
          x: (c + rng.next()) * this.cellSize,
          y: (r + rng.next()) * this.cellSize
        });
      }
      if (rng.chance(clamp(s.uncertainPct / 100, 0, 1))) this.uncertain[i] = 1;
    }
  }

  cellIndex(x: number, y: number): number {
    const c = clamp(Math.floor(x / this.cellSize), 0, this.cols - 1);
    const r = clamp(Math.floor(y / this.cellSize), 0, this.rows - 1);
    return r * this.cols + c;
  }

  /**
   * Turn counts into the simulated computer-vision labels.
   * @param damageAt average crop damage level (0 to 1+) in a square
   */
  result(crop: Rect, damageAt: (r: Rect) => number, rng: Random, finishedAt: number): SurveyResult {
    const area = this.cellSize * this.cellSize;
    const category: SurveyCategory[] = [];
    let onCrop = 0;
    let hotspots = 0;
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const i = r * this.cols + c;
        const sq = { x: c * this.cellSize, y: r * this.cellSize, w: this.cellSize, h: this.cellSize };
        const isCrop = inRect(sq.x + sq.w / 2, sq.y + sq.h / 2, crop);
        if (isCrop) onCrop += this.estimate[i];
        const density = (this.estimate[i] / area) * 100;
        let cat: SurveyCategory;
        if (!isCrop) cat = 'none';
        else if (this.uncertain[i]) cat = 'uncertain';
        else if (density >= VISION_RULES.highPer100m2) cat = 'high';
        else if (
          density >= VISION_RULES.possiblePer100m2 ||
          damageAt(sq) * (0.8 + 0.4 * rng.next()) >= VISION_RULES.damageSeen
        )
          cat = 'possible';
        else cat = 'healthy';
        if (cat === 'high') hotspots++;
        category.push(cat);
      }
    }
    return {
      id: this.id,
      label: this.label,
      timeSec: finishedAt,
      cols: this.cols,
      rows: this.rows,
      cellSize: this.cellSize,
      estimate: [...this.estimate],
      truth: [...this.truth],
      category,
      detections: [...this.detections],
      detectedTotal: this.estimate.reduce((a, b) => a + b, 0),
      trueTotal: this.truth.reduce((a, b) => a + b, 0),
      estimatedOnCrop: onCrop,
      hotspotSquares: hotspots
    };
  }
}
