import type { Metrics, Settings, TreatmentPlan } from '../models/types';
import { cropRect } from '../simulation/Simulation';
import { getScenario, settingsWith } from '../simulation/scenarios';
import { workTimeText } from '../notebook/notebook';

/**
 * The Team presentation page: two fixed experiments a student can run in
 * front of an audience, each comparing two ready-made spray plans. The team
 * only sprays (by drone or ground robot), so there are no device plans here.
 */

export type TeamExperimentId = 'pesticide' | 'sprayer';
export type PlanKey = 'A' | 'B';
export const PLAN_KEYS: PlanKey[] = ['A', 'B'];

export interface TeamPlan {
  name: string;
  icon: string;
  /** One line under the plan's name. */
  detail: string;
  settings: Settings;
}

/** One number shown for both plans. */
export interface TeamNumber {
  label: string;
  /** The value used for the bars and for "which plan had more". */
  value: (m: Metrics) => number;
  /** How the value reads in the results. */
  text: (m: Metrics, s: Settings) => string;
  /** Bars are drawn against this (e.g. 100 for a percent). */
  max: (a: number, b: number) => number;
}

/** A quick prediction: the student picks plan A or plan B. */
export interface TeamPick {
  id: string;
  question: string;
  /** Which number answers it, and whether more or less of it wins. */
  number: number;
  wants: 'more' | 'less';
}

export interface TeamExperiment {
  id: TeamExperimentId;
  title: string;
  icon: string;
  question: string;
  /** What stays the same and what changes, in a sentence or two. */
  setup: string;
  plans: Record<PlanKey, TeamPlan>;
  numbers: TeamNumber[];
  picks: TeamPick[];
  foundStarter: string;
  realWorldStarter: string;
}

/** Both experiments spray the whole crop. */
export function teamPlan(s: Settings): TreatmentPlan {
  return { sprayZones: [cropRect(s.field)], devices: [] };
}

const pct = (v: number) => `${Math.round(v)}%`;
const upTo100 = () => 100;

const cropProtected: TeamNumber = {
  label: 'Crop protected',
  value: (m) => m.cropProtectedPct,
  text: (m) => pct(m.cropProtectedPct),
  max: upTo100
};

const weeklySpray = { resprayEveryDays: 7 };
const groundAir = getScenario('groundAir')!.settings;

export const TEAM_EXPERIMENTS: TeamExperiment[] = [
  {
    id: 'pesticide',
    title: 'Pesticide or scent?',
    icon: '🧪',
    question: 'Can a scent spray protect the crop as well as pesticide does, without killing the helpful insects?',
    setup: 'The drone sprays the whole field once a week for 3 weeks. The only thing that changes is what is in the tank.',
    plans: {
      A: {
        name: 'Pesticide spray',
        icon: '☠️',
        detail: 'Poison that kills the insects it touches',
        settings: settingsWith({ treatment: 'pesticide', drone: weeklySpray })
      },
      B: {
        name: 'Scent spray',
        icon: '🌸',
        detail: 'A smell that pests dislike, so they fly away',
        settings: settingsWith({ treatment: 'spray', drone: weeklySpray })
      }
    },
    numbers: [
      cropProtected,
      {
        label: 'Helpful insects alive',
        value: (m) => m.helpersAlive ?? 0,
        text: (m) => `${m.helpersAlive ?? 0} of ${m.helpersTotal ?? 0}`,
        max: (a, b) => Math.max(a, b, 1)
      },
      {
        label: 'Insects killed',
        value: (m) => (m.pestsKilled ?? 0) + (m.helpersKilled ?? 0),
        text: (m) => String((m.pestsKilled ?? 0) + (m.helpersKilled ?? 0)),
        max: (a, b) => Math.max(a, b, 1)
      }
    ],
    picks: [
      { id: 'crop', question: 'Which plan will protect more crop?', number: 0, wants: 'more' },
      { id: 'helpers', question: 'Which plan will keep more bees and ladybugs alive?', number: 1, wants: 'more' }
    ],
    foundStarter: 'The scent spray protected ___% of the crop and the pesticide protected ___%. The biggest difference was ___.',
    realWorldStarter: 'To check this on a real field, we could ___.'
  },
  {
    id: 'sprayer',
    title: 'Drone or ground robot?',
    icon: '🚁',
    question: 'On a windy day, which sprayer protects more crop: the fast drone or the slow ground robot?',
    setup: 'A strong 15 mph wind blows all month. Both sprayers put scent on the whole field once a week. The only thing that changes is the sprayer.',
    plans: {
      A: {
        name: 'Drone',
        icon: '🚁',
        detail: 'Fast, but sprays from up in the air',
        settings: structuredClone(groundAir)
      },
      B: {
        name: 'Ground robot',
        icon: '🤖',
        detail: 'Slow, but sprays right onto the plants',
        settings: { ...structuredClone(groundAir), sprayer: 'groomba' }
      }
    },
    numbers: [
      cropProtected,
      {
        label: 'Spray blown away by the wind',
        value: (m) => m.sprayBlownAwayPct ?? 0,
        text: (m) => pct(m.sprayBlownAwayPct ?? 0),
        max: upTo100
      },
      {
        label: 'Time spent spraying',
        value: (m) => m.flightTimeMin,
        text: (m, s) => workTimeText(s, m.flightTimeMin).replace(/ (flying|driving)$/, ''),
        max: (a, b) => Math.max(a, b, 1)
      }
    ],
    picks: [
      { id: 'crop', question: 'Which sprayer will protect more crop?', number: 0, wants: 'more' },
      { id: 'time', question: 'Which sprayer will finish the job faster?', number: 2, wants: 'less' }
    ],
    foundStarter: 'In the wind, the ___ protected more crop. The drone lost ___% of its spray to the wind, but it ___.',
    realWorldStarter: 'To check this on a real field, we could ___.'
  }
];

export function teamExperiment(id: TeamExperimentId): TeamExperiment {
  return TEAM_EXPERIMENTS.find((e) => e.id === id)!;
}

/** What one finished run keeps: enough for the results, the report and the slide. */
export interface TeamRun {
  metrics: Metrics;
  settings: Settings;
  /** Small JPEG of the map at the end of the run. */
  snapshot?: string;
}

/** Which plan won a pick, or null for a tie (or when a run is missing). */
export function pickWinner(exp: TeamExperiment, pick: TeamPick, runs: Partial<Record<PlanKey, TeamRun>>): PlanKey | null {
  const a = runs.A;
  const b = runs.B;
  if (!a || !b) return null;
  const n = exp.numbers[pick.number];
  const va = n.value(a.metrics);
  const vb = n.value(b.metrics);
  if (Math.abs(va - vb) < 0.5) return null;
  return (pick.wants === 'more' ? va > vb : va < vb) ? 'A' : 'B';
}

/** One line per pick: what the student guessed and what happened. */
export function pickResultLines(
  exp: TeamExperiment,
  guesses: Record<string, PlanKey | undefined>,
  runs: Partial<Record<PlanKey, TeamRun>>
): Array<{ question: string; guess: string; answer: string; right: boolean | null }> {
  return exp.picks.map((p) => {
    const g = guesses[p.id];
    const w = pickWinner(exp, p, runs);
    return {
      question: p.question,
      guess: g ? exp.plans[g].name : 'No guess',
      answer: w ? exp.plans[w].name : 'About the same',
      right: g && w ? g === w : null
    };
  });
}
