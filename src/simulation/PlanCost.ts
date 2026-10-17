import type { CostBreakdown, Settings, TreatmentPlan } from '../models/types';
import { modelMinToDays } from '../utils/fieldTime';
import { computeCost } from './CostModel';
import { Drone, type DroneTask } from './Drone';
import { homePoint } from './Simulation';
import { activePlan, buildDroneTasks } from './Treatment';

/** How many times the spray zones get sprayed in the run (the first spray plus repeats). */
export function sprayRounds(s: Settings): number {
  if (s.treatment !== 'spray') return 1;
  const every = s.drone.resprayEveryDays ?? 0;
  const startDay = s.run.treatStartDay ?? 1;
  const runDays = Math.max(0, modelMinToDays(s.run.durationMin) - (startDay - 1));
  return every > 0 ? 1 + Math.floor((runDays - 1e-6) / every) : 1;
}

/**
 * What a plan would cost if the drone did all of it (ignoring any budget):
 * flies the plan on its own, with no pests, and adds up flight time, product
 * and devices. Repeat sprays are flown back to back, which costs the same.
 */
export function estimatePlanCost(s: Settings, plan: TreatmentPlan): CostBreakdown {
  const eff = activePlan(plan, s.treatment);
  const map = { x: 0, y: 0, w: s.field.width, h: s.field.height };
  const home = homePoint(s.field);
  const drone = new Drone(s.drone, home);
  const sprayOnly = buildDroneTasks({ sprayZones: eff.sprayZones, devices: [] }, map, home, s.drone, s.devices);
  const tasks: DroneTask[] = [];
  for (let r = 0; r < sprayRounds(s); r++) tasks.push(...sprayOnly.map((t) => ({ ...t })));
  if (s.devices.deployByDrone) tasks.push(...buildDroneTasks({ sprayZones: [], devices: eff.devices }, map, home, s.drone, s.devices));
  drone.tasks = tasks;
  const world = {
    spray: () => {},
    dropDevice: () => {},
    devicesMassKg: s.devices.massKg,
    devicesPerTrip: s.devices.perTrip
  };
  for (let i = 0; i < 400000 && drone.busy; i++) drone.step(1, world);
  return computeCost(
    {
      sprayedAreaM2: drone.sprayedAreaM2,
      litersUsed: drone.litersSprayed,
      devicesUsed: s.devices.deployByDrone ? drone.devicesDropped : eff.devices.length,
      flightMin: drone.airborneSec / 60
    },
    s.cost
  );
}
