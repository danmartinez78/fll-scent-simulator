import { describe, expect, it } from 'vitest';
import { captureRun, newEntry, summaryRows } from '../src/notebook/notebook';
import { notebookReportHtml } from '../src/notebook/report';
import { safeCharts } from '../src/notebook/reportCharts';
import { cropRect, Simulation } from '../src/simulation/Simulation';
import { defaultSettings } from '../src/simulation/scenarios';
import { sprayBlownAwayShare, sprayLanding } from '../src/simulation/Wind';
import { GROOMBA_REFERENCE } from '../src/simulation/Groomba';

describe('wind blows drone spray away', () => {
  it('blows away nothing in calm air and much more as the wind grows', () => {
    const w = (speedMph: number) => ({ direction: 0, speedMph, changing: false });
    expect(sprayBlownAwayShare(w(0))).toBe(0);
    expect(sprayBlownAwayShare(w(5))).toBeCloseTo(0.05);
    expect(sprayBlownAwayShare(w(15))).toBeCloseTo(0.45);
    // The groomba sprays from just above the plants.
    expect(sprayBlownAwayShare(w(15), GROOMBA_REFERENCE.driftFactor)).toBeCloseTo(0.045);
    const landed = sprayLanding(w(15), 0).reduce((a, p) => a + p.share, 0);
    expect(landed).toBeCloseTo(0.55);
    expect(sprayLanding(w(0), 0).reduce((a, p) => a + p.share, 0)).toBeCloseTo(1);
  });

  it('reports the share blown away', () => {
    const s = { ...defaultSettings(), wind: { direction: 0, speedMph: 10, changing: false } };
    const sim = new Simulation(s, { sprayZones: [cropRect(s.field)], devices: [] });
    while (sim.drone.busy || !sim.treatmentStarted) sim.step();
    expect(sim.metrics().sprayBlownAwayPct).toBeCloseTo(20, 0);
  });
});

describe('events on the charts', () => {
  it('marks repeat sprays and wind changes, and keeps them in the report', () => {
    const base = defaultSettings();
    const s = { ...base, drone: { ...base.drone, resprayEveryDays: 3 }, run: { ...base.run, durationMin: base.run.durationMin } };
    const sim = new Simulation(s, { sprayZones: [cropRect(s.field)], devices: [] });
    sim.advance(60);
    sim.updateSettings({ ...s, wind: { ...s.wind, speedMph: s.wind.speedMph + 10 } });
    sim.runToEnd();
    const kinds = sim.events.map((e) => e.kind);
    expect(kinds).toContain('wind');
    expect(kinds).toContain('spray');
    expect(sim.events.find((e) => e.kind === 'wind')!.label).toBe(`Wind ${s.wind.speedMph} → ${s.wind.speedMph + 10} mph`);
    expect(sim.events.find((e) => e.kind === 'spray')!.label).toBe('Spray #2');

    const captured = captureRun(sim, 'Basic Field');
    expect(captured.charts?.events?.length).toBe(sim.events.length);
    const html = notebookReportHtml([{ ...newEntry('Experiment 1'), captured }]);
    expect(html).toContain('Spray #2');
    expect(html).toContain('🌬️');
    expect(Object.fromEntries(summaryRows(captured))['Spray blown away by the wind']).toMatch(/%$/);
  }, 60000);

  it('drops broken events from an imported notebook and escapes labels', () => {
    const c = safeCharts({
      days: [0, 1],
      arrived: [0, 1], feeding: [0, 1], crop: [0, 1], helpers: [0, 1], killed: [0, 1], scent: [0, 1], product: [0, 1],
      treatStartDay: 0,
      rains: [],
      events: [{ day: 0.5, kind: 'wind', label: '<b>x</b>' }, { day: 'no', kind: 'wind', label: 'a' }, { day: 1, kind: 'bad', label: 'b' }]
    });
    expect(c?.events).toEqual([{ day: 0.5, kind: 'wind', label: '<b>x</b>' }]);
  });
});
