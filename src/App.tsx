import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Scenario, Settings, SurveyResult, TreatmentPlan, ViewOptions } from './models/types';
import { Simulation } from './simulation/Simulation';
import { SCENARIOS } from './simulation/scenarios';
import { needsReset, liveSettings } from './simulation/settingsRules';
import type { SurveyLayer } from './render/drawScene';
import { SimulationCanvas, type Tool } from './components/SimulationCanvas';
import { ControlPanel } from './components/ControlPanel';
import { Toolbar } from './components/Toolbar';
import { ResultsPanel } from './components/ResultsPanel';
import { SurveyPanel } from './components/SurveyPanel';
import { OptimizerPanel } from './components/OptimizerPanel';
import { NotebookPanel } from './components/NotebookPanel';
import { HelpPanel } from './components/HelpPanel';
import { ScenarioSelector } from './components/ScenarioSelector';
import { ExperimentPanel } from './components/ExperimentPanel';
import { GuidedPanel, type GuidedStep } from './components/GuidedPanel';
import { MODEL_NOTE } from './content/help';
import { SimToRealDialog } from './components/SimToReal';
import { WelcomeDialog } from './components/WelcomeDialog';
import { captureRun, loadNotebook, newEntry, nextName, saveNotebook, type EntrySetup, type NotebookEntry } from './notebook/notebook';

/** Simulated seconds per real second at "1x". */
export const BASE_SIM_SPEED = 10;

const DEFAULT_VIEW: ViewOptions = {
  showPests: true,
  showScent: true,
  showSurvey: true,
  showDamage: true,
  showPath: true
};

/** The map tool that fits a treatment method. */
export function defaultTool(method: Settings['treatment']): Tool {
  if (method === 'spray') return 'zone';
  if (method === 'slowRelease' || method === 'pushPull') return 'repellent';
  return 'none';
}

type Tab = 'results' | 'survey' | 'computer' | 'notebook' | 'learn';
type Mode = 'guided' | 'playground';

const MODE_KEY = 'scent-sim-mode';
const PHONE_NOTE_KEY = 'scent-sim-phone-note';
const WELCOME_KEY = 'scent-sim-welcome-seen';
/** Screens this narrow get the phone layout: Guided only, steps first. */
const PHONE_QUERY = '(max-width: 760px)';

/** True while the screen is phone-sized. */
function usePhone(): boolean {
  const query = () => typeof window !== 'undefined' && !!window.matchMedia?.(PHONE_QUERY).matches;
  const [phone, setPhone] = useState(query);
  useEffect(() => {
    const mq = window.matchMedia?.(PHONE_QUERY);
    if (!mq) return;
    const onChange = () => setPhone(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return phone;
}

function loadWelcomeSeen(): boolean {
  try {
    return localStorage.getItem(WELCOME_KEY) === '1';
  } catch {
    return false;
  }
}

function loadPhoneNoteHidden(): boolean {
  try {
    return sessionStorage.getItem(PHONE_NOTE_KEY) === '1';
  } catch {
    return false;
  }
}

/** A small JPEG of the map for the notebook report, or nothing if it can't be drawn. */
function mapSnapshot(): string | undefined {
  const src = document.querySelector<HTMLCanvasElement>('.sim-canvas canvas');
  if (!src || !src.width || !src.height) return undefined;
  try {
    const w = Math.min(480, src.width);
    const out = document.createElement('canvas');
    out.width = w;
    out.height = Math.round((src.height / src.width) * w);
    const ctx = out.getContext('2d');
    if (!ctx) return undefined;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(src, 0, 0, out.width, out.height);
    return out.toDataURL('image/jpeg', 0.7);
  } catch {
    return undefined;
  }
}

function loadMode(): Mode {
  try {
    return localStorage.getItem(MODE_KEY) === 'playground' ? 'playground' : 'guided';
  } catch {
    return 'guided';
  }
}

export default function App() {
  const [scenario, setScenario] = useState<Scenario>(SCENARIOS[0]);
  const [settings, setSettings] = useState<Settings>(() => structuredClone(SCENARIOS[0].settings));
  const [plan, setPlanState] = useState<TreatmentPlan>(() => structuredClone(SCENARIOS[0].plan));
  const [view, setView] = useState<ViewOptions>({ ...DEFAULT_VIEW, ...SCENARIOS[0].view });
  const [surveyLayer, setSurveyLayer] = useState<SurveyLayer>('camera');
  const [selectedSurveyId, setSelectedSurveyId] = useState<number | null>(null);
  const [instructor, setInstructor] = useState(false);
  const [tool, setTool] = useState<Tool>(() => defaultTool(SCENARIOS[0].settings.treatment));
  const [running, setRunning] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [pendingReset, setPendingReset] = useState(false);
  const [notice, setNotice] = useState<null | 'finished' | 'survey'>(null);
  const [tab, setTab] = useState<Tab>('results');
  const [entries, setEntries] = useState<NotebookEntry[]>(() => loadNotebook());
  const [activeEntryId, setActiveEntryId] = useState<string | null>(null);
  const [savedMode, setModeState] = useState<Mode>(loadMode);
  const phone = usePhone();
  // Phones always get Guided mode; the saved choice comes back on a bigger screen.
  const mode: Mode = phone ? 'guided' : savedMode;
  const [phoneNoteHidden, setPhoneNoteHidden] = useState(loadPhoneNoteHidden);
  const [step, setStepState] = useState<GuidedStep>('mission');
  const [prediction, setPrediction] = useState('');
  const [savedTo, setSavedTo] = useState<string | null>(null);
  const [loopOpen, setLoopOpen] = useState(false);
  const [welcomeOpen, setWelcomeOpen] = useState(() => !loadWelcomeSeen());
  const [, setTick] = useState(0);

  const simRef = useRef<Simulation>(new Simulation(settings, plan));
  const runningRef = useRef(running);
  const speedRef = useRef(speed);
  const finishAck = useRef(false);
  const surveysSeen = useRef(0);
  runningRef.current = running;
  speedRef.current = speed;

  useEffect(() => saveNotebook(entries), [entries]);

  const setMode = useCallback((m: Mode) => {
    setModeState(m);
    try {
      localStorage.setItem(MODE_KEY, m);
    } catch {
      // Private windows can block storage; the mode just won't be remembered.
    }
  }, []);

  const resetSim = useCallback((s: Settings, p: TreatmentPlan) => {
    simRef.current = new Simulation(s, p);
    finishAck.current = false;
    surveysSeen.current = 0;
    setSelectedSurveyId(null);
    setRunning(false);
    setPendingReset(false);
    setNotice(null);
    setSavedTo(null);
    setTick((t) => t + 1);
  }, []);

  // Main loop: step the simulation at the chosen speed.
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    let lastUi = 0;
    const frame = (now: number) => {
      const realDt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const sim = simRef.current;
      if (runningRef.current) {
        acc += realDt * BASE_SIM_SPEED * speedRef.current;
        let steps = Math.floor(acc / sim.dt);
        acc -= steps * sim.dt;
        steps = Math.min(steps, 600);
        for (let i = 0; i < steps; i++) {
          sim.step();
          if (sim.finished && !finishAck.current && !sim.surveying) {
            finishAck.current = true;
            setRunning(false);
            setNotice('finished');
            break;
          }
          if (sim.surveys.length > surveysSeen.current) {
            surveysSeen.current = sim.surveys.length;
            setSelectedSurveyId(null);
            setView((v) => ({ ...v, showSurvey: true }));
            setRunning(false);
            setNotice('survey');
            setTab('survey');
            break;
          }
        }
      } else acc = 0;
      if (now - lastUi > 200) {
        lastUi = now;
        setTick((t) => t + 1);
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  const updateSettings = useCallback(
    (next: Settings) => {
      const sim = simRef.current;
      setSettings(next);
      if (needsReset(sim.settings, next)) {
        if (sim.time === 0) resetSim(next, plan);
        else {
          setPendingReset(true);
          sim.updateSettings(liveSettings(sim.settings, next));
        }
      } else sim.updateSettings(next);
    },
    [plan, resetSim]
  );

  /**
   * Move to a Guided step. Only the Run step runs the simulation, so leaving it
   * pauses, and going back to Plan after a run starts the run over.
   */
  const setStep = useCallback(
    (next: GuidedStep) => {
      const sim = simRef.current;
      if (next !== 'run' && !sim.surveying) setRunning(false);
      if (next === 'plan' && sim.time > 0 && !sim.treatmentWaiting) resetSim(settings, plan);
      setStepState(next);
      // On a phone the page scrolls, so start each step at the top.
      if (phone) window.scrollTo(0, 0);
    },
    [resetSim, settings, plan, phone]
  );

  const setPlan = useCallback((p: TreatmentPlan) => {
    setPlanState(p);
    simRef.current.setPlan(p);
  }, []);

  const loadScenario = useCallback(
    (sc: Scenario) => {
      setScenario(sc);
      const s = structuredClone(sc.settings);
      const p = structuredClone(sc.plan);
      setSettings(s);
      setPlanState(p);
      setView({ ...DEFAULT_VIEW, ...sc.view });
      setTool(defaultTool(s.treatment));
      resetSim(s, p);
    },
    [resetSim]
  );

  const loadSetup = useCallback(
    (setup: EntrySetup) => {
      setSettings(structuredClone(setup.settings));
      setPlanState(structuredClone(setup.plan));
      const known = SCENARIOS.find((s) => s.name === setup.scenarioName);
      if (known) setScenario(known);
      setTool(defaultTool(setup.settings.treatment));
      resetSim(setup.settings, setup.plan);
    },
    [resetSim]
  );

  const startSurvey = useCallback(() => {
    simRef.current.startSurvey(true);
    setNotice(null);
    setRunning(true);
  }, []);

  const saveRunToNotebook = useCallback(
    (targetId?: string) => {
      const captured = captureRun(simRef.current, scenario.name, mapSnapshot());
      const wanted = targetId ?? activeEntryId;
      const target = entries.find((e) => e.id === wanted && (targetId !== undefined || !e.captured));
      // Guided mode carries the mission's question and the student's prediction into the notebook.
      const guided = mode === 'guided' ? { question: scenario.question, prediction: prediction.trim() } : null;
      if (target) {
        setEntries(
          entries.map((e) =>
            e.id === target.id
              ? { ...e, captured, question: e.question || guided?.question || '', prediction: e.prediction || guided?.prediction || '' }
              : e
          )
        );
        setSavedTo(target.name);
      } else {
        const e = { ...newEntry(nextName(entries)), ...guided, captured };
        setEntries([...entries, e]);
        setActiveEntryId(e.id);
        setSavedTo(e.name);
      }
      if (mode === 'playground') setTab('notebook');
      setNotice(null);
    },
    [scenario.name, scenario.question, activeEntryId, entries, mode, prediction]
  );

  const sim = simRef.current;
  const surveys = sim.surveys;
  const shownSurvey: SurveyResult | null = useMemo(() => {
    if (!surveys.length) return null;
    return surveys.find((s) => s.id === selectedSurveyId) ?? surveys[surveys.length - 1];
  }, [surveys.length, selectedSurveyId, surveys]);

  // Guided mode moves to the Compare step when a run finishes.
  useEffect(() => {
    if (notice === 'finished' && mode === 'guided') setStep('compare');
  }, [notice, mode]);

  const activeEntry = entries.find((e) => e.id === activeEntryId) ?? null;

  // Guided mode unlocks one thing at a time: drawing in Plan, running in Run.
  const guided = mode === 'guided';
  const canDraw = !guided || step === 'plan';
  const canRun = !guided || step === 'run';
  const mapTool: Tool = canDraw ? tool : 'none';
  const lockedNote = !guided
    ? undefined
    : step === 'mission' || step === 'predict'
      ? 'Preview of the field. You plan on it in step 3.'
      : step === 'plan'
        ? 'Draw your plan on the map. Run unlocks in the next step.'
        : 'Run finished. Pick what to do next on the left.';

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo" aria-hidden="true">
            <svg viewBox="0 0 32 32" width="30" height="30">
              <rect width="32" height="32" rx="7" fill="#2f8f4e" />
              <circle cx="16" cy="16" r="10" fill="#b98cf0" opacity=".75" />
              <circle cx="16" cy="16" r="4" fill="#fff" />
            </svg>
          </span>
          <div>
            <h1>Scent Dispersal Simulator</h1>
            <p className="tagline">Explore how drones and scents might help keep pests off crops.</p>
          </div>
        </div>
        <ScenarioSelector scenario={scenario} onLoad={loadScenario} pickable={mode === 'playground'} />
        {!phone && (
        <div className="mode-switch" role="tablist" aria-label="Mode">
          <button role="tab" aria-selected={mode === 'guided'} className={mode === 'guided' ? 'active' : ''} onClick={() => setMode('guided')}>
            🧭 Guided
          </button>
          <button role="tab" aria-selected={mode === 'playground'} className={mode === 'playground' ? 'active' : ''} onClick={() => setMode('playground')}>
            🛝 Playground
          </button>
        </div>
        )}
      </header>
      {phone && !phoneNoteHidden && !welcomeOpen && (
        <div className="phone-note" role="note">
          <span>📱 You can try the guided missions here. The full simulator works best on a tablet or computer.</span>
          <button
            className="link-btn"
            aria-label="Hide this note"
            onClick={() => {
              setPhoneNoteHidden(true);
              try {
                sessionStorage.setItem(PHONE_NOTE_KEY, '1');
              } catch {
                // Storage can be blocked; the note just comes back next time.
              }
            }}
          >
            ✕
          </button>
        </div>
      )}

      <main className={`layout ${mode}${guided ? ` step-${step}` : ''}${phone ? ' phone' : ''}`}>
        <aside className="panel left" aria-label={mode === 'guided' ? 'Steps' : 'Controls'}>
          {mode === 'guided' ? (
            <GuidedPanel
              step={step}
              onStep={setStep}
              scenario={scenario}
              onLoadScenario={(sc) => {
                if (sc.id !== scenario.id) setPrediction('');
                loadScenario(sc);
              }}
              prediction={prediction}
              onPrediction={setPrediction}
              settings={settings}
              plan={plan}
              tool={tool}
              sim={sim}
              running={running}
              onSettings={updateSettings}
              onPlan={setPlan}
              onTool={setTool}
              onSurvey={startSurvey}
              onSave={() => saveRunToNotebook()}
              saved={savedTo}
              entries={entries}
              onTryAgain={() => {
                resetSim(settings, plan);
                setStep('plan');
              }}
            />
          ) : (
            <ControlPanel
              settings={settings}
              plan={plan}
              tool={tool}
              simStarted={sim.time > 0}
              onSettings={updateSettings}
              onPlan={setPlan}
              onTool={setTool}
              onLoadScenario={loadScenario}
              scenario={scenario}
            />
          )}
        </aside>

        <section className="center">
          <Toolbar
            running={running}
            speed={speed}
            time={sim.time}
            duration={sim.durationSec}
            fieldTime={sim.fieldTime}
            flying={sim.droneFlying}
            surveying={sim.surveying}
            surveyProgress={sim.survey?.progress ?? 0}
            pendingReset={pendingReset}
            view={view}
            onRun={() => {
              setNotice(null);
              // A survey flown before the first Run only flies the survey drone;
              // pressing Run once it is done starts the treatment.
              if (!running && !simRef.current.surveying) simRef.current.startTreatment();
              if (!running && mode === 'guided' && !simRef.current.surveying) setStep('run');
              setRunning((r) => !r);
            }}
            onReset={() => resetSim(settings, plan)}
            onSpeed={setSpeed}
            onSurvey={startSurvey}
            onView={setView}
            showSurvey={mode === 'playground' || scenario.id === 'survey'}
            controls={canRun}
            lockedNote={lockedNote}
          />
          <div className="canvas-wrap">
            <SimulationCanvas
              simRef={simRef}
              view={view}
              surveyLayer={instructor ? surveyLayer : surveyLayer === 'truth' ? 'camera' : surveyLayer}
              survey={shownSurvey}
              tool={mapTool}
              plan={plan}
              settings={settings}
              onPlan={setPlan}
            />
            {guided && (step === 'mission' || step === 'predict') && sim.time === 0 && (
              <div className="preview-tag" aria-hidden="true">
                👀 Preview
              </div>
            )}
            {notice === 'finished' && mode === 'playground' && (
              <div className="notice" role="status">
                <strong>Run finished.</strong> What happened? Did it match your prediction?
                <div className="notice-actions">
                  <button className="btn primary" onClick={() => saveRunToNotebook()}>
                    📓 Save results to notebook
                  </button>
                  <button className="btn" onClick={() => { setNotice(null); simRef.current.startTreatment(); setRunning(true); }}>
                    Keep going
                  </button>
                  <button className="btn" onClick={() => resetSim(settings, plan)}>
                    Reset
                  </button>
                </div>
              </div>
            )}
            {notice === 'survey' && (
              <div className="notice" role="status">
                <strong>Survey finished.</strong> The colored squares are what the camera software thinks it saw. Is it right everywhere?
                <div className="notice-actions">
                  <button className="btn primary" onClick={() => { setNotice(null); if (mode === 'guided') setStep('plan'); }}>
                    Plan a treatment
                  </button>
                  {!guided && (
                    <button className="btn" onClick={() => { setNotice(null); simRef.current.startTreatment(); setRunning(true); }}>
                      Keep running
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
          <ExperimentPanel settings={settings} sim={sim} tool={mapTool} running={running} />
        </section>

        {mode === 'playground' && (
          <aside className="panel right" aria-label="Results and tools">
            <nav className="tabs" role="tablist">
              {(
                [
                  ['results', '📊', 'Results'],
                  ['survey', '🛰️', 'Survey'],
                  ['computer', '🤖', 'Computer'],
                  ['notebook', '📓', 'Notebook'],
                  ['learn', '💡', 'Learn']
                ] as Array<[Tab, string, string]>
              ).map(([k, icon, label]) => (
                <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'tab active' : 'tab'} onClick={() => setTab(k)}>
                  <span className="tab-icon" aria-hidden="true">{icon}</span>
                  {label}
                </button>
              ))}
            </nav>
            <div className="tab-body">
              {tab === 'results' && <ResultsPanel sim={sim} onSave={() => saveRunToNotebook()} />}
              {tab === 'survey' && (
                <SurveyPanel
                  sim={sim}
                  surveys={surveys}
                  shown={shownSurvey}
                  layer={surveyLayer}
                  instructor={instructor}
                  onInstructor={setInstructor}
                  onLayer={setSurveyLayer}
                  onSelect={setSelectedSurveyId}
                  onSurvey={startSurvey}
                  view={view}
                  onView={setView}
                />
              )}
              {tab === 'computer' && (
                <OptimizerPanel
                  settings={settings}
                  plan={plan}
                  surveys={surveys}
                  onSettings={updateSettings}
                  onUsePlan={(p) => {
                    setPlanState(p);
                    resetSim(settings, p);
                  }}
                />
              )}
              {tab === 'notebook' && (
                <NotebookPanel
                  entries={entries}
                  activeId={activeEntryId}
                  onActive={setActiveEntryId}
                  onEntries={setEntries}
                  onSaveRun={saveRunToNotebook}
                  onLoadSetup={loadSetup}
                  simTime={sim.time}
                />
              )}
              {tab === 'learn' && <HelpPanel />}
            </div>
            {activeEntry && tab !== 'notebook' && (
              <div className="active-entry">
                📓 Recording into <strong>{activeEntry.name}</strong>
                {activeEntry.prediction && <span className="muted"> · Prediction: “{activeEntry.prediction}”</span>}
              </div>
            )}
          </aside>
        )}
      </main>

      <footer className="footer">
        <span className="honesty">
          ⚠️ {MODEL_NOTE}{' '}
          <button className="link-btn inline" onClick={() => setLoopOpen(true)}>
            Why trust a simulator that isn't perfect? →
          </button>{' '}
          <button className="link-btn inline" onClick={() => setWelcomeOpen(true)}>
            👋 How this works
          </button>
        </span>
      </footer>
      <SimToRealDialog open={loopOpen} onClose={() => setLoopOpen(false)} />
      <WelcomeDialog
        open={welcomeOpen}
        phone={phone}
        onClose={() => {
          setWelcomeOpen(false);
          // The welcome already told phone users about bigger screens.
          if (phone) setPhoneNoteHidden(true);
          try {
            localStorage.setItem(WELCOME_KEY, '1');
          } catch {
            // Storage can be blocked; the welcome just shows again next visit.
          }
        }}
      />
    </div>
  );
}
