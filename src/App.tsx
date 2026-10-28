import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Scenario, Settings, SurveyResult, TreatmentPlan, ViewOptions } from './models/types';
import { Simulation } from './simulation/Simulation';
import { GROOMBA_PLAYBACK } from './simulation/Groomba';
import { modelToFieldSec } from './utils/fieldTime';
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
import { NotebookDialog } from './components/NotebookDialog';
import { MapKey } from './components/MapKey';
import { TeamPage } from './components/TeamPage';
import { mapSnapshot } from './components/ui';
import {
  captureRun,
  describeChanges,
  loadNotebook,
  newEntry,
  newSessionRun,
  nextName,
  saveNotebook,
  type EntrySetup,
  type NotebookEntry,
  type SessionRun
} from './notebook/notebook';
import { SaveExperimentDialog, type ExperimentNotes } from './components/SaveExperimentDialog';

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
  if (method === 'spray' || method === 'pesticide') return 'zone';
  if (method === 'slowRelease' || method === 'pushPull') return 'repellent';
  return 'none';
}

type Tab = 'results' | 'survey' | 'computer' | 'notebook' | 'learn';
type Mode = 'guided' | 'playground' | 'team';

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

function loadMode(): Mode {
  // A link ending in #team opens the Team presentation page.
  if (typeof location !== 'undefined' && location.hash === '#team') return 'team';
  try {
    const m = localStorage.getItem(MODE_KEY);
    return m === 'playground' || m === 'team' ? m : 'guided';
  } catch {
    return 'guided';
  }
}

/** Guided starts with the no-treatment baseline; the Playground starts with Basic Field. */
function firstScenario(): Scenario {
  return (loadMode() === 'guided' && SCENARIOS.find((s) => s.id === 'baseline')) || SCENARIOS[0];
}

export default function App() {
  const [scenario, setScenario] = useState<Scenario>(firstScenario);
  const [settings, setSettings] = useState<Settings>(() => structuredClone(scenario.settings));
  const [plan, setPlanState] = useState<TreatmentPlan>(() => structuredClone(scenario.plan));
  const [view, setView] = useState<ViewOptions>(() => ({ ...DEFAULT_VIEW, ...scenario.view }));
  const [surveyLayer, setSurveyLayer] = useState<SurveyLayer>('camera');
  const [selectedSurveyId, setSelectedSurveyId] = useState<number | null>(null);
  const [instructor, setInstructor] = useState(false);
  const [tool, setTool] = useState<Tool>(() => scenario.startTool ?? defaultTool(scenario.settings.treatment));
  const [running, setRunning] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [pendingReset, setPendingReset] = useState(false);
  const [notice, setNotice] = useState<null | 'finished' | 'survey'>(null);
  const [tab, setTab] = useState<Tab>('results');
  const [entries, setEntries] = useState<NotebookEntry[]>(() => loadNotebook());
  const [activeEntryId, setActiveEntryId] = useState<string | null>(null);
  // Runs from this visit (for Compare), and which one the map is showing now.
  const [sessionRuns, setSessionRuns] = useState<SessionRun[]>([]);
  const [currentRunId, setCurrentRunId] = useState<string | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [savedMode, setModeState] = useState<Mode>(loadMode);
  const phone = usePhone();
  // Phones get Guided mode (or the Team page, if that is open); the saved choice comes back on a bigger screen.
  const mode: Mode = phone && savedMode === 'playground' ? 'guided' : savedMode;
  const [phoneNoteHidden, setPhoneNoteHidden] = useState(loadPhoneNoteHidden);
  const [step, setStepState] = useState<GuidedStep>('mission');
  const [prediction, setPrediction] = useState('');
  const [guess, setGuess] = useState<number | null>(null);
  const [savedTo, setSavedTo] = useState<string | null>(null);
  const [loopOpen, setLoopOpen] = useState(false);
  const [welcomeOpen, setWelcomeOpen] = useState(() => !loadWelcomeSeen());
  const [notebookOpen, setNotebookOpen] = useState(false);
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

  /**
   * Start the run over. Surveys flown before the run are kept (unless
   * `fresh`), so trying a new plan does not mean flying the survey again.
   */
  const resetSim = useCallback((s: Settings, p: TreatmentPlan, fresh = false) => {
    const next = new Simulation(s, p);
    const kept = fresh ? 0 : next.adoptSurveysFrom(simRef.current);
    simRef.current = next;
    finishAck.current = false;
    surveysSeen.current = kept;
    setSelectedSurveyId(null);
    setRunning(false);
    setPendingReset(false);
    setNotice(null);
    setSavedTo(null);
    setCurrentRunId(null);
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
        // The groomba's drives take hours, so they play faster than the drone's flights.
        acc += realDt * BASE_SIM_SPEED * speedRef.current * (sim.groombaDriving ? GROOMBA_PLAYBACK : 1);
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
        if (!sim.runStarted) resetSim(next, plan);
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
      if (next === 'plan' && sim.runStarted) resetSim(settings, plan);
      setStepState(next);
      // Compare reveals where the pests really were on a mission that hides them.
      if (scenario.view?.showPests === false) setSurveyLayer(next === 'compare' ? 'truth' : 'camera');
      // On a phone the page scrolls, so start each step at the top.
      if (phone) window.scrollTo(0, 0);
    },
    [resetSim, settings, plan, phone, scenario]
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
      setTool(sc.startTool ?? defaultTool(s.treatment));
      resetSim(s, p, true);
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
      resetSim(setup.settings, setup.plan, true);
    },
    [resetSim]
  );

  /**
   * Switch modes. Guided missions are meant to run with their own settings,
   * so entering Guided reloads the current mission fresh: anything changed in
   * the Playground (pest count, scent, drone, costs, map layers, instructor
   * view) is put back, and the steps start over at Mission.
   */
  const switchMode = useCallback(
    (m: Mode) => {
      if (m === mode) return;
      setMode(m);
      setRunning(false);
      try {
        history.replaceState(null, '', m === 'team' ? '#team' : location.pathname + location.search);
      } catch {
        // Some embeds block history changes; the page still switches.
      }
      if (m === 'guided') {
        loadScenario(scenario);
        setInstructor(false);
        setSurveyLayer('camera');
        setPrediction('');
        setGuess(null);
        setStepState('mission');
      }
    },
    [mode, setMode, loadScenario, scenario]
  );

  const startSurvey = useCallback(() => {
    simRef.current.startSurvey(true);
    setNotice(null);
    setRunning(true);
  }, []);

  /** Remember the run on the map in this visit's runs (not the notebook), once. */
  const recordRun = useCallback((): SessionRun => {
    const existing = sessionRuns.find((r) => r.id === currentRunId);
    if (existing) return existing;
    const run = newSessionRun(captureRun(simRef.current, scenario.name, mapSnapshot()), sessionRuns.length);
    setSessionRuns((list) => [...list, run]);
    setCurrentRunId(run.id);
    return run;
  }, [sessionRuns, currentRunId, scenario.name]);

  /** Open the notebook page for the run on the map. */
  const openSave = useCallback(() => {
    if (!simRef.current.runStarted) return;
    recordRun();
    setNotice(null);
    setSaveOpen(true);
  }, [recordRun]);

  const currentRun = sessionRuns.find((r) => r.id === currentRunId) ?? null;
  // An experiment the student started in the notebook but has no results yet: the save fills it in.
  const startedEntry = entries.find((e) => e.id === activeEntryId && !e.captured) ?? null;
  const saveInitial: ExperimentNotes = {
    name: startedEntry?.name ?? nextName(entries),
    question: startedEntry?.question || (mode === 'guided' ? scenario.question : ''),
    prediction:
      startedEntry?.prediction ||
      (mode === 'guided' ? [prediction.trim(), guess === null ? '' : `My guess: ${guess}% of the crop protected.`].filter(Boolean).join(' ') : ''),
    variablesChanged: startedEntry?.variablesChanged ?? '',
    variablesSame: startedEntry?.variablesSame ?? '',
    result: '',
    surprise: '',
    next: '',
    realWorld: ''
  };
  // What changed since the previous run on this mission, as a hint for "Variables changed".
  const missionRuns = sessionRuns.filter((r) => r.captured.scenarioName === scenario.name);
  const previousRun = currentRun ? missionRuns[missionRuns.indexOf(currentRun) - 1] : missionRuns[missionRuns.length - 1];
  const changeHint =
    currentRun && previousRun ? describeChanges(previousRun.captured, currentRun.captured).join('; ') : '';

  /** Save the run as a notebook experiment with the student's notes. */
  const saveExperiment = useCallback(
    (notes: ExperimentNotes) => {
      const run = sessionRuns.find((r) => r.id === currentRunId);
      if (!run) return;
      const target = entries.find((e) => e.id === activeEntryId && !e.captured);
      let id: string;
      if (target) {
        id = target.id;
        setEntries(entries.map((e) => (e.id === target.id ? { ...e, ...notes, captured: run.captured } : e)));
      } else {
        const e = { ...newEntry(notes.name), ...notes, captured: run.captured };
        id = e.id;
        setEntries([...entries, e]);
      }
      setSessionRuns((list) => list.map((r) => (r.id === run.id ? { ...r, entryId: id } : r)));
      setActiveEntryId(id);
      setSavedTo(notes.name);
      setSaveOpen(false);
    },
    [sessionRuns, currentRunId, entries, activeEntryId]
  );

  /** Put the run on the map into an experiment the student picked in the notebook. */
  const saveRunToNotebook = useCallback(
    (targetId?: string) => {
      const captured = captureRun(simRef.current, scenario.name, mapSnapshot());
      const wanted = targetId ?? activeEntryId;
      const target = entries.find((e) => e.id === wanted && (targetId !== undefined || !e.captured));
      // Guided mode carries the mission's question and the student's prediction into the notebook.
      const guessText = guess === null ? '' : `My guess: ${guess}% of the crop protected.`;
      const guided =
        mode === 'guided' ? { question: scenario.question, prediction: [prediction.trim(), guessText].filter(Boolean).join(' ') } : null;
      if (target) {
        setEntries(
          entries.map((e) =>
            e.id === target.id
              ? { ...e, captured, question: e.question || guided?.question || '', prediction: e.prediction || guided?.prediction || '' }
              : e
          )
        );
        setActiveEntryId(target.id);
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
    [scenario.name, scenario.question, activeEntryId, entries, mode, prediction, guess]
  );

  const sim = simRef.current;
  const surveys = sim.surveys;
  // Guided Compare on a mission that hides the pests: show them, and allow the "real pests" survey layer.
  const revealing = mode === 'guided' && step === 'compare' && sim.runStarted && scenario.view?.showPests === false;
  const mapView = revealing ? { ...view, showPests: true } : view;
  // Where the forecast rain falls on the clock bar (farm time, ignoring the short real-time flights).
  const runFieldSec = modelToFieldSec(sim.durationSec);
  const rainMarks = sim.rains.map((r) => ({ day: r.day, left: (r.start / runFieldSec) * 100, width: ((r.end - r.start) / runFieldSec) * 100 }));
  const shownSurvey: SurveyResult | null = useMemo(() => {
    if (!surveys.length) return null;
    return surveys.find((s) => s.id === selectedSurveyId) ?? surveys[surveys.length - 1];
  }, [surveys.length, selectedSurveyId, surveys]);

  // A finished run is remembered for Compare (not saved to the notebook: the
  // student decides that). Guided mode then moves to the Compare step.
  useEffect(() => {
    if (notice !== 'finished') return;
    recordRun();
    if (mode === 'guided') setStep('compare');
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
        : step === 'compare'
          ? 'Run finished. Your results are in step 5, Compare.'
          : 'Run the experiment with the buttons here.';

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
        {mode !== 'team' && <ScenarioSelector scenario={scenario} onLoad={loadScenario} pickable={mode === 'playground'} />}
        {(!phone || mode === 'team') && (
        <div className="mode-switch" role="tablist" aria-label="Mode">
          <button role="tab" aria-selected={mode === 'guided'} className={mode === 'guided' ? 'active' : ''} onClick={() => switchMode('guided')}>
            🧭 Guided
          </button>
          <button role="tab" aria-selected={mode === 'playground'} className={mode === 'playground' ? 'active' : ''} onClick={() => switchMode('playground')}>
            🛝 Playground
          </button>
          <button role="tab" aria-selected={mode === 'team'} className={mode === 'team' ? 'active' : ''} onClick={() => switchMode('team')}>
            🎤 Team presentation
          </button>
        </div>
        )}
      </header>
      {phone && mode !== 'team' && !phoneNoteHidden && !welcomeOpen && (
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

      {mode === 'team' ? (
        <TeamPage />
      ) : (
      <main className={`layout ${mode}${guided ? ` step-${step}` : ''}${phone ? ' phone' : ''}`}>
        <aside className="panel left" aria-label={mode === 'guided' ? 'Steps' : 'Controls'}>
          {mode === 'guided' ? (
            <GuidedPanel
              step={step}
              onStep={setStep}
              scenario={scenario}
              onLoadScenario={(sc) => {
                if (sc.id !== scenario.id) {
                  setPrediction('');
                  setGuess(null);
                }
                loadScenario(sc);
              }}
              prediction={prediction}
              onPrediction={setPrediction}
              guess={guess}
              onGuess={setGuess}
              settings={settings}
              plan={plan}
              tool={tool}
              sim={sim}
              running={running}
              onSettings={updateSettings}
              onPlan={setPlan}
              onTool={setTool}
              onSurvey={startSurvey}
              onSave={openSave}
              saved={savedTo}
              sessionRuns={sessionRuns}
              currentRunId={currentRunId}
              entries={entries}
              activeEntryId={activeEntryId}
              onUpdateEntry={(id, patch) => setEntries((list) => list.map((e) => (e.id === id ? { ...e, ...patch } : e)))}
              onOpenNotebook={() => setNotebookOpen(true)}
              surveyLayer={surveyLayer}
              onSurveyLayer={setSurveyLayer}
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
              simStarted={sim.runStarted}
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
            driving={sim.groombaDriving}
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
            // In Guided the survey is flown from the Plan step: once the run starts the plan can't change.
            showSurvey={mode === 'playground'}
            started={sim.runStarted}
            raining={sim.raining}
            rainMarks={rainMarks}
            controls={canRun}
            lockedNote={lockedNote}
          />
          <div className="canvas-wrap">
            <SimulationCanvas
              simRef={simRef}
              view={mapView}
              surveyLayer={instructor || revealing ? surveyLayer : surveyLayer === 'truth' ? 'camera' : surveyLayer}
              survey={shownSurvey}
              tool={mapTool}
              plan={plan}
              settings={settings}
              onPlan={setPlan}
            />
            {guided && (step === 'mission' || step === 'predict') && !sim.runStarted && (
              <div className="preview-tag" aria-hidden="true">
                👀 Preview
              </div>
            )}
            {notice === 'finished' && mode === 'playground' && (
              <div className="notice" role="status">
                <strong>Run finished.</strong> What happened? Did it match your prediction?
                <div className="notice-actions">
                  <button className="btn primary" onClick={openSave}>
                    📓 Save this experiment
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
                <strong>Survey finished.</strong> The colored squares are what the camera software thinks it saw. It may be wrong in places.
                <div className="notice-actions">
                  <button className="btn primary" onClick={() => { setNotice(null); if (mode === 'guided') setStep('plan'); }}>
                    {guided ? 'Got it' : 'Plan a treatment'}
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
          <MapKey settings={settings} view={mapView} survey={!!shownSurvey} onSpotlight={(g) => setView((v) => ({ ...v, spotlight: g }))} />
          <ExperimentPanel settings={settings} sim={sim} tool={mapTool} running={running} canRun={canRun} detailed={!guided} />
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
              {tab === 'results' && <ResultsPanel sim={sim} onSave={openSave} saved={currentRun?.entryId ? savedTo : null} />}
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
      )}

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
      <SaveExperimentDialog
        open={saveOpen}
        run={currentRun?.captured ?? null}
        initial={saveInitial}
        changeHint={changeHint}
        updating={!!startedEntry}
        onSave={saveExperiment}
        onClose={() => setSaveOpen(false)}
      />
      {guided && (
        <NotebookDialog open={notebookOpen} onClose={() => setNotebookOpen(false)}>
          <NotebookPanel
            entries={entries}
            activeId={activeEntryId}
            onActive={setActiveEntryId}
            onEntries={setEntries}
            onSaveRun={(id) => saveRunToNotebook(id)}
            onLoadSetup={(setup) => {
              // Loading a saved setup is "change one thing and run again": go straight to Plan.
              loadSetup(setup);
              setSavedTo(null);
              setNotebookOpen(false);
              setStepState('plan');
            }}
            simTime={sim.time}
          />
        </NotebookDialog>
      )}
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
