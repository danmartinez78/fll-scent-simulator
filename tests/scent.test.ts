import { describe, expect, it } from 'vitest';
import { ScentField } from '../src/simulation/ScentField';
import { scentDrift, windVector } from '../src/simulation/Wind';

describe('scent field', () => {
  it('is weaker farther from a source', () => {
    const f = new ScentField(200, 200, 4);
    for (let i = 0; i < 120; i++) {
      f.addGaussian(100, 100, 2, 6);
      f.step(0.5, 0, 0, 0.5, 300);
    }
    const near = f.sample(100, 100);
    const mid = f.sample(120, 100);
    const far = f.sample(160, 100);
    expect(near).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(far);
  });

  it('fades over time without a source', () => {
    const f = new ScentField(100, 100, 4);
    f.addGaussian(50, 50, 500, 5);
    const start = f.total();
    f.step(1, 0, 0, 0, 60);
    const after1 = f.total();
    for (let i = 0; i < 59; i++) f.step(1, 0, 0, 0, 60);
    const after60 = f.total();
    expect(after1).toBeLessThan(start);
    // After one lifetime about 37% should remain.
    expect(after60 / start).toBeGreaterThan(0.3);
    expect(after60 / start).toBeLessThan(0.45);
  });

  it('keeps the total amount when it only spreads (no fading)', () => {
    const f = new ScentField(200, 200, 4);
    f.addGaussian(100, 100, 100, 5);
    const start = f.total();
    for (let i = 0; i < 20; i++) f.step(0.5, 0, 0, 1, Infinity);
    expect(f.total()).toBeCloseTo(start, 1);
    expect(f.max()).toBeLessThan(100 / (2 * Math.PI * 25));
  });

  it('is carried downwind', () => {
    const wind = { direction: 90, speedMph: 10, changing: false }; // blowing toward the east (right)
    const v = scentDrift(wind, 0);
    expect(v.x).toBeGreaterThan(0);
    expect(Math.abs(v.y)).toBeLessThan(1e-9);
    const f = new ScentField(300, 200, 4);
    f.addGaussian(80, 100, 100, 5);
    const before = f.centerOfMass();
    for (let i = 0; i < 40; i++) f.step(0.5, v.x, v.y, 0.5, 600);
    const after = f.centerOfMass();
    // 20 seconds at the drift speed.
    expect(after.x - before.x).toBeCloseTo(v.x * 20, 0);
    expect(Math.abs(after.y - before.y)).toBeLessThan(2);
  });

  it('points wind north when direction is 0', () => {
    const v = windVector({ direction: 0, speedMph: 5, changing: false }, 0);
    expect(v.y).toBeLessThan(0); // up on the map
    expect(Math.abs(v.x)).toBeLessThan(1e-9);
  });

  it('makes an elongated plume from a steady source in wind', () => {
    const f = new ScentField(300, 200, 4);
    const v = scentDrift({ direction: 90, speedMph: 8, changing: false }, 0);
    for (let i = 0; i < 400; i++) {
      f.addGaussian(60, 100, 2, 5);
      f.step(0.5, v.x, v.y, 1, 600);
    }
    const downwind = f.sample(110, 100);
    const upwind = f.sample(10, 100);
    const crosswind = f.sample(60, 150);
    expect(downwind).toBeGreaterThan(upwind * 5);
    expect(downwind).toBeGreaterThan(crosswind * 5);
  });
});
