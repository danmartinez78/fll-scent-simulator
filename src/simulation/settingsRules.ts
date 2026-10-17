import type { Settings } from '../models/types';

/**
 * Some settings shape the whole experiment (map size, how many pests,
 * where they start and when they arrive, the random seed). Changing them mid-run needs a reset.
 */
export function needsReset(current: Settings, next: Settings): boolean {
  return (
    JSON.stringify(current.field) !== JSON.stringify(next.field) ||
    current.pests.count !== next.pests.count ||
    current.pests.distribution !== next.pests.distribution ||
    current.pests.hotspotCount !== next.pests.hotspotCount ||
    (current.pests.buildUpDays ?? 0) !== (next.pests.buildUpDays ?? 0) ||
    current.run.seed !== next.run.seed ||
    current.devices.deployByDrone !== next.devices.deployByDrone ||
    (current.sprayer ?? 'drone') !== (next.sprayer ?? 'drone') ||
    JSON.stringify(current.helpers ?? null) !== JSON.stringify(next.helpers ?? null)
  );
}

/** `next`, but keeping the parts of `current` that can only change on reset. */
export function liveSettings(current: Settings, next: Settings): Settings {
  return {
    ...next,
    field: current.field,
    pests: {
      ...next.pests,
      count: current.pests.count,
      distribution: current.pests.distribution,
      hotspotCount: current.pests.hotspotCount,
      buildUpDays: current.pests.buildUpDays
    },
    run: { ...next.run, seed: current.run.seed },
    devices: { ...next.devices, deployByDrone: current.devices.deployByDrone },
    helpers: current.helpers,
    sprayer: current.sprayer
  };
}
