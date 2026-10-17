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
    const sim = new Simulation(settingsWith({ treatment: 'slowRelease', run: { treatStartDay: 1 } }), plan);
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
    // No product limit: the whole 20-acre field gets its 2 gal/acre (it used to stop at a 40 gal cap).
    expect(sim.drone.outOfProduct).toBe(false);
    expect(m.productUsedGal).toBeGreaterThan(40);
    expect(m.productLeftGal).toBeNull();
  }, 30000);

  it('sprays again on schedule when repeat spraying is on', () => {
    const once = new Simulation(settingsWith({ treatment: 'spray' }), { sprayZones: [crop], devices: [] });
    once.runToEnd();
    const daily = new Simulation(settingsWith({ treatment: 'spray', drone: { resprayEveryDays: 7, productAvailableGal: 40 } }), { sprayZones: [crop], devices: [] });
    daily.runToEnd();
    expect(once.resprays).toBe(0);
    expect(daily.resprays).toBe(2);
    expect(daily.metrics().productUsedGal).toBeGreaterThan(once.metrics().productUsedGal * 2.5);
    expect(daily.metrics().pestsDeterredAvgPct).toBeGreaterThan(once.metrics().pestsDeterredAvgPct);
  }, 30000);
  it('brings pests in over the build-up days', () => {
    const sim = new Simulation(settingsWith({ treatment: 'none', pests: { buildUpDays: 10 } }), { sprayZones: [], devices: [] });
    const start = sim.pests.countPresent();
    expect(start).toBeGreaterThan(0);
    expect(start).toBeLessThan(sim.pests.n * 0.2);
    sim.advance(5 * 60);
    const mid = sim.pests.countPresent();
    expect(mid).toBeGreaterThan(sim.pests.n * 0.4);
    expect(mid).toBeLessThan(sim.pests.n * 0.7);
    sim.advance(6 * 60);
    expect(sim.pests.countPresent()).toBe(sim.pests.n);
  });

  it('waits for the treatment start day', () => {
    const sim = new Simulation(settingsWith({ treatment: 'spray', run: { treatStartDay: 3 } }), { sprayZones: [crop], devices: [] });
    sim.advance(1.9 * 60);
    expect(sim.treatmentStarted).toBe(false);
    expect(sim.drone.flights).toBe(0);
    expect(sim.damage.reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
    while (!sim.treatmentStarted) sim.step();
    expect(sim.fieldTime).toBeGreaterThanOrEqual(2 * 86400);
    expect(sim.fieldTime).toBeLessThan(2 * 86400 + 3600);
  });
});

describe('wind and spray', () => {
  // Spray one strip with the wind blowing east, then compare where it landed.
  function sprayStrip(speedMph: number) {
    const s = settingsWith({ treatment: 'spray', wind: { speedMph, direction: 90 }, run: { treatStartDay: 1 } });
    const sim = new Simulation(s, { sprayZones: [{ x: 185, y: 40, w: 15, h: 60 }], devices: [] });
    while (!sim.finished && (sim.drone.flights === 0 || sim.droneFlying)) sim.step();
    return sim;
  }

  it('lands spray downwind and loses more of it as the wind grows', () => {
    const calm = sprayStrip(0);
    const windy = sprayStrip(15);
    expect(windy.sprayResidue.centerOfMass().x).toBeGreaterThan(calm.sprayResidue.centerOfMass().x + 1);
    expect(windy.metrics().productUsedGal).toBeCloseTo(calm.metrics().productUsedGal, 1);
    // Same product sprayed next to the east edge, but some blew off the map.
    expect(windy.sprayResidue.total()).toBeLessThan(calm.sprayResidue.total());
  });

  it('carries the smell of spray residue downwind of the sprayed plants', () => {
    const sim = sprayStrip(15);
    sim.advance(120);
    expect(sim.residueVapor.centerOfMass().x).toBeGreaterThan(sim.sprayResidue.centerOfMass().x + 1);
  });
  it('gives a device a bigger noticed patch when its effective range is longer, even in wind', () => {
    const patch = (rangeM: number, mph: number) => {
      const s = settingsWith({
        treatment: 'slowRelease',
        wind: { direction: 90, speedMph: mph },
        scent: { rangeM },
        devices: { deployByDrone: false },
        pests: { count: 1 },
        run: { treatStartDay: 1, durationMin: 3 }
      });
      const sim = new Simulation(s, { sprayZones: [], devices: [{ id: 1, x: 110, y: 70, kind: 'repellent', trap: false }] });
      sim.runToEnd();
      const f = sim.repellent;
      let cells = 0;
      for (let i = 0; i < f.data.length; i++) if (f.data[i] > s.scent.threshold) cells++;
      // Radius of a circle with the same area.
      return Math.sqrt((cells * f.cell * f.cell) / Math.PI);
    };
    for (const mph of [0, 6]) {
      const r12 = patch(12, mph);
      const r24 = patch(24, mph);
      expect(r24).toBeGreaterThan(r12 * 1.6);
      // The patch reaches about the effective range from the device.
      expect(r24).toBeGreaterThan(20);
      expect(r24).toBeLessThan(30);
    }
  });
  it('lets pests notice an attractant from farther away than a repellent', () => {
    const patch = (kind: 'repellent' | 'attractant') => {
      const s = settingsWith({
        treatment: 'pushPull',
        devices: { deployByDrone: false },
        pests: { count: 1 },
        run: { treatStartDay: 1, durationMin: 3 }
      });
      const sim = new Simulation(s, { sprayZones: [], devices: [{ id: 1, x: 110, y: 70, kind, trap: false }] });
      sim.runToEnd();
      const f = kind === 'repellent' ? sim.repellent : sim.attractant;
      // Pests notice attractant at half the threshold (see PEST_RULES.attractNoticeFraction).
      const th = s.scent.threshold * (kind === 'repellent' ? 1 : 0.5);
      let cells = 0;
      for (let i = 0; i < f.data.length; i++) if (f.data[i] > th) cells++;
      return cells;
    };
    expect(patch('attractant')).toBeGreaterThan(patch('repellent') * 4);
  });
});
