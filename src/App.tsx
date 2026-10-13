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
import { HONESTY_NOTE } from './content/help';
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
  const [, setTick] = useState(0);

  const simRef = useRef<Simulation>(new Simulation(settings, plan));
  const runningRef = useRef(running);
  const speedRef = useRef(speed);
  const finishAck = useRef(false);
  const surveysSeen = useRef(0);
  runningRef.current = running;
  speedRef.current = speed;

  useEffect(() => saveNotebook(entries), [entries]);

  const resetSim = useCallback((s: Settings, p: TreatmentPlan) => {
    simRef.current = new Simulation(s, p);
    finishAck.current = false;
    surveysSeen.current = 0;
    setSelectedSurveyId(null);
    setRunning(false);
    setPendingReset(false);
    setNotice(null);
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
          if (sim.finished && !finishAck.current) {
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
      resetSim(setup.settings, setup.plan);
    },
    [resetSim]
  );

  const startSurvey = useCallback(() => {
    simRef.current.startSurvey();
    setNotice(null);
    setRunning(true);
  }, []);

  const saveRunToNotebook = useCallback(() => {
    const captured = captureRun(simRef.current, scenario.name);
    setEntries((list) => {
      const target = list.find((e) => e.id === activeEntryId && !e.captured);
      if (target) return list.map((e) => (e.id === target.id ? { ...e, captured } : e));
      const e = { ...newEntry(nextName(list)), captured };
      setActiveEntryId(e.id);
      return [...list, e];
    });
    setTab('notebook');
    setNotice(null);
  }, [scenario.name, activeEntryId]);

  const sim = simRef.current;
  const surveys = sim.surveys;
  const shownSurvey: SurveyResult | null = useMemo(() => {
    if (!surveys.length) return null;
    return surveys.find((s) => s.id === selectedSurveyId) ?? surveys[surveys.length - 1];
  }, [surveys.length, selectedSurveyId, surveys]);

  const activeEntry = entries.find((e) => e.id === activeEntryId) ?? null;

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
        <ScenarioSelector scenario={scenario} onLoad={loadScenario} />
      </header>

      <main className="layout">
        <aside className="panel left" aria-label="Controls">
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
        </aside>

        <section className="center">
          <Toolbar
            running={running}
            speed={speed}
            time={sim.time}
            duration={sim.durationSec}
            surveying={sim.surveying}
            surveyProgress={sim.survey?.progress ?? 0}
            pendingReset={pendingReset}
            view={view}
            onRun={() => {
              setNotice(null);
              setRunning((r) => !r);
            }}
            onReset={() => resetSim(settings, plan)}
            onSpeed={setSpeed}
            onSurvey={startSurvey}
            onView={setView}
          />
          <div className="canvas-wrap">
            <SimulationCanvas
              simRef={simRef}
              view={view}
              surveyLayer={instructor ? surveyLayer : surveyLayer === 'truth' ? 'camera' : surveyLayer}
              survey={shownSurvey}
              tool={tool}
              plan={plan}
              settings={settings}
              onPlan={setPlan}
            />
            {notice === 'finished' && (
              <div className="notice" role="status">
                <strong>Run finished.</strong> What happened? Did it match your prediction?
                <div className="notice-actions">
                  <button className="btn primary" onClick={saveRunToNotebook}>
                    📓 Save results to notebook
                  </button>
                  <button className="btn" onClick={() => { setNotice(null); setRunning(true); }}>
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
                  <button className="btn primary" onClick={() => setNotice(null)}>
                    Plan a treatment
                  </button>
                  <button className="btn" onClick={() => { setNotice(null); setRunning(true); }}>
                    Keep running
                  </button>
                </div>
              </div>
            )}
          </div>
          <ExperimentPanel settings={settings} sim={sim} tool={tool} running={running} />
        </section>

        <aside className="panel right" aria-label="Results and tools">
          <nav className="tabs" role="tablist">
            {(
              [
                ['results', '📊 Results'],
                ['survey', '🛰️ Survey'],
                ['computer', '🤖 Computer'],
                ['notebook', '📓 Notebook'],
                ['learn', '💡 Learn']
              ] as Array<[Tab, string]>
            ).map(([k, label]) => (
              <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'tab active' : 'tab'} onClick={() => setTab(k)}>
                {label}
              </button>
            ))}
          </nav>
          <div className="tab-body">
            {tab === 'results' && <ResultsPanel sim={sim} onSave={saveRunToNotebook} />}
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
      </main>

      <footer className="footer">
        <span className="honesty">⚠️ {HONESTY_NOTE}</span>
      </footer>
    </div>
  );
}
