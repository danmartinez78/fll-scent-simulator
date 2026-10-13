import { describe, expect, it } from 'vitest';
import { Drone, devicesPerTrip, enduranceSec, T50_REFERENCE, type DroneWorld } from '../src/simulation/Drone';
import type { DroneSettings } from '../src/models/types';
import { galToL } from '../src/utils/units';

function world(): DroneWorld & { sprayed: number; drops: number[] } {
  const w = {
    sprayed: 0,
    drops: [] as number[],
    devicesMassKg: 0.5,
    spray(_x: number, _y: number, liters: number) {
      w.sprayed += liters;
    },
    dropDevice(id: number) {
      w.drops.push(id);
    }
  };
  return w;
}

const home = { x: 0, y: 0 };

function sprayDrone(over: Partial<DroneSettings> = {}) {
  const d = new Drone({ ...T50_REFERENCE, ...over }, home);
  d.tasks.push({ kind: 'spray', from: { x: 10, y: 0 }, to: { x: 2000, y: 0 }, zoneKey: 'z' });
  return d;
}

describe('T50-style drone', () => {
  it('has the reference endurance at empty and full payload', () => {
    expect(enduranceSec(T50_REFERENCE, 0)).toBeCloseTo(16.5 * 60);
    expect(enduranceSec(T50_REFERENCE, 1)).toBeCloseTo(7 * 60);
    expect(enduranceSec(T50_REFERENCE, 0.5)).toBeCloseTo(11.75 * 60);
  });

  it('uses payload while spraying', () => {
    const d = sprayDrone();
    const w = world();
    for (let i = 0; i < 20; i++) d.step(0.5, w);
    const start = d.payloadL;
    for (let i = 0; i < 40; i++) d.step(0.5, w);
    expect(d.spraying).toBe(true);
    expect(d.payloadL).toBeLessThan(start);
    expect(d.litersSprayed).toBeGreaterThan(0);
    expect(w.sprayed).toBeCloseTo(d.litersSprayed, 6);
  });

  it('uses flight time while flying', () => {
    const d = sprayDrone();
    const w = world();
    d.step(0.5, w);
    const b0 = d.battery;
    for (let i = 0; i < 100; i++) d.step(0.5, w);
    expect(d.battery).toBeLessThan(b0);
    expect(d.airborneSec).toBeCloseTo(50.5, 5);
  });

  it('drains the battery faster when heavier', () => {
    const heavy = sprayDrone();
    const light = sprayDrone({ tankL: 5 });
    const w = world();
    for (let i = 0; i < 60; i++) {
      heavy.step(0.5, w);
      light.step(0.5, w);
    }
    expect(1 - heavy.battery).toBeGreaterThan(1 - light.battery);
  });

  it('heads home when the battery reaches the reserve', () => {
    const d = sprayDrone({ hoverEmptyMin: 3, hoverFullMin: 2, reservePct: 30 });
    const w = world();
    let sawReturn = false;
    for (let i = 0; i < 2000 && !sawReturn; i++) {
      d.step(0.5, w);
      if (d.mode === 'returning') sawReturn = true;
    }
    expect(sawReturn).toBe(true);
    expect(d.lastReturnReason).toBe('battery');
    expect(d.battery).toBeGreaterThan(0.3);
    // It makes it home with the reserve still there, then swaps the battery.
    while (d.mode === 'returning') d.step(0.5, w);
    expect(d.battery).toBeGreaterThan(0.25);
    expect(d.mode).toBe('turnaround');
    while (d.mode === 'turnaround') d.step(0.5, w);
    expect(d.batterySwaps).toBe(1);
    expect(d.battery).toBe(1);
  });

  it('comes back to refill and resumes where it stopped', () => {
    const d = new Drone({ ...T50_REFERENCE, tankL: 2, productAvailableGal: 10 }, home);
    d.tasks.push({ kind: 'spray', from: { x: 10, y: 0 }, to: { x: 600, y: 0 }, zoneKey: 'z' });
    const w = world();
    for (let i = 0; i < 20000 && d.busy; i++) d.step(0.5, w);
    expect(d.tankFills).toBeGreaterThan(1);
    expect(d.tasks.length).toBe(0);
    expect(d.sprayedAreaM2).toBeCloseTo(590 * T50_REFERENCE.swathM, -1);
  });

  it('never sprays more product than is available', () => {
    const d = sprayDrone({ productAvailableGal: 1 });
    const w = world();
    for (let i = 0; i < 20000 && d.busy; i++) d.step(0.5, w);
    expect(d.litersSprayed).toBeLessThanOrEqual(galToL(1) + 1e-6);
    expect(d.outOfProduct).toBe(true);
  });

  it('carries and drops devices', () => {
    const d = new Drone(T50_REFERENCE, home);
    d.tasks.push({ kind: 'drop', at: { x: 50, y: 0 }, deviceId: 1 }, { kind: 'drop', at: { x: 80, y: 30 }, deviceId: 2 });
    const w = world();
    for (let i = 0; i < 2000 && d.busy; i++) d.step(0.5, w);
    expect(w.drops).toEqual([1, 2]);
    expect(d.devicesDropped).toBe(2);
    expect(d.mode).toBe('parked');
  });

  it('makes extra trips when the drop rack is full', () => {
    const d = new Drone(T50_REFERENCE, home);
    for (let id = 1; id <= 10; id++) d.tasks.push({ kind: 'drop', at: { x: 20 + id * 5, y: 10 }, deviceId: id });
    const w = { ...world(), devicesPerTrip: 4 };
    for (let i = 0; i < 20000 && d.busy; i++) d.step(0.5, w);
    expect(d.devicesDropped).toBe(10);
    expect(d.flights).toBe(3);
  });

  it('carries fewer heavy devices per trip because of the weight limit', () => {
    expect(devicesPerTrip(T50_REFERENCE, 0.5, 4)).toBe(4);
    expect(devicesPerTrip(T50_REFERENCE, 15, 4)).toBe(2);
    expect(devicesPerTrip(T50_REFERENCE, 50, 4)).toBe(0);
  });

  it('records each drop point in its flight path', () => {
    const d = new Drone(T50_REFERENCE, home);
    const spots = [
      { x: 53, y: 7 },
      { x: 81, y: 33 }
    ];
    spots.forEach((at, i) => d.tasks.push({ kind: 'drop', at, deviceId: i + 1 }));
    const w = world();
    for (let i = 0; i < 2000 && d.busy; i++) d.step(0.5, w);
    for (const at of spots) expect(d.trail.some((p) => p.x === at.x && p.y === at.y)).toBe(true);
  });
});
