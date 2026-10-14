import { describe, expect, it } from 'vitest';
import { Simulation } from '../src/simulation/Simulation';
import { getScenario, settingsWith } from '../src/simulation/scenarios';
import type { TreatmentPlan } from '../src/models/types';

const crop = { x: 20, y: 20, w: 180, h: 100 };

describe('simulation', () => {
  it('protects more crop with a whole-field spray than with no treatment', () => {
    const s = settingsWith({ treatment: 'spray', run: { durationMin: 15 } });
    const none = new Simulation({ ...s, treatment: 'none' }, { sprayZones: [], devices: [] });
    none.runToEnd();
    const spray = new Simulation(s, { sprayZones: [crop], devices: [] });
    spray.runToEnd();
    expect(spray.metrics().cropProtectedPct).toBeGreaterThan(none.metrics().cropProtectedPct);
    expect(spray.metrics().productUsedGal).toBeGreaterThan(0);
    expect(none.metrics().productUsedGal).toBe(0);
  });

  it('lets pests come back after a short-lived scent fades', () => {
    const s = settingsWith({ treatment: 'spray', scent: { lifetimeMin: 1 }, run: { durationMin: 25 } });
    const sim = new Simulation(s, { sprayZones: [crop], devices: [] });
    let minFeeding = 100;
    while (!sim.finished) {
      sim.step();
      // Measure after the drone has landed, once the time-lapse is running.
      if (sim.time > 60 && !sim.droneFlying) minFeeding = Math.min(minFeeding, sim.metrics().pestsFeedingPct);
    }
    expect(sim.metrics().pestsFeedingPct).toBeGreaterThan(minFeeding + 20);
  });

  it('only activates devices after the drone drops them', () => {
    const plan: TreatmentPlan = { sprayZones: [], devices: [{ id: 1, x: 100, y: 60, kind: 'repellent', trap: false }] };
    const sim = new Simulation(settingsWith({ treatment: 'slowRelease' }), plan);
    expect(sim.devices[0].activatedAt).toBeNull();
    sim.advance(120);
    expect(sim.devices[0].activatedAt).not.toBeNull();
    expect(sim.repellent.max()).toBeGreaterThan(0);
  });

  it('activates hand-placed devices immediately', () => {
    const plan: TreatmentPlan = { sprayZones: [], devices: [{ id: 1, x: 100, y: 60, kind: 'repellent', trap: false }] };
    const sim = new Simulation(settingsWith({ treatment: 'slowRelease', devices: { deployByDrone: false } }), plan);
    expect(sim.devices[0].activatedAt).toBe(0);
  });

  it('ignores plan pieces that do not match the method', () => {
    const plan: TreatmentPlan = { sprayZones: [crop], devices: [{ id: 1, x: 100, y: 60, kind: 'attractant', trap: true }] };
    const slow = new Simulation(settingsWith({ treatment: 'slowRelease' }), plan);
    expect(slow.devices.length).toBe(0);
    expect(slow.drone.tasks.length).toBe(0);
    const push = new Simulation(settingsWith({ treatment: 'pushPull' }), plan);
    expect(push.devices.length).toBe(1);
  });

  it('adds plan changes while running', () => {
    const s = settingsWith({ treatment: 'spray' });
    const sim = new Simulation(s, { sprayZones: [], devices: [] });
    sim.advance(10);
    expect(sim.drone.tasks.length).toBe(0);
    sim.setPlan({ sprayZones: [{ x: 30, y: 30, w: 40, h: 20 }], devices: [] });
    expect(sim.drone.tasks.length).toBeGreaterThan(0);
    sim.setPlan({ sprayZones: [], devices: [] });
    expect(sim.drone.tasks.length).toBe(0);
  });

  it('records history for the charts and finishes on time', () => {
    const sim = new Simulation(getScenario('baseline')!.settings, { sprayZones: [], devices: [] });
    sim.runToEnd();
    expect(sim.time).toBeCloseTo(sim.durationSec, 0);
    expect(sim.history.length).toBeGreaterThan(sim.durationSec / 10);
    expect(sim.metrics().cropAffectedPct).toBeGreaterThan(20);
  });

  it('needs several flights for a big field with a short battery', () => {
    const sc = getScenario('flighttime')!;
    const s = sc.settings;
    const sim = new Simulation(s, { sprayZones: [{ x: 20, y: 20, w: 380, h: 220 }], devices: [] });
    sim.runToEnd();
    const m = sim.metrics();
    expect(m.flights).toBeGreaterThanOrEqual(3);
    expect(m.batterySwaps).toBeGreaterThanOrEqual(2);
    expect(m.productUsedGal).toBeLessThanOrEqual(s.drone.productAvailableGal + 1e-6);
  }, 30000);

  it('sprays again on schedule when repeat spraying is on', () => {
    const once = new Simulation(settingsWith({ treatment: 'spray' }), { sprayZones: [crop], devices: [] });
    once.runToEnd();
    const daily = new Simulation(settingsWith({ treatment: 'spray', drone: { resprayEveryDays: 2, productAvailableGal: 40 } }), { sprayZones: [crop], devices: [] });
    daily.runToEnd();
    expect(once.resprays).toBe(0);
    expect(daily.resprays).toBe(2);
    expect(daily.metrics().productUsedGal).toBeGreaterThan(once.metrics().productUsedGal * 2.5);
    expect(daily.metrics().pestsDeterredAvgPct).toBeGreaterThan(once.metrics().pestsDeterredAvgPct);
  }, 30000);
});
