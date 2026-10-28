import { useCallback, useEffect, useRef, useState } from 'react';
import type { InsectGroup, ViewOptions } from '../models/types';
import { Simulation } from '../simulation/Simulation';
import { GROOMBA_PLAYBACK } from '../simulation/Groomba';
import { formatFieldClock } from '../utils/fieldTime';
import {
  PLAN_KEYS,
  pickResultLines,
  TEAM_EXPERIMENTS,
  teamExperiment,
  teamPlan,
  type PlanKey,
  type TeamExperiment,
  type TeamExperimentId
} from '../team/experiments';
import { emptyExperimentState, loadTeamState, saveTeamState, type TeamExperimentState, type TeamState } from '../team/teamState';
import { experimentDone, PLAN_COLORS, teamFileStem, teamReportHtml } from '../team/teamReport';
import { experimentSlidePng } from '../team/slideImage';
import { SimulationCanvas } from './SimulationCanvas';
import { MapKey } from './MapKey';
import { mapSnapshot, openHtml } from './ui';

/** Simulated seconds per real second, as in the main page. */
const BASE_SIM_SPEED = 10;
/** A whole run takes about 20 seconds at the normal speed (Guided's 20x). */
const NORMAL_SPEED = 20;
const FAST_SPEED = 60;
/** Keep each frame short so the page stays smooth while the model works. */
const FRAME_BUDGET_MS = 25;

const VIEW: ViewOptions = { showPests: true, showScent: true, showSurvey: false, showDamage: true, showPath: true };

function newSim(exp: TeamExperiment, k: PlanKey): Simulation {
  const s = structuredClone(exp.plans[k].settings);
  return new Simulation(s, teamPlan(s));
}

function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function PlanTag({ k }: { k: PlanKey }) {
  return (
    <span className="plan-tag" style={{ background: PLAN_COLORS[k] }}>
      {k}
    </span>
  );
}

/**
 * Team presentation: one page where a student picks one of two ready-made
 * experiments, predicts, runs both plans and writes two sentences, then makes
 * a one-page report and a slide picture. Nothing here changes Guided or Playground.
 */
export function TeamPage() {
  const [team, setTeamState] = useState<TeamState>(loadTeamState);
  const exp = team.current ? teamExperiment(team.current) : null;
  const st: TeamExperimentState = (team.current && team.experiments[team.current]) || emptyExperimentState();

  const simRef = useRef<Simulation>(newSim(exp ?? TEAM_EXPERIMENTS[0], 'A'));
  const [shown, setShown] = useState<PlanKey>('A');
  const [running, setRunning] = useState<PlanKey | null>(null);
  const [fast, setFast] = useState(false);
  const [skipping, setSkipping] = useState(false);
  const [spotlight, setSpotlight] = useState<InsectGroup | null>(null);
  const [mapMode, setMapMode] = useState<'live' | 'both'>(() => (experimentDone(st) ? 'both' : 'live'));
  const [busy, setBusy] = useState(false);
  const [, setTick] = useState(0);
  const runningRef = useRef(running);
  const speedRef = useRef(NORMAL_SPEED);
  const skipRef = useRef(false);
  const centerRef = useRef<HTMLElement>(null);
  const resultsRef = useRef<HTMLElement>(null);
  runningRef.current = running;
  speedRef.current = fast ? FAST_SPEED : NORMAL_SPEED;
  skipRef.current = skipping;

  const setTeam = useCallback((update: (t: TeamState) => TeamState) => {
    setTeamState((t) => {
      const next = update(t);
      saveTeamState(next);
      return next;
    });
  }, []);

  /** Change the current experiment's part of the saved state. */
  const patch = useCallback(
    (p: Partial<TeamExperimentState>) => {
      setTeam((t) => {
        if (!t.current) return t;
        const cur = t.experiments[t.current] ?? emptyExperimentState();
        return { ...t, experiments: { ...t.experiments, [t.current]: { ...cur, ...p } } };
      });
    },
    [setTeam]
  );

  const teamRef = useRef(team);
  teamRef.current = team;

  const finishRun = useCallback((k: PlanKey) => {
    // Let the map draw the last frame before taking its picture.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const t = teamRef.current;
        if (!t.current) return;
        const sim = simRef.current;
        const snapshot = mapSnapshot(960, centerRef.current ?? document);
        const cur = t.experiments[t.current] ?? emptyExperimentState();
        const runs = { ...cur.runs, [k]: { metrics: sim.metrics(), settings: structuredClone(sim.settings), snapshot } };
        const next = { ...t, experiments: { ...t.experiments, [t.current]: { ...cur, runs } } };
        saveTeamState(next);
        setTeamState(next);
        if (runs.A && runs.B) {
          setMapMode('both');
          // Bring the results into view once React has drawn them.
          setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
        }
      })
    );
  }, []);

  // Step the model while a plan is running.
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    let lastUi = 0;
    const frame = (now: number) => {
      // A slow screen draws fewer frames, so each frame catches up more (up to half a second).
      const realDt = Math.min(0.5, (now - last) / 1000);
      last = now;
      const sim = simRef.current;
      const k = runningRef.current;
      if (k && !sim.finished) {
        const start = performance.now();
        if (skipRef.current) {
          while (!sim.finished && performance.now() - start < FRAME_BUDGET_MS * 2) sim.step();
        } else {
          acc += realDt * BASE_SIM_SPEED * speedRef.current * (sim.groombaDriving ? GROOMBA_PLAYBACK : 1);
          let steps = Math.floor(acc / sim.dt);
          acc -= steps * sim.dt;
          while (steps-- > 0 && !sim.finished && performance.now() - start < FRAME_BUDGET_MS) sim.step();
          // Falling behind is fine: drop what didn't fit rather than piling it up.
          if (steps > 0) acc = 0;
        }
        if (sim.finished) {
          setRunning(null);
          setSkipping(false);
          finishRun(k);
        }
      } else acc = 0;
      if (now - lastUi > 150) {
        lastUi = now;
        setTick((t) => t + 1);
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [finishRun]);

  const pickExperiment = (id: TeamExperimentId) => {
    if (running) return;
    const e = teamExperiment(id);
    const saved = team.experiments[id];
    setTeam((t) => ({ ...t, current: id, experiments: { ...t.experiments, [id]: t.experiments[id] ?? emptyExperimentState() } }));
    simRef.current = newSim(e, 'A');
    setShown('A');
    setMapMode(experimentDone(saved) ? 'both' : 'live');
  };

  const runPlan = (k: PlanKey) => {
    if (!exp || running) return;
    simRef.current = newSim(exp, k);
    setShown(k);
    setMapMode('live');
    setSkipping(false);
    setRunning(k);
  };

  const startOver = () => {
    if (!exp || running) return;
    if (!window.confirm(`Start "${exp.title}" over? Your prediction, results and sentences for it will be cleared.`)) return;
    patch(emptyExperimentState());
    simRef.current = newSim(exp, 'A');
    setShown('A');
    setMapMode('live');
  };

  const makeSlide = async () => {
    if (!exp || busy) return;
    setBusy(true);
    try {
      const blob = await experimentSlidePng(exp, st, team.teamName);
      if (blob) downloadBlob(`${teamFileStem()}-${exp.id}.png`, blob);
    } finally {
      setBusy(false);
    }
  };

  const sim = simRef.current;
  const guessed = !!exp && exp.picks.every((p) => st.guesses[p.id]);
  const done = experimentDone(st);
  const anyDone = TEAM_EXPERIMENTS.some((e) => experimentDone(team.experiments[e.id]));
  const progress = sim.durationSec ? Math.min(1, sim.time / sim.durationSec) : 0;

  return (
    <main className="team-layout">
      <aside className="panel team-panel" aria-label="Team presentation steps">
        <div className="team-head">
          <h2>🎤 Team presentation</h2>
          <label className="team-name">
            <span>Team name</span>
            <input
              value={team.teamName}
              placeholder="Our team"
              onChange={(e) => {
                const v = e.target.value;
                setTeam((t) => ({ ...t, teamName: v }));
              }}
            />
          </label>
        </div>

        <section className="team-step">
          <h3>
            <span className="step-num">1</span> Pick an experiment
          </h3>
          <div className="missions">
            {TEAM_EXPERIMENTS.map((e) => (
              <button
                key={e.id}
                className={e.id === team.current ? 'mission active' : 'mission'}
                aria-pressed={e.id === team.current}
                disabled={!!running}
                onClick={() => pickExperiment(e.id)}
              >
                <span className="mission-head">
                  <strong>
                    <span aria-hidden="true">{e.icon} </span>
                    {e.title}
                  </strong>
                  {experimentDone(team.experiments[e.id]) && <span className="team-done">✓ Done</span>}
                </span>
                <span className="mission-text">{e.question}</span>
              </button>
            ))}
          </div>
        </section>

        {exp && (
          <>
            <section className="team-step">
              <h3>
                <span className="step-num">2</span> Predict
              </h3>
              <p className="hint">{exp.setup}</p>
              {exp.picks.map((p) => (
                <div key={p.id} className="team-pick">
                  <span className="team-pick-q">{p.question}</span>
                  <div className="team-pick-choices" role="group" aria-label={p.question}>
                    {PLAN_KEYS.map((k) => (
                      <button
                        key={k}
                        className={st.guesses[p.id] === k ? 'chip active' : 'chip'}
                        aria-pressed={st.guesses[p.id] === k}
                        onClick={() => patch({ guesses: { ...st.guesses, [p.id]: k } })}
                      >
                        {k}: {exp.plans[k].icon} {exp.plans[k].name}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              <label className="predict">
                <span>Why do you think so?</span>
                <textarea rows={2} value={st.because} placeholder="I think ___ because ___." onChange={(e) => patch({ because: e.target.value })} />
              </label>
            </section>

            <section className="team-step">
              <h3>
                <span className="step-num">3</span> Run both plans
              </h3>
              {!guessed && <p className="hint warn">Make your guesses in step 2 first.</p>}
              {PLAN_KEYS.map((k) => {
                const plan = exp.plans[k];
                const isRunning = running === k;
                const hasRun = !!st.runs[k];
                return (
                  <div key={k} className={`team-plan${shown === k && mapMode === 'live' ? ' shown' : ''}`}>
                    <PlanTag k={k} />
                    <div className="team-plan-text">
                      <strong>
                        {plan.icon} {plan.name}
                      </strong>
                      <span className="muted">{plan.detail}</span>
                    </div>
                    {isRunning ? (
                      <span className="team-running">Running…</span>
                    ) : (
                      <button className={`btn ${hasRun ? '' : 'run big'}`} disabled={!guessed || !!running} onClick={() => runPlan(k)}>
                        {hasRun ? '↺ Watch again' : '▶ Run'}
                      </button>
                    )}
                    {hasRun && !isRunning && <span className="team-done" aria-label="Done">✓</span>}
                  </div>
                );
              })}
              {running && (
                <div className="team-speed">
                  <button className={fast ? 'chip active' : 'chip'} aria-pressed={fast} onClick={() => setFast(!fast)}>
                    ⏩ Faster
                  </button>
                  <button className="chip" disabled={skipping} onClick={() => setSkipping(true)}>
                    ⏭ Skip to the end
                  </button>
                </div>
              )}
            </section>

            {done && (
              <section className="team-step" ref={resultsRef}>
                <h3>
                  <span className="step-num">4</span> Results
                </h3>
                <table className="team-results">
                  <thead>
                    <tr>
                      <th />
                      {PLAN_KEYS.map((k) => (
                        <th key={k}>
                          <PlanTag k={k} /> {exp.plans[k].name}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {exp.numbers.map((n) => (
                      <tr key={n.label}>
                        <th>{n.label}</th>
                        {PLAN_KEYS.map((k) => (
                          <td key={k}>{n.text(st.runs[k]!.metrics, st.runs[k]!.settings)}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                <ul className="team-checks">
                  {pickResultLines(exp, st.guesses, st.runs).map((l) => (
                    <li key={l.question}>
                      {l.right === null ? '➖' : l.right ? '✅' : '❌'} {l.question} You guessed <strong>{l.guess}</strong>.{' '}
                      {l.answer === 'About the same' ? 'They came out about the same.' : <>It was <strong>{l.answer}</strong>.</>}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {done && (
              <section className="team-step">
                <h3>
                  <span className="step-num">5</span> Wrap up
                </h3>
                <label className="predict">
                  <span>What we found</span>
                  <textarea rows={3} value={st.found} placeholder={exp.foundStarter} onChange={(e) => patch({ found: e.target.value })} />
                </label>
                {!st.found.trim() && (
                  <button className="link-btn" onClick={() => patch({ found: exp.foundStarter })}>
                    ✏️ Use a sentence starter
                  </button>
                )}
                <label className="predict">
                  <span>How could we check it in the real world?</span>
                  <textarea rows={2} value={st.realWorld} placeholder={exp.realWorldStarter} onChange={(e) => patch({ realWorld: e.target.value })} />
                </label>
                {!st.realWorld.trim() && (
                  <button className="link-btn" onClick={() => patch({ realWorld: exp.realWorldStarter })}>
                    ✏️ Use a sentence starter
                  </button>
                )}
                <div className="team-actions">
                  <button className="btn primary big" onClick={() => openHtml(`${teamFileStem()}.html`, teamReportHtml(team))}>
                    📄 Make report
                  </button>
                  <button className="btn big" disabled={busy} onClick={makeSlide}>
                    🖼 Save slide picture
                  </button>
                </div>
                <p className="hint small">The report has one page for each experiment you finished. Print it or save it as a PDF.</p>
              </section>
            )}

            <button className="link-btn team-start-over" disabled={!!running} onClick={startOver}>
              Start this experiment over
            </button>
          </>
        )}
        {!exp && anyDone && (
          <button className="btn" onClick={() => openHtml(`${teamFileStem()}.html`, teamReportHtml(team))}>
            📄 Make report
          </button>
        )}
      </aside>

      <section className="center team-center" ref={centerRef}>
        <div className="team-mapbar">
          {exp && mapMode === 'live' && (
            <>
              <strong>
                <PlanTag k={shown} /> {exp.plans[shown].icon} {exp.plans[shown].name}
              </strong>
              <span className="team-clock">⏱ {formatFieldClock(sim.fieldTime)}</span>
              <span className="team-progress" aria-hidden="true">
                <span style={{ width: `${progress * 100}%` }} />
              </span>
            </>
          )}
          {exp && mapMode === 'both' && <strong>Both plans at the end of the 3 weeks</strong>}
          {!exp && <strong>Pick an experiment to start</strong>}
          {done && !running && (
            <div className="team-mapswitch" role="tablist" aria-label="Map view">
              <button role="tab" aria-selected={mapMode === 'both'} className={mapMode === 'both' ? 'chip active' : 'chip'} onClick={() => setMapMode('both')}>
                Side by side
              </button>
              <button role="tab" aria-selected={mapMode === 'live'} className={mapMode === 'live' ? 'chip active' : 'chip'} onClick={() => setMapMode('live')}>
                Live map
              </button>
            </div>
          )}
        </div>
        {/* The live map stays mounted (hidden behind the side-by-side view) so its picture can still be taken. */}
        <div className="canvas-wrap">
          <SimulationCanvas
            simRef={simRef}
            view={{ ...VIEW, spotlight }}
            surveyLayer="camera"
            survey={null}
            tool="none"
            plan={sim.plan}
            settings={sim.settings}
            onPlan={() => {}}
          />
          {exp && mapMode === 'both' && done && (
            <div className="team-both">
              {PLAN_KEYS.map((k) => (
                <figure key={k}>
                  <figcaption>
                    <PlanTag k={k} /> {exp.plans[k].icon} {exp.plans[k].name}
                  </figcaption>
                  {st.runs[k]?.snapshot && <img src={st.runs[k]!.snapshot} alt={`Map at the end of plan ${k}`} />}
                  <dl>
                    {exp.numbers.map((n) => (
                      <div key={n.label}>
                        <dt>{n.label}</dt>
                        <dd>{n.text(st.runs[k]!.metrics, st.runs[k]!.settings)}</dd>
                      </div>
                    ))}
                  </dl>
                </figure>
              ))}
            </div>
          )}
          {exp && mapMode === 'live' && !running && !sim.runStarted && <div className="preview-tag">👀 Preview of plan {shown}</div>}
        </div>
        <MapKey settings={sim.settings} view={{ ...VIEW, spotlight }} survey={false} onSpotlight={setSpotlight} />
      </section>
    </main>
  );
}
