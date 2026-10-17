import { useState } from 'react';
import type { ViewOptions } from '../models/types';
import { formatFieldClock, formatFieldSpan, modelToFieldSec } from '../utils/fieldTime';
import { InfoButton } from './ui';

interface Props {
  running: boolean;
  speed: number;
  /** Model clock and run length, in model seconds (for the progress bar). */
  time: number;
  duration: number;
  /** Farm clock in seconds. */
  fieldTime: number;
  /** A drone is flying, so the clock runs in real time. */
  flying: boolean;
  /** The groomba is driving (shown faster than real time). */
  driving?: boolean;
  surveying: boolean;
  surveyProgress: number;
  pendingReset: boolean;
  view: ViewOptions;
  onRun: () => void;
  onReset: () => void;
  onSpeed: (s: number) => void;
  onSurvey: () => void;
  onView: (v: ViewOptions) => void;
  /** Show the Fly survey button (Guided mode hides it outside survey missions). */
  showSurvey?: boolean;
  /** Show Run, Reset and speed (Guided mode shows them only in the Run step). */
  controls?: boolean;
  /** Shown in place of the run buttons while they are locked. */
  lockedNote?: string;
  /** The run itself has begun (a survey flown first does not count). Default: the clock has moved. */
  started?: boolean;
  /** It is raining right now. */
  raining?: boolean;
  /** Rain in the forecast, as percent of the run (for marks on the clock bar). */
  rainMarks?: Array<{ left: number; width: number; day: number }>;
}

const SPEEDS = [1, 5, 20];

const LAYERS: Array<[keyof ViewOptions, string, string]> = [
  ['showPests', '🐞', 'Pests'],
  ['showScent', '💨', 'Scent'],
  ['showDamage', '🍂', 'Damage'],
  ['showSurvey', '🗺️', 'Survey map'],
  ['showPath', '✈️', 'Drone path']
];

export function Toolbar(p: Props) {
  const pct = Math.min(100, (p.time / Math.max(1, p.duration)) * 100);
  return (
    <div className="toolbar">
      {p.controls === false ? (
        <div className="toolbar-locked">{p.lockedNote}</div>
      ) : (
      <div className="toolbar-group">
        <button className={`btn big ${p.running ? 'pause' : 'run'}`} onClick={p.onRun}>
          {p.running ? '⏸ Pause' : (p.started ?? p.time > 0) ? '▶ Resume' : '▶ Run'}
        </button>
        <button className={`btn big ${p.pendingReset ? 'attention' : ''}`} onClick={p.onReset} title="Start this experiment over with the same settings and seed">
          ↺ Reset
        </button>
        <div className="speed" role="group" aria-label="Simulation speed">
          {SPEEDS.map((s) => (
            <button key={s} className={p.speed === s ? 'chip active' : 'chip'} onClick={() => p.onSpeed(s)}>
              {s}x
            </button>
          ))}
        </div>
      </div>
      )}
      <div className="clock" title="Time on the farm">
        {!p.running && p.time >= p.duration ? (
          <span className="clock-time">✓ All {formatFieldSpan(modelToFieldSec(p.duration))} done</span>
        ) : (
          <>
            <span className="clock-time">⏱ {formatFieldClock(p.fieldTime)}</span>
            <span className="clock-of">of {formatFieldSpan(modelToFieldSec(p.duration))}</span>
          </>
        )}
        <span className="clock-bar">
          <span style={{ width: `${pct}%` }} />
          {p.rainMarks?.map((r) => (
            <i key={r.day} className="rain-mark" style={{ left: `${r.left}%`, width: `${Math.max(0.8, r.width)}%` }} title={`Rain on Day ${r.day}`} />
          ))}
        </span>
      </div>
      {p.raining && <span className="clock-mode rain">🌧️ Raining</span>}
      <span className={`clock-mode ${p.flying ? 'real' : 'lapse'}`}>
        {p.driving ? '🤖 Groomba driving (10x)' : p.flying ? '🚁 Real time' : '⏩ Time-lapse'}
        <InfoButton topic="timeLapse" />
      </span>
      {p.showSurvey !== false && p.controls !== false && (
        <button className="btn survey-btn" onClick={p.onSurvey} disabled={p.surveying}>
          {p.surveying ? `🛰️ Scanning ${Math.round(p.surveyProgress * 100)}%` : '🛰️ Fly survey'}
        </button>
      )}
      <MapMenu view={p.view} onView={p.onView} />
      {p.pendingReset && <div className="reset-hint">Some changes start on the next Reset.</div>}
    </div>
  );
}

/** "Map" button with a small menu of what to show on the map. */
function MapMenu({ view, onView }: { view: ViewOptions; onView: (v: ViewOptions) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="map-menu">
      <button className="btn" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        👁 Map ▾
      </button>
      {open && (
        <>
          {/* Catches the click that closes the menu, so it never reaches the map. */}
          <div className="menu-backdrop" onPointerDown={() => setOpen(false)} />
          <div className="menu-pop" role="group" aria-label="What to show on the map">
            {LAYERS.map(([key, icon, label]) => (
              <label key={key} className="menu-item">
                <input type="checkbox" checked={view[key]} onChange={() => onView({ ...view, [key]: !view[key] })} />
                <span aria-hidden="true">{icon}</span> {label}
              </label>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
