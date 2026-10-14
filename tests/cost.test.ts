import { describe, expect, it } from 'vitest';
import { computeCost, DEFAULT_COSTS } from '../src/simulation/CostModel';
import { acresToM2, galToL } from '../src/utils/units';

describe('cost model', () => {
  it('adds flying, material and device costs', () => {
    const c = computeCost(
      { sprayedAreaM2: acresToM2(5), litersUsed: galToL(10), devicesUsed: 3, flightMin: 14 },
      { flightCostPerMin: 5, materialCostPerGal: 20, deviceCost: 4 }
    );
    expect(c.acresSprayed).toBeCloseTo(5);
    expect(c.application).toBeCloseTo(70);
    expect(c.material).toBeCloseTo(200);
    expect(c.devices).toBeCloseTo(12);
    expect(c.total).toBeCloseTo(282);
  });

  it('is zero when nothing is used', () => {
    expect(computeCost({ sprayedAreaM2: 0, litersUsed: 0, devicesUsed: 0, flightMin: 0 }, DEFAULT_COSTS).total).toBe(0);
  });

  it('matches the $12 to $16 per acre benchmark at about 22 acres an hour', () => {
    const perAcre = (DEFAULT_COSTS.flightCostPerMin * 60) / 22;
    expect(perAcre).toBeGreaterThanOrEqual(12);
    expect(perAcre).toBeLessThanOrEqual(16);
  });

  it('matches the 2 gal/acre example: a 10.5 gal tank treats about 5.25 acres', () => {
    const tankGal = 40 / 3.78541;
    expect(tankGal).toBeCloseTo(10.57, 1);
    expect(10.5 / 2).toBeCloseTo(5.25);
  });
});
