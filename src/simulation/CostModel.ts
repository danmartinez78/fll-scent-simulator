import type { CostBreakdown, CostSettings } from '../models/types';
import { lToGal, m2ToAcres } from '../utils/units';

/**
 * Default cost reference values. Drone operating cost is charged per minute
 * in the air for every mission, spraying or dropping devices. $5 a minute
 * ($300 an hour) matches the usual $12 to $16 per acre benchmark for drone
 * spraying at the simulator's spray rate (about 22 acres an hour). Material
 * and device prices are placeholders: the simulator does not know the actual
 * cost of the team's scent product.
 */
export const DEFAULT_COSTS: CostSettings = {
  flightCostPerMin: 5,
  materialCostPerGal: 25,
  deviceCost: 12
};

export interface CostInputs {
  sprayedAreaM2: number;
  litersUsed: number;
  devicesUsed: number;
  flightMin: number;
}

export function computeCost(inputs: CostInputs, c: CostSettings): CostBreakdown {
  const acresSprayed = m2ToAcres(inputs.sprayedAreaM2);
  // Setups saved before this setting existed get the default rate.
  const application = inputs.flightMin * (c.flightCostPerMin ?? DEFAULT_COSTS.flightCostPerMin);
  const material = lToGal(inputs.litersUsed) * c.materialCostPerGal;
  const devices = inputs.devicesUsed * c.deviceCost;
  return {
    acresSprayed,
    application,
    material,
    devices,
    total: application + material + devices
  };
}
