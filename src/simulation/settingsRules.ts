import type { Settings } from '../models/types';

/**
 * Some settings shape the whole experiment (map size, how many pests and
 * where they start, the random seed). Changing them mid-run needs a reset.
 */
export function needsReset(current: Settings, next: Settings): boolean {
  return (
    JSON.stringify(current.field) !== JSON.stringify(next.field) ||
    current.pests.count !== next.pests.count ||
    current.pests.distribution !== next.pests.distribution ||
    current.pests.hotspotCount !== next.pests.hotspotCount ||
    current.run.seed !== next.run.seed ||
    current.devices.deployByDrone !== next.devices.deployByDrone
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
      hotspotCount: current.pests.hotspotCount
    },
    run: { ...next.run, seed: current.run.seed },
    devices: { ...next.devices, deployByDrone: current.devices.deployByDrone }
  };
}
