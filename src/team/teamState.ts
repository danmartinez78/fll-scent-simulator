import { PLAN_KEYS, TEAM_EXPERIMENTS, type PlanKey, type TeamExperimentId, type TeamRun } from './experiments';

/** What the student has done on one experiment. */
export interface TeamExperimentState {
  guesses: Record<string, PlanKey | undefined>;
  because: string;
  runs: Partial<Record<PlanKey, TeamRun>>;
  found: string;
  realWorld: string;
}

export interface TeamState {
  teamName: string;
  current: TeamExperimentId | null;
  experiments: Partial<Record<TeamExperimentId, TeamExperimentState>>;
}

const KEY = 'scent-sim-team';

export const emptyExperimentState = (): TeamExperimentState => ({ guesses: {}, because: '', runs: {}, found: '', realWorld: '' });
export const emptyTeamState = (): TeamState => ({ teamName: '', current: null, experiments: {} });

const str = (v: unknown) => (typeof v === 'string' ? v : '');

/** Keep only what this page knows how to show, so an old or broken save can't break it. */
export function cleanTeamState(raw: unknown): TeamState {
  const out = emptyTeamState();
  if (!raw || typeof raw !== 'object') return out;
  const r = raw as Record<string, unknown>;
  out.teamName = str(r.teamName);
  const ids = TEAM_EXPERIMENTS.map((e) => e.id);
  if (ids.includes(r.current as TeamExperimentId)) out.current = r.current as TeamExperimentId;
  const exps = (r.experiments ?? {}) as Record<string, unknown>;
  for (const id of ids) {
    const e = exps[id] as Record<string, unknown> | undefined;
    if (!e || typeof e !== 'object') continue;
    const st = emptyExperimentState();
    const guesses = (e.guesses ?? {}) as Record<string, unknown>;
    for (const [k, v] of Object.entries(guesses)) if (v === 'A' || v === 'B') st.guesses[k] = v;
    st.because = str(e.because);
    st.found = str(e.found);
    st.realWorld = str(e.realWorld);
    const runs = (e.runs ?? {}) as Record<string, unknown>;
    for (const k of PLAN_KEYS) {
      const run = runs[k] as TeamRun | undefined;
      if (run && typeof run === 'object' && run.metrics && run.settings) st.runs[k] = run;
    }
    out.experiments[id] = st;
  }
  return out;
}

export function loadTeamState(): TeamState {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? cleanTeamState(JSON.parse(raw)) : emptyTeamState();
  } catch {
    return emptyTeamState();
  }
}

export function saveTeamState(s: TeamState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Storage can be full or blocked; the page still works until it is closed.
  }
}
