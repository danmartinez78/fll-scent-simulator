import { describe, expect, it } from 'vitest';
import { settingsWith } from '../src/simulation/scenarios';
import { cropRect, Simulation } from '../src/simulation/Simulation';
import { sprayRounds } from '../src/simulation/PlanCost';
import { forecastText, rainSpans, rainingAt, RESPRAY_AFTER_RAIN } from '../src/simulation/Weather';
import type { DevicePlan } from '../src/models/types';

const crop = cropRect(settingsWith({}).field);

describe('rain', () => {
  it('falls on the forecast days in the afternoon', () => {
    const s = settingsWith({ weather: { rainDays: [6, 13] } });
    const spans = rainSpans(s);
    expect(spans.map((r) => r.day)).toEqual([6, 13]);
    // Day 6 at 2 PM is 5 days and 6 hours after the 8 AM start.
    expect(rainingAt(spans, 5 * 86400 + 6 * 3600)).toBe(true);
    expect(rainingAt(spans, 5 * 86400 + 2 * 3600)).toBe(false);
    expect(forecastText(s)).toContain('Day 6 and Day 13');
    expect(rainSpans(settingsWith({}))).toEqual([]);
  });

  it('washes spray off the leaves', () => {
    const run = (rainDays: number[]) => {
      const sim = new Simulation(settingsWith({ treatment: 'spray', run: { treatStartDay: 1 }, weather: { rainDays } }), { sprayZones: [crop], devices: [] });
      while (sim.fieldTime < 2.9 * 86400) sim.step();
      return sim.sprayResidue.total();
    };
    const dry = run([]);
    const wet = run([2]);
    expect(wet).toBeLessThan(dry * 0.4);
    expect(wet).toBeGreaterThan(dry * 0.2);
  });

  it('keeps the drone on the ground while it rains, then it finishes the job', () => {
    // Treatment starts in the rain on Day 3.
    const s = settingsWith({ treatment: 'spray', run: { treatStartDay: 3 }, weather: { rainDays: [3] } });
    const sim = new Simulation(s, { sprayZones: [crop], devices: [] });
    let sprayedInRain = 0;
    let last = 0;
    while (!sim.finished) {
      sim.step();
      const now = sim.drone.litersSprayed;
      if (sim.raining && now > last + 1e-9) sprayedInRain += now - last;
      last = now;
    }
    expect(sprayedInRain).toBe(0);
    expect(sim.drone.outOfProduct).toBe(false);
    expect(sim.drone.gaveUp).toBe(false);
    expect(sim.metrics().productUsedGal).toBeGreaterThan(8);
  }, 30000);

  it('sprays again after each rain when asked', () => {
    const s = settingsWith({ treatment: 'spray', drone: { resprayEveryDays: RESPRAY_AFTER_RAIN }, weather: { rainDays: [5, 9, 14] } });
    expect(sprayRounds(s)).toBe(4);
    const sim = new Simulation(s, { sprayZones: [crop], devices: [] });
    sim.runToEnd();
    expect(sim.resprays).toBe(3);
  }, 30000);

  it('hurts spray much more than slow-release devices', () => {
    const devices: DevicePlan[] = Array.from({ length: 12 }, (_, i) => ({
      id: i + 1,
      x: crop.x + (crop.w * ((i % 4) + 0.5)) / 4,
      y: crop.y + (crop.h * (Math.floor(i / 4) + 0.5)) / 3,
      kind: 'repellent',
      trap: false
    }));
    const crop0 = (treatment: 'spray' | 'slowRelease', rainDays: number[]) => {
      const s = settingsWith({ treatment, drone: { resprayEveryDays: 3 }, weather: { rainDays } });
      const sim = new Simulation(s, { sprayZones: [crop], devices });
      sim.runToEnd();
      return sim.metrics().cropProtectedPct;
    };
    const sprayLoss = crop0('spray', []) - crop0('spray', [5, 9, 14, 18]);
    const deviceLoss = crop0('slowRelease', []) - crop0('slowRelease', [5, 9, 14, 18]);
    expect(sprayLoss).toBeGreaterThan(2);
    expect(sprayLoss).toBeGreaterThan(deviceLoss + 2);
  }, 60000);
});
