import { describe, expect, it } from 'vitest';
import { getScenario, parseScenario, SCENARIOS } from '../src/simulation/scenarios';
import { Simulation } from '../src/simulation/Simulation';
import { needsReset } from '../src/simulation/settingsRules';

describe('scenarios', () => {
  it('ships the required presets', () => {
    const names = SCENARIOS.map((s) => s.name);
    for (const n of ['Basic Field', 'Windy Field', 'Pest Hotspots', 'Limited Product', 'Push-Pull', 'Survey Uncertainty', 'Limited Flight Time']) {
      expect(names).toContain(n);
    }
    expect(new Set(SCENARIOS.map((s) => s.id)).size).toBe(SCENARIOS.length);
  });

  it('loads and runs every scenario', () => {
    for (const sc of SCENARIOS) {
      const sim = new Simulation(sc.settings, sc.plan);
      expect(sim.pests.n).toBe(sc.settings.pests.count);
      sim.advance(30);
      const m = sim.metrics();
      expect(m.timeSec).toBeGreaterThan(0);
      expect(m.fieldTimeSec).toBeGreaterThanOrEqual(30);
      expect(m.cropProtectedPct).toBeGreaterThanOrEqual(0);
      expect(m.cropProtectedPct).toBeLessThanOrEqual(100);
    }
  });

  it('round-trips through JSON', () => {
    const sc = getScenario('pushpull')!;
    const back = parseScenario(JSON.stringify(sc));
    expect(back.settings).toEqual(sc.settings);
    expect(back.plan).toEqual(sc.plan);
    expect(back.name).toBe(sc.name);
  });

  it('fills missing settings with defaults', () => {
    const sc = parseScenario(JSON.stringify({ name: 'Tiny', settings: { wind: { speedMph: 7 } } }));
    expect(sc.settings.wind.speedMph).toBe(7);
    expect(sc.settings.wind.direction).toBe(90);
    expect(sc.settings.pests.count).toBeGreaterThan(0);
    expect(sc.plan).toEqual({ sprayZones: [], devices: [] });
  });

  it('rejects files that are not scenarios', () => {
    expect(() => parseScenario('not json')).toThrow();
  });

  it('knows which changes need a reset', () => {
    const s = getScenario('basic')!.settings;
    expect(needsReset(s, { ...s, wind: { ...s.wind, speedMph: 10 } })).toBe(false);
    expect(needsReset(s, { ...s, pests: { ...s.pests, count: 100 } })).toBe(true);
    expect(needsReset(s, { ...s, run: { ...s.run, seed: 1 } })).toBe(true);
  });
});
