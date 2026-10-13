import type { CostBreakdown, CostSettings } from '../models/types';
import { lToGal, m2ToAcres } from '../utils/units';

/**
 * Default cost reference values. The application cost is a benchmark for
 * conventional drone spraying (about $12 to $16 per acre, product not
 * included). Material and device prices are placeholders: the simulator
 * does not know the actual cost of the team's scent product.
 */
export const DEFAULT_COSTS: CostSettings = {
  appCostPerAcre: 14,
  materialCostPerGal: 25,
  deviceCost: 4
};

export interface CostInputs {
  sprayedAreaM2: number;
  litersUsed: number;
  devicesUsed: number;
}

export function computeCost(inputs: CostInputs, c: CostSettings): CostBreakdown {
  const acresSprayed = m2ToAcres(inputs.sprayedAreaM2);
  const application = acresSprayed * c.appCostPerAcre;
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
