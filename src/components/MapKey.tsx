import { useState, type ReactNode } from 'react';
import type { InsectGroup, Settings, ViewOptions } from '../models/types';
import { COLORS } from '../render/drawScene';
import { deviceReachM } from '../simulation/Treatment';
import { usesGroomba } from '../simulation/Groomba';

const KEY_OPEN = 'scent-sim-key-open';

const rgb = (c: readonly number[], a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

/** Small pictures that match what the map draws. */
const Dot = ({ color }: { color: string }) => (
  <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
    <circle cx="9" cy="9" r="4" fill={color} />
  </svg>
);
/** A pest as the map draws it: an oval body with two feelers. */
const Bug = ({ color }: { color: string }) => (
  <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
    <ellipse cx="9" cy="10.5" rx="3.2" ry="4.8" fill={color} />
    <path d="M8 7 L5.6 2.8 M10 7 L12.4 2.8" stroke={color} strokeWidth="1.3" strokeLinecap="round" />
  </svg>
);
/** A bee: yellow with a black stripe. */
const Bee = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
    <ellipse cx="9" cy="9" rx="6.5" ry="4.5" fill={COLORS.bee} stroke="#111827" strokeWidth="1" />
    <rect x="8" y="4.6" width="2" height="8.8" fill="#111827" />
  </svg>
);
/** A ladybug: red with two spots and a line down its back. */
const Ladybug = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
    <circle cx="9" cy="9" r="5.5" fill={COLORS.ladybug} stroke="#111827" strokeWidth="1" />
    <path d="M9 3.5 V14.5" stroke="#111827" strokeWidth="1" />
    <circle cx="6.6" cy="9.6" r="1.2" fill="#111827" />
    <circle cx="11.4" cy="9.6" r="1.2" fill="#111827" />
  </svg>
);
/** The groomba as the map draws it: a white rover with a spray bar. */
const Rover = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
    <rect x="3" y="3" width="4" height="2.5" fill="#334155" />
    <rect x="11" y="3" width="4" height="2.5" fill="#334155" />
    <rect x="3" y="12.5" width="4" height="2.5" fill="#334155" />
    <rect x="11" y="12.5" width="4" height="2.5" fill="#334155" />
    <rect x="2" y="5" width="14" height="8" rx="2.5" fill="#fff" stroke="#1f2937" strokeWidth="1.2" />
    <rect x="13" y="5.8" width="1.6" height="6.4" fill="#3b82f6" />
  </svg>
);
const Tracks = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
    <path d="M1 7h16M1 11h16" stroke="rgba(120,72,32,0.75)" strokeWidth="1.4" />
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
const Cross = ({ color }: { color: string }) => (
  <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
    <path d="M5 5 L13 13 M13 5 L5 13" stroke={color} strokeWidth="2" />
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
  /** Tapping an insect in the key shows that group and fades the other one; tapping it again shows all. */
  onSpotlight?: (group: InsectGroup | null) => void;
}

const GROUP_NAME: Record<InsectGroup, string> = { pests: 'pests', helpers: 'bees and ladybugs' };

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
export function MapKey({ settings: s, view, survey, onSpotlight }: Props) {
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

  // Insects come first, one entry per kind, and can be tapped to put that kind in the spotlight.
  const insects: Array<{ group: InsectGroup; title: string; items: Array<[ReactNode, string]> }> = [];
  if (view.showPests) {
    const items: Array<[ReactNode, string]> = [[<Bug color={COLORS.pest} />, 'eating or flying']];
    if (treated) items.push([<Bug color={COLORS.pestAgitated} />, 'pushed away by repellent']);
    if (ignorers) items.push([<Bug color={COLORS.pestIgnores} />, 'ignores the scent']);
    insects.push({ group: 'pests', title: 'Pests', items });
  }
  if (s.helpers?.count) {
    insects.push({
      group: 'helpers',
      title: 'Helpful insects',
      items: [
        [<Bee />, 'bee'],
        [<Ladybug />, 'ladybug (eats pests)']
      ]
    });
  }
  const spot = view.spotlight ?? null;
  const rows: Array<[ReactNode, string]> = [];
  if (treated) rows.push([<Cross color={COLORS.ladybug} />, 'Red ×: a bee or ladybug was killed here']);
  if (t === 'pesticide') {
    rows.push([<Cross color="rgba(17,24,39,0.7)" />, 'Black ×: a pest was killed by pesticide']);
    if (view.showScent) rows.push([<Cloud color={COLORS.pesticide} />, 'Pesticide on the plants (kills insects)']);
  }
  rows.push([<Crop />, 'Crop']);
  rows.push([<Patch fill={COLORS.grass} />, 'Grass (no crop)']);
  if (view.showDamage) rows.push([<Patch fill={rgb(COLORS.damage, 0.8)} />, 'Crop eaten by pests']);
  if (view.showScent && treated) rows.push([<Cloud color={COLORS.repellent} />, 'Repellent scent (darker = stronger)']);
  if (view.showScent && t === 'pushPull') rows.push([<Cloud color={COLORS.attractant} />, 'Attractant scent']);
  if (t === 'spray' || t === 'pesticide') {
    rows.push([<Patch fill="rgba(37,99,235,0.1)" stroke={COLORS.zone} dashed />, 'Spray zone you drew']);
    rows.push([<Dot color="rgba(96,165,250,0.8)" />, usesGroomba(s) ? 'Spray coming out of the groomba' : 'Spray coming out of the drone']);
    if (usesGroomba(s)) rows.push([<Rover />, 'The groomba (ground robot)']);
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
      rows.push([<Ring color={COLORS.attractant} />, `Dashed circle: how far pests notice an attractant (${deviceReachM('attractant', s)} m)`]);
  }
  if (treated) rows.push([<Home />, usesGroomba(s) ? "Groomba's home spot" : "Drone's home pad"]);
  if (view.showPath && treated) {
    if (usesGroomba(s)) rows.push([<Tracks />, 'Wheel tracks: where the groomba has driven']);
    else rows.push([<Line color="rgba(30,41,59,0.45)" />, 'Where the drone has flown']);
    rows.push([<Line color="rgba(37,99,235,0.8)" dashed />, usesGroomba(s) ? 'Where it will drive next' : 'Where it will fly next']);
  }
  if (s.wind.speedMph > 0) rows.push([<Line color="#94a3b8" />, 'White streaks show the wind']);
  if ((s.weather?.rainDays ?? []).length) rows.push([<Patch fill="rgba(71,85,105,0.35)" />, 'Gray with falling streaks: it is raining']);
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
          {insects.map(({ group, title, items }) => {
            const inner = (
              <>
                <b>{title}:</b>
                {items.map(([icon, label]) => (
                  <span key={label} className="key-item">
                    {icon}
                    {label}
                  </span>
                ))}
              </>
            );
            return (
              <li key={group} className="key-insects">
                {onSpotlight ? (
                  <button
                    className={`key-spot ${spot === group ? 'on' : ''} ${spot && spot !== group ? 'faded' : ''}`}
                    aria-pressed={spot === group}
                    title={spot === group ? 'Tap to show all insects again' : `Tap to show only the ${GROUP_NAME[group]} on the map`}
                    onClick={() => onSpotlight(spot === group ? null : group)}
                  >
                    {inner}
                  </button>
                ) : (
                  inner
                )}
              </li>
            );
          })}
          {rows.map(([icon, label]) => (
            <li key={label}>
              {icon}
              <span>{label}</span>
            </li>
          ))}
        </ul>
      )}
      {open && spot && <span className="key-hint">Only the {GROUP_NAME[spot]} are shown. Tap them again to show all insects.</span>}
    </div>
  );
}
