import type { Scenario, Settings, TreatmentPlan } from '../models/types';
import type { Simulation } from '../simulation/Simulation';
import { describeChanges, methodName, runMethodName, workTimeText, type NotebookEntry, type SessionRun } from '../notebook/notebook';
import { usesGroomba } from '../simulation/Groomba';
import { activePlan } from '../simulation/Treatment';
import { formatFieldClock } from '../utils/fieldTime';
import { ReportButtons } from './ReportButtons';
import { SCENARIOS } from '../simulation/scenarios';
import { formatMoney } from '../utils/units';
import { ControlPanel } from './ControlPanel';
import { ResultsPanel } from './ResultsPanel';
import type { Tool } from './SimulationCanvas';
import type { SurveyLayer } from '../render/drawScene';

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
  /** Runs from this visit (all missions), for Compare; only saved ones are in the notebook. */
  sessionRuns: SessionRun[];
  /** The run on the map, once it has finished or been saved. */
  currentRunId: string | null;
  /** Open the full notebook (all experiments, compare two, report, export). */
  onOpenNotebook: () => void;
  /** Reset the run with the current settings and go back to planning. */
  onTryAgain: () => void;
  /** Which survey map the map shows (Compare can switch to where the pests really were). */
  surveyLayer: SurveyLayer;
  onSurveyLayer: (l: SurveyLayer) => void;
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

/** Icon and level for each built-in mission, easiest first (listed in this order within a level). */
const MISSION_INFO: Record<string, { icon: string; level: number }> = {
  baseline: { icon: '📏', level: 1 },
  basic: { icon: '🌱', level: 1 },
  critters: { icon: '🐞', level: 1 },
  sprayVsDevices: { icon: '⚖️', level: 2 },
  windy: { icon: '🌬️', level: 2 },
  groundAir: { icon: '🤖', level: 2 },
  rainy: { icon: '🌧️', level: 2 },
  hotspots: { icon: '🎯', level: 2 },
  budget: { icon: '💰', level: 2 },
  pushpull: { icon: '↔️', level: 3 },
  survey: { icon: '🛰️', level: 3 },
  flighttime: { icon: '🔋', level: 3 }
};
const LEVEL_NAMES = ['', 'Starter', 'Next step', 'Challenge'];

function MissionStep({ scenario, onLoadScenario }: Props) {
  const order = Object.keys(MISSION_INFO);
  const rank = (id: string) => (MISSION_INFO[id]?.level ?? 9) * 100 + (order.includes(id) ? order.indexOf(id) : 99);
  const missions = [...SCENARIOS].sort((a, b) => rank(a.id) - rank(b.id));
  return (
    <>
      <h2 className="guided-title">Pick a mission</h2>
      <p className="hint">
        New here? Start with <strong>No Treatment</strong> to see what the pests do on their own, then try <strong>Basic Field</strong>.
        Missions get harder as you go down.
      </p>
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

/** A mission where nothing is treated: the baseline every other run is compared to. */
const isBaseline = (sc: Scenario) => sc.settings.treatment === 'none';

/** The survey mission's first job: fly the survey, then use its map to place traps. */
function SurveyBox(p: Props) {
  const done = p.sim.surveys.length > 0;
  if (p.sim.surveying)
    return (
      <div className="guided-extra">
        <p className="hint">🛰️ The survey drone is scanning the field. Watch the colored squares appear.</p>
      </div>
    );
  if (!done)
    return (
      <div className="guided-extra">
        <p className="hint">
          <strong>Step 1:</strong> You can't see the pests here. Fly the survey drone to find where they gather.
        </p>
        <button className="btn survey-btn" onClick={p.onSurvey}>
          🛰️ Fly survey
        </button>
        <p className="hint small">Or skip it and place your traps without a map, to see how much the survey helps.</p>
      </div>
    );
  return (
    <div className="guided-extra">
      <p className="hint">
        ✅ <strong>Survey done.</strong> <strong>Step 2:</strong> put your {p.settings.devices.maxDevices} traps (🪤) where the camera saw lots
        of pests (red squares). The camera can be wrong: gray squares it couldn't judge, and some colors are mistakes.
      </p>
      <p className="hint small">The survey map stays when you try again. To test without it, pick this mission again and skip the survey.</p>
    </div>
  );
}

function PlanStep(p: Props) {
  const survey = p.scenario.id === 'survey';
  if (isBaseline(p.scenario)) {
    return (
      <>
        <h2 className="guided-title">Nothing to plan this time</h2>
        <div className="guided-extra">
          <p className="hint">
            📏 This run is the <strong>baseline</strong>. The drone stays home and no scent is used, so you can see what the pests do on
            their own.
          </p>
          <p className="hint">
            Every treatment you try later gets compared to this. A plan only helps if it protects <strong>more</strong> crop than doing
            nothing.
          </p>
        </div>
      </>
    );
  }
  return (
    <>
      <h2 className="guided-title">Plan your treatment</h2>
      <p className="hint">Pick a method, then use the map to place it. Change one thing at a time so you know what made the difference.</p>
      {survey && <SurveyBox {...p} />}
      <ControlPanel
        settings={p.settings}
        plan={p.plan}
        tool={p.tool}
        simStarted={p.sim.runStarted}
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
      <div className={m.helpersKilled ? 'big-bad' : ''}>
        <span className="big-value">{(m.pestsKilled ?? 0) + (m.helpersKilled ?? 0)}</span>
        <span className="big-label">🪲 insects killed</span>
        {(m.helpersTotal ?? 0) > 0 && (
          <span className="big-sub">
            🐝 {m.helpersKilled ?? 0} helpful · {(m.helpersAlivePct ?? 100).toFixed(0)}% alive
          </span>
        )}
      </div>
    </div>
  );
}

/** What the student still has to place on the map, or null when the plan has something in it. */
function missingPlan(settings: Settings, plan: TreatmentPlan): string | null {
  const eff = activePlan(plan, settings.treatment);
  if ((settings.treatment === 'spray' || settings.treatment === 'pesticide') && !eff.sprayZones.length) return 'spray zones';
  if ((settings.treatment === 'slowRelease' || settings.treatment === 'pushPull') && !eff.devices.length) return 'scent devices';
  return null;
}

function RunStep({ sim, running, onStep, settings, plan }: Props) {
  const missing = !sim.runStarted ? missingPlan(settings, plan) : null;
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
        {!sim.runStarted
          ? 'Press ▶ Run above the map to start.'
          : running
            ? settings.treatment === 'pesticide'
              ? 'Watch the × marks: each one is an insect killed. A red × is a bee or ladybug.'
              : 'Watch the pests. Orange pests are bothered by repellent. Blue pests ignore the scent. Red dots are ladybugs eating pests.'
            : 'Paused. Press ▶ Resume to keep going.'}
      </p>
      {!sim.runStarted && <p className="hint">Tip: 5x and 20x make the days go by faster.</p>}
      {sim.runStarted && !sim.finished && (
        <p className="hint">When all the days are done, your results open by themselves.</p>
      )}
      <BigNumbers sim={sim} />
      {sim.finished ? (
        <button className="btn primary wide" onClick={() => onStep('compare')}>
          See the results →
        </button>
      ) : (
        sim.runStarted && (
          <button className="btn wide" onClick={() => onStep('compare')}>
            ⏹ Stop early and see the results
          </button>
        )
      )}
    </>
  );
}

/** The cost to insect life: shown on every Compare, in plain words. */
function InsectNote({ sim }: { sim: Simulation }) {
  const m = sim.metrics();
  const helpers = m.helpersKilled ?? 0;
  const pests = m.pestsKilled ?? 0;
  const total = m.helpersTotal ?? 0;
  if (helpers > 0)
    return (
      <div className="insect-note bad">
        <h3 className="runs-title">☠️ This plan killed {helpers} bees and ladybugs</h3>
        <p className="hint small">
          That is {Math.round((helpers / Math.max(1, total)) * 100)}% of the helpful insects in the field, plus {pests} pests. Bees pollinate crops,
          and ladybugs eat pests for free. Who pollinates the crop next season, and who eats the pests now?
        </p>
      </div>
    );
  if (pests > 0)
    return (
      <div className="insect-note">
        <h3 className="runs-title">🪲 This plan killed {pests} pests</h3>
        <p className="hint small">
          Traps protect the crop, but every pest they catch dies. Pests are part of nature too. Could fewer traps, or more repellent, protect
          the crop as well?
        </p>
      </div>
    );
  return (
    <div className="insect-note good">
      <h3 className="runs-title">💚 No insects were killed</h3>
      <p className="hint small">
        Every bee and ladybug is still alive{m.pestsEaten ? `, and the ladybugs ate ${m.pestsEaten} pests for free` : ''}. Scents move pests
        instead of killing them.
      </p>
    </div>
  );
}

/** On a mission that hid the pests: show where they really were, next to what the survey said. */
function SurveyReveal({ sim, surveyLayer, onSurveyLayer }: Props) {
  const sv = sim.surveys[0];
  return (
    <div className="change-check">
      <h3 className="runs-title">🔍 Where were the pests really?</h3>
      {sv ? (
        <>
          <p className="hint small">
            The camera counted about <strong>{Math.round(sv.detectedTotal)}</strong> pests. There were really{' '}
            <strong>{Math.round(sv.trueTotal)}</strong>. Switch the map between the two. Did your traps land where the pests really were?
          </p>
          <div className="tool-row">
            <button className={surveyLayer === 'camera' ? 'chip active' : 'chip'} onClick={() => onSurveyLayer('camera')}>
              📷 What the camera saw
            </button>
            <button className={surveyLayer === 'truth' ? 'chip active' : 'chip'} onClick={() => onSurveyLayer('truth')}>
              🐞 Where the pests really were
            </button>
          </div>
        </>
      ) : (
        <p className="hint small">
          You placed your traps without a survey. The pests left on the field are now shown on the map. Try again with a survey and compare.
        </p>
      )}
    </div>
  );
}

/** How close the guess came, in words a student can enjoy. */
/**
 * This mission's saved runs side by side, plus the current run if it isn't
 * saved yet, so the Compare step has something to compare against.
 */
/** This mission's runs from this visit, oldest first. */
function missionRuns(p: Props): SessionRun[] {
  return p.sessionRuns.filter((r) => r.captured.scenarioName === p.scenario.name);
}

/** The name a run goes by: its notebook name once saved, otherwise "Run 3". */
function runName(p: Props, r: SessionRun): string {
  return (r.entryId && p.entries.find((e) => e.id === r.entryId)?.name) || r.label;
}

/**
 * This mission's runs from this visit side by side, plus the run on the map
 * if it isn't recorded yet (stopped early), so Compare has something to
 * compare against whether or not the runs were saved.
 */
function RunsTable(p: Props) {
  const { sim, settings, currentRunId } = p;
  const runs = missionRuns(p);
  const rows: Array<{ key: string; name: string; saved: boolean; method: string; crop: number; kept: number; cost: number; killed: number | null; helpers: number | null; current: boolean; groomba: boolean; time: string }> = runs
    .slice(-6)
    .map((r) => {
      const c = r.captured;
      return {
        key: r.id,
        name: runName(p, r),
        saved: !!r.entryId,
        method: runMethodName(c.settings),
        groomba: usesGroomba(c.settings),
        time: workTimeText(c.settings, c.metrics.flightTimeMin),
        crop: c.metrics.cropProtectedPct,
        kept: c.metrics.pestsDeterredAvgPct,
        cost: c.metrics.cost.total,
        killed: c.metrics.pestsKilled === undefined ? null : c.metrics.pestsKilled + (c.metrics.helpersKilled ?? 0),
        helpers: c.metrics.helpersKilled ?? null,
        current: r.id === currentRunId
      };
    });
  if (!currentRunId && sim.runStarted) {
    const m = sim.metrics();
    rows.push({
      key: 'now',
      name: 'This run',
      saved: false,
      method: runMethodName(settings),
      groomba: usesGroomba(settings),
      time: workTimeText(settings, m.flightTimeMin),
      crop: m.cropProtectedPct,
      kept: m.pestsDeterredAvgPct,
      cost: m.cost.total,
      killed: (m.pestsKilled ?? 0) + (m.helpersKilled ?? 0),
      helpers: m.helpersKilled ?? 0,
      current: true
    });
  }
  const best = Math.max(...rows.map((r) => r.crop));
  const hasBaseline = rows.some((r) => r.method === methodName('none'));
  // How long the sprayer worked, when the groomba is part of the comparison.
  const showTime = p.scenario.id === 'groundAir' || rows.some((r) => r.groomba);
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
            {showTime && <th scope="col">⏱ Time spraying</th>}
            <th scope="col">🪲 Insects killed</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className={r.current ? 'current' : ''}>
              <th scope="row">
                {r.name}
                {r.saved && <span title="Saved in the notebook"> 📓</span>}
                <span className="runs-method">{r.method}</span>
              </th>
              <td className={rows.length > 1 && r.crop === best ? 'best' : ''}>
                {r.crop.toFixed(0)}%{rows.length > 1 && r.crop === best ? ' 🏆' : ''}
              </td>
              <td>{r.kept.toFixed(0)}%</td>
              <td>{formatMoney(r.cost)}</td>
              {showTime && <td>{r.method === methodName('none') ? '—' : r.time}</td>}
              <td className={r.helpers ? 'bad' : ''}>
                {r.killed === null ? '—' : r.killed}
                {r.helpers ? <span className="runs-method">🐝 {r.helpers} helpful</span> : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 1 && <p className="hint small">Run this mission again with one change, and the runs will line up here.</p>}
      <p className="hint small">📓 marks runs saved in your notebook. The others are kept only until you close the page.</p>
      {!hasBaseline && (
        <p className="hint small">
          💡 Also try <strong>No treatment</strong> on this mission. Then you can see how much your plan really helped.
        </p>
      )}
    </div>
  );
}

/**
 * What changed since the previous run on this mission, and how the results
 * moved, so students can check they changed one thing at a time.
 */
function ChangeCheck(p: Props) {
  const { sim } = p;
  const runs = missionRuns(p);
  const current = runs.find((r) => r.id === p.currentRunId);
  const before = current ? runs.slice(0, runs.indexOf(current)) : runs;
  const prevRun = before[before.length - 1];
  if (!prevRun) return null;
  const prev = { name: runName(p, prevRun), captured: prevRun.captured };
  const now = current?.captured ?? { settings: sim.settings, plan: sim.plan, metrics: sim.metrics(), surveysDone: sim.surveys.length };
  const changes = describeChanges(prev.captured, now);
  const crop0 = prev.captured.metrics.cropProtectedPct;
  const crop1 = now.metrics.cropProtectedPct;
  const diff = Math.round(crop1) - Math.round(crop0);
  const costDiff = now.metrics.cost.total - prev.captured.metrics.cost.total;
  return (
    <div className={`change-check ${changes.length > 1 ? 'warn' : ''}`}>
      <h3 className="runs-title">🔬 What did you change since {prev.name}?</h3>
      {changes.length === 0 ? (
        <p className="hint small">
          Nothing! With the same setup, the simulator gives the same result every time. Change one thing to test an idea.
        </p>
      ) : (
        <>
          <ul className="change-list">
            {changes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          <p className="hint small">
            Crop safe went from <strong>{crop0.toFixed(0)}%</strong> to <strong>{crop1.toFixed(0)}%</strong> (
            {diff > 0 ? `+${diff}` : diff}) and the cost {costDiff >= 0 ? 'went up' : 'went down'} by{' '}
            <strong>{formatMoney(Math.abs(costDiff))}</strong>.
          </p>
          <p className="hint small">
            {changes.length === 1
              ? '✅ You changed one thing, so that change is what made the difference. That is a fair test!'
              : `⚠️ You changed ${changes.length} things at once. It is hard to tell which one made the difference. Next time, try changing just one.`}
          </p>
        </>
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
  const ran = p.sim.runStarted;
  // After the baseline, the next step is a mission with a treatment to compare against it.
  const nextMission = SCENARIOS.find((s) => s.id === 'basic');
  const actual = p.sim.metrics().cropProtectedPct;
  // With two or more runs to line up, the comparison table is the main thing, so it goes first.
  const current = p.sessionRuns.find((r) => r.id === p.currentRunId) ?? null;
  const runCount = missionRuns(p).length + (current ? 0 : 1);
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
      {ran && p.scenario.view?.showPests === false && <SurveyReveal {...p} />}
      {ran && <InsectNote sim={p.sim} />}
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
          {tableFirst && <ChangeCheck {...p} />}
          {tableFirst && <h3 className="runs-title">This run in detail</h3>}
          <ResultsPanel sim={p.sim} onSave={p.onSave} saved={null} showSave={false} />
        </>
      )}
      {ran && !tableFirst && <RunsTable {...p} />}
      {ran && <SaveBox {...p} />}
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
        {isBaseline(p.scenario) && nextMission ? (
          <button
            className="btn primary wide"
            onClick={() => {
              p.onLoadScenario(nextMission);
              p.onStep('mission');
            }}
          >
            ➡️ Now try a treatment: {nextMission.name}
          </button>
        ) : (
          <button className="btn primary wide" onClick={p.onTryAgain}>
            🔁 Change one thing and run again
          </button>
        )}
        {ran && !current?.entryId && (
          <p className="unsaved-note">This run isn't in your notebook yet. Save it first if you want to keep it.</p>
        )}
        <button className="btn wide" onClick={() => p.onStep('mission')}>
          🗺️ Pick a new mission
        </button>
      </div>
    </>
  );
}

/**
 * Save the run to the notebook, or say where it was saved. Saving opens a
 * notebook page where the student writes the experiment up.
 */
function SaveBox(p: Props) {
  const current = p.sessionRuns.find((r) => r.id === p.currentRunId) ?? null;
  const entry = current?.entryId ? p.entries.find((e) => e.id === current.entryId) : null;
  if (entry)
    return (
      <div className="write-up">
        <h3 className="runs-title">✅ Saved in your notebook as {entry.name}</h3>
        <button className="btn small" onClick={p.onOpenNotebook}>
          📓 Open notebook
        </button>
      </div>
    );
  return (
    <div className="write-up">
      <h3 className="runs-title">✍️ Worth keeping?</h3>
      <p className="hint small">Save this run as an experiment in your notebook, and write down what you changed and what you learned.</p>
      <button className="btn primary" onClick={p.onSave}>
        📓 Save this experiment
      </button>
    </div>
  );
}
