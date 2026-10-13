import { useState } from 'react';
import type { ViewOptions } from '../models/types';
import { formatClock } from '../utils/units';

interface Props {
  running: boolean;
  speed: number;
  time: number;
  duration: number;
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
      <div className="toolbar-group">
        <button className={`btn big ${p.running ? 'pause' : 'run'}`} onClick={p.onRun}>
          {p.running ? '⏸ Pause' : p.time > 0 ? '▶ Resume' : '▶ Run'}
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
      <div className="clock" title="Simulated time (minutes:seconds)">
        <span className="clock-time">⏱ {formatClock(p.time)}</span>
        <span className="clock-of">of {formatClock(p.duration)}</span>
        <span className="clock-bar">
          <span style={{ width: `${pct}%` }} />
        </span>
      </div>
      {p.showSurvey !== false && (
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
