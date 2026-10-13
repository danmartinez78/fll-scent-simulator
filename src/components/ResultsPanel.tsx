import { useState } from 'react';
import type { Simulation } from '../simulation/Simulation';
import { formatMoney } from '../utils/units';
import { LineChart } from './Chart';
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
  const xs = sim.history.map((h) => h.t / 60);
  const treat = sim.settings.treatment;
  return (
    <div className="results">
      <div className="metrics">
        <Card icon="🌱" label="Crop protected" info="cropProtected" value={`${m.cropProtectedPct.toFixed(0)}%`} sub={`${m.cropAffectedPct.toFixed(0)}% affected`} tone="good" />
        <Card
          icon="🐞"
          label="Pests kept off crop"
          info="pestsDeterred"
          value={`${m.pestsDeterredPct.toFixed(0)}%`}
          sub={`average ${m.pestsDeterredAvgPct.toFixed(0)}%${m.pestsTrapped ? ` · ${m.pestsTrapped} trapped` : ''}`}
        />
        <Card
          icon="💲"
          label="Estimated cost"
          info="cost"
          value={formatMoney(m.cost.total)}
          sub={`application ${formatMoney(m.cost.application)} · product ${formatMoney(m.cost.material)} · devices ${formatMoney(m.cost.devices)}`}
        />
      </div>
      <button className="link-btn" aria-expanded={more} onClick={() => setMore((x) => !x)}>
        {more ? '▾ Fewer numbers' : '▸ More numbers'}
      </button>
      {more && (
        <div className="metrics">
          <Card icon="💧" label="Product used" value={`${m.productUsedGal.toFixed(1)} gal`} sub={`${m.productLeftGal.toFixed(1)} gal left`} />
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
          yMax={100}
          yLabel="%"
          series={[
            { label: 'Pests feeding on crop', color: '#b45309', values: sim.history.map((h) => h.pestsFeedingPct) },
            { label: 'Crop affected', color: '#7c2d12', values: sim.history.map((h) => h.cropAffectedPct) }
          ]}
        />
      )}
      {chart === 'scent' && (
        <LineChart xs={xs} yMax={100} yLabel="%" series={[{ label: 'Crop with noticeable repellent', color: '#7c3aed', values: sim.history.map((h) => h.scentCoveragePct) }]} />
      )}
      {chart === 'product' && (
        <LineChart xs={xs} yLabel="gal" series={[{ label: 'Product used (gal)', color: '#2563eb', values: sim.history.map((h) => h.productUsedGal) }]} />
      )}

      <button className="btn primary wide" onClick={onSave} disabled={sim.time === 0}>
        📓 Save these results to the notebook
      </button>
      {saved && <p className="saved-note">✓ Saved to {saved}.</p>}
    </div>
  );
}
