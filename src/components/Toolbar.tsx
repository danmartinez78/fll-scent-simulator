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
}

const SPEEDS = [1, 2, 5, 10, 20];

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
      <button className="btn survey-btn" onClick={p.onSurvey} disabled={p.surveying}>
        {p.surveying ? `🛰️ Scanning ${Math.round(p.surveyProgress * 100)}%` : '🛰️ Fly survey'}
      </button>
      <div className="layers" role="group" aria-label="What to show on the map">
        {LAYERS.map(([key, icon, label]) => (
          <button
            key={key}
            className={p.view[key] ? 'chip active' : 'chip'}
            aria-pressed={p.view[key]}
            title={`Show or hide: ${label}`}
            onClick={() => p.onView({ ...p.view, [key]: !p.view[key] })}
          >
            {icon} {label}
          </button>
        ))}
      </div>
      {p.pendingReset && <div className="reset-hint">Some changes start on the next Reset.</div>}
    </div>
  );
}
