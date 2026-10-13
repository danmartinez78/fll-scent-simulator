import { ACTIVITY_STEPS, HELP, HONESTY_NOTE } from '../content/help';

const ORDER = [
  'pheromone',
  'repellent',
  'attractant',
  'pushPull',
  'slowRelease',
  'spray',
  'windPlume',
  'payload',
  'flightTime',
  'applicationRate',
  'reserve',
  't50',
  'survey',
  'surveyAccuracy',
  'computerVision',
  'optimization',
  'score',
  'seed',
  'cost'
];

export function HelpPanel() {
  return (
    <div className="help">
      <div className="honesty-box">
        <strong>Important:</strong> {HONESTY_NOTE}
      </div>

      <h3>How to use the map</h3>
      <ul className="legend-list">
        <li><i className="dot pest" /> Pest (dark = normal, orange = bothered by repellent)</li>
        <li><i className="dot rep" /> Repellent A cloud (stronger = more purple)</li>
        <li><i className="dot att" /> Attractant B cloud</li>
        <li><i className="dot dmg" /> Crop damage from feeding</li>
        <li><span className="badge">H</span> Drone home: refill tank, swap battery</li>
        <li><span className="badge">R</span>/<span className="badge">A</span> Slow-release devices (white = waiting for the drone; a ring = trap)</li>
      </ul>

      <h3>Try an experiment</h3>
      <ol className="steps">
        {ACTIVITY_STEPS.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>

      <h3>Questions to explore</h3>
      <ul className="questions">
        <li>What happens to a scent when the wind changes?</li>
        <li>Is spraying the whole field always better than targeting certain areas?</li>
        <li>What happens if scent only lasts a short time?</li>
        <li>How does limited drone payload affect treatment?</li>
        <li>Could slow-release sources work differently from spraying?</li>
        <li>Does it help to know where pests are before treatment?</li>
        <li>Where should a limited number of scent sources be placed?</li>
        <li>Can a computer find a better plan than a person? Better at what?</li>
        <li>What happens when the survey is imperfect?</li>
      </ul>

      <h3>Words to know</h3>
      <dl className="glossary">
        {ORDER.map((k) => (
          <div key={k}>
            <dt>{HELP[k].title}</dt>
            <dd>{HELP[k].text}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
