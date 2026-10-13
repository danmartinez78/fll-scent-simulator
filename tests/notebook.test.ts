import { describe, expect, it } from 'vitest';
import { captureRun, compareRows, duplicateEntry, duplicateName, exportNotebook, neutralSummary, newEntry, parseNotebook } from '../src/notebook/notebook';
import { Simulation } from '../src/simulation/Simulation';
import { getScenario } from '../src/simulation/scenarios';

describe('experiment notebook', () => {
  it('names duplicates A, B, C', () => {
    const e3a = newEntry('Experiment 3A');
    expect(duplicateName('Experiment 3A', [e3a])).toBe('Experiment 3B');
    expect(duplicateName('Experiment 3', [])).toBe('Experiment 3B');
    expect(duplicateName('Experiment 3A', [e3a, newEntry('Experiment 3B')])).toBe('Experiment 3C');
  });

  it('captures settings and results, and duplicates keep the setup but not the results', () => {
    const sc = getScenario('windy')!;
    const sim = new Simulation(sc.settings, sc.plan);
    sim.advance(60);
    const e = { ...newEntry('Experiment 1'), question: 'Q', prediction: 'P', captured: captureRun(sim, sc.name) };
    expect(e.captured.settings.wind.speedMph).toBe(sc.settings.wind.speedMph);
    expect(e.captured.metrics.timeSec).toBeCloseTo(60);
    const d = duplicateEntry(e, [e]);
    expect(d.captured).toBeNull();
    expect(d.setup?.settings.wind.speedMph).toBe(sc.settings.wind.speedMph);
    expect(d.question).toBe('Q');
    expect(d.prediction).toBe('');
  });

  it('exports and imports', () => {
    const e = { ...newEntry('Experiment 1'), prediction: 'more wind, more drift' };
    const back = parseNotebook(exportNotebook([e]));
    expect(back).toHaveLength(1);
    expect(back[0].prediction).toBe('more wind, more drift');
    expect(() => parseNotebook('{"hello":1}')).toThrow();
  });

  it('compares without telling students which is better', () => {
    const sc = getScenario('basic')!;
    const a = new Simulation(sc.settings, { sprayZones: [{ x: 20, y: 20, w: 180, h: 100 }], devices: [] });
    a.advance(300);
    const b = new Simulation({ ...sc.settings, wind: { ...sc.settings.wind, speedMph: 10 } }, sc.plan);
    b.advance(300);
    const ca = captureRun(a, sc.name);
    const cb = captureRun(b, sc.name);
    const rows = compareRows(ca, cb);
    expect(rows.find((r) => r.label === 'Wind')!.differs).toBe(true);
    const text = neutralSummary('A', ca, 'B', cb);
    expect(text).toMatch(/A used .* gallons/);
    expect(text).not.toMatch(/better|worse|best|correct/i);
  });
});
