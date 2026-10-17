import { describe, expect, it } from 'vitest';
import { coveredBlocks, kMeans, mergeBlocks, Optimizer, planWithinLimits, scoreMetrics, sprayBlocks } from '../src/simulation/Optimizer';
import { cropRect, Simulation } from '../src/simulation/Simulation';
import { Random } from '../src/utils/random';
import { settingsWith } from '../src/simulation/scenarios';
import { estimateSprayLiters } from '../src/simulation/Treatment';
import { galToL } from '../src/utils/units';
import type { Metrics } from '../src/models/types';

describe('optimizer', () => {
  it('keeps spray plans within the product limit', () => {
    const s = settingsWith({ treatment: 'spray', pests: { distribution: 'hotspots', hotspotCount: 4 }, drone: { productAvailableGal: 4 } });
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

  it('keeps attractant traps in the grass border, never on the crop', () => {
    const s = settingsWith({ treatment: 'pushPull', devices: { maxDevices: 12 }, run: { durationMin: 5 } });
    const crop = cropRect(s.field);
    const opt = new Optimizer(s, { kind: 'none' }, 1, 60);
    const plans = [...opt.startingIdeas().map((i) => i.plan)];
    let p = opt.randomPlan();
    for (let i = 0; i < 300; i++) plans.push((p = opt.mutate(p)));
    let traps = 0;
    for (const plan of plans) {
      for (const d of plan.devices) {
        if (d.kind !== 'attractant') continue;
        traps++;
        expect(d.trap).toBe(true);
        const inside = d.x > crop.x && d.x < crop.x + crop.w && d.y > crop.y && d.y < crop.y + crop.h;
        expect(inside).toBe(false);
      }
    }
    expect(traps).toBeGreaterThan(20);
  });

  it('tries push-pull ideas with different numbers of traps', () => {
    const s = settingsWith({ treatment: 'pushPull', devices: { maxDevices: 12 }, run: { durationMin: 5 } });
    const opt = new Optimizer(s, { kind: 'none' }, 1, 60);
    const trapCounts = new Set(opt.startingIdeas().map((i) => i.plan.devices.filter((d) => d.trap).length));
    for (const t of [0, 1, 2, 3, 4]) expect(trapCounts.has(t)).toBe(true);
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

describe('optimizer building blocks', () => {
  it('merges chosen blocks into the fewest rectangles', () => {
    const s = settingsWith({ treatment: 'spray' });
    const blocks = sprayBlocks(s);
    const crop = cropRect(s.field);
    const all = mergeBlocks(blocks);
    expect(all.length).toBe(1);
    expect(all[0].x).toBeCloseTo(crop.x);
    expect(all[0].w).toBeCloseTo(crop.w);
    expect(all[0].h).toBeCloseTo(crop.h);
    // One full row plus one odd block elsewhere: two rectangles.
    const nx = Math.round(crop.w / 30);
    const row = blocks.slice(0, nx);
    const merged = mergeBlocks([...row, blocks[blocks.length - 1]]);
    expect(merged.length).toBe(2);
    expect(coveredBlocks([crop], blocks).length).toBe(blocks.length);
    expect(coveredBlocks(merged, blocks).length).toBe(nx + 1);
  });

  it('tries the obvious ideas first, including doing nothing', () => {
    const s = settingsWith({ treatment: 'spray', run: { durationMin: 5 } });
    const opt = new Optimizer(s, { kind: 'none' }, 8, 60);
    const labels = opt.startingIdeas().map((i) => i.label);
    expect(labels).toContain('Whole field');
    expect(labels).toContain('Border strips');
    expect(labels[labels.length - 1]).toBe('Do nothing');
    opt.runAll();
    expect(opt.starts.length).toBe(Math.min(8, labels.length));
    expect(opt.starts.some((st) => st.label === 'Do nothing' && st.allowed)).toBe(true);
    expect(opt.bestFrom).not.toBe('');
  });

  it('groups points into clusters', () => {
    const rng = new Random(3);
    const pts = [];
    for (let i = 0; i < 60; i++) pts.push({ x: 20 + rng.gaussian() * 2, y: 20 + rng.gaussian() * 2 });
    for (let i = 0; i < 60; i++) pts.push({ x: 150 + rng.gaussian() * 2, y: 90 + rng.gaussian() * 2 });
    const centers = kMeans(pts, 2, rng).sort((a, b) => a.x - b.x);
    expect(centers[0].x).toBeCloseTo(20, 0);
    expect(centers[1].x).toBeCloseTo(150, 0);
  });

  it('lets fewer test pests stand for the real count when feeding', () => {
    const s = settingsWith({ treatment: 'none', pests: { buildUpDays: 0 }, run: { durationMin: 7 } });
    const light = new Simulation(s, { sprayZones: [], devices: [] }, { pestCount: 100 });
    const weighted = new Simulation(s, { sprayZones: [], devices: [] }, { pestCount: 100, pestWeight: 5 });
    light.runToEnd();
    weighted.runToEnd();
    expect(weighted.metrics().cropAffectedPct).toBeGreaterThan(light.metrics().cropAffectedPct + 10);
  });
});
