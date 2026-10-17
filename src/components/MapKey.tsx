import { useState, type ReactNode } from 'react';
import type { Settings, ViewOptions } from '../models/types';
import { COLORS } from '../render/drawScene';
import { deviceReachM } from '../simulation/Treatment';

const KEY_OPEN = 'scent-sim-key-open';

const rgb = (c: readonly number[], a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

/** Small pictures that match what the map draws. */
const Dot = ({ color }: { color: string }) => (
  <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
    <circle cx="9" cy="9" r="4" fill={color} />
  </svg>
);
const Patch = ({ fill, stroke, dashed }: { fill: string; stroke?: string; dashed?: boolean }) => (
  <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
    <rect x="2" y="3" width="14" height="12" rx="2" fill={fill} stroke={stroke ?? 'none'} strokeWidth="1.5" strokeDasharray={dashed ? '3 2' : undefined} />
  </svg>
);
const Cloud = ({ color }: { color: readonly number[] }) => (
  <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
    <defs>
      <radialGradient id={`g${color.join('')}`}>
        <stop offset="0" stopColor={rgb(color, 0.85)} />
        <stop offset="1" stopColor={rgb(color, 0)} />
      </radialGradient>
    </defs>
    <circle cx="9" cy="9" r="8.5" fill={`url(#g${color.join('')})`} />
  </svg>
);
const Device = ({ color, letter, waiting, trap }: { color: readonly number[]; letter: string; waiting?: boolean; trap?: boolean }) => {
  const dark = `rgb(${color[0] * 0.6},${color[1] * 0.6},${color[2] * 0.6})`;
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      {trap && <circle cx="9" cy="9" r="8" fill="none" stroke={dark} strokeWidth="1.2" />}
      <circle cx="9" cy="9" r={trap ? 5 : 6.5} fill={waiting ? '#fff' : rgb(color)} stroke={dark} strokeWidth="1.3" strokeDasharray={waiting ? '2 1.5' : undefined} />
      <text x="9" y="12.2" textAnchor="middle" fontSize={trap ? 7 : 8.5} fontWeight="700" fill={waiting ? dark : '#fff'}>
        {letter}
      </text>
    </svg>
  );
};
const Ring = ({ color }: { color: readonly number[] }) => (
  <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
    <circle cx="9" cy="9" r="7.5" fill={rgb(color, 0.08)} stroke={rgb(color.map((c) => c * 0.7), 0.8)} strokeWidth="1.2" strokeDasharray="2.5 2" />
  </svg>
);
const Line = ({ color, dashed }: { color: string; dashed?: boolean }) => (
  <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
    <path d="M2 13 L8 6 L16 9" fill="none" stroke={color} strokeWidth="1.8" strokeDasharray={dashed ? '2.5 2' : undefined} />
  </svg>
);
const Home = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
    <circle cx="9" cy="9" r="7" fill="#f8fafc" stroke="#334155" strokeWidth="1.2" />
    <text x="9" y="12.3" textAnchor="middle" fontSize="9" fontWeight="700" fill="#334155">
      H
    </text>
  </svg>
);
const Crop = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
    <rect x="2" y="3" width="14" height="12" rx="2" fill={COLORS.crop} />
    <path d="M2 6.5 H16 M2 10 H16 M2 13.5 H16" stroke={COLORS.cropRow} strokeWidth="1.2" />
  </svg>
);

interface Props {
  settings: Settings;
  view: ViewOptions;
  /** A survey map is on screen. */
  survey: boolean;
}

function loadOpen(): boolean {
  try {
    const v = localStorage.getItem(KEY_OPEN);
    if (v !== null) return v === '1';
  } catch {
    // Storage can be blocked; fall back to the default.
  }
  return true;
}

/** Map key: says what each color and mark on the map means, showing only what this setup can draw. */
export function MapKey({ settings: s, view, survey }: Props) {
  const [open, setOpenState] = useState(loadOpen);
  const setOpen = (o: boolean) => {
    setOpenState(o);
    try {
      localStorage.setItem(KEY_OPEN, o ? '1' : '0');
    } catch {
      // The choice just won't be remembered.
    }
  };
  const t = s.treatment;
  const treated = t !== 'none';
  const devices = t === 'slowRelease' || t === 'pushPull';
  const ignorers = treated && (s.scent.effectivenessPct ?? 100) < 100;

  const rows: Array<[ReactNode, string]> = [];
  if (view.showPests) {
    rows.push([<Dot color={COLORS.pest} />, 'Pest (flying or eating)']);
    if (treated) rows.push([<Dot color={COLORS.pestAgitated} />, 'Pest bothered by repellent']);
    if (ignorers) rows.push([<Dot color={COLORS.pestIgnores} />, 'Pest that ignores the scent']);
  }
  rows.push([<Crop />, 'Crop']);
  rows.push([<Patch fill={COLORS.grass} />, 'Grass (no crop)']);
  if (view.showDamage) rows.push([<Patch fill={rgb(COLORS.damage, 0.8)} />, 'Crop eaten by pests']);
  if (view.showScent && treated) rows.push([<Cloud color={COLORS.repellent} />, 'Repellent scent (darker = stronger)']);
  if (view.showScent && t === 'pushPull') rows.push([<Cloud color={COLORS.attractant} />, 'Attractant scent']);
  if (t === 'spray') {
    rows.push([<Patch fill="rgba(37,99,235,0.1)" stroke={COLORS.zone} dashed />, 'Spray zone you drew']);
    rows.push([<Dot color="rgba(96,165,250,0.8)" />, 'Spray coming out of the drone']);
  }
  if (devices) {
    rows.push([<Device color={COLORS.repellent} letter="R" />, 'Repellent device']);
    if (t === 'pushPull') {
      rows.push([<Device color={COLORS.attractant} letter="A" />, 'Attractant device']);
      rows.push([<Device color={COLORS.attractant} letter="A" trap />, 'Attractant with a trap']);
    }
    rows.push([<Device color={COLORS.repellent} letter="R" waiting />, 'Device not dropped yet']);
    rows.push([<Ring color={COLORS.repellent} />, `Dashed circle: how far a repellent reaches (${s.scent.rangeM} m) with no wind`]);
    if (t === 'pushPull')
      rows.push([<Ring color={COLORS.attractant} />, `Dashed circle: how far pests notice an attractant (${deviceReachM('attractant', s.scent.rangeM)} m)`]);
  }
  if (treated) rows.push([<Home />, "Drone's home pad"]);
  if (view.showPath && treated) {
    rows.push([<Line color="rgba(30,41,59,0.45)" />, 'Where the drone has flown']);
    rows.push([<Line color="rgba(37,99,235,0.8)" dashed />, 'Where it will fly next']);
  }
  if (s.wind.speedMph > 0) rows.push([<Line color="#94a3b8" />, 'White streaks show the wind']);
  if (survey && view.showSurvey) {
    rows.push([<Patch fill={COLORS.survey.healthy} />, 'Survey: looks healthy']);
    rows.push([<Patch fill={COLORS.survey.possible} />, 'Survey: maybe pests']);
    rows.push([<Patch fill={COLORS.survey.high} />, 'Survey: lots of pests']);
    rows.push([<Patch fill={COLORS.survey.uncertain} />, "Survey: camera couldn't tell"]);
  }

  return (
    <div className={`map-key ${open ? 'open' : ''}`}>
      <button className="map-key-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? '▾' : '▸'} Map key
      </button>
      {open && (
        <ul className="map-key-list">
          {rows.map(([icon, label]) => (
            <li key={label}>
              {icon}
              <span>{label}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
