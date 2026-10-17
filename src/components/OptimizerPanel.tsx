import { useEffect, useRef, useState } from 'react';
import type { Metrics, Settings, SurveyResult, TreatmentPlan } from '../models/types';
import { Optimizer, runFull, scoreMetrics, type Knowledge, type ScoreBreakdown, type StartingIdea } from '../simulation/Optimizer';
import { activePlan } from '../simulation/Treatment';
import { formatMoney } from '../utils/units';
import { methodName } from '../notebook/notebook';
import { LineChart } from './Chart';
import { InfoButton, Slider } from './ui';

interface Props {
  settings: Settings;
  plan: TreatmentPlan;
  surveys: SurveyResult[];
  onSettings: (s: Settings) => void;
  onUsePlan: (p: TreatmentPlan) => void;
}

interface Outcome {
  mine: { plan: TreatmentPlan; metrics: Metrics; score: ScoreBreakdown };
  computer: { plan: TreatmentPlan; metrics: Metrics; score: ScoreBreakdown };
  knowledgeLabel: string;
  settings: Settings;
  /** The named ideas the computer tried first, with the scores from its quick tests. */
  starts: StartingIdea[];
  /** Which idea the final plan grew from, and how many small improvements it kept. */
  bestFrom: string;
  improvements: number;
  /** The computer's quick-test score for its final plan. */
  quickBest: number;
}

export function OptimizerPanel({ settings, plan, surveys, onSettings, onUsePlan }: Props) {
  const [tries, setTries] = useState(60);
  const [knowledgeId, setKnowledgeId] = useState<number>(0);
  const [progress, setProgress] = useState<{ tried: number; total: number; best: number; trace: number[] } | null>(null);
  const [phase, setPhase] = useState<'idle' | 'searching' | 'comparing' | 'done'>('idle');
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [showing, setShowing] = useState<'mine' | 'computer'>('mine');
  const cancelRef = useRef(false);

  useEffect(() => () => void (cancelRef.current = true), []);

  const w = settings.weights;
  const setW = (k: keyof Settings['weights'], v: number) => onSettings({ ...settings, weights: { ...w, [k]: v } });

  const eff = activePlan(plan, settings.treatment);
  const myPlanEmpty = eff.sprayZones.length === 0 && eff.devices.length === 0;

  const start = () => {
    const survey = surveys.find((s) => s.id === knowledgeId);
    const knowledge: Knowledge = survey ? { kind: 'survey', survey } : { kind: 'none' };
    const knowledgeLabel = survey ? `${survey.label} (what its camera saw)` : 'nothing (it assumed pests were spread evenly)';
    const frozen = structuredClone(settings);
    const myPlan = structuredClone(plan);
    const opt = new Optimizer(frozen, knowledge, tries);
    cancelRef.current = false;
    setPhase('searching');
    setOutcome(null);
    const tick = () => {
      if (cancelRef.current) return;
      opt.work(40);
      setProgress({ tried: opt.tried, total: opt.total, best: opt.bestScore, trace: [...opt.trace] });
      if (!opt.done) {
        setTimeout(tick, 0);
        return;
      }
      setPhase('comparing');
      setTimeout(() => {
        if (cancelRef.current || !opt.best) {
          setPhase('idle');
          return;
        }
        // Judge both plans the same way: the full simulation with the real pests.
        const mineM = runFull(frozen, myPlan);
        const compM = runFull(frozen, opt.best);
        setOutcome({
          mine: { plan: myPlan, metrics: mineM, score: scoreMetrics(mineM, frozen.weights) },
          computer: { plan: opt.best, metrics: compM, score: scoreMetrics(compM, frozen.weights) },
          knowledgeLabel,
          settings: frozen,
          starts: opt.starts,
          bestFrom: opt.bestFrom,
          improvements: opt.improvements,
          quickBest: opt.bestScore
        });
        setShowing('mine');
        setPhase('done');
      }, 30);
    };
    setTimeout(tick, 0);
  };

  if (settings.treatment === 'none') {
    return (
      <div className="optimizer">
        <p className="lead">Choose a treatment method first (Spray, Slow-release or Push-pull). The computer will search for a plan using the same method and the same limits as you.</p>
      </div>
    );
  }

  const rows: Array<[string, (m: Metrics) => string]> = [
    ['Crop protected', (m) => `${m.cropProtectedPct.toFixed(0)}%`],
    ['Pests kept off the crop (average)', (m) => `${m.pestsDeterredAvgPct.toFixed(0)}%`],
    ['Product used', (m) => `${m.productUsedGal.toFixed(1)} gal`],
    ['Scent devices used', (m) => String(m.devicesUsed)],
    ['Drone flight time', (m) => `${m.flightTimeMin.toFixed(1)} min`],
    ['Flights', (m) => String(m.flights)],
    ['Estimated cost', (m) => formatMoney(m.cost.total)]
  ];

  return (
    <div className="optimizer">
      <p className="lead">
        First make your own plan. Then let the computer try many plans with the same method ({methodName(settings.treatment)}) and the same limits. <InfoButton topic="optimization" />
      </p>

      <label className="control control-row">
        <span className="control-label">What the computer knows about the pests</span>
        <select value={knowledgeId} onChange={(e) => setKnowledgeId(Number(e.target.value))}>
          <option value={0}>Nothing (assume they're everywhere)</option>
          {surveys.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label} map
            </option>
          ))}
        </select>
      </label>
      <label className="control control-row">
        <span className="control-label">Plans to try</span>
        <select value={tries} onChange={(e) => setTries(Number(e.target.value))}>
          <option value={30}>30 (about half a minute)</option>
          <option value={60}>60 (about a minute)</option>
          <option value={120}>120 (a few minutes)</option>
        </select>
      </label>
      <p className="hint small">
        The computer tries the obvious plans first (treat everything, the border, the worst areas, devices spread out or where the pests are),
        keeps the best one, then makes small changes and keeps each change only if the score goes up.
      </p>

      <details className="weights">
        <summary>
          What does "best" mean? (score rules) <InfoButton topic="score" />
        </summary>
        <div className="formula">
          Score = {w.protection} × % crop protected
          <br />+ {w.pestsDeterred} × % pests kept off crop
          <br />− {w.material} × gallons used
          <br />− {w.flightTime} × minutes of flight
          <br />− {w.cost} × (cost ÷ $10)
        </div>
        <Slider label="Crop protected" value={w.protection} min={0} max={3} step={0.1} onChange={(v) => setW('protection', v)} />
        <Slider label="Pests kept off crop" value={w.pestsDeterred} min={0} max={3} step={0.1} onChange={(v) => setW('pestsDeterred', v)} />
        <Slider label="Product used (penalty)" value={w.material} min={0} max={10} step={0.5} onChange={(v) => setW('material', v)} />
        <Slider label="Flight time (penalty)" value={w.flightTime} min={0} max={5} step={0.25} onChange={(v) => setW('flightTime', v)} />
        <Slider label="Cost (penalty)" value={w.cost} min={0} max={5} step={0.25} onChange={(v) => setW('cost', v)} />
        <p className="hint small">Try making product very expensive in the score. Does the computer choose a different plan?</p>
      </details>

      {myPlanEmpty && <p className="hint warn">Your plan is empty. Make a plan on the map first so you can compare.</p>}

      <button className="btn primary wide" onClick={start} disabled={phase === 'searching' || phase === 'comparing'}>
        🤖 Let the computer try
      </button>

      {progress && (phase === 'searching' || phase === 'comparing') && (
        <div className="opt-progress" role="status">
          <div>
            Trying strategy {progress.tried} of {progress.total}
          </div>
          <div>Best score so far: {Number.isFinite(progress.best) ? progress.best.toFixed(0) : '—'}</div>
          <div className="hint small">Each plan is a full {Math.round(settings.run.durationMin)}-day run in a quick version of the simulation.</div>
          <div className="bar">
            <span style={{ width: `${(progress.tried / progress.total) * 100}%` }} />
          </div>
          {phase === 'comparing' && <div>Testing both plans in the full simulation…</div>}
          <button
            className="btn small"
            onClick={() => {
              cancelRef.current = true;
              setPhase('idle');
            }}
          >
            Stop
          </button>
        </div>
      )}

      {progress && progress.trace.length > 2 && (
        <LineChart
          xs={progress.trace.map((_, i) => i + 1)}
          xLabel="plans tried"
          series={[{ label: 'Best score found so far', color: '#0f766e', values: progress.trace.map((v) => (Number.isFinite(v) ? Math.max(0, v) : 0)) }]}
          height={110}
        />
      )}

      {outcome && phase === 'done' && (
        <div className="opt-result">
          <p className="hint small">The computer planned using: {outcome.knowledgeLabel}. Both plans were then tested in the full simulation with the real pests and the same seed.</p>
          <StartingIdeas outcome={outcome} />
          <table className="table">
            <thead>
              <tr>
                <th />
                <th>Your plan</th>
                <th>Computer plan</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(([label, f]) => (
                <tr key={label}>
                  <td>{label}</td>
                  <td>{f(outcome.mine.metrics)}</td>
                  <td>{f(outcome.computer.metrics)}</td>
                </tr>
              ))}
              <tr className="score-row">
                <td>Score (using the rules above)</td>
                <td>{outcome.mine.score.total.toFixed(0)}</td>
                <td>{outcome.computer.score.total.toFixed(0)}</td>
              </tr>
            </tbody>
          </table>
          <p className="neutral">
            {outcome.computer.score.total > outcome.mine.score.total
              ? 'The computer found a plan that scored higher using these rules.'
              : outcome.computer.score.total < outcome.mine.score.total
                ? 'Your plan scored higher using these rules.'
                : 'Both plans scored the same using these rules.'}
          </p>
          <div className="tool-row">
            <button
              className={showing === 'computer' ? 'btn small active' : 'btn small'}
              onClick={() => {
                setShowing('computer');
                onUsePlan(structuredClone(outcome.computer.plan));
              }}
            >
              Show computer plan on the map
            </button>
            <button
              className={showing === 'mine' ? 'btn small active' : 'btn small'}
              onClick={() => {
                setShowing('mine');
                onUsePlan(structuredClone(outcome.mine.plan));
              }}
            >
              Back to my plan
            </button>
          </div>
          <ul className="questions">
            <li>Why do you think the computer chose these locations?</li>
            <li>Would its plan actually make sense on a real farm?</li>
            <li>What if the survey map it used was wrong?</li>
          </ul>
        </div>
      )}
    </div>
  );
}

/** What the computer tried first and where its final plan came from. */
function StartingIdeas({ outcome }: { outcome: Outcome }) {
  const ranked = [...outcome.starts].sort((a, b) => b.score - a.score);
  const compEmpty = outcome.computer.plan.sprayZones.length === 0 && outcome.computer.plan.devices.length === 0;
  return (
    <details className="ideas">
      <summary>What the computer tried first</summary>
      <ol className="ideas-list">
        {ranked.map((st) => (
          <li key={st.label} className={st.label === outcome.bestFrom ? 'best' : ''}>
            <span>{st.label}</span>
            <strong>{st.allowed ? st.score.toFixed(0) : 'over the limit'}</strong>
          </li>
        ))}
      </ol>
      <p className="hint small">
        Scores from its quick tests, using only what it knew about the pests.{' '}
        {outcome.improvements > 0
          ? `It started from "${outcome.bestFrom}" and kept ${outcome.improvements} small improvement${outcome.improvements === 1 ? '' : 's'}, reaching ${outcome.quickBest.toFixed(0)}.`
          : `None of its small changes beat "${outcome.bestFrom}".`}
      </p>
      {compEmpty && (
        <p className="hint warn">
          By these score rules, doing nothing beat every plan the computer tried. Pests pushed off a treated area move to the nearest untreated
          crop and keep eating, so a little treatment mostly moves the problem. If protecting the crop matters more to you, raise its weight above.
        </p>
      )}
    </details>
  );
}
