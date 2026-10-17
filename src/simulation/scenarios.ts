import type { Scenario, Settings, TreatmentPlan } from '../models/types';
import { DEFAULT_COSTS } from './CostModel';
import { T50_REFERENCE } from './Drone';

export function defaultSettings(): Settings {
  return {
    field: { width: 220, height: 140, border: 20 },
    pests: {
      count: 500,
      distribution: 'uniform',
      hotspotCount: 3,
      cropAttraction: 1,
      sensitivity: 1,
      speed: 0.8,
      buildUpDays: 10
    },
    wind: { direction: 90, speedMph: 0, changing: false },
    scent: { strength: 1, lifetimeMin: 2, rangeM: 18, threshold: 0.15, effectivenessPct: 80 },
    treatment: 'spray',
    drone: { ...T50_REFERENCE },
    devices: { maxDevices: 12, releaseRate: 1, lifetimeMin: 60, massKg: 0.5, perTrip: 4, deployByDrone: true },
    survey: { detectionPct: 90, falsePositivesPer1000m2: 0.5, positionNoiseM: 3, uncertainPct: 5 },
    cost: { ...DEFAULT_COSTS },
    weights: { protection: 2, pestsDeterred: 0.5, material: 2, flightTime: 1, cost: 0.5 },
    run: { durationMin: 21, seed: 42, treatStartDay: 3 },
    weather: { rainDays: [] }
  };
}

export const emptyPlan = (): TreatmentPlan => ({ sprayZones: [], devices: [] });

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

/** Default settings with some values changed. */
export function settingsWith(changes: DeepPartial<Settings>): Settings {
  const base = defaultSettings();
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(changes)) {
    const cur = (base as unknown as Record<string, unknown>)[k];
    out[k] = v && typeof v === 'object' && cur && typeof cur === 'object' ? { ...cur, ...v } : v;
  }
  return out as unknown as Settings;
}

export const SCENARIOS: Scenario[] = [
  {
    id: 'basic',
    name: 'Basic Field',
    purpose: 'Learn the controls. Pests are spread evenly, there is no wind, and there is plenty of product.',
    question: 'What happens to the pests when you spray the whole field?',
    settings: settingsWith({ treatment: 'spray' }),
    plan: emptyPlan()
  },
  {
    id: 'sprayVsDevices',
    name: 'Spray or Devices?',
    purpose:
      'Spray the field with the drone (as often as you like), or drop up to 12 slow-release devices. Run both and compare how much crop each one saves, and what it costs.',
    question: 'Can 12 devices protect as much crop as spraying? Which plan costs less?',
    settings: settingsWith({
      treatment: 'spray',
      devices: { maxDevices: 12 }
    }),
    plan: emptyPlan()
  },
  {
    id: 'rainy',
    name: 'Rainy Season',
    purpose:
      'It will rain on Days 5, 9, 14 and 18. Rain washes most of the spray off the leaves and keeps the drone on the ground. Slow-release devices keep their scent inside.',
    question: 'Rain washes spray away. How do you protect the crop through a rainy spell, and what does it cost?',
    settings: settingsWith({
      treatment: 'spray',
      devices: { maxDevices: 12 },
      weather: { rainDays: [5, 9, 14, 18] }
    }),
    plan: emptyPlan()
  },
  {
    id: 'windy',
    name: 'Windy Field',
    purpose: 'Watch how a steady crosswind carries scent across the field.',
    question: 'Where should a scent source go if the wind always blows the same way?',
    settings: settingsWith({
      treatment: 'slowRelease',
      wind: { direction: 90, speedMph: 6 },
      devices: { maxDevices: 6 }
    }),
    plan: {
      sprayZones: [],
      devices: [
        { id: 1, x: 70, y: 50, kind: 'repellent', trap: false },
        { id: 2, x: 70, y: 90, kind: 'repellent', trap: false },
        { id: 3, x: 140, y: 70, kind: 'repellent', trap: false }
      ]
    }
  },
  {
    id: 'hotspots',
    name: 'Pest Hotspots',
    purpose: 'Pests gather in a few places. Compare treating everywhere with treating only some areas.',
    question: 'Is spraying the whole field always better than targeting certain areas?',
    settings: settingsWith({
      treatment: 'spray',
      pests: { distribution: 'hotspots', hotspotCount: 3, count: 600 }
    }),
    plan: emptyPlan()
  },
  {
    id: 'budget',
    name: 'Limited Budget',
    purpose:
      'Pests gather in a few hotspots, and you have $250 for the whole season. Spend it on spray, scent devices or push-pull. The drone stops working when the money runs out.',
    question: 'With only $250, which plan protects the most crop?',
    settings: settingsWith({
      treatment: 'spray',
      pests: { distribution: 'hotspots', hotspotCount: 4 },
      devices: { maxDevices: 40 },
      cost: { budget: 250 }
    }),
    plan: emptyPlan()
  },
  {
    id: 'pushpull',
    name: 'Push-Pull',
    purpose: 'Use a repellent to push pests off the crop and an attractant trap to pull them somewhere else.',
    question: 'Where should the "push" and the "pull" go so they work together?',
    settings: settingsWith({
      treatment: 'pushPull',
      wind: { direction: 270, speedMph: 3 },
      devices: { maxDevices: 10 }
    }),
    plan: {
      sprayZones: [],
      devices: [
        { id: 1, x: 170, y: 45, kind: 'repellent', trap: false },
        { id: 2, x: 170, y: 95, kind: 'repellent', trap: false },
        { id: 3, x: 110, y: 45, kind: 'repellent', trap: false },
        { id: 4, x: 110, y: 95, kind: 'repellent', trap: false },
        { id: 5, x: 12, y: 70, kind: 'attractant', trap: true }
      ]
    }
  },
  {
    id: 'survey',
    name: 'Survey Uncertainty',
    purpose:
      'You cannot see the pests here, and you only have 3 traps. Fly the survey drone to find where the pests gather, then put the traps there. The camera is not perfect.',
    question: 'Can a survey help you put a few traps in the right places, even when its map has mistakes?',
    settings: settingsWith({
      treatment: 'pushPull',
      // The pests are already there, so the survey has something to find.
      pests: { distribution: 'hotspots', hotspotCount: 3, buildUpDays: 0 },
      // A short-range lure, so where each trap goes matters.
      devices: { maxDevices: 3, lureReach: 2 },
      survey: { detectionPct: 75, falsePositivesPer1000m2: 1.5, positionNoiseM: 6, uncertainPct: 10 }
    }),
    plan: emptyPlan(),
    view: { showPests: false, showSurvey: true },
    startTool: 'trap'
  },
  {
    id: 'flighttime',
    name: 'Limited Flight Time',
    purpose: 'A big field and a short battery. Watch how often the drone must come home.',
    question: 'How many flights does it take to treat a large field, and why?',
    settings: settingsWith({
      field: { width: 420, height: 260, border: 20 },
      pests: { count: 900 },
      treatment: 'spray',
      drone: { reservePct: 25 },
      run: { durationMin: 28 }
    }),
    plan: emptyPlan()
  },
  {
    id: 'baseline',
    name: 'No Treatment (baseline)',
    purpose: 'Nothing is done. Use this run to see what happens naturally, then compare treatments to it.',
    question: 'How much of the crop is affected if we do nothing?',
    settings: settingsWith({ treatment: 'none' }),
    plan: emptyPlan()
  }
];

export function getScenario(id: string): Scenario | undefined {
  return SCENARIOS.find((s) => s.id === id);
}

/** Read a scenario from JSON (for example, one a coach exported), filling any gaps with defaults. */
export function parseScenario(json: string): Scenario {
  const raw = JSON.parse(json) as Partial<Scenario>;
  if (!raw || typeof raw !== 'object') throw new Error('Not a scenario file.');
  const settings = settingsWith((raw.settings ?? {}) as DeepPartial<Settings>);
  const plan: TreatmentPlan = {
    sprayZones: Array.isArray(raw.plan?.sprayZones) ? raw.plan!.sprayZones : [],
    devices: Array.isArray(raw.plan?.devices) ? raw.plan!.devices : []
  };
  return {
    id: typeof raw.id === 'string' ? raw.id : 'custom',
    name: typeof raw.name === 'string' ? raw.name : 'Custom scenario',
    purpose: typeof raw.purpose === 'string' ? raw.purpose : '',
    question: typeof raw.question === 'string' ? raw.question : '',
    settings,
    plan,
    view: raw.view
  };
}
