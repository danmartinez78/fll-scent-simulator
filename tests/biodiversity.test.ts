import { describe, expect, it } from 'vitest';
import { getScenario, settingsWith } from '../src/simulation/scenarios';
import { cropRect, Simulation } from '../src/simulation/Simulation';
import { Optimizer, scoreMetrics } from '../src/simulation/Optimizer';
import { FATE_POISONED } from '../src/simulation/Pest';
import { PESTICIDE_RULES } from '../src/simulation/Pesticide';
import type { DevicePlan, Settings, TreatmentPlan } from '../src/models/types';

const crop = cropRect(settingsWith({}).field);
const run = (s: Settings, plan: TreatmentPlan) => {
  const sim = new Simulation(s, plan);
  sim.runToEnd();
  return { sim, m: sim.metrics() };
};
const none: TreatmentPlan = { sprayZones: [], devices: [] };
const wholeField: TreatmentPlan = { sprayZones: [crop], devices: [] };
const grid = (kind: 'repellent' | 'attractant', trap = false): DevicePlan[] =>
  Array.from({ length: 12 }, (_, i) => ({
    id: i + 1,
    x: crop.x + (crop.w * ((i % 4) + 0.5)) / 4,
    y: crop.y + (crop.h * (Math.floor(i / 4) + 0.5)) / 3,
    kind,
    trap
  }));

describe('helpful insects', () => {
  it('ladybugs eat pests, which protects the crop for free', () => {
    const without = run(settingsWith({ treatment: 'none', helpers: { count: 0 } }), none).m;
    const withHelpers = run(settingsWith({ treatment: 'none' }), none).m;
    expect(without.pestsEaten).toBe(0);
    expect(withHelpers.pestsEaten).toBeGreaterThan(100);
    expect(withHelpers.cropProtectedPct).toBeGreaterThan(without.cropProtectedPct + 5);
    // Nobody killed anything.
    expect(withHelpers.pestsKilled).toBe(0);
    expect(withHelpers.helpersAlivePct).toBe(100);
  }, 60000);

  it('scents never kill helpful insects; sticky traps catch only a few', () => {
    const spray = run(settingsWith({ treatment: 'spray', drone: { resprayEveryDays: 7 } }), wholeField).m;
    const devices = run(settingsWith({ treatment: 'slowRelease' }), { sprayZones: [], devices: grid('repellent') }).m;
    const traps = run(settingsWith({ treatment: 'pushPull', devices: { maxDevices: 12 } }), { sprayZones: [], devices: grid('attractant', true) }).m;
    expect(spray.helpersKilled).toBe(0);
    expect(devices.helpersKilled).toBe(0);
    expect(spray.pestsKilled).toBe(0);
    expect(traps.pestsKilled).toBeGreaterThan(100);
    expect(traps.helpersAlivePct!).toBeGreaterThan(80);
    expect(traps.helpersKilled!).toBeGreaterThan(0);
  }, 60000);
});

describe('pesticide', () => {
  it('kills pests (except resistant ones) and helpful insects alike', () => {
    const { sim, m } = run(settingsWith({ treatment: 'pesticide', drone: { resprayEveryDays: 7 } }), wholeField);
    expect(m.pestsPoisoned!).toBeGreaterThan(250);
    expect(m.helpersAlivePct!).toBeLessThan(10);
    // Resistant pests (the lowest toughness values) are never poisoned.
    const p = sim.pests;
    for (let i = 0; i < p.n; i++) if (p.toughness[i] < PESTICIDE_RULES.resistantShare) expect(p.fate[i]).not.toBe(FATE_POISONED);
    // It kills pests that ignore scent too.
    let ignorersPoisoned = 0;
    for (let i = 0; i < p.n; i++) if (!p.reacts(i, 0.8) && p.fate[i] === FATE_POISONED) ignorersPoisoned++;
    expect(ignorersPoisoned).toBeGreaterThan(20);
  }, 60000);

  it('one spray kills the ladybugs, so pests come back (resurgence)', () => {
    const base = run(settingsWith({ treatment: 'none' }), none).m;
    const once = run(settingsWith({ treatment: 'pesticide' }), wholeField).m;
    const devices = run(settingsWith({ treatment: 'slowRelease' }), { sprayZones: [], devices: grid('repellent') }).m;
    expect(once.helpersAlivePct!).toBeLessThan(10);
    expect(once.pestsEaten!).toBeLessThan(base.pestsEaten! / 3);
    // Barely better than doing nothing, and well behind scent devices that kill nothing.
    expect(once.cropProtectedPct).toBeLessThan(base.cropProtectedPct + 15);
    expect(devices.cropProtectedPct).toBeGreaterThan(once.cropProtectedPct + 15);
  }, 60000);

  it('makes killing count in the default score', () => {
    const pesticide = run(settingsWith({ treatment: 'pesticide', drone: { resprayEveryDays: 7 } }), wholeField);
    const devices = run(settingsWith({ treatment: 'slowRelease' }), { sprayZones: [], devices: grid('repellent') });
    const w = settingsWith({}).weights;
    const parts = scoreMetrics(pesticide.m, w).parts;
    expect(parts.find((p) => p.label === 'Helpful insects killed')!.points).toBeLessThan(-100);
    expect(scoreMetrics(devices.m, w).total).toBeGreaterThan(scoreMetrics(pesticide.m, w).total);
  }, 60000);
});

describe('older setups', () => {
  it('runs without helpful insects when the setting is missing', () => {
    const s = settingsWith({ treatment: 'none' });
    delete (s as Partial<Settings>).helpers;
    const { m } = run(s, none);
    expect(m.helpersTotal).toBe(0);
    expect(m.helpersAlivePct).toBe(100);
    expect(m.pestsEaten).toBe(0);
  }, 60000);

  it('has a Crops and Critters mission that starts with pesticide', () => {
    const sc = getScenario('critters')!;
    expect(sc.settings.treatment).toBe('pesticide');
    expect(sc.settings.helpers?.count).toBeGreaterThan(0);
  });
});

describe('optimizer with pesticide', () => {
  it('plans pesticide zones within the limits and scores the insects killed', () => {
    const s = { ...getScenario('critters')!.settings, run: { ...getScenario('critters')!.settings.run, durationMin: 7 } };
    const opt = new Optimizer(s, { kind: 'none' }, opt0Ideas(s) + 2, 120);
    opt.runAll();
    expect(opt.best).not.toBeNull();
    expect(opt.best!.devices).toHaveLength(0);
    // "Do nothing" is always among the ideas, so the best score is at least that.
    const nothing = opt.starts.find((i) => i.label === 'Do nothing')!;
    expect(opt.bestScore).toBeGreaterThanOrEqual(nothing.score);
    expect(opt.starts.some((i) => (i.metrics?.helpersKilled ?? 0) > 0)).toBe(true);
  }, 120000);
});

/** Number of starting ideas the optimizer will test for these settings. */
function opt0Ideas(s: Settings): number {
  return new Optimizer(s, { kind: 'none' }, 1, 10).startingIdeas().length;
}
