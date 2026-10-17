import { describe, expect, it } from 'vitest';
import { captureRun, describeChanges, runMethodName, summaryRows, workTimeText } from '../src/notebook/notebook';
import { notebookCsv, notebookReportHtml } from '../src/notebook/report';
import { newEntry } from '../src/notebook/notebook';
import { GROOMBA_REFERENCE, sprayDriftFactor, sprayerCosts, sprayerSettings, usesGroomba } from '../src/simulation/Groomba';
import { estimatePlanCost } from '../src/simulation/PlanCost';
import { cropRect, Simulation } from '../src/simulation/Simulation';
import { defaultSettings, getScenario } from '../src/simulation/scenarios';
import { needsReset } from '../src/simulation/settingsRules';
import { sprayLanding } from '../src/simulation/Wind';
import type { Settings } from '../src/models/types';

const withSprayer = (s: Settings, sprayer: 'drone' | 'groomba'): Settings => ({ ...s, sprayer });

describe('groomba', () => {
  it('leaves the drone alone unless it is chosen', () => {
    const s = defaultSettings();
    expect(s.sprayer).toBeUndefined();
    expect(usesGroomba(s)).toBe(false);
    expect(sprayerSettings(s)).toBe(s.drone);
    expect(sprayerCosts(s)).toBe(s.cost);
    expect(sprayDriftFactor(s)).toBe(1);
    // Devices are always flown out by the drone.
    expect(usesGroomba({ ...s, sprayer: 'groomba', treatment: 'slowRelease' })).toBe(false);
  });

  it('drives slower, sprays a narrower strip and costs less per minute', () => {
    const s = withSprayer(defaultSettings(), 'groomba');
    const g = sprayerSettings(s);
    expect(g.speed).toBe(GROOMBA_REFERENCE.speed);
    expect(g.swathM).toBe(GROOMBA_REFERENCE.swathM);
    expect(g.takeoffLandingSec).toBe(0);
    expect(g.appRateGalPerAcre).toBe(s.drone.appRateGalPerAcre);
    expect(sprayerCosts(s).flightCostPerMin).toBe(0.5);
  });

  it('its spray barely drifts', () => {
    const wind = { direction: 90, speedMph: 15, changing: false };
    const drone = sprayLanding(wind, 0);
    const groomba = sprayLanding(wind, 0, GROOMBA_REFERENCE.driftFactor);
    expect(Math.abs(groomba[0].dx)).toBeCloseTo(Math.abs(drone[0].dx) * 0.1);
    // Fewer fine drops drift off, and far less of the spray blows away before it lands.
    expect(groomba[1].share).toBeLessThan(drone[1].share * 0.2);
    const landed = (parts: typeof drone) => parts.reduce((a, p) => a + p.share, 0);
    expect(landed(drone)).toBeLessThan(0.6);
    expect(landed(groomba)).toBeGreaterThan(0.95);
  });

  it('takes about two hours for the whole field but costs about the same as the drone', () => {
    const base = defaultSettings();
    const plan = { sprayZones: [cropRect(base.field)], devices: [] };
    const drone = new Simulation(base, plan);
    const groomba = new Simulation(withSprayer(base, 'groomba'), plan);
    while (drone.drone.busy || !drone.treatmentStarted) drone.step();
    while (groomba.drone.busy || !groomba.treatmentStarted) groomba.step();
    const dm = drone.metrics();
    const gm = groomba.metrics();
    expect(dm.flightTimeMin).toBeGreaterThan(9);
    expect(dm.flightTimeMin).toBeLessThan(15);
    expect(gm.flightTimeMin).toBeGreaterThan(90);
    expect(gm.flightTimeMin).toBeLessThan(130);
    expect(gm.productUsedGal).toBeCloseTo(dm.productUsedGal, 0);
    expect(Math.abs(gm.cost.total - dm.cost.total) / dm.cost.total).toBeLessThan(0.15);
    // The plan cost estimate matches what the run spent.
    expect(estimatePlanCost(withSprayer(base, 'groomba'), plan).total).toBeCloseTo(gm.cost.total, -1);
  });

  it('protects more crop than the drone on the windy "Ground or air?" mission', () => {
    const sc = getScenario('groundAir')!;
    expect(sc.settings.sprayer).toBeUndefined();
    const run = (s: Settings) => {
      const sim = new Simulation(s, sc.plan);
      sim.runToEnd();
      return sim.metrics();
    };
    const drone = run(sc.settings);
    const groomba = run(withSprayer(sc.settings, 'groomba'));
    expect(groomba.cropProtectedPct).toBeGreaterThan(drone.cropProtectedPct);
    expect(groomba.pestsDeterredAvgPct).toBeGreaterThan(drone.pestsDeterredAvgPct);
    expect(groomba.flightTimeMin).toBeGreaterThan(drone.flightTimeMin * 5);
  }, 60000);

  it('is named in the notebook, report and spreadsheet', () => {
    const s = withSprayer(defaultSettings(), 'groomba');
    expect(runMethodName(s)).toBe('Spray with the groomba');
    expect(runMethodName({ ...s, treatment: 'pesticide' })).toBe('Pesticide with the groomba');
    expect(runMethodName(defaultSettings())).toBe('Spray');
    expect(workTimeText(s, 113)).toBe('1 h 53 min driving');
    expect(workTimeText(defaultSettings(), 12.44)).toBe('12.4 min flying');

    const sim = new Simulation(s, { sprayZones: [cropRect(s.field)], devices: [] });
    sim.advance(30);
    const captured = captureRun(sim, 'Basic Field');
    const rows = Object.fromEntries(summaryRows(captured));
    expect(rows['Treatment']).toBe('Spray with the groomba');
    expect(rows['Groomba driving time']).toMatch(/driving/);
    expect(rows['Drone flight time']).toBe('—');
    const entries = [{ ...newEntry('Experiment 1'), captured }];
    expect(notebookCsv(entries)).toContain('Spray with the groomba');
    expect(notebookReportHtml(entries)).toContain('Flying or driving time');

    const changes = describeChanges({ settings: defaultSettings(), plan: captured.plan }, { settings: s, plan: captured.plan });
    expect(changes).toEqual(['Sprayer: drone → groomba']);
  });

  it('switching sprayers starts the run over', () => {
    const s = defaultSettings();
    expect(needsReset(s, withSprayer(s, 'groomba'))).toBe(true);
    expect(needsReset(s, withSprayer(s, 'drone'))).toBe(false);
  });
});
