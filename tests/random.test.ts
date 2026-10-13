import { describe, expect, it } from 'vitest';
import { childSeed, Random } from '../src/utils/random';
import { Simulation } from '../src/simulation/Simulation';
import { getScenario } from '../src/simulation/scenarios';

describe('seeded randomness', () => {
  it('gives the same numbers for the same seed', () => {
    const a = new Random(123);
    const b = new Random(123);
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
  });

  it('gives different numbers for different seeds', () => {
    const a = new Random(1);
    const b = new Random(2);
    const sa = Array.from({ length: 10 }, () => a.next());
    const sb = Array.from({ length: 10 }, () => b.next());
    expect(sa).not.toEqual(sb);
  });

  it('stays in [0, 1) and child seeds differ by salt', () => {
    const r = new Random(9);
    for (let i = 0; i < 1000; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
    expect(childSeed(5, 1)).not.toBe(childSeed(5, 2));
  });

  it('repeats a whole experiment exactly with the same seed', () => {
    const sc = getScenario('pushpull')!;
    const run = () => {
      const sim = new Simulation(sc.settings, sc.plan);
      sim.advance(120);
      return { m: sim.metrics(), x: Array.from(sim.pests.x.slice(0, 20)) };
    };
    expect(run()).toEqual(run());
  });

  it('changes the experiment when the seed changes', () => {
    const sc = getScenario('basic')!;
    const a = new Simulation(sc.settings, sc.plan);
    const b = new Simulation({ ...sc.settings, run: { ...sc.settings.run, seed: 999 } }, sc.plan);
    expect(Array.from(a.pests.x.slice(0, 10))).not.toEqual(Array.from(b.pests.x.slice(0, 10)));
  });
});
