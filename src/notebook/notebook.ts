import type { Metrics, Settings, TreatmentPlan } from '../models/types';
import type { Simulation } from '../simulation/Simulation';
import { activePlan } from '../simulation/Treatment';
import { compassName } from '../utils/geometry';
import { formatClock, formatMoney } from '../utils/units';

export const NOTEBOOK_KEY = 'scent-sim-notebook-v1';

export interface CapturedRun {
  savedAt: string;
  scenarioName: string;
  timeSec: number;
  finished: boolean;
  settings: Settings;
  plan: TreatmentPlan;
  metrics: Metrics;
  surveysDone: number;
}

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
  pushPull: 'Push-pull'
};

export function methodName(m: string): string {
  return METHOD_NAMES[m] ?? m;
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

export function captureRun(sim: Simulation, scenarioName: string): CapturedRun {
  return {
    savedAt: new Date().toISOString(),
    scenarioName,
    timeSec: sim.time,
    finished: sim.finished,
    settings: structuredClone(sim.settings),
    plan: structuredClone(sim.plan),
    metrics: sim.metrics(),
    surveysDone: sim.surveys.length
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
    ['Run time', `${formatClock(c.timeSec)}${c.finished ? '' : ' (not finished)'}`],
    ['Treatment', methodName(s.treatment)],
    ['Wind', s.wind.speedMph > 0 ? `${s.wind.speedMph} mph toward the ${compassName(s.wind.direction)}${s.wind.changing ? ' (changing)' : ''}` : 'No wind'],
    ['Pests', `${s.pests.count}, ${s.pests.distribution}`],
    ['Scent', `strength ${s.scent.strength}, lifetime ${s.scent.lifetimeMin} min`],
    ['Spray zones planned', String(eff.sprayZones.length)],
    ['Scent devices planned', String(devices)],
    ['Crop protected', `${m.cropProtectedPct.toFixed(0)}%`],
    ['Pests kept off crop (average)', `${m.pestsDeterredAvgPct.toFixed(0)}%`],
    ['Pests trapped', String(m.pestsTrapped)],
    ['Product used', `${m.productUsedGal.toFixed(1)} gal`],
    ['Devices used', String(m.devicesUsed)],
    ['Drone flight time', `${m.flightTimeMin.toFixed(1)} min`],
    ['Flights', String(m.flights)],
    ['Estimated cost', formatMoney(m.cost.total)],
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
    `${n} used ${c.metrics.productUsedGal.toFixed(1)} gallons and ${c.metrics.devicesUsed} devices, flew ${c.metrics.flightTimeMin.toFixed(1)} minutes, and protected ${c.metrics.cropProtectedPct.toFixed(0)}% of the crop.`;
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
    // Storage full or blocked: the notebook still works until the page closes.
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
