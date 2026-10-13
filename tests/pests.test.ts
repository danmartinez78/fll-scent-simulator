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
  it('lets some pests give up on repellent and fly off in a random direction', () => {
    const { env, swarm, field, rng } = setup('repellent');
    // Build up a strong cloud first, so the pests start inside it.
    for (let i = 0; i < 240; i++) {
      field.addGaussian(100, 100, 25, 10);
      field.step(0.5, 0, 0, 0.5, 300);
    }
    let leftEver = 0;
    for (let i = 0; i < 60; i++) {
      field.addGaussian(100, 100, 25, 10);
      field.step(0.5, 0, 0, 0.5, 300);
      swarm.step(0.5, env, rng);
      for (let k = 0; k < swarm.n; k++) if (swarm.leaving[k] > 0) leftEver++;
    }
    expect(leftEver).toBeGreaterThan(0);
    for (let k = 0; k < swarm.n; k++) if (swarm.leaving[k] > 0) expect(swarm.feeding[k]).toBe(0);
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
