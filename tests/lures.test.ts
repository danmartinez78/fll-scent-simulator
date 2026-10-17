import { describe, expect, it } from 'vitest';
import { settingsWith } from '../src/simulation/scenarios';
import { AFFECTED_DAMAGE, BARE_DAMAGE_FACTOR, cropRect, Simulation } from '../src/simulation/Simulation';
import type { DevicePlan } from '../src/models/types';

// No helpful insects here: this checks lure behavior alone (ladybugs would eat some pests first).
const s = settingsWith({ treatment: 'pushPull', devices: { maxDevices: 4 }, helpers: { count: 0 } });
const c = cropRect(s.field);
const border = [
  { x: c.x + c.w / 2, y: c.y - 10 },
  { x: c.x + c.w + 10, y: c.y + c.h / 2 },
  { x: c.x + c.w / 2, y: c.y + c.h + 10 },
  { x: c.x - 10, y: c.y + c.h / 2 }
];
const lures = (trap: boolean): DevicePlan[] => border.map((p, i) => ({ id: i + 1, ...p, kind: 'attractant', trap }));

function run(trap: boolean) {
  const sim = new Simulation(s, { sprayZones: [], devices: lures(trap) });
  sim.runToEnd();
  return sim.metrics();
}

describe('attractant with and without a trap', () => {
  it('a trap does clearly better than the same lure with no trap', () => {
    const plain = run(false);
    const trap = run(true);
    expect(plain.pestsTrapped).toBe(0);
    expect(trap.pestsTrapped).toBeGreaterThan(300);
    // Pests lose interest in a lure that cannot catch them, and go back to the crop.
    expect(trap.pestsDeterredAvgPct).toBeGreaterThan(plain.pestsDeterredAvgPct + 8);
    expect(trap.cropProtectedPct).toBeGreaterThan(plain.cropProtectedPct + 2);
  }, 60000);
});

describe('food running out', () => {
  it('pests do not feed on a square that is eaten bare', () => {
    const sim = new Simulation(settingsWith({ treatment: 'none', pests: { count: 50 } }), { sprayZones: [], devices: [] });
    sim.damage.fill(BARE_DAMAGE_FACTOR * AFFECTED_DAMAGE);
    sim.advance(60);
    expect(sim.feedingCount()).toBe(0);
    expect(sim.isBare(c.x + c.w / 2, c.y + c.h / 2)).toBe(true);
  });
});
