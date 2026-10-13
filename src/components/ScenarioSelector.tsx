import type { Scenario } from '../models/types';
import { SCENARIOS } from '../simulation/scenarios';

export function ScenarioSelector({ scenario, onLoad }: { scenario: Scenario; onLoad: (s: Scenario) => void }) {
  const known = SCENARIOS.some((s) => s.id === scenario.id);
  return (
    <div className="scenario">
      <label className="scenario-pick">
        <span>Scenario</span>
        <select
          value={known ? scenario.id : '__custom'}
          onChange={(e) => {
            const s = SCENARIOS.find((x) => x.id === e.target.value);
            if (s) onLoad(s);
          }}
        >
          {SCENARIOS.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
          {!known && <option value="__custom">{scenario.name}</option>}
        </select>
      </label>
      <div className="scenario-text">
        <span className="purpose">{scenario.purpose}</span>
        {scenario.question && <span className="question">❓ {scenario.question}</span>}
      </div>
    </div>
  );
}
