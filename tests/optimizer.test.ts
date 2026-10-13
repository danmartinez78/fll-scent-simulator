import { describe, expect, it } from 'vitest';
import { Optimizer, planWithinLimits, scoreMetrics } from '../src/simulation/Optimizer';
import { getScenario, settingsWith } from '../src/simulation/scenarios';
import { estimateSprayLiters } from '../src/simulation/Treatment';
import { galToL } from '../src/utils/units';
import type { Metrics } from '../src/models/types';

describe('optimizer', () => {
  it('keeps spray plans within the product limit', () => {
    const s = getScenario('limited')!.settings;
    const opt = new Optimizer(s, { kind: 'none' }, 12, 60);
    const map = { x: 0, y: 0, w: s.field.width, h: s.field.height };
    for (let i = 0; i < 200; i++) {
      const p = i % 2 ? opt.randomPlan() : opt.mutate(opt.randomPlan());
      expect(estimateSprayLiters(p.sprayZones, map, s.drone)).toBeLessThanOrEqual(galToL(s.drone.productAvailableGal) + 1e-6);
      expect(planWithinLimits(p, s)).toBe(true);
    }
    opt.runAll();
    expect(opt.best).not.toBeNull();
    expect(planWithinLimits(opt.best!, s)).toBe(true);
    expect(opt.bestMetrics!.productUsedGal).toBeLessThanOrEqual(s.drone.productAvailableGal + 1e-6);
  });

  it('keeps device plans within the device limit', () => {
    const s = settingsWith({ treatment: 'pushPull', devices: { maxDevices: 4 }, run: { durationMin: 5 } });
    const opt = new Optimizer(s, { kind: 'none' }, 10, 60);
    for (let i = 0; i < 200; i++) {
      const p = opt.mutate(opt.randomPlan());
      expect(p.devices.length).toBeLessThanOrEqual(4);
      expect(p.sprayZones.length).toBe(0);
    }
    opt.runAll();
    expect(opt.best!.devices.length).toBeLessThanOrEqual(4);
    expect(opt.bestMetrics!.devicesUsed).toBeLessThanOrEqual(4);
  });

  it('only uses repellent devices for slow-release', () => {
    const s = settingsWith({ treatment: 'slowRelease', run: { durationMin: 5 } });
    const opt = new Optimizer(s, { kind: 'none' }, 5, 50);
    for (let i = 0; i < 50; i++) expect(opt.mutate(opt.randomPlan()).devices.every((d) => d.kind === 'repellent')).toBe(true);
  });

  it('never finds a worse best score as it goes', () => {
    const s = settingsWith({ treatment: 'slowRelease', run: { durationMin: 5 } });
    const opt = new Optimizer(s, { kind: 'none' }, 15, 50);
    opt.runAll();
    for (let i = 1; i < opt.trace.length; i++) expect(opt.trace[i]).toBeGreaterThanOrEqual(opt.trace[i - 1]);
    expect(opt.tried).toBe(15);
  });

  it('exposes how the score is calculated', () => {
    const m = {
      cropProtectedPct: 80,
      pestsDeterredAvgPct: 40,
      productUsedGal: 5,
      flightTimeMin: 10,
      cost: { total: 100 }
    } as Metrics;
    const w = { protection: 1, pestsDeterred: 0.5, material: 2, flightTime: 1, cost: 0.5 };
    const b = scoreMetrics(m, w);
    expect(b.total).toBeCloseTo(80 + 20 - 10 - 10 - 5);
    expect(b.parts.map((p) => p.label)).toContain('Product used');
  });
});
