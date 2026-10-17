import { describe, expect, it } from 'vitest';
import { getScenario, settingsWith } from '../src/simulation/scenarios';
import { cropRect, Simulation } from '../src/simulation/Simulation';
import type { DevicePlan } from '../src/models/types';

function surveyed(): Simulation {
  const sc = getScenario('survey')!;
  const sim = new Simulation(sc.settings, sc.plan);
  sim.startSurvey(true);
  while (sim.surveying) sim.step();
  return sim;
}

describe('survey before the run', () => {
  it('does not count as starting the run', () => {
    const sim = surveyed();
    expect(sim.surveys).toHaveLength(1);
    expect(sim.surveys[0].beforeRun).toBe(true);
    expect(sim.runStarted).toBe(false);
    expect(sim.time).toBeGreaterThan(0);
    sim.startTreatment();
    sim.step();
    expect(sim.runStarted).toBe(true);
  });

  it('is kept when the same field starts over, but not on a different field', () => {
    const old = surveyed();
    const sc = getScenario('survey')!;
    const again = new Simulation(sc.settings, sc.plan);
    expect(again.adoptSurveysFrom(old)).toBe(1);
    expect(again.surveys[0].estimate).toEqual(old.surveys[0].estimate);
    const other = new Simulation({ ...sc.settings, run: { ...sc.settings.run, seed: 7 } }, sc.plan);
    expect(other.adoptSurveysFrom(old)).toBe(0);
  });
});

describe('traps', () => {
  it('catch at least as many pests with more traps (pests fly to the nearest lure)', () => {
    const s = settingsWith({ treatment: 'pushPull', pests: { distribution: 'hotspots', hotspotCount: 3, buildUpDays: 0 }, devices: { maxDevices: 6 } });
    const c = cropRect(s.field);
    const traps = (k: number): DevicePlan[] =>
      Array.from({ length: k }, (_, i) => ({ id: i + 1, x: c.x + (c.w * (i + 0.5)) / k, y: c.y + c.h / 2, kind: 'attractant', trap: true }));
    const caught = (k: number) => {
      const sim = new Simulation(s, { sprayZones: [], devices: traps(k) });
      sim.runToEnd();
      return sim.pests.countTrapped();
    };
    const two = caught(2);
    const six = caught(6);
    expect(six).toBeGreaterThanOrEqual(two * 0.95);
  });
});
