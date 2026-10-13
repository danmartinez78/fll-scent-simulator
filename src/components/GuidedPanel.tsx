import type { Scenario, Settings, TreatmentPlan } from '../models/types';
import type { Simulation } from '../simulation/Simulation';
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

function MissionStep({ scenario, onLoadScenario }: Props) {
  return (
    <>
      <h2 className="guided-title">Pick a mission</h2>
      <div className="missions">
        {SCENARIOS.map((s) => (
          <button
            key={s.id}
            className={s.id === scenario.id ? 'mission active' : 'mission'}
            aria-pressed={s.id === scenario.id}
            onClick={() => onLoadScenario(s)}
          >
            <strong>{s.name}</strong>
            <span>{s.purpose}</span>
          </button>
        ))}
      </div>
    </>
  );
}

function PredictStep({ scenario, prediction, onPrediction }: Props) {
  return (
    <>
      <h2 className="guided-title">What do you think will happen?</h2>
      {scenario.question && <p className="guided-question">❓ {scenario.question}</p>}
      <label className="predict">
        <span>My prediction</span>
        <textarea
          rows={5}
          value={prediction}
          placeholder="I think that... because..."
          onChange={(e) => onPrediction(e.target.value)}
        />
      </label>
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

function RunStep({ sim, running, onStep }: Props) {
  return (
    <>
      <h2 className="guided-title">Run the experiment</h2>
      <p className="hint">
        {sim.time === 0
          ? 'Press ▶ Run above the map. Use 5x or 20x to speed it up.'
          : running
            ? 'Watch the pests. Orange pests are bothered by repellent. Blue pests ignore the scent.'
            : 'Paused. Press Resume to keep going.'}
      </p>
      <BigNumbers sim={sim} />
      <button className="btn primary wide" disabled={sim.time === 0} onClick={() => onStep('compare')}>
        {sim.finished ? 'See the results →' : 'Stop here and see the results →'}
      </button>
    </>
  );
}

function CompareStep(p: Props) {
  return (
    <>
      <h2 className="guided-title">What happened?</h2>
      {p.prediction.trim() && <p className="guided-question">You predicted: “{p.prediction.trim()}”</p>}
      {p.sim.time === 0 ? (
        <p className="hint">Run the experiment first, then come back here.</p>
      ) : (
        <ResultsPanel sim={p.sim} onSave={p.onSave} saved={p.saved} />
      )}
      <div className="guided-again">
        <button className="btn wide" onClick={p.onTryAgain}>
          🔁 Try another change
        </button>
        <button className="btn wide" onClick={() => p.onStep('mission')}>
          🗺️ Pick a new mission
        </button>
      </div>
    </>
  );
}
