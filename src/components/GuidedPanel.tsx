import type { Scenario, Settings, TreatmentPlan } from '../models/types';
import type { Simulation } from '../simulation/Simulation';
import { ENTRY_FIELDS, methodName, type NotebookEntry } from '../notebook/notebook';
import { activePlan } from '../simulation/Treatment';
import { formatFieldClock } from '../utils/fieldTime';
import { ReportButtons } from './ReportButtons';
import { SCENARIOS } from '../simulation/scenarios';
import { formatMoney } from '../utils/units';
import { ControlPanel } from './ControlPanel';
import { ResultsPanel } from './ResultsPanel';
import type { Tool } from './SimulationCanvas';

export type GuidedStep = 'mission' | 'predict' | 'plan' | 'run' | 'compare';

export const GUIDED_STEPS: Array<{ key: GuidedStep; label: string }> = [
  { key: 'mission', label: 'Mission' },
  { key: 'predict', label: 'Predict' },
  { key: 'plan', label: 'Plan' },
  { key: 'run', label: 'Run' },
  { key: 'compare', label: 'Compare' }
];

interface Props {
  step: GuidedStep;
  onStep: (s: GuidedStep) => void;
  scenario: Scenario;
  onLoadScenario: (s: Scenario) => void;
  prediction: string;
  onPrediction: (text: string) => void;
  /** The student's number guess for crop protected, or null if they skipped it. */
  guess: number | null;
  onGuess: (pct: number | null) => void;
  settings: Settings;
  plan: TreatmentPlan;
  tool: Tool;
  sim: Simulation;
  running: boolean;
  onSettings: (s: Settings) => void;
  onPlan: (p: TreatmentPlan) => void;
  onTool: (t: Tool) => void;
  onSurvey: () => void;
  onSave: () => void;
  saved: string | null;
  entries: NotebookEntry[];
  /** The notebook experiment the current run was saved into (if any). */
  activeEntryId: string | null;
  onUpdateEntry: (id: string, patch: Partial<NotebookEntry>) => void;
  /** Open the full notebook (all experiments, compare two, report, export). */
  onOpenNotebook: () => void;
  /** Reset the run with the current settings and go back to planning. */
  onTryAgain: () => void;
}

/** Step-by-step version of the simulator: one small task at a time. */
export function GuidedPanel(p: Props) {
  const index = GUIDED_STEPS.findIndex((s) => s.key === p.step);
  const next = GUIDED_STEPS[index + 1];
  return (
    <div className="guided-panel">
      <ol className="stepper">
        {GUIDED_STEPS.map((s, i) => (
          <li key={s.key}>
            <button
              className={`step ${i === index ? 'current' : i < index ? 'done' : ''}`}
              aria-current={i === index ? 'step' : undefined}
              onClick={() => p.onStep(s.key)}
            >
              <span className="step-num">{i < index ? '✓' : i + 1}</span>
              {s.label}
            </button>
          </li>
        ))}
      </ol>
      <div className="guided-tools">
        <span className="hint small">{p.scenario.name}</span>
        <button className="btn small" onClick={p.onOpenNotebook} title="Every experiment: notes, results, compare two, report">
          📓 Notebook{p.entries.length ? ` (${p.entries.length})` : ''}
        </button>
      </div>

      <div className="guided-body">
        {p.step === 'mission' && <MissionStep {...p} />}
        {p.step === 'predict' && <PredictStep {...p} />}
        {p.step === 'plan' && <PlanStep {...p} />}
        {p.step === 'run' && <RunStep {...p} />}
        {p.step === 'compare' && <CompareStep {...p} />}
      </div>

      {next && p.step !== 'run' && (
        <div className="guided-nav">
          <button className="btn primary wide" onClick={() => p.onStep(next.key)}>
            Next: {next.label} →
          </button>
        </div>
      )}
    </div>
  );
}

/** Icon and level for each built-in mission, easiest first. */
const MISSION_INFO: Record<string, { icon: string; level: number }> = {
  basic: { icon: '🌱', level: 1 },
  baseline: { icon: '📏', level: 1 },
  windy: { icon: '🌬️', level: 2 },
  hotspots: { icon: '🎯', level: 2 },
  limited: { icon: '🧴', level: 2 },
  pushpull: { icon: '↔️', level: 3 },
  survey: { icon: '🛰️', level: 3 },
  flighttime: { icon: '🔋', level: 3 }
};
const LEVEL_NAMES = ['', 'Starter', 'Next step', 'Challenge'];

function MissionStep({ scenario, onLoadScenario }: Props) {
  const missions = [...SCENARIOS].sort((a, b) => (MISSION_INFO[a.id]?.level ?? 9) - (MISSION_INFO[b.id]?.level ?? 9));
  return (
    <>
      <h2 className="guided-title">Pick a mission</h2>
      <p className="hint">New here? Start with <strong>Basic Field</strong>. Missions get harder as you go down.</p>
      <div className="missions">
        {missions.map((s) => {
          const info = MISSION_INFO[s.id];
          return (
            <button
              key={s.id}
              className={s.id === scenario.id ? 'mission active' : 'mission'}
              aria-pressed={s.id === scenario.id}
              onClick={() => onLoadScenario(s)}
            >
              <span className="mission-head">
                <strong>
                  {info && <span aria-hidden="true">{info.icon} </span>}
                  {s.name}
                </strong>
                {info && (
                  <span className={`level level-${info.level}`} title={`Level ${info.level}`}>
                    {'★'.repeat(info.level)}
                    <span className="level-name"> {LEVEL_NAMES[info.level]}</span>
                  </span>
                )}
              </span>
              <span className="mission-text">{s.purpose}</span>
            </button>
          );
        })}
      </div>
    </>
  );
}

function PredictStep({ scenario, prediction, onPrediction, guess, onGuess }: Props) {
  return (
    <>
      <h2 className="guided-title">What do you think will happen?</h2>
      {scenario.question && <p className="guided-question">❓ {scenario.question}</p>}
      <label className="predict">
        <span>My prediction</span>
        <textarea
          rows={4}
          value={prediction}
          placeholder="I think that... because..."
          onChange={(e) => onPrediction(e.target.value)}
        />
      </label>
      <div className="guess">
        <span className="guess-label">🎯 Make a guess: how much of the crop will be safe at the end?</span>
        {guess === null ? (
          <button className="btn" onClick={() => onGuess(50)}>
            I want to guess
          </button>
        ) : (
          <>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={guess}
              aria-label="My guess for crop protected, in percent"
              onChange={(e) => onGuess(Number(e.target.value))}
            />
            <span className="guess-value">
              {guess}% of the crop protected{' '}
              <button className="link-btn inline" onClick={() => onGuess(null)}>
                skip
              </button>
            </span>
          </>
        )}
      </div>
      <p className="hint small">Your prediction is saved in the notebook with this run's results.</p>
    </>
  );
}

function PlanStep(p: Props) {
  const survey = p.scenario.id === 'survey';
  return (
    <>
      <h2 className="guided-title">Plan your treatment</h2>
      <p className="hint">Pick a method, then use the map to place it. Change one thing at a time so you know what made the difference.</p>
      {survey && (
        <div className="guided-extra">
          <p className="hint">You can't see the pests here. Fly the survey drone first to find them.</p>
          <button className="btn survey-btn" onClick={p.onSurvey} disabled={p.sim.surveying}>
            {p.sim.surveying ? '🛰️ Scanning…' : '🛰️ Fly survey'}
          </button>
        </div>
      )}
      <ControlPanel
        settings={p.settings}
        plan={p.plan}
        tool={p.tool}
        simStarted={p.sim.time > 0}
        scenario={p.scenario}
        onSettings={p.onSettings}
        onPlan={p.onPlan}
        onTool={p.onTool}
        onLoadScenario={p.onLoadScenario}
        only={['plan', 'wind']}
      />
    </>
  );
}

function BigNumbers({ sim }: { sim: Simulation }) {
  const m = sim.metrics();
  return (
    <div className="big-numbers">
      <div>
        <span className="big-value">{m.cropProtectedPct.toFixed(0)}%</span>
        <span className="big-label">🌱 crop protected</span>
      </div>
      <div>
        <span className="big-value">{m.pestsDeterredPct.toFixed(0)}%</span>
        <span className="big-label">🐞 pests kept off</span>
      </div>
      <div>
        <span className="big-value">{formatMoney(m.cost.total)}</span>
        <span className="big-label">💲 cost</span>
      </div>
    </div>
  );
}

/** What the student still has to place on the map, or null when the plan has something in it. */
function missingPlan(settings: Settings, plan: TreatmentPlan): string | null {
  const eff = activePlan(plan, settings.treatment);
  if (settings.treatment === 'spray' && !eff.sprayZones.length) return 'spray zones';
  if ((settings.treatment === 'slowRelease' || settings.treatment === 'pushPull') && !eff.devices.length) return 'scent devices';
  return null;
}

function RunStep({ sim, running, onStep, settings, plan }: Props) {
  const missing = sim.time === 0 ? missingPlan(settings, plan) : null;
  return (
    <>
      <h2 className="guided-title">Run the experiment</h2>
      {missing && (
        <div className="guided-warn" role="note">
          <span>
            You haven't placed any {missing} yet, so nothing will be treated. That makes this run a <strong>no-treatment baseline</strong>.
          </span>
          <button className="btn small" onClick={() => onStep('plan')}>
            ← Back to Plan
          </button>
        </div>
      )}
      <p className="hint big-hint">
        {sim.time === 0
          ? 'Press ▶ Run above the map to start.'
          : running
            ? 'Watch the pests. Orange pests are bothered by repellent. Blue pests ignore the scent.'
            : 'Paused. Press ▶ Resume to keep going.'}
      </p>
      {sim.time === 0 && <p className="hint">Tip: 5x and 20x make the days go by faster.</p>}
      {sim.time > 0 && !sim.finished && (
        <p className="hint">When all the days are done, your results open by themselves.</p>
      )}
      <BigNumbers sim={sim} />
      {sim.finished ? (
        <button className="btn primary wide" onClick={() => onStep('compare')}>
          See the results →
        </button>
      ) : (
        sim.time > 0 && (
          <button className="btn wide" onClick={() => onStep('compare')}>
            ⏹ Stop early and see the results
          </button>
        )
      )}
    </>
  );
}

/** How close the guess came, in words a student can enjoy. */
/**
 * This mission's saved runs side by side, plus the current run if it isn't
 * saved yet, so the Compare step has something to compare against.
 */
function RunsTable({ scenario, entries, sim, saved, settings }: Props) {
  const rows: Array<{ key: string; name: string; method: string; crop: number; kept: number; cost: number; current: boolean }> = entries
    .filter((e) => e.captured && e.captured.scenarioName === scenario.name)
    .slice(-6)
    .map((e) => {
      const c = e.captured!;
      return {
        key: e.id,
        name: e.name,
        method: methodName(c.settings.treatment),
        crop: c.metrics.cropProtectedPct,
        kept: c.metrics.pestsDeterredAvgPct,
        cost: c.metrics.cost.total,
        current: !!saved && e.name === saved
      };
    });
  if (!saved) {
    const m = sim.metrics();
    rows.push({
      key: 'now',
      name: 'This run',
      method: methodName(settings.treatment),
      crop: m.cropProtectedPct,
      kept: m.pestsDeterredAvgPct,
      cost: m.cost.total,
      current: true
    });
  }
  const best = Math.max(...rows.map((r) => r.crop));
  const hasBaseline = rows.some((r) => r.method === methodName('none'));
  return (
    <div className="runs">
      <h3 className="runs-title">📊 Compare your runs on this mission</h3>
      <table className="runs-table">
        <thead>
          <tr>
            <th scope="col">Run</th>
            <th scope="col">🌱 Crop safe</th>
            <th scope="col">🐞 Pests kept off (avg)</th>
            <th scope="col">💲 Cost</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className={r.current ? 'current' : ''}>
              <th scope="row">
                {r.name}
                <span className="runs-method">{r.method}</span>
              </th>
              <td className={rows.length > 1 && r.crop === best ? 'best' : ''}>
                {r.crop.toFixed(0)}%{rows.length > 1 && r.crop === best ? ' 🏆' : ''}
              </td>
              <td>{r.kept.toFixed(0)}%</td>
              <td>{formatMoney(r.cost)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 1 && <p className="hint small">Run this mission again with one change, and the runs will line up here.</p>}
      {!hasBaseline && (
        <p className="hint small">
          💡 Also try <strong>No treatment</strong> on this mission. Then you can see how much your plan really helped.
        </p>
      )}
    </div>
  );
}

function guessVerdict(guess: number, actual: number): string {
  const off = Math.abs(guess - actual);
  if (off <= 5) return '🎯 Right on!';
  if (off <= 15) return '👍 Close!';
  return actual > guess ? 'The plan did better than you guessed.' : 'The plan did worse than you guessed.';
}

function CompareStep(p: Props) {
  const ran = p.sim.time > 0;
  const actual = p.sim.metrics().cropProtectedPct;
  // With two or more runs to line up, the comparison table is the main thing, so it goes first.
  const runCount = p.entries.filter((e) => e.captured?.scenarioName === p.scenario.name).length + (p.saved ? 0 : 1);
  const tableFirst = ran && runCount >= 2;
  return (
    <>
      <h2 className="guided-title">
        {!ran ? 'What happened?' : p.sim.finished ? '🎉 Run done! What happened?' : 'You stopped early. Here is what happened so far.'}
      </h2>
      {ran && !p.sim.finished && (
        <p className="hint">Stopped at {formatFieldClock(p.sim.fieldTime)}. Results can change a lot later in the run.</p>
      )}
      {p.prediction.trim() && <p className="guided-question">You predicted: “{p.prediction.trim()}”</p>}
      {ran && p.guess !== null && (
        <div className="guess-result">
          <span>
            You guessed <strong>{p.guess}%</strong> of the crop would be protected. The simulator says <strong>{actual.toFixed(0)}%</strong>.
          </span>
          <strong>{guessVerdict(p.guess, actual)}</strong>
        </div>
      )}
      {!ran ? (
        <p className="hint">Run the experiment first, then come back here.</p>
      ) : (
        <>
          {tableFirst && <RunsTable {...p} />}
          {tableFirst && <h3 className="runs-title">This run in detail</h3>}
          <ResultsPanel sim={p.sim} onSave={p.onSave} saved={p.saved} />
        </>
      )}
      {ran && !tableFirst && <RunsTable {...p} />}
      {ran && <WriteItDown {...p} />}
      {p.entries.length > 0 && (
        <div className="guided-report">
          <span className="hint small">
            📓 {p.entries.length} experiment{p.entries.length === 1 ? '' : 's'} in the notebook
          </span>
          <div className="tool-row">
            <button className="btn small" onClick={p.onOpenNotebook}>
              📓 Open notebook
            </button>
            <ReportButtons entries={p.entries} />
          </div>
        </div>
      )}
      <div className="guided-again">
        <button className="btn primary wide" onClick={p.onTryAgain}>
          🔁 Change one thing and run again
        </button>
        <button className="btn wide" onClick={() => p.onStep('mission')}>
          🗺️ Pick a new mission
        </button>
      </div>
    </>
  );
}

/** The notebook fields students fill in after a run, right where the results are. */
const WRITE_UP_KEYS: Array<keyof NotebookEntry> = ['variablesChanged', 'variablesSame', 'result', 'surprise', 'next', 'realWorld'];

function WriteItDown({ entries, activeEntryId, saved, onUpdateEntry, onSave }: Props) {
  const entry = entries.find((e) => e.id === activeEntryId && e.captured) ?? null;
  if (!entry || !saved) {
    return (
      <div className="write-up">
        <h3 className="runs-title">✍️ Write it down</h3>
        <p className="hint small">Save this run to the notebook, then write what happened here.</p>
        <button className="btn small primary" onClick={onSave}>
          📓 Save this run
        </button>
      </div>
    );
  }
  const fields = ENTRY_FIELDS.filter((f) => WRITE_UP_KEYS.includes(f.key));
  return (
    <div className="write-up">
      <h3 className="runs-title">✍️ Write it down</h3>
      <p className="hint small">
        Notes for <strong>{entry.name}</strong>. They are saved as you type.
      </p>
      {fields.map((f) => (
        <label key={f.key} className="control">
          <span className="control-label">{f.key === 'realWorld' ? '🌱 ' : ''}{f.label}</span>
          <textarea
            rows={2}
            placeholder={f.hint}
            value={entry[f.key] as string}
            onChange={(ev) => onUpdateEntry(entry.id, { [f.key]: ev.target.value } as Partial<NotebookEntry>)}
          />
        </label>
      ))}
    </div>
  );
}
