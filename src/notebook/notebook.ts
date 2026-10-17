import type { Metrics, Settings, TreatmentPlan } from '../models/types';
import type { ChartEvent } from '../utils/chartEvents';
import type { Simulation } from '../simulation/Simulation';
import { activePlan, usesSprayZones } from '../simulation/Treatment';
import { usesGroomba } from '../simulation/Groomba';
import { compassName } from '../utils/geometry';
import { formatMoney } from '../utils/units';
import { formatFieldSpan, formatModelMin, modelToFieldSec } from '../utils/fieldTime';

export const NOTEBOOK_KEY = 'scent-sim-notebook-v1';

export interface CapturedRun {
  savedAt: string;
  scenarioName: string;
  /** Model clock when saved (see utils/fieldTime.ts). */
  timeSec: number;
  /** Farm clock when saved; missing in runs saved before the two clocks. */
  fieldTimeSec?: number;
  finished: boolean;
  settings: Settings;
  plan: TreatmentPlan;
  metrics: Metrics;
  surveysDone: number;
  /** Small JPEG picture of the map when the run was saved, for reports. */
  snapshot?: string;
  /** The run's charts, thinned out, for reports; missing in runs saved before charts were kept. */
  charts?: RunCharts;
}

/** The lines the Results charts draw, x in farm days, values rounded to keep the notebook small. */
export interface RunCharts {
  days: number[];
  arrived: number[];
  feeding: number[];
  crop: number[];
  helpers: number[];
  killed: number[];
  scent: number[];
  product: number[];
  /** Farm day the treatment started (0 when it starts right away or there is none). */
  treatStartDay: number;
  /** Rain as [from, to] farm days. */
  rains: Array<[number, number]>;
  /** Repeat sprays, wind changes and other events (missing in runs saved before events were kept). */
  events?: ChartEvent[];
}

/** Most points a saved chart keeps (plenty for a printed chart). */
export const CHART_POINTS = 120;

/** Settings to load back into the simulator (for repeating or changing one thing). */
export interface EntrySetup {
  scenarioName: string;
  settings: Settings;
  plan: TreatmentPlan;
}

export interface NotebookEntry {
  id: string;
  name: string;
  question: string;
  prediction: string;
  variablesChanged: string;
  variablesSame: string;
  result: string;
  surprise: string;
  next: string;
  /** How a real test could check this, and what to change in the model if it disagreed. */
  realWorld: string;
  createdAt: string;
  setup: EntrySetup | null;
  captured: CapturedRun | null;
}

export const ENTRY_FIELDS: Array<{ key: keyof NotebookEntry; label: string; hint: string }> = [
  { key: 'question', label: 'Question', hint: 'What do you want to find out?' },
  { key: 'prediction', label: 'Prediction', hint: 'I think that... because...' },
  { key: 'variablesChanged', label: 'Variables changed', hint: 'What did you change on purpose?' },
  { key: 'variablesSame', label: 'Variables kept the same', hint: 'What did you keep the same?' },
  { key: 'result', label: 'Result', hint: 'What happened? Did it match your prediction?' },
  { key: 'surprise', label: 'What surprised you?', hint: '' },
  { key: 'next', label: 'What would you try next?', hint: '' },
  {
    key: 'realWorld',
    label: 'Real-world check',
    hint: 'How could we test this for real? If a real test came out different, what would we change in the model?'
  }
];

const METHOD_NAMES: Record<string, string> = {
  none: 'No treatment',
  spray: 'Spray',
  slowRelease: 'Slow-release devices',
  pushPull: 'Push-pull',
  pesticide: 'Pesticide'
};

export function methodName(m: string): string {
  return METHOD_NAMES[m] ?? m;
}

/** The method as a student would say it, naming the groomba when it did the spraying ("Spray with the groomba"). */
export function runMethodName(s: Pick<Settings, 'treatment' | 'sprayer'>): string {
  return usesGroomba(s) ? `${methodName(s.treatment)} with the groomba` : methodName(s.treatment);
}

/** How long the sprayer worked: "12.4 min flying" for the drone, "1 h 53 min driving" for the groomba. */
export function workTimeText(s: Pick<Settings, 'treatment' | 'sprayer'>, minutes: number): string {
  if (!usesGroomba(s)) return `${minutes.toFixed(1)} min flying`;
  const h = Math.floor(minutes / 60);
  const min = Math.round(minutes - h * 60);
  return `${h ? `${h} h ` : ''}${min} min driving`;
}

let counter = 0;
function newId(): string {
  counter++;
  return `${Date.now().toString(36)}-${counter}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

export function newEntry(name: string): NotebookEntry {
  return {
    id: newId(),
    name,
    question: '',
    prediction: '',
    variablesChanged: '',
    variablesSame: '',
    result: '',
    surprise: '',
    next: '',
    realWorld: '',
    createdAt: new Date().toISOString(),
    setup: null,
    captured: null
  };
}

/** Next free "Experiment N" name. */
export function nextName(entries: NotebookEntry[]): string {
  let n = entries.length + 1;
  const names = new Set(entries.map((e) => e.name));
  while (names.has(`Experiment ${n}`)) n++;
  return `Experiment ${n}`;
}

/** "Experiment 3A" -> "Experiment 3B"; "Experiment 3" -> "Experiment 3B" (and the original is left alone). */
export function duplicateName(name: string, entries: NotebookEntry[]): string {
  const names = new Set(entries.map((e) => e.name));
  const m = name.match(/^(.*?)([A-Z])$/);
  const stem = m && /\d$/.test(m[1]) ? m[1] : name;
  let letter = m && /\d$/.test(m[1]) ? m[2].charCodeAt(0) + 1 : 'B'.charCodeAt(0);
  while (letter <= 90 && names.has(`${stem}${String.fromCharCode(letter)}`)) letter++;
  if (letter > 90) return `${name} (copy)`;
  return `${stem}${String.fromCharCode(letter)}`;
}

export function duplicateEntry(e: NotebookEntry, entries: NotebookEntry[]): NotebookEntry {
  return {
    ...newEntry(duplicateName(e.name, entries)),
    question: e.question,
    variablesSame: e.variablesSame,
    // Keep the setup so the student can load it, change one thing and run again.
    setup: entrySetup(e),
    captured: null
  };
}

/** The setup an entry would load: its saved run, or the setup it was copied from. */
export function entrySetup(e: NotebookEntry): EntrySetup | null {
  if (e.captured) {
    return {
      scenarioName: e.captured.scenarioName,
      settings: structuredClone(e.captured.settings),
      plan: structuredClone(e.captured.plan)
    };
  }
  return e.setup ? structuredClone(e.setup) : null;
}

export function captureRun(sim: Simulation, scenarioName: string, snapshot?: string): CapturedRun {
  return {
    ...(snapshot ? { snapshot } : {}),
    savedAt: new Date().toISOString(),
    scenarioName,
    timeSec: sim.time,
    fieldTimeSec: sim.fieldTime,
    finished: sim.finished,
    settings: structuredClone(sim.settings),
    plan: structuredClone(sim.plan),
    metrics: sim.metrics(),
    surveysDone: sim.surveys.length,
    charts: runCharts(sim)
  };
}

const r1 = (v: number) => Math.round(v * 10) / 10;

/** The same lines as the Results charts, thinned to at most CHART_POINTS points. */
export function runCharts(sim: Simulation): RunCharts {
  const h = sim.history;
  const step = Math.max(1, (h.length - 1) / (CHART_POINTS - 1));
  const picks: typeof h = [];
  for (let i = 0; i < h.length; i += step) picks.push(h[Math.round(i)]);
  if (h.length && picks[picks.length - 1] !== h[h.length - 1]) picks.push(h[h.length - 1]);
  const present = (p: (typeof h)[number]) => p.pestsPresentPct ?? 100;
  return {
    days: picks.map((p) => Math.round((modelToFieldSec(p.t) / 86400) * 1000) / 1000),
    arrived: picks.map((p) => r1(present(p))),
    feeding: picks.map((p) => r1((p.pestsFeedingPct * present(p)) / 100)),
    crop: picks.map((p) => r1(p.cropAffectedPct)),
    helpers: picks.map((p) => r1(p.helpersAlivePct ?? 100)),
    killed: picks.map((p) => r1(p.pestsKilledPct ?? 0)),
    scent: picks.map((p) => r1(p.scentCoveragePct)),
    product: picks.map((p) => Math.round(p.productUsedGal * 100) / 100),
    treatStartDay: sim.settings.treatment === 'none' ? 0 : sim.treatStartFieldSec / 86400,
    rains: sim.rains.map((r) => [r.start / 86400, r.end / 86400] as [number, number]),
    events: sim.events.map((e) => ({ day: Math.round((e.fieldSec / 86400) * 1000) / 1000, kind: e.kind, label: e.label }))
  };
}

/** The values students would otherwise copy by hand. */
export function summaryRows(c: CapturedRun): Array<[string, string]> {
  const s = c.settings;
  const m = c.metrics;
  const eff = activePlan(c.plan, s.treatment);
  const devices = eff.devices.length;
  return [
    ['Scenario', c.scenarioName],
    ['Run time', `${formatFieldSpan(c.fieldTimeSec ?? modelToFieldSec(c.timeSec))}${c.finished ? '' : ' (not finished)'}`],
    ['Treatment', runMethodName(s)],
    ['Rain', (s.weather?.rainDays ?? []).length ? `Days ${s.weather!.rainDays.join(', ')}` : 'None'],
    ['Wind', s.wind.speedMph > 0 ? `${s.wind.speedMph} mph toward the ${compassName(s.wind.direction)}${s.wind.changing ? ' (changing)' : ''}` : 'No wind'],
    ['Pests', `${s.pests.count}, ${s.pests.distribution}`],
    ['Scent', `strength ${s.scent.strength}, lifetime ${formatModelMin(s.scent.lifetimeMin)}`],
    ['Spray zones planned', String(eff.sprayZones.length)],
    ['Scent devices planned', String(devices)],
    ['Crop protected', `${m.cropProtectedPct.toFixed(0)}%`],
    ['Pests kept off crop (average)', `${m.pestsDeterredAvgPct.toFixed(0)}%`],
    ['Pests trapped', String(m.pestsTrapped)],
    ['Product used', `${m.productUsedGal.toFixed(1)} gal`],
    ['Spray blown away by the wind', m.sprayBlownAwayPct === undefined || !m.productUsedGal ? '—' : `${m.sprayBlownAwayPct.toFixed(0)}%`],
    ['Devices used', String(m.devicesUsed)],
    // Both rows are always there so two runs line up row by row; the groomba drives instead of flying.
    ['Drone flight time', usesGroomba(s) ? '—' : `${m.flightTimeMin.toFixed(1)} min`],
    ['Groomba driving time', usesGroomba(s) ? workTimeText(s, m.flightTimeMin) : '—'],
    ['Flights', usesGroomba(s) ? '—' : String(m.flights)],
    ['Estimated cost', formatMoney(m.cost.total)],
    // Always present (even when empty) so two runs line up row by row.
    ['Budget', s.cost.budget ? formatMoney(s.cost.budget) : 'No limit'],
    ['Insects killed', m.pestsKilled === undefined ? '—' : `${m.pestsKilled + (m.helpersKilled ?? 0)} (${m.pestsKilled} pests, ${m.helpersKilled ?? 0} bees and ladybugs)`],
    ['Helpful insects alive', m.helpersAlivePct === undefined || !m.helpersTotal ? '—' : `${m.helpersAlivePct.toFixed(0)}% (${m.helpersAlive} of ${m.helpersTotal})`],
    ['Pests eaten by ladybugs', m.pestsEaten === undefined ? '—' : String(m.pestsEaten)],
    ['Survey', `${c.surveysDone} done; camera ${s.survey.detectionPct}% detection`],
    ['Random seed', String(s.run.seed)]
  ];
}

export interface CompareRow {
  label: string;
  a: string;
  b: string;
  differs: boolean;
}

export function compareRows(a: CapturedRun, b: CapturedRun): CompareRow[] {
  const ra = summaryRows(a);
  const rb = summaryRows(b);
  return ra.map(([label, va], i) => ({ label, a: va, b: rb[i][1], differs: va !== rb[i][1] }));
}

/** Plain facts, no verdict. The student decides what they mean. */
export function neutralSummary(nameA: string, a: CapturedRun, nameB: string, b: CapturedRun): string {
  const f = (n: string, c: CapturedRun) =>
    `${n} used ${c.metrics.productUsedGal.toFixed(1)} gallons and ${c.metrics.devicesUsed} devices, ${usesGroomba(c.settings) ? `drove the groomba ${c.metrics.flightTimeMin.toFixed(0)} minutes` : `flew ${c.metrics.flightTimeMin.toFixed(1)} minutes`}, protected ${c.metrics.cropProtectedPct.toFixed(0)}% of the crop` +
    (c.metrics.pestsKilled === undefined ? '.' : `, and killed ${c.metrics.pestsKilled} pests and ${c.metrics.helpersKilled ?? 0} bees and ladybugs.`);
  return `${f(nameA, a)} ${f(nameB, b)}`;
}

export function loadNotebook(): NotebookEntry[] {
  try {
    const raw = localStorage.getItem(NOTEBOOK_KEY);
    if (!raw) return [];
    return parseNotebook(raw);
  } catch {
    return [];
  }
}

export function saveNotebook(entries: NotebookEntry[]): void {
  try {
    localStorage.setItem(NOTEBOOK_KEY, JSON.stringify(entries));
  } catch {
    // Storage full: keep the notes and numbers, drop the map pictures.
    try {
      const lean = entries.map((e) => (e.captured?.snapshot ? { ...e, captured: { ...e.captured, snapshot: undefined } } : e));
      localStorage.setItem(NOTEBOOK_KEY, JSON.stringify(lean));
    } catch {
      // Storage blocked: the notebook still works until the page closes.
    }
  }
}

export function exportNotebook(entries: NotebookEntry[]): string {
  return JSON.stringify({ format: 'scent-sim-notebook', version: 1, entries }, null, 2);
}

/** Accepts an exported file or a bare list of entries. */
export function parseNotebook(json: string): NotebookEntry[] {
  const raw = JSON.parse(json);
  const list = Array.isArray(raw) ? raw : raw?.entries;
  if (!Array.isArray(list)) throw new Error('This file is not a notebook export.');
  return list
    .filter((e) => e && typeof e === 'object')
    .map((e) => {
      const base = newEntry(typeof e.name === 'string' ? e.name : 'Experiment');
      const out: NotebookEntry = { ...base };
      for (const f of ENTRY_FIELDS) {
        const v = e[f.key];
        if (typeof v === 'string') (out as unknown as Record<string, unknown>)[f.key] = v;
      }
      if (typeof e.id === 'string') out.id = e.id;
      if (typeof e.createdAt === 'string') out.createdAt = e.createdAt;
      out.captured = e.captured && e.captured.metrics && e.captured.settings ? e.captured : null;
      out.setup = e.setup && e.setup.settings && e.setup.plan ? e.setup : null;
      return out;
    });
}

/** A run's setup: what was chosen before pressing Run. */
export interface RunSetup {
  settings: Settings;
  plan: TreatmentPlan;
  /** Surveys flown before or during the run (left out when unknown). */
  surveysDone?: number;
}

const RESPRAY_NAMES: Record<number, string> = { 0: 'once', 3: 'every 3 days', 7: 'every week', [-1]: 'after each rain' };
const usesDevices = (m: string) => m === 'slowRelease' || m === 'pushPull';

function windWords(s: Settings): string {
  if (s.wind.speedMph <= 0) return 'no wind';
  return `${s.wind.speedMph} mph toward the ${compassName(s.wind.direction)}${s.wind.changing ? ', changing' : ''}`;
}

function samePlaces<T extends { x: number; y: number }>(a: T[], b: T[], key: (t: T) => string): boolean {
  const ka = a.map(key).sort();
  const kb = b.map(key).sort();
  return ka.length === kb.length && ka.every((k, i) => k === kb[i]);
}

/**
 * The things a student changed between two runs, in plain words
 * ("Method: Spray → Slow-release devices"). Plan details only count when
 * both runs use that part of the plan, so switching methods is one change.
 */
export function describeChanges(before: RunSetup, after: RunSetup): string[] {
  const a = before.settings;
  const b = after.settings;
  const out: string[] = [];
  const add = (label: string, x: string | number, y: string | number) => {
    if (x !== y) out.push(`${label}: ${x} → ${y}`);
  };
  add('Method', methodName(a.treatment), methodName(b.treatment));
  if (usesSprayZones(a.treatment) && usesSprayZones(b.treatment)) {
    const sprayer = (s: Settings) => (usesGroomba(s) ? 'groomba' : 'drone');
    add('Sprayer', sprayer(a), sprayer(b));
  }
  if (before.surveysDone !== undefined && after.surveysDone !== undefined) add('Surveys flown', before.surveysDone, after.surveysDone);
  add('Treatment starts', `Day ${a.run.treatStartDay ?? 1}`, `Day ${b.run.treatStartDay ?? 1}`);

  const pa = activePlan(before.plan, a.treatment);
  const pb = activePlan(after.plan, b.treatment);
  if (a.treatment === b.treatment && (a.treatment === 'spray' || a.treatment === 'pesticide')) {
    const ra = a.drone.resprayEveryDays ?? 0;
    const rb = b.drone.resprayEveryDays ?? 0;
    add('How often to spray', RESPRAY_NAMES[ra] ?? `every ${ra} days`, RESPRAY_NAMES[rb] ?? `every ${rb} days`);
    const zoneKey = (z: { x: number; y: number; w: number; h: number }) => [z.x, z.y, z.w, z.h].map(Math.round).join(',');
    if (pa.sprayZones.length !== pb.sprayZones.length) add('Spray zones', pa.sprayZones.length, pb.sprayZones.length);
    else if (!samePlaces(pa.sprayZones, pb.sprayZones, zoneKey)) out.push('Spray zones were moved or resized');
  }
  if (usesDevices(a.treatment) && usesDevices(b.treatment)) {
    const count = (p: TreatmentPlan, kind: string, trap?: boolean) =>
      p.devices.filter((d) => d.kind === kind && (trap === undefined || d.trap === trap)).length;
    add('Repellent devices', count(pa, 'repellent'), count(pb, 'repellent'));
    add('Attractant devices', count(pa, 'attractant', false), count(pb, 'attractant', false));
    add('Attractant traps', count(pa, 'attractant', true), count(pb, 'attractant', true));
    const devKey = (d: { x: number; y: number; kind: string; trap: boolean }) => `${Math.round(d.x)},${Math.round(d.y)},${d.kind},${d.trap}`;
    if (pa.devices.length === pb.devices.length && !samePlaces(pa.devices, pb.devices, devKey)) out.push('Devices were moved');
  }

  add('Wind', windWords(a), windWords(b));
  const rainWords = (s: Settings) => ((s.weather?.rainDays ?? []).length ? `days ${s.weather!.rainDays.join(', ')}` : 'none');
  add('Rain', rainWords(a), rainWords(b));
  const product = (g: number) => (g > 0 ? `${g} gal` : 'no limit');
  add('Product available', product(a.drone.productAvailableGal), product(b.drone.productAvailableGal));
  add('Budget', a.cost.budget ? formatMoney(a.cost.budget) : 'no limit', b.cost.budget ? formatMoney(b.cost.budget) : 'no limit');
  add('Device range', `${a.scent.rangeM} m`, `${b.scent.rangeM} m`);
  add('Scent strength', a.scent.strength, b.scent.strength);
  add('Spray lasts', formatModelMin(a.scent.lifetimeMin), formatModelMin(b.scent.lifetimeMin));
  add('Pests that react to scent', `${a.scent.effectivenessPct ?? 100}%`, `${b.scent.effectivenessPct ?? 100}%`);
  add('Noticing threshold', a.scent.threshold, b.scent.threshold);
  add('Device release rate', `${a.devices.releaseRate}x`, `${b.devices.releaseRate}x`);
  add('Device lifetime', formatModelMin(a.devices.lifetimeMin), formatModelMin(b.devices.lifetimeMin));
  add('Lure reach', `${a.devices.lureReach ?? 3}x`, `${b.devices.lureReach ?? 3}x`);
  add('Number of pests', a.pests.count, b.pests.count);
  add('Helpful insects', a.helpers?.count ?? 0, b.helpers?.count ?? 0);
  add('Where pests start', a.pests.distribution, b.pests.distribution);
  add('Pest sensitivity', a.pests.sensitivity, b.pests.sensitivity);
  add('Crop attraction', a.pests.cropAttraction, b.pests.cropAttraction);
  add('Pests keep arriving for', `${a.pests.buildUpDays ?? 0} days`, `${b.pests.buildUpDays ?? 0} days`);
  add('Run length', formatModelMin(a.run.durationMin), formatModelMin(b.run.durationMin));
  add('Random seed', a.run.seed, b.run.seed);
  if (JSON.stringify(a.field) !== JSON.stringify(b.field)) out.push('Field size changed');
  return out;
}

/**
 * A run from this visit, kept out of sight so Compare can line runs up and
 * say what changed. It goes into the notebook only if the student saves it.
 */
export interface SessionRun {
  id: string;
  /** "Run 3": its number among this visit's runs. */
  label: string;
  captured: CapturedRun;
  /** The notebook experiment it was saved as, or null if not saved. */
  entryId: string | null;
}

let runCounter = 0;
export function newSessionRun(captured: CapturedRun, count: number): SessionRun {
  runCounter++;
  return { id: `run-${Date.now().toString(36)}-${runCounter}`, label: `Run ${count + 1}`, captured, entryId: null };
}
