// Shared data types. Everything here is plain data so it can be saved to
// JSON (scenarios, notebook entries) and copied safely.

export type TreatmentMethod = 'none' | 'spray' | 'slowRelease' | 'pushPull';

export type PestDistribution = 'uniform' | 'hotspots' | 'edge' | 'scattered';

export type ScentKind = 'repellent' | 'attractant';

export interface Vec {
  x: number;
  y: number;
}

/** Axis-aligned rectangle in meters. (x, y) is the top-left corner. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface FieldSettings {
  /** Whole map, in meters, including the grass border around the crop. */
  width: number;
  height: number;
  /** Width of the grass border around the crop, in meters. */
  border: number;
}

export interface PestSettings {
  count: number;
  distribution: PestDistribution;
  /** Number of clusters for the "hotspots" distribution. */
  hotspotCount: number;
  /** How strongly pests are drawn to the crop (0 to 2). */
  cropAttraction: number;
  /** How strongly pests react to scent (0 to 2). */
  sensitivity: number;
  /** Cruising speed in meters per second. */
  speed: number;
  /**
   * Days over which pests keep arriving. A few are there on Day 1 and the
   * rest land at their starting spots spread over this many days. 0 or
   * missing (setups saved before this existed) = all pests there at the start.
   */
  buildUpDays?: number;
}

export interface WindSettings {
  /** Compass direction the wind blows TOWARD, in degrees (0 = north/up, 90 = east/right). */
  direction: number;
  speedMph: number;
  /** Slowly swing the wind direction back and forth. */
  changing: boolean;
}

export interface ScentSettings {
  /** How powerful the scent product is (multiplies every source). */
  strength: number;
  /** How long scent lingers in the air before fading, in minutes (time to fall to about 37%). */
  lifetimeMin: number;
  /** How far a slow-release device spreads its scent before the wind takes it, in meters. */
  rangeM: number;
  /** Pests only notice scent above this concentration. */
  threshold: number;
  /**
   * Percent of pests that react to the scent at all (0 to 100). The rest
   * ignore repellent and attractant, as some real insects do.
   */
  effectivenessPct: number;
}

export interface DroneSettings {
  tankL: number;
  maxPayloadKg: number;
  hoverEmptyMin: number;
  hoverFullMin: number;
  /** Battery percent kept in reserve; the drone heads home before using it. */
  reservePct: number;
  /** Flying speed while working, meters per second. */
  speed: number;
  /** Width of the spray strip, meters. */
  swathM: number;
  appRateGalPerAcre: number;
  /** Seconds on the ground for a refill or battery swap. */
  turnaroundSec: number;
  /** Total scent product the team has for this run, in gallons. */
  productAvailableGal: number;
  /** Seconds to take off, and again to land, on each flight. */
  takeoffLandingSec?: number;
  /** Seconds loitering over each drop spot to release a device. */
  dropLoiterSec?: number;
  /** Spray the zones again every this many farm days (0 or missing = spray once). */
  resprayEveryDays?: number;
}

export interface DeviceSettings {
  /** Most slow-release devices the team can place. */
  maxDevices: number;
  /** Scent released per device, relative to the standard device (1 = standard). */
  releaseRate: number;
  lifetimeMin: number;
  massKg: number;
  /** Most devices the drone's drop rack holds on one trip (its weight limit can lower this). */
  perTrip: number;
  /** Drone flies each device to its spot; otherwise devices are placed by hand at the start. */
  deployByDrone: boolean;
  /**
   * How far pests notice an attractant lure, as a multiple of the scent's
   * effective range. Missing = ATTRACTANT_REACH_FACTOR (3).
   */
  lureReach?: number;
}

export interface SurveySettings {
  /** Chance that the camera spots a pest it flies over (0 to 100). */
  detectionPct: number;
  /** Average number of fake detections per 1000 square meters. */
  falsePositivesPer1000m2: number;
  /** How far off (meters) a detected position can be. */
  positionNoiseM: number;
  /** Percent of map squares the software can't judge (glare, shadows). */
  uncertainPct: number;
}

export interface CostSettings {
  /** Drone operating cost per minute in the air (pilot, equipment, batteries), for every mission. */
  flightCostPerMin: number;
  materialCostPerGal: number;
  deviceCost: number;
  /**
   * Most money the team can spend on the whole run, in dollars. The drone
   * stops working when the next job would go over it. 0 or missing = no limit.
   */
  budget?: number;
}

export interface ScoreWeights {
  /** Points per percent of crop protected. */
  protection: number;
  /** Points per percent of pests kept away from the crop (run average). */
  pestsDeterred: number;
  /** Points lost per gallon of product. */
  material: number;
  /** Points lost per minute of drone flight. */
  flightTime: number;
  /** Points lost per $10 of estimated cost. */
  cost: number;
}

export interface RunSettings {
  durationMin: number;
  seed: number;
  /**
   * Day the treatment starts, as shown on the farm clock (1 = right away).
   * Missing (setups saved before this existed) = Day 1.
   */
  treatStartDay?: number;
}

export interface Settings {
  field: FieldSettings;
  pests: PestSettings;
  wind: WindSettings;
  scent: ScentSettings;
  treatment: TreatmentMethod;
  drone: DroneSettings;
  devices: DeviceSettings;
  survey: SurveySettings;
  cost: CostSettings;
  weights: ScoreWeights;
  run: RunSettings;
}

export interface DevicePlan {
  id: number;
  x: number;
  y: number;
  kind: ScentKind;
  /** An attractant device with a sticky trap catches pests that reach it. */
  trap: boolean;
}

export interface TreatmentPlan {
  sprayZones: Rect[];
  devices: DevicePlan[];
}

export interface ViewOptions {
  showPests: boolean;
  showScent: boolean;
  showSurvey: boolean;
  showDamage: boolean;
  showPath: boolean;
}

export interface Scenario {
  id: string;
  name: string;
  purpose: string;
  question: string;
  settings: Settings;
  plan: TreatmentPlan;
  view?: Partial<ViewOptions>;
  /** Map tool selected when the mission loads (default: the method's usual tool). */
  startTool?: 'zone' | 'repellent' | 'attractant' | 'trap';
}

/** The handful of numbers students see. Percentages are 0 to 100. */
export interface Metrics {
  /** Model clock (see utils/fieldTime.ts). */
  timeSec: number;
  /** Farm clock: real time while a drone flies, time-lapse otherwise. */
  fieldTimeSec?: number;
  cropAffectedPct: number;
  cropProtectedPct: number;
  pestsFeedingPct: number;
  pestsDeterredPct: number;
  pestsDeterredAvgPct: number;
  pestsTrapped: number;
  productUsedGal: number;
  productLeftGal: number;
  flightTimeMin: number;
  flights: number;
  refills: number;
  batterySwaps: number;
  distanceKm: number;
  devicesUsed: number;
  acresSprayed: number;
  scentCoveragePct: number;
  cost: CostBreakdown;
}

export interface CostBreakdown {
  acresSprayed: number;
  application: number;
  material: number;
  devices: number;
  total: number;
}

export interface HistoryPoint {
  t: number;
  /** Percent of the pests in the field (arrived so far) that are feeding. */
  pestsFeedingPct: number;
  /** Percent of all pests that have arrived so far (missing in old saves = 100). */
  pestsPresentPct?: number;
  cropAffectedPct: number;
  productUsedGal: number;
  scentCoveragePct: number;
}

export type SurveyCategory = 'healthy' | 'possible' | 'high' | 'uncertain' | 'none';

export interface SurveyResult {
  id: number;
  label: string;
  timeSec: number;
  cols: number;
  rows: number;
  cellSize: number;
  /** Estimated pest count per square (what the camera software reports). */
  estimate: number[];
  /** Real pest count per square at scan time (instructor view only). */
  truth: number[];
  category: SurveyCategory[];
  /** Positions of detections, used by the optimizer as its best guess. */
  detections: Vec[];
  detectedTotal: number;
  trueTotal: number;
  estimatedOnCrop: number;
  hotspotSquares: number;
  /** Flown before the run started (it can be kept when the run is started over). */
  beforeRun?: boolean;
}
