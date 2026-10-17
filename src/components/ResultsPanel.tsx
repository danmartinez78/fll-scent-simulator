import { useState } from 'react';
import type { Simulation } from '../simulation/Simulation';
import { formatMoney } from '../utils/units';
import { LineChart } from './Chart';
import { modelToFieldSec } from '../utils/fieldTime';
import { InfoButton } from './ui';

function Card({ icon, label, value, sub, info, tone }: { icon: string; label: string; value: string; sub?: string; info?: string; tone?: string }) {
  return (
    <div className={`metric ${tone ?? ''}`}>
      <span className="metric-icon" aria-hidden="true">{icon}</span>
      <span className="metric-label">
        {label}
        {info && <InfoButton topic={info} />}
      </span>
      <span className="metric-value">{value}</span>
      {sub && <span className="metric-sub">{sub}</span>}
    </div>
  );
}

type ChartKind = 'pests' | 'product' | 'scent';

export function ResultsPanel({ sim, onSave, saved }: { sim: Simulation; onSave: () => void; saved?: string | null }) {
  const m = sim.metrics();
  const [chart, setChart] = useState<ChartKind>('pests');
  const [more, setMore] = useState(false);
  const xs = sim.history.map((h) => modelToFieldSec(h.t) / 86400);
  const treat = sim.settings.treatment;
  const treatStartDay = treat === 'none' ? 0 : sim.treatStartFieldSec / 86400;
  return (
    <div className="results">
      <div className="metrics">
        <Card icon="🌱" label="Crop protected" info="cropProtected" value={`${m.cropProtectedPct.toFixed(0)}%`} sub={`${m.cropAffectedPct.toFixed(0)}% affected`} tone="good" />
        <Card
          icon="🐞"
          label="Pests kept off crop"
          info="pestsDeterred"
          // During a run show right now; once it is over, the average over the whole run is the fairer summary.
          value={`${(sim.finished ? m.pestsDeterredAvgPct : m.pestsDeterredPct).toFixed(0)}%`}
          sub={`${sim.finished ? `on average · ${m.pestsDeterredPct.toFixed(0)}% at the end` : `right now · ${m.pestsDeterredAvgPct.toFixed(0)}% on average`}${m.pestsTrapped ? ` · ${m.pestsTrapped} trapped` : ''}`}
        />
        <Card
          icon="💲"
          label="Estimated cost"
          info="cost"
          value={formatMoney(m.cost.total)}
          sub={`${sim.settings.cost.budget ? `of your ${formatMoney(sim.settings.cost.budget)} budget${sim.drone.outOfBudget ? ' (used up)' : ''} · ` : ''}drone flying ${formatMoney(m.cost.application)} · product ${formatMoney(m.cost.material)} · devices ${formatMoney(m.cost.devices)}`}
        />
      </div>
      <button className="link-btn" aria-expanded={more} onClick={() => setMore((x) => !x)}>
        {more ? '▾ Fewer numbers' : '▸ More numbers'}
      </button>
      {more && (
        <div className="metrics">
          <Card icon="💧" label="Product used" value={`${m.productUsedGal.toFixed(1)} gal`} sub={m.productLeftGal == null ? 'no limit on product' : `${m.productLeftGal.toFixed(1)} gal left`} />
          <Card icon="⏳" label="Scent devices used" value={String(m.devicesUsed)} sub={treat === 'pushPull' || treat === 'slowRelease' ? `of ${sim.settings.devices.maxDevices}` : ''} />
          <Card icon="🚁" label="Drone flight time" info="flightTime" value={`${m.flightTimeMin.toFixed(1)} min`} sub={`${m.distanceKm.toFixed(2)} km flown`} />
          <Card icon="🔁" label="Flights" value={String(m.flights)} sub={`${m.refills} refills · ${m.batterySwaps} battery swaps`} />
          <Card icon="🗺️" label="Scent coverage now" info="scentCoverage" value={`${m.scentCoveragePct.toFixed(0)}%`} sub={`${m.acresSprayed.toFixed(2)} acres sprayed`} />
        </div>
      )}

      <div className="chart-tabs">
        {(
          [
            ['pests', 'Pests & crop'],
            ['scent', 'Scent'],
            ['product', 'Product used']
          ] as Array<[ChartKind, string]>
        ).map(([k, l]) => (
          <button key={k} className={chart === k ? 'chip small active' : 'chip small'} onClick={() => setChart(k)}>
            {l}
          </button>
        ))}
      </div>
      {chart === 'pests' && (
        <LineChart
          xs={xs}
          xLabel="days"
          yMax={100}
          yLabel="%"
          marker={treatStartDay > 0 ? { x: treatStartDay, label: 'treatment starts' } : undefined}
          series={[
            { label: 'Pests that have arrived', color: '#94a3b8', values: sim.history.map((h) => h.pestsPresentPct ?? 100) },
            // Share of all pests, so the gap to the line above is the pests kept off the crop.
            { label: 'Pests eating the crop', color: '#b45309', values: sim.history.map((h) => (h.pestsFeedingPct * (h.pestsPresentPct ?? 100)) / 100) },
            { label: 'Crop damaged', color: '#7c2d12', values: sim.history.map((h) => h.cropAffectedPct) }
          ]}
        />
      )}
      {chart === 'pests' && (
        <p className="hint small chart-note">
          Pests don't all show up on Day 1. They fly in over the first days. The gray line is how many have arrived so far, out of all the
          pests in this run. The gap between gray and orange is pests that are in the field but kept off the crop.
        </p>
      )}
      {chart === 'scent' && (
        <LineChart xs={xs} xLabel="days" yMax={100} yLabel="%" series={[{ label: 'Crop with noticeable repellent', color: '#7c3aed', values: sim.history.map((h) => h.scentCoveragePct) }]} />
      )}
      {chart === 'product' && (
        <LineChart xs={xs} xLabel="days" yLabel="gal" series={[{ label: 'Product used (gal)', color: '#2563eb', values: sim.history.map((h) => h.productUsedGal) }]} />
      )}

      {saved ? (
        <p className="saved-note">✓ Saved in the notebook as {saved}.</p>
      ) : (
        <button className="btn primary wide" onClick={onSave} disabled={!sim.runStarted}>
          📓 Save these results to the notebook
        </button>
      )}
    </div>
  );
}
