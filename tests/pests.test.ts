import { describe, expect, it } from 'vitest';
import { PestSwarm, type PestEnvironment } from '../src/simulation/Pest';
import { ScentField } from '../src/simulation/ScentField';
import { Random } from '../src/utils/random';

function setup(kind: 'repellent' | 'attractant' | 'none') {
  const rep = new ScentField(200, 200, 4);
  const att = new ScentField(200, 200, 4);
  const field = kind === 'repellent' ? rep : att;
  const env: PestEnvironment = {
    width: 200,
    height: 200,
    crop: { x: 0, y: 0, w: 200, h: 200 },
    repellent: rep,
    attractant: att,
    threshold: 0.15,
    sensitivity: 1,
    effectiveness: 1,
    cropAttraction: 1,
    speed: 1,
    traps: []
  };
  // Pests start in a ring 20 to 40 m from the center.
  const rng = new Random(7);
  const pts = Array.from({ length: 300 }, () => {
    const a = rng.range(0, Math.PI * 2);
    const r = rng.range(20, 40);
    return { x: 100 + Math.cos(a) * r, y: 100 + Math.sin(a) * r };
  });
  const swarm = PestSwarm.fromPositions(pts, rng);
  return { env, swarm, field, rng };
}

function meanDistance(s: PestSwarm): number {
  let sum = 0;
  for (let i = 0; i < s.n; i++) sum += Math.hypot(s.x[i] - 100, s.y[i] - 100);
  return sum / s.n;
}

function run(kind: 'repellent' | 'attractant' | 'none'): number {
  const { env, swarm, field, rng } = setup(kind);
  for (let i = 0; i < 240; i++) {
    if (kind !== 'none') field.addGaussian(100, 100, 25, 10);
    field.step(0.5, 0, 0, 0.5, 300);
    swarm.step(0.5, env, rng);
  }
  return meanDistance(swarm);
}

describe('pest movement', () => {
  it('moves away from repellent', () => {
    expect(run('repellent')).toBeGreaterThan(run('none') + 5);
  });

  it('moves toward attractant', () => {
    expect(run('attractant')).toBeLessThan(run('none') - 5);
  });

  it('ignores scent when sensitivity is 0', () => {
    const a = setup('repellent');
    a.env.sensitivity = 0;
    const b = setup('none');
    for (let i = 0; i < 100; i++) {
      a.field.addGaussian(100, 100, 25, 10);
      a.field.step(0.5, 0, 0, 0.5, 300);
      a.swarm.step(0.5, a.env, a.rng);
      b.swarm.step(0.5, b.env, b.rng);
    }
    expect(meanDistance(a.swarm)).toBeCloseTo(meanDistance(b.swarm), 5);
  });

  it('gets caught by a trap', () => {
    const { env, swarm, field, rng } = setup('attractant');
    env.traps = [{ x: 100, y: 100 }];
    for (let i = 0; i < 600; i++) {
      field.addGaussian(100, 100, 25, 10);
      field.step(0.5, 0, 0, 0.5, 300);
      swarm.step(0.5, env, rng);
    }
    expect(swarm.countTrapped()).toBeGreaterThan(10);
  });

  it('stays inside the map', () => {
    const { env, swarm, rng } = setup('none');
    for (let i = 0; i < 1000; i++) swarm.step(0.5, env, rng);
    for (let i = 0; i < swarm.n; i++) {
      expect(swarm.x[i]).toBeGreaterThanOrEqual(0);
      expect(swarm.x[i]).toBeLessThanOrEqual(200);
      expect(swarm.y[i]).toBeGreaterThanOrEqual(0);
      expect(swarm.y[i]).toBeLessThanOrEqual(200);
    }
  });
  /** A flat repellent cloud over the middle 100 m square, well above the threshold everywhere inside. */
  function flatCloud(field: ScentField, level = 1) {
    for (let r = 0; r < field.rows; r++) {
      for (let c = 0; c < field.cols; c++) {
        const x = (c + 0.5) * field.cell;
        const y = (r + 0.5) * field.cell;
        if (x >= 50 && x < 150 && y >= 50 && y < 150) field.data[r * field.cols + c] = level;
      }
    }
    field.touch();
  }
  const inCloud = (s: PestSwarm, i: number) => s.x[i] >= 50 && s.x[i] < 150 && s.y[i] >= 50 && s.y[i] < 150;

  it('flies out of a flat repellent cloud in straight-ish runs instead of milling around inside it', () => {
    const { env, swarm, field, rng } = setup('repellent');
    flatCloud(field);
    // All 300 pests start inside the cloud (they were placed 20 to 40 m from the center).
    expect(Array.from({ length: swarm.n }, (_, i) => inCloud(swarm, i)).every(Boolean)).toBe(true);
    // At 1.6 x 1 m/s a pest 40 m from the edge needs about 25 s on a straight line; allow 120 s.
    for (let i = 0; i < 240; i++) swarm.step(0.5, env, rng);
    let inside = 0;
    for (let i = 0; i < swarm.n; i++) if (inCloud(swarm, i)) inside++;
    expect(inside / swarm.n).toBeLessThan(0.1);
  });

  it('turns around when a flee run leads deeper into the repellent', () => {
    const { env, swarm, field, rng } = setup('repellent');
    // A cloud that gets stronger toward the center, with a flat-looking patch where the pests start.
    for (let r = 0; r < field.rows; r++) {
      for (let c = 0; c < field.cols; c++) {
        const d = Math.hypot((c + 0.5) * field.cell - 100, (r + 0.5) * field.cell - 100);
        field.data[r * field.cols + c] = d < 60 ? 0.5 + 2 * Math.max(0, 1 - d / 60) ** 2 : 0;
      }
    }
    field.touch();
    const before = meanDistance(swarm);
    for (let i = 0; i < 160; i++) swarm.step(0.5, env, rng);
    expect(meanDistance(swarm)).toBeGreaterThan(before + 20);
  });

  it('stays wary for a while after escaping, so it moves on instead of testing the same edge', () => {
    const { env, swarm, field, rng } = setup('repellent');
    flatCloud(field);
    // After 60 s many pests have just escaped; the wary period lasts 60 s, so nearly all of them are still wary.
    for (let i = 0; i < 120; i++) swarm.step(0.5, env, rng);
    let outside = 0;
    let wary = 0;
    for (let i = 0; i < swarm.n; i++) {
      if (inCloud(swarm, i)) continue;
      outside++;
      if (swarm.wary[i] > 0) wary++;
    }
    expect(outside / swarm.n).toBeGreaterThan(0.3);
    expect(wary / outside).toBeGreaterThan(0.8);
    // Fleeing and wary pests are never counted as feeding.
    for (let k = 0; k < swarm.n; k++) if (swarm.repelled[k] || swarm.wary[k] > 0) expect(swarm.feeding[k]).toBe(0);
  });

  it('lets pests that ignore the scent keep feeding inside a repellent cloud', () => {
    const { env, swarm, field, rng } = setup('repellent');
    swarm.assignToughness(new Random(11));
    env.effectiveness = 0.6;
    for (let i = 0; i < 240; i++) {
      field.addGaussian(100, 100, 25, 10);
      field.step(0.5, 0, 0, 0.5, 300);
    }
    swarm.step(0.5, env, rng);
    let ignorers = 0;
    let repelledIgnorers = 0;
    let reactorsRepelled = 0;
    for (let k = 0; k < swarm.n; k++) {
      if (swarm.reacts(k, env.effectiveness)) reactorsRepelled += swarm.repelled[k];
      else {
        ignorers++;
        repelledIgnorers += swarm.repelled[k];
      }
    }
    // About 40% ignore the scent; none of them are bothered by it.
    expect(ignorers / swarm.n).toBeGreaterThan(0.3);
    expect(ignorers / swarm.n).toBeLessThan(0.5);
    expect(repelledIgnorers).toBe(0);
    expect(reactorsRepelled).toBeGreaterThan(0);
  });
});
