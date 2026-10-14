import { useState } from 'react';
import type { SurveyCategory, SurveyResult, ViewOptions } from '../models/types';
import type { Simulation } from '../simulation/Simulation';
import { COLORS, type SurveyLayer } from '../render/drawScene';
import { formatFieldClock } from '../utils/fieldTime';
import { InfoButton, Toggle } from './ui';

interface Props {
  sim: Simulation;
  surveys: SurveyResult[];
  shown: SurveyResult | null;
  layer: SurveyLayer;
  instructor: boolean;
  view: ViewOptions;
  onView: (v: ViewOptions) => void;
  onInstructor: (v: boolean) => void;
  onLayer: (l: SurveyLayer) => void;
  onSelect: (id: number | null) => void;
  onSurvey: () => void;
}

const CATEGORY_LABELS: Array<[Exclude<SurveyCategory, 'none'>, string]> = [
  ['healthy', 'Healthy crop'],
  ['possible', 'Possible damage'],
  ['high', 'High pest activity'],
  ['uncertain', 'Uncertain']
];

function counts(s: SurveyResult) {
  const c: Record<string, number> = { healthy: 0, possible: 0, high: 0, uncertain: 0 };
  let total = 0;
  for (const cat of s.category) {
    if (cat === 'none') continue;
    c[cat]++;
    total++;
  }
  return { c, total: Math.max(1, total) };
}

function MiniMap({ s, layer }: { s: SurveyResult; layer: SurveyLayer }) {
  const values = layer === 'truth' ? s.truth : s.estimate;
  const max = Math.max(1, ...values);
  return (
    <svg viewBox={`0 0 ${s.cols} ${s.rows}`} className="minimap" preserveAspectRatio="xMidYMid meet" role="img" aria-label={`${s.label} map`}>
      <rect width={s.cols} height={s.rows} fill={COLORS.grass} />
      {s.category.map((cat, i) => {
        const x = i % s.cols;
        const y = Math.floor(i / s.cols);
        let fill: string | null = null;
        if (layer === 'camera') fill = cat === 'none' ? null : COLORS.survey[cat];
        else if (values[i] > 0) {
          const t = Math.min(1, values[i] / max);
          fill = `rgba(${Math.round(250 - 30 * t)},${Math.round(200 - 170 * t)},${Math.round(60 - 30 * t)},${0.3 + 0.6 * t})`;
        }
        if (cat !== 'none' && layer !== 'camera' && !fill) fill = 'rgba(95,167,90,0.6)';
        return fill ? <rect key={i} x={x} y={y} width={1} height={1} fill={fill} /> : null;
      })}
    </svg>
  );
}

export function SurveyPanel(p: Props) {
  const { surveys, instructor } = p;
  const [aId, setAId] = useState<number | null>(null);
  const [bId, setBId] = useState<number | null>(null);
  const a = surveys.find((s) => s.id === aId) ?? surveys[0];
  const b = surveys.find((s) => s.id === bId) ?? surveys[surveys.length - 1];
  const layerOptions: Array<[SurveyLayer, string]> = [
    ['camera', 'Camera software labels'],
    ['estimate', 'Estimated pest count'],
    ...(instructor ? ([['truth', 'Real pests (instructor)']] as Array<[SurveyLayer, string]>) : [])
  ];

  return (
    <div className="survey-panel">
      <p className="lead">
        Some drones are built to carry liquid; others are built to take pictures and make maps. <strong>Does one drone need to do every job?</strong>{' '}
        <InfoButton topic="survey" />
      </p>
      <button className="btn primary wide" onClick={p.onSurvey} disabled={p.sim.surveying}>
        {p.sim.surveying ? `🛰️ Scanning… ${Math.round((p.sim.survey?.progress ?? 0) * 100)}%` : '🛰️ Fly the survey drone now'}
      </button>
      <p className="hint small">
        The survey drone flies back and forth over the field. Its camera software guesses where pests are. It is not perfect: it can miss pests, see pests that aren't there, and put them in the wrong spot. <InfoButton topic="computerVision" />
      </p>

      {surveys.length === 0 ? (
        <p className="empty">No surveys yet. Fly one before treatment, then again after, to compare.</p>
      ) : (
        <>
          <div className="control">
            <span className="control-label">Show on map</span>
            <div className="tool-row">
              {surveys.map((s) => (
                <button key={s.id} className={p.shown?.id === s.id ? 'chip small active' : 'chip small'} onClick={() => p.onSelect(s.id)}>
                  {s.label} ({formatFieldClock(s.timeSec)})
                </button>
              ))}
            </div>
            <div className="tool-row">
              {layerOptions.map(([k, l]) => (
                <button key={k} className={p.layer === k ? 'chip small active' : 'chip small'} onClick={() => p.onLayer(k)}>
                  {l}
                </button>
              ))}
            </div>
            <Toggle label="Show survey map on the field" checked={p.view.showSurvey} onChange={(v) => p.onView({ ...p.view, showSurvey: v })} />
          </div>
          <div className="legend survey-legend">
            {CATEGORY_LABELS.map(([k, l]) => (
              <span key={k}>
                <i style={{ background: COLORS.survey[k] }} /> {l}
              </span>
            ))}
          </div>

          <h3>Before and after</h3>
          <div className="compare-pick">
            <label>
              Before
              <select value={a?.id} onChange={(e) => setAId(Number(e.target.value))}>
                {surveys.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label} at {formatFieldClock(s.timeSec)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              After
              <select value={b?.id} onChange={(e) => setBId(Number(e.target.value))}>
                {surveys.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label} at {formatFieldClock(s.timeSec)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {a && b && (
            <>
              <div className="minimaps">
                <div>
                  <MiniMap s={a} layer={p.layer === 'truth' && !instructor ? 'camera' : p.layer} />
                  <span className="caption">{a.label}</span>
                </div>
                <div>
                  <MiniMap s={b} layer={p.layer === 'truth' && !instructor ? 'camera' : p.layer} />
                  <span className="caption">{b.label}</span>
                </div>
              </div>
              <table className="table">
                <thead>
                  <tr>
                    <th />
                    <th>{a.label}</th>
                    <th>{b.label}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Pests the camera counted on the crop</td>
                    <td>{a.estimatedOnCrop}</td>
                    <td>{b.estimatedOnCrop}</td>
                  </tr>
                  {CATEGORY_LABELS.map(([k, l]) => (
                    <tr key={k}>
                      <td>{l} (crop squares)</td>
                      <td>{((counts(a).c[k] / counts(a).total) * 100).toFixed(0)}%</td>
                      <td>{((counts(b).c[k] / counts(b).total) * 100).toFixed(0)}%</td>
                    </tr>
                  ))}
                  {instructor && (
                    <tr className="instructor-row">
                      <td>Real pests on the map (instructor)</td>
                      <td>
                        {a.trueTotal} (camera found {a.detectedTotal})
                      </td>
                      <td>
                        {b.trueTotal} (camera found {b.detectedTotal})
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
              <p className="question-prompt">What changed between the two maps? Did pests disappear, or did they move somewhere else?</p>
            </>
          )}
        </>
      )}

      <details className="instructor">
        <summary>Instructor / coach view</summary>
        <Toggle label="Instructor mode (shows the real pest counts)" checked={instructor} onChange={p.onInstructor} />
        <Toggle label="Show the real pests on the field" checked={p.view.showPests} onChange={(v) => p.onView({ ...p.view, showPests: v })} />
        <p className="hint small">In the Survey Uncertainty scenario the real pests start hidden, like on a real farm. Turn them on to check the survey.</p>
      </details>
    </div>
  );
}
