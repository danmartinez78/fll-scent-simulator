import { useMemo } from 'react';
import type { PestDistribution, Scenario, Settings, TreatmentMethod, TreatmentPlan } from '../models/types';
import { formatModelMin, TIME_LAPSE } from '../utils/fieldTime';
import { cropRect } from '../simulation/Simulation';
import { devicesPerTrip } from '../simulation/Drone';
import { activePlan, estimateSprayLiters, planCoverage } from '../simulation/Treatment';
import { parseScenario } from '../simulation/scenarios';
import { compassLabel, compassName } from '../utils/geometry';
import { formatMoney, galToL, lToGal, m2ToAcres } from '../utils/units';
import { estimatePlanCost, sprayRounds } from '../simulation/PlanCost';
import type { Tool } from './SimulationCanvas';
import { downloadText, InfoButton, NumberField, pickTextFile, Section, Select, Slider, Toggle } from './ui';

interface Props {
  settings: Settings;
  plan: TreatmentPlan;
  tool: Tool;
  simStarted: boolean;
  scenario: Scenario;
  onSettings: (s: Settings) => void;
  onPlan: (p: TreatmentPlan) => void;
  onTool: (t: Tool) => void;
  onLoadScenario: (s: Scenario) => void;
  /** Only show these sections, all open (Guided mode). Leave out to show everything. */
  only?: SectionKey[];
}

export type SectionKey = 'plan' | 'wind' | 'pests' | 'scent' | 'drone' | 'devices' | 'survey' | 'cost' | 'run' | 'editor';

const METHODS: Array<{ value: TreatmentMethod; label: string; icon: string; sub: string; info?: string }> = [
  { value: 'none', label: 'No treatment', icon: '🚫', sub: 'Do nothing, to compare' },
  { value: 'spray', label: 'Spray', icon: '💧', sub: 'Drone sprays scent on areas', info: 'spray' },
  { value: 'slowRelease', label: 'Slow-release', icon: '⏳', sub: 'Drop scent devices that last', info: 'slowRelease' },
  { value: 'pushPull', label: 'Push-pull', icon: '↔️', sub: 'Push pests away, pull them to a trap', info: 'pushPull' }
];

const DISTRIBUTIONS: Array<{ value: PestDistribution; label: string }> = [
  { value: 'uniform', label: 'Spread evenly' },
  { value: 'hotspots', label: 'Hotspots (clusters)' },
  { value: 'edge', label: 'Arriving from the west edge' },
  { value: 'scattered', label: 'Scattered everywhere' }
];

const RESPRAY_OPTIONS: Array<[number, string]> = [
  [0, 'Once'],
  [7, 'Every week'],
  [3, 'Every 3 days']
];

/** Day the treatment starts (farm clock day). */
const START_DAY_OPTIONS: Array<[number, string]> = [
  [1, 'Day 1'],
  [3, 'Day 3'],
  [7, 'Day 7']
];

export function ControlPanel({ settings: s, plan, tool, simStarted, scenario, onSettings, onPlan, onTool, onLoadScenario, only }: Props) {
  const shows = (k: SectionKey) => !only || only.includes(k);
  // In the full panel only the treatment plan starts open.
  const isOpen = (k: SectionKey) => !!only || k === 'plan';
  // Small helper: change one group of settings.
  function set<K extends keyof Settings>(key: K, value: Partial<Settings[K]> | Settings[K]) {
    const cur = s[key];
    const next = typeof cur === 'object' && cur !== null ? { ...cur, ...(value as object) } : value;
    onSettings({ ...s, [key]: next } as Settings);
  }

  const eff = activePlan(plan, s.treatment);
  const crop = cropRect(s.field);
  // Still-air estimate of how much crop the plan reaches, so students can see gaps and overlaps.
  const coverage = planCoverage(eff, crop, s.scent.rangeM);
  const repellentCount = eff.devices.filter((d) => d.kind === 'repellent').length;
  const map = { x: 0, y: 0, w: s.field.width, h: s.field.height };
  const planLiters = estimateSprayLiters(eff.sprayZones, map, s.drone);
  const stockL = galToL(s.drone.productAvailableGal);
  // Repeat sprays: one on the start day, then one every N days until the run ends.
  const startDay = s.run.treatStartDay ?? 1;
  const sprays = sprayRounds(s);
  const totalLiters = planLiters * sprays;
  const hasPlan = eff.sprayZones.length > 0 || eff.devices.length > 0;
  // What the whole plan would cost: the drone flies it on its own, quickly, with no pests.
  const planCost = useMemo(() => (hasPlan && s.treatment !== 'none' ? estimatePlanCost(s, eff).total : 0), [s, plan, hasPlan]);
  const budget = s.cost.budget ?? 0;

  const chooseMethod = (m: TreatmentMethod) => {
    onSettings({ ...s, treatment: m });
    onTool(m === 'spray' ? 'zone' : m === 'slowRelease' || m === 'pushPull' ? 'repellent' : 'none');
  };

  const border = Math.max(s.drone.swathM * 2, 8);
  const perTrip = devicesPerTrip(s.drone, s.devices.massKg, s.devices.perTrip);
  const trips = perTrip > 0 ? Math.ceil(eff.devices.length / perTrip) : 0;
  const toolButton = (t: Tool, label: string) => (
    <button className={tool === t ? 'chip active' : 'chip'} onClick={() => onTool(tool === t ? 'none' : t)}>
      {label}
    </button>
  );

  return (
    <div className="controls">
      {shows('plan') && (
        <Section title="Treatment plan" icon="🧪" open={isOpen('plan')}>
          <div className="method-grid" role="radiogroup" aria-label="Treatment method">
            {METHODS.map((m) => (
              <button
                key={m.value}
                role="radio"
                aria-checked={s.treatment === m.value}
                className={s.treatment === m.value ? 'method active' : 'method'}
                onClick={() => chooseMethod(m.value)}
              >
                <span className="method-icon" aria-hidden="true">{m.icon}</span>
                <span className="method-text">
                  {m.label}
                  <span className="method-sub">{m.sub}</span>
                </span>
              </button>
            ))}
          </div>

          {s.treatment !== 'none' && (
            <div className="control">
              <span className="control-label">
                Start treatment on <InfoButton topic="treatStart" />
              </span>
              <div className="tool-row">
                {START_DAY_OPTIONS.map(([day, label]) => (
                  <button
                    key={day}
                    className={startDay === day ? 'chip active' : 'chip'}
                    aria-pressed={startDay === day}
                    onClick={() => set('run', { treatStartDay: day })}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {s.treatment !== 'none' && (
            <p className="hint small">
              Spray or devices? They protect the crop in different ways. <InfoButton topic="sprayVsDevices" />
            </p>
          )}

          {s.treatment === 'none' && (
            <p className="hint">Baseline: nothing is done. Run this first so you have something to compare treatments against.</p>
          )}

          {s.treatment === 'spray' && (
            <>
              <p className="hint">
                Drag on the map to draw spray zones. The drone flies back and forth over each zone. <InfoButton topic="spray" />
              </p>
              <div className="tool-row">
                {toolButton('zone', '▭ Draw zone')}
                {toolButton('erase', '🧽 Eraser')}
              </div>
              <div className="tool-row">
                <button className="chip" onClick={() => onPlan({ ...plan, sprayZones: [...plan.sprayZones, { ...crop }] })}>
                  Whole field
                </button>
                <button
                  className="chip"
                  onClick={() =>
                    onPlan({
                      ...plan,
                      sprayZones: [
                        ...plan.sprayZones,
                        { x: crop.x, y: crop.y, w: crop.w, h: border },
                        { x: crop.x, y: crop.y + crop.h - border, w: crop.w, h: border },
                        { x: crop.x, y: crop.y + border, w: border, h: crop.h - 2 * border },
                        { x: crop.x + crop.w - border, y: crop.y + border, w: border, h: crop.h - 2 * border }
                      ]
                    })
                  }
                >
                  Border strips
                </button>
                <button className="chip" onClick={() => onPlan({ ...plan, sprayZones: [] })}>
                  Clear zones
                </button>
              </div>
              <div className="control">
                <span className="control-label">
                  How often to spray <InfoButton topic="respray" />
                </span>
                <div className="tool-row">
                  {RESPRAY_OPTIONS.map(([days, label]) => (
                    <button
                      key={days}
                      className={(s.drone.resprayEveryDays ?? 0) === days ? 'chip active' : 'chip'}
                      aria-pressed={(s.drone.resprayEveryDays ?? 0) === days}
                      onClick={() => set('drone', { resprayEveryDays: days })}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <p className={`plan-summary ${totalLiters > stockL ? 'warn' : ''}`}>
                {eff.sprayZones.length} zone{eff.sprayZones.length === 1 ? '' : 's'}
                {sprays > 1 ? ` × ${sprays} sprays` : ''} · needs about {lToGal(totalLiters).toFixed(1)} gal
                {totalLiters > stockL
                  ? `, but this setup only has ${s.drone.productAvailableGal} gal. The drone will run out partway through, so some spraying won't happen.`
                  : ` (${s.drone.productAvailableGal} gal available)`}
              </p>
              {eff.sprayZones.length > 0 && (
                <p className="plan-summary">
                  Your zones cover about {coverage.coveredPct.toFixed(0)}% of the crop. <InfoButton topic="planCoverage" />
                </p>
              )}
            </>
          )}

          {(s.treatment === 'slowRelease' || s.treatment === 'pushPull') && (
            <>
              <p className="hint">
                Click the map to place devices.{' '}
                {s.treatment === 'pushPull' ? (
                  <>
                    Repellent pushes pests away; attractant pulls them in. <InfoButton topic="pushPull" />
                  </>
                ) : (
                  <>
                    Each device slowly gives off repellent. <InfoButton topic="slowRelease" />
                  </>
                )}
              </p>
              <div className="tool-row">
                {toolButton('repellent', '🟣 Repellent A')}
                {s.treatment === 'pushPull' && toolButton('attractant', '🟠 Attractant B')}
                {s.treatment === 'pushPull' && toolButton('trap', '🪤 Attractant + trap')}
                {toolButton('erase', '🧽 Eraser')}
              </div>
              <div className="tool-row">
                <button
                  className="chip"
                  onClick={() => onPlan({ ...plan, devices: plan.devices.filter((d) => !eff.devices.includes(d)) })}
                >
                  Clear devices
                </button>
              </div>
              <p className="plan-summary">
                {eff.devices.length} of {s.devices.maxDevices} devices placed
                {s.devices.deployByDrone
                  ? perTrip === 0
                    ? ' · too heavy for the drone to carry!'
                    : ` · the drone will fly them out in ${trips} trip${trips === 1 ? '' : 's'} (${perTrip} per trip)`
                  : ' · placed by hand at the start'}
              </p>
              {repellentCount > 0 && (
                <p className="plan-summary">
                  The dashed circles show how far each repellent reaches ({s.scent.rangeM} m). Together they cover about{' '}
                  {coverage.coveredPct.toFixed(0)}% of the crop in still air. <InfoButton topic="planCoverage" />
                  {coverage.overlapPct >= 20 && ' Some circles overlap, so those devices protect the same spot twice.'}
                  {s.wind.speedMph > 0 && ' Wind will push each scent patch downwind.'}
                </p>
              )}
            </>
          )}
          {s.treatment !== 'none' && (hasPlan || budget > 0) && (
            <p className={`plan-summary ${budget > 0 && planCost > budget ? 'warn' : ''}`}>
              💲 {hasPlan ? <>This plan will cost about <strong>{formatMoney(planCost)}</strong></> : 'Nothing planned yet'}
              {budget > 0 && <> of your <strong>{formatMoney(budget)}</strong> budget</>}.{' '}
              {budget > 0 && planCost > budget && "That's more than you have, so the drone will stop when the money runs out. "}
              <InfoButton topic="budget" />
            </p>
          )}
        </Section>
      )}

      {shows('wind') && (
        <Section title="Wind" icon="🌬️" note={s.wind.speedMph > 0 ? `${s.wind.speedMph} mph → ${compassLabel(s.wind.direction)}` : 'calm'} open={isOpen('wind')}>
          <Slider
            label="Blowing toward"
            info="windPlume"
            value={s.wind.direction}
            min={0}
            max={355}
            step={5}
            format={(v) => `${compassLabel(v)} (${v}°)`}
            onChange={(v) => set('wind', { direction: v })}
          />
          <div className="compass-row">
            {[0, 45, 90, 135, 180, 225, 270, 315].map((d) => (
              <button
                key={d}
                className={s.wind.direction === d ? 'chip small active' : 'chip small'}
                title={`Wind blowing toward the ${compassName(d)}`}
                onClick={() => set('wind', { direction: d })}
              >
                {compassLabel(d)}
              </button>
            ))}
          </div>
          <Slider label="Wind speed" value={s.wind.speedMph} min={0} max={20} unit="mph" onChange={(v) => set('wind', { speedMph: v })} />
          <Toggle label="Changing wind (swings back and forth)" checked={s.wind.changing} onChange={(v) => set('wind', { changing: v })} />
        </Section>
      )}

      {shows('pests') && (
        <Section title="Pests" icon="🐞" open={isOpen('pests')}>
          <Slider label="Number of pests" value={s.pests.count} min={50} max={1500} step={50} onChange={(v) => set('pests', { count: v })} />
          <Select label="Where they start" value={s.pests.distribution} options={DISTRIBUTIONS} onChange={(v) => set('pests', { distribution: v })} />
          {s.pests.distribution === 'hotspots' && (
            <Slider label="Number of hotspots" value={s.pests.hotspotCount} min={1} max={8} onChange={(v) => set('pests', { hotspotCount: v })} />
          )}
          <Slider
            label="Pests keep arriving for"
            info="buildUp"
            value={s.pests.buildUpDays ?? 0}
            min={0}
            max={14}
            step={1}
            format={(v) => (v === 0 ? 'all there on Day 1' : `${v} day${v === 1 ? '' : 's'}`)}
            onChange={(v) => set('pests', { buildUpDays: v })}
          />
          <Slider label="Crop attraction" info="cropAttraction" value={s.pests.cropAttraction} min={0} max={2} step={0.1} onChange={(v) => set('pests', { cropAttraction: v })} />
          <Slider label="Sensitivity to scent" info="sensitivity" value={s.pests.sensitivity} min={0} max={2} step={0.1} onChange={(v) => set('pests', { sensitivity: v })} />
          <Slider label="How far pests roam" value={s.pests.speed} min={0.2} max={2} step={0.1} format={(v) => `${Math.round((v * 3600) / TIME_LAPSE)} m per hour`} onChange={(v) => set('pests', { speed: v })} />
        </Section>
      )}

      {shows('scent') && (
        <Section title="Scent" icon="💜" open={isOpen('scent')}>
          <Slider
            label="Scent effectiveness"
            info="effectiveness"
            value={s.scent.effectivenessPct ?? 100}
            min={0}
            max={100}
            step={5}
            format={(v) => `${v}% of pests react`}
            onChange={(v) => set('scent', { effectivenessPct: v })}
          />
          <Slider label="Scent strength" info="scentStrength" value={s.scent.strength} min={0.2} max={3} step={0.1} onChange={(v) => set('scent', { strength: v })} />
          <Slider label="Spray lasts on plants" info="scentLifetime" value={s.scent.lifetimeMin} min={1} max={30} format={formatModelMin} onChange={(v) => set('scent', { lifetimeMin: v })} />
          <Slider label="Effective range (devices)" info="scentRange" value={s.scent.rangeM} min={4} max={30} unit="m" onChange={(v) => set('scent', { rangeM: v })} />
          <Slider label="Noticing threshold" info="threshold" value={s.scent.threshold} min={0.05} max={0.6} step={0.05} onChange={(v) => set('scent', { threshold: v })} />
        </Section>
      )}

      {shows('drone') && (
        <Section title="Spray drone" icon="🚁" note="T50-style" open={isOpen('drone')}>
          <p className="hint small">
            Reference numbers loosely based on the DJI Agras T50, not guaranteed mission times. <InfoButton topic="t50" />
          </p>
          <Slider
            label="Product available"
            info="product"
            value={s.drone.productAvailableGal}
            min={1}
            max={100}
            unit="gal"
            onChange={(v) => set('drone', { productAvailableGal: v })}
          />
          <Slider
            label="Application rate"
            info="applicationRate"
            value={s.drone.appRateGalPerAcre}
            min={0.5}
            max={5}
            step={0.25}
            unit="gal/acre"
            onChange={(v) => set('drone', { appRateGalPerAcre: v })}
          />
          <p className="hint small">
            A full tank ({lToGal(s.drone.tankL).toFixed(1)} gal) treats about{' '}
            {(lToGal(s.drone.tankL) / s.drone.appRateGalPerAcre).toFixed(2)} acres at this rate. The crop is{' '}
            {m2ToAcres(crop.w * crop.h).toFixed(1)} acres.
          </p>
          <Slider label="Tank size (payload)" info="payload" value={s.drone.tankL} min={5} max={60} unit="L" onChange={(v) => set('drone', { tankL: v, maxPayloadKg: Math.max(v, s.drone.maxPayloadKg) })} />
          <Slider label="Battery reserve" info="reserve" value={s.drone.reservePct} min={5} max={50} unit="%" onChange={(v) => set('drone', { reservePct: v })} />
          <Slider label="Hover time, empty" info="flightTime" value={s.drone.hoverEmptyMin} min={3} max={40} step={0.5} unit="min" onChange={(v) => set('drone', { hoverEmptyMin: v })} />
          <Slider label="Hover time, full" info="flightTime" value={s.drone.hoverFullMin} min={2} max={30} step={0.5} unit="min" onChange={(v) => set('drone', { hoverFullMin: Math.min(v, s.drone.hoverEmptyMin) })} />
          <Slider label="Flying speed" value={s.drone.speed} min={2} max={12} step={0.5} unit="m/s" onChange={(v) => set('drone', { speed: v })} />
          <Slider label="Spray width (swath)" info="swath" value={s.drone.swathM} min={3} max={12} step={0.5} unit="m" onChange={(v) => set('drone', { swathM: v })} />
          <Slider label="Refill / battery swap time" info="turnaround" value={s.drone.turnaroundSec} min={0} max={300} step={10} unit="s" onChange={(v) => set('drone', { turnaroundSec: v })} />
        </Section>
      )}

      {shows('devices') && (
        <Section title="Slow-release devices" icon="⏳" open={isOpen('devices')}>
          <Slider label="Devices available" value={s.devices.maxDevices} min={1} max={40} onChange={(v) => set('devices', { maxDevices: v })} />
          <Slider label="Release rate" value={s.devices.releaseRate} min={0.25} max={3} step={0.25} format={(v) => `${v}x standard`} onChange={(v) => set('devices', { releaseRate: v })} />
          <Slider label="Device lifetime" value={s.devices.lifetimeMin} min={7} max={120} format={formatModelMin} onChange={(v) => set('devices', { lifetimeMin: v })} />
          <Slider label="Mass per device" info="payload" value={s.devices.massKg} min={0.1} max={5} step={0.1} unit="kg" onChange={(v) => set('devices', { massKg: v })} />
          <Slider label="Devices per trip (drop rack)" info="perTrip" value={s.devices.perTrip ?? 20} min={1} max={20} onChange={(v) => set('devices', { perTrip: v })} />
          <p className="hint small">
            The drone carries {perTrip} device{perTrip === 1 ? '' : 's'} per trip
            {perTrip < (s.devices.perTrip ?? Infinity) ? ' (limited by weight)' : ''}.
          </p>
          <Toggle label="Drone flies devices out" checked={s.devices.deployByDrone} onChange={(v) => set('devices', { deployByDrone: v })} />
        </Section>
      )}

      {shows('survey') && (
        <Section title="Survey camera" icon="🛰️" open={isOpen('survey')}>
          <Slider label="Detection chance" info="surveyAccuracy" value={s.survey.detectionPct} min={10} max={100} step={5} unit="%" onChange={(v) => set('survey', { detectionPct: v })} />
          <Slider label="Fake detections" value={s.survey.falsePositivesPer1000m2} min={0} max={5} step={0.25} format={(v) => `${v} per 1000 m²`} onChange={(v) => set('survey', { falsePositivesPer1000m2: v })} />
          <Slider label="Position error" value={s.survey.positionNoiseM} min={0} max={20} unit="m" onChange={(v) => set('survey', { positionNoiseM: v })} />
          <Slider label="Squares the software can't judge" value={s.survey.uncertainPct} min={0} max={40} unit="%" onChange={(v) => set('survey', { uncertainPct: v })} />
        </Section>
      )}

      {shows('cost') && (
        <Section title="Costs" icon="💲" open={isOpen('cost')}>
          <p className="hint small">
            This simulator does not know the actual cost of the team's scent product. Change these to try different guesses. <InfoButton topic="cost" />
          </p>
          <NumberField label="Drone operating cost" value={s.cost.flightCostPerMin ?? 5} min={0} step={0.5} unit="$/min in the air" onChange={(v) => set('cost', { flightCostPerMin: v })} />
          <NumberField label="Scent product" value={s.cost.materialCostPerGal} min={0} step={1} unit="$/gal" onChange={(v) => set('cost', { materialCostPerGal: v })} />
          <NumberField label="Slow-release device" value={s.cost.deviceCost} min={0} step={0.5} unit="$ each" onChange={(v) => set('cost', { deviceCost: v })} />
          <Slider
            label="Budget"
            info="budget"
            value={s.cost.budget ?? 0}
            min={0}
            max={2000}
            step={50}
            format={(v) => (v === 0 ? 'no limit' : formatMoney(v))}
            onChange={(v) => set('cost', { budget: v })}
          />
        </Section>
      )}

      {shows('run') && (
        <Section title="Experiment run" icon="🎲" open={isOpen('run')}>
          <Slider label="Run length" value={s.run.durationMin} min={7} max={84} step={7} format={formatModelMin} onChange={(v) => set('run', { durationMin: v })} />
          <NumberField label="Random seed" info="seed" value={s.run.seed} min={0} step={1} onChange={(v) => set('run', { seed: Math.round(v) })} />
          <button className="btn small" onClick={() => set('run', { seed: Math.floor(Math.random() * 100000) })}>
            🎲 New random seed
          </button>
          <p className="hint small">Same seed + same settings = the same experiment. Press Reset to repeat it exactly.</p>
        </Section>
      )}

      {shows('editor') && (
        <Section title="Scenario editor" icon="🛠️" open={isOpen('editor')}>
          <p className="hint small">Change the map size, then save the whole setup (all settings and the plan) as a file to share.</p>
          <NumberField label="Map width" value={s.field.width} min={80} max={600} step={10} unit="m" onChange={(v) => set('field', { width: v })} />
          <NumberField label="Map height" value={s.field.height} min={60} max={400} step={10} unit="m" onChange={(v) => set('field', { height: v })} />
          <NumberField label="Grass border" value={s.field.border} min={5} max={60} step={5} unit="m" onChange={(v) => set('field', { border: v })} />
          <p className="hint small">
            Crop: {crop.w} × {crop.h} m = {m2ToAcres(crop.w * crop.h).toFixed(1)} acres.{simStarted ? ' Map changes start on the next Reset.' : ''}
          </p>
          <div className="tool-row">
            <button
              className="btn small"
              onClick={() =>
                downloadText(
                  `${scenario.id || 'scenario'}-custom.json`,
                  JSON.stringify(
                    {
                      format: 'scent-sim-scenario',
                      version: 1,
                      id: `${scenario.id}-custom`,
                      name: `${scenario.name} (custom)`,
                      purpose: scenario.purpose,
                      question: scenario.question,
                      settings: s,
                      plan
                    },
                    null,
                    2
                  )
                )
              }
            >
              ⬇ Export scenario
            </button>
            <button
              className="btn small"
              onClick={async () => {
                const text = await pickTextFile();
                if (!text) return;
                try {
                  onLoadScenario(parseScenario(text));
                } catch (e) {
                  alert(`Could not read that scenario file: ${(e as Error).message}`);
                }
              }}
            >
              ⬆ Import scenario
            </button>
          </div>
        </Section>
      )}
    </div>
  );
}
