import { describe, expect, it } from 'vitest';
import { Simulation } from '../src/simulation/Simulation';
import { settingsWith } from '../src/simulation/scenarios';

/** Settings with every pest there at the start and the treatment starting right away. */
const atOnce = (c: Parameters<typeof settingsWith>[0]) =>
  settingsWith({ ...c, pests: { buildUpDays: 0, ...c.pests }, run: { treatStartDay: 1, ...c.run } });

import type { Settings } from '../src/models/types';

function survey(s: Settings) {
  const sim = new Simulation(s, { sprayZones: [], devices: [] });
  sim.startSurvey();
  for (let i = 0; i < 5000 && sim.surveying; i++) sim.step();
  expect(sim.surveys.length).toBe(1);
  return sim.surveys[0];
}

describe('survey drone', () => {
  it('counts every pest with a perfect camera', () => {
    const r = survey(atOnce({ treatment: 'none', survey: { detectionPct: 100, falsePositivesPer1000m2: 0, positionNoiseM: 0, uncertainPct: 0 } }));
    // Pests keep moving during the scan, so a few can slip between squares.
    expect(r.trueTotal).toBeGreaterThan(485);
    expect(r.trueTotal).toBeLessThan(515);
    expect(r.detectedTotal).toBe(r.trueTotal);
    expect(r.estimate).toEqual(r.truth);
    expect(r.category.includes('uncertain')).toBe(false);
  });

  it('misses pests with an imperfect camera', () => {
    const r = survey(atOnce({ treatment: 'none', survey: { detectionPct: 60, falsePositivesPer1000m2: 0, positionNoiseM: 0, uncertainPct: 0 } }));
    expect(r.detectedTotal).toBeLessThan(r.trueTotal * 0.75);
    expect(r.detectedTotal).toBeGreaterThan(r.trueTotal * 0.45);
  });

  it('reports fake detections', () => {
    const r = survey(atOnce({ treatment: 'none', pests: { count: 50 }, survey: { detectionPct: 100, falsePositivesPer1000m2: 5, positionNoiseM: 0, uncertainPct: 0 } }));
    expect(r.detectedTotal).toBeGreaterThan(r.trueTotal + 50);
  });

  it('finds hotspots where pests cluster', () => {
    const r = survey(atOnce({ treatment: 'none', pests: { distribution: 'hotspots', count: 600 }, survey: { detectionPct: 90, falsePositivesPer1000m2: 0.5, positionNoiseM: 3, uncertainPct: 0 } }));
    expect(r.hotspotSquares).toBeGreaterThan(0);
    expect(r.category.filter((c) => c === 'healthy').length).toBeGreaterThan(0);
  });

  it('can survey again later to compare before and after', () => {
    const sim = new Simulation(atOnce({ treatment: 'none' }), { sprayZones: [], devices: [] });
    sim.startSurvey();
    while (sim.surveying) sim.step();
    sim.advance(300);
    sim.startSurvey();
    while (sim.surveying) sim.step();
    expect(sim.surveys.map((s) => s.label)).toEqual(['Survey 1', 'Survey 2']);
    expect(sim.surveys[1].timeSec).toBeGreaterThan(sim.surveys[0].timeSec);
  });

  it('flies only the survey drone when surveying before the first Run', () => {
    const plan = { sprayZones: [], devices: [{ id: 1, x: 100, y: 60, kind: 'repellent' as const, trap: false }] };
    const sim = new Simulation(atOnce({ treatment: 'slowRelease' }), plan);
    sim.startSurvey(true);
    while (sim.surveying) sim.step();
    expect(sim.treatmentWaiting).toBe(true);
    expect(sim.drone.mode).toBe('parked');
    expect(sim.drone.flights).toBe(0);
    expect(sim.devices[0].activatedAt).toBeNull();
    expect(sim.repellent.max()).toBe(0);
    // Pressing Run starts the treatment.
    sim.startTreatment();
    sim.advance(120);
    expect(sim.devices[0].activatedAt).not.toBeNull();
    expect(sim.repellent.max()).toBeGreaterThan(0);
  });

  it('starts hand-placed devices when the run starts, not during an earlier survey', () => {
    const plan = { sprayZones: [], devices: [{ id: 1, x: 100, y: 60, kind: 'repellent' as const, trap: false }] };
    const sim = new Simulation(atOnce({ treatment: 'slowRelease', devices: { deployByDrone: false } }), plan);
    sim.startSurvey(true);
    while (sim.surveying) sim.step();
    expect(sim.repellent.max()).toBe(0);
    const t = sim.time;
    sim.startTreatment();
    sim.step();
    expect(sim.devices[0].activatedAt).toBe(t);
    expect(sim.repellent.max()).toBeGreaterThan(0);
  });

  it('keeps the treatment going during a survey flown mid-run', () => {
    const plan = { sprayZones: [], devices: [{ id: 1, x: 100, y: 60, kind: 'repellent' as const, trap: false }] };
    const sim = new Simulation(atOnce({ treatment: 'slowRelease' }), plan);
    sim.advance(10);
    sim.startSurvey(true);
    expect(sim.treatmentWaiting).toBe(false);
    sim.advance(120);
    expect(sim.devices[0].activatedAt).not.toBeNull();
  });
});
