import { describe, expect, it } from 'vitest';
import { cropRect, Simulation } from '../src/simulation/Simulation';
import { estimatePlanCost, sprayRounds } from '../src/simulation/PlanCost';
import { settingsWith } from '../src/simulation/scenarios';
import type { DevicePlan, Settings, TreatmentPlan } from '../src/models/types';

const crop = cropRect(settingsWith({}).field);
const grid = (n: number): DevicePlan[] =>
  Array.from({ length: n }, (_, i) => ({ id: i + 1, x: crop.x + 10 + ((i * 37) % (crop.w - 20)), y: crop.y + 10 + ((i * 23) % (crop.h - 20)), kind: 'repellent', trap: false }));

function actual(s: Settings, plan: TreatmentPlan) {
  const sim = new Simulation(s, plan);
  sim.runToEnd();
  return { cost: sim.metrics().cost.total, sim };
}

describe('plan cost estimate', () => {
  it('matches what the run really costs', () => {
    const cases: Array<[Settings, TreatmentPlan]> = [
      [settingsWith({ treatment: 'spray' }), { sprayZones: [crop], devices: [] }],
      [settingsWith({ treatment: 'spray', drone: { resprayEveryDays: 7 } }), { sprayZones: [crop], devices: [] }],
      [settingsWith({ treatment: 'slowRelease' }), { sprayZones: [], devices: grid(12) }]
    ];
    for (const [s, plan] of cases) {
      const est = estimatePlanCost(s, plan).total;
      const real = actual(s, plan).cost;
      expect(Math.abs(est - real) / real).toBeLessThan(0.05);
    }
  });

  it('counts repeat sprays', () => {
    expect(sprayRounds(settingsWith({ treatment: 'spray' }))).toBe(1);
    expect(sprayRounds(settingsWith({ treatment: 'spray', drone: { resprayEveryDays: 7 } }))).toBe(3);
  });
});

describe('budget', () => {
  it('never lets the drone spend more than the budget', () => {
    for (const [s, plan] of [
      [settingsWith({ treatment: 'spray', drone: { resprayEveryDays: 3 }, cost: { budget: 500 } }), { sprayZones: [crop], devices: [] }],
      [settingsWith({ treatment: 'slowRelease', devices: { maxDevices: 40 }, cost: { budget: 200 } }), { sprayZones: [], devices: grid(40) }]
    ] as Array<[Settings, TreatmentPlan]>) {
      const { cost, sim } = actual(s, plan);
      expect(cost).toBeLessThanOrEqual(s.cost.budget!);
      // ...but it uses most of it before stopping.
      expect(cost).toBeGreaterThan(s.cost.budget! * 0.85);
      expect(sim.drone.outOfBudget).toBe(true);
    }
  });

  it('changes nothing when the plan fits the budget', () => {
    const s = settingsWith({ treatment: 'spray' });
    const plan = { sprayZones: [crop], devices: [] };
    const free = actual(s, plan).cost;
    const { cost, sim } = actual({ ...s, cost: { ...s.cost, budget: free + 50 } }, plan);
    expect(cost).toBeCloseTo(free, 5);
    expect(sim.drone.outOfBudget).toBe(false);
  });
});
