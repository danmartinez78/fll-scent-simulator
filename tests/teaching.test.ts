import { describe, expect, it } from 'vitest';
import { planCoverage } from '../src/simulation/Treatment';
import { describeChanges } from '../src/notebook/notebook';
import { settingsWith } from '../src/simulation/scenarios';
import type { DevicePlan } from '../src/models/types';

const crop = { x: 20, y: 20, w: 180, h: 100 };
const dev = (id: number, x: number, y: number, kind: 'repellent' | 'attractant' = 'repellent'): DevicePlan => ({ id, x, y, kind, trap: false });

describe('plan coverage estimate', () => {
  it('counts a whole-field spray zone as full coverage', () => {
    expect(planCoverage({ sprayZones: [{ ...crop }], devices: [] }, crop, 18).coveredPct).toBeCloseTo(100, 0);
  });

  it('gives spread-out devices more coverage and less overlap than bunched ones', () => {
    const spread = [dev(1, 50, 45), dev(2, 110, 45), dev(3, 170, 45), dev(4, 50, 95), dev(5, 110, 95), dev(6, 170, 95)];
    const bunched = spread.map((d, i) => ({ ...d, x: 100 + i * 3, y: 70 }));
    const a = planCoverage({ sprayZones: [], devices: spread }, crop, 18);
    const b = planCoverage({ sprayZones: [], devices: bunched }, crop, 18);
    expect(a.coveredPct).toBeGreaterThan(b.coveredPct * 3);
    expect(a.overlapPct).toBeLessThan(5);
    expect(b.overlapPct).toBeGreaterThan(50);
    // One circle of radius 18 m is about 1018 m2 of the 18000 m2 crop.
    expect(planCoverage({ sprayZones: [], devices: [dev(1, 110, 70)] }, crop, 18).coveredPct).toBeCloseTo(5.65, 0);
  });

  it('ignores attractant devices', () => {
    expect(planCoverage({ sprayZones: [], devices: [dev(1, 110, 70, 'attractant')] }, crop, 18).coveredPct).toBe(0);
  });
});

describe('what changed between runs', () => {
  const base = settingsWith({ treatment: 'spray' });
  const plan = { sprayZones: [{ ...crop }], devices: [dev(1, 50, 50), dev(2, 150, 90)] };

  it('finds nothing when the setup is the same', () => {
    expect(describeChanges({ settings: base, plan }, { settings: structuredClone(base), plan: structuredClone(plan) })).toEqual([]);
  });

  it('counts switching method as one change, even though the plan pieces differ', () => {
    const after = { ...base, treatment: 'slowRelease' as const };
    expect(describeChanges({ settings: base, plan }, { settings: after, plan })).toEqual(['Method: Spray → Slow-release devices']);
  });

  it('lists each change in plain words', () => {
    const after = settingsWith({ treatment: 'spray', wind: { speedMph: 6 }, drone: { resprayEveryDays: 7 } });
    const changes = describeChanges({ settings: base, plan }, { settings: after, plan });
    expect(changes).toContain('How often to spray: once → every week');
    expect(changes).toContain('Wind: no wind → 6 mph toward the east');
    expect(changes).toHaveLength(2);
  });

  it('notices moved devices', () => {
    const s = { ...base, treatment: 'slowRelease' as const };
    const moved = { ...plan, devices: [dev(1, 60, 50), dev(2, 150, 90)] };
    expect(describeChanges({ settings: s, plan }, { settings: s, plan: moved })).toEqual(['Devices were moved']);
  });
});
