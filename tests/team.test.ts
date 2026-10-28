import { describe, expect, it } from 'vitest';
import { Simulation } from '../src/simulation/Simulation';
import { pickResultLines, pickWinner, TEAM_EXPERIMENTS, teamExperiment, teamPlan, type PlanKey, type TeamRun } from '../src/team/experiments';
import { cleanTeamState, emptyExperimentState } from '../src/team/teamState';
import { teamReportHtml } from '../src/team/teamReport';

const runPlan = (id: 'pesticide' | 'sprayer', k: PlanKey): TeamRun => {
  const s = structuredClone(teamExperiment(id).plans[k].settings);
  const sim = new Simulation(s, teamPlan(s));
  sim.runToEnd();
  return { metrics: sim.metrics(), settings: sim.settings };
};

describe('team presentation experiments', () => {
  it('only uses spray plans (the team does not use scent devices)', () => {
    for (const e of TEAM_EXPERIMENTS)
      for (const k of ['A', 'B'] as PlanKey[]) {
        expect(['spray', 'pesticide']).toContain(e.plans[k].settings.treatment);
        expect(teamPlan(e.plans[k].settings).devices).toHaveLength(0);
      }
  });

  it('pesticide kills the helpful insects; the scent spray kills none and protects almost as much crop', () => {
    const exp = teamExperiment('pesticide');
    const runs = { A: runPlan('pesticide', 'A'), B: runPlan('pesticide', 'B') };
    expect(runs.A.metrics.helpersAlive).toBe(0);
    expect(runs.B.metrics.helpersAlive).toBe(runs.B.metrics.helpersTotal);
    expect(runs.B.metrics.pestsKilled).toBe(0);
    expect(runs.B.metrics.cropProtectedPct).toBeGreaterThan(runs.A.metrics.cropProtectedPct - 10);
    expect(pickWinner(exp, exp.picks[1], runs)).toBe('B');
  }, 60000);

  it('in the wind the ground robot loses less spray and protects more crop, but takes longer', () => {
    const exp = teamExperiment('sprayer');
    const runs = { A: runPlan('sprayer', 'A'), B: runPlan('sprayer', 'B') };
    expect(runs.A.metrics.sprayBlownAwayPct!).toBeGreaterThan(runs.B.metrics.sprayBlownAwayPct! + 20);
    expect(pickWinner(exp, exp.picks[0], runs)).toBe('B');
    expect(pickWinner(exp, exp.picks[1], runs)).toBe('A');
    expect(exp.numbers[2].text(runs.B.metrics, runs.B.settings)).toMatch(/h/);
  }, 120000);
});

describe('team page state and report', () => {
  const fakeRun = (protectedPct: number, helpersAlive: number): TeamRun => {
    const settings = structuredClone(teamExperiment('pesticide').plans.A.settings);
    const sim = new Simulation(settings, teamPlan(settings));
    return { metrics: { ...sim.metrics(), cropProtectedPct: protectedPct, helpersAlive, helpersTotal: 120 }, settings };
  };

  it('scores the guesses against the results', () => {
    const exp = teamExperiment('pesticide');
    const runs = { A: fakeRun(80, 0), B: fakeRun(70, 120) };
    const lines = pickResultLines(exp, { crop: 'B', helpers: 'B' }, runs);
    expect(lines.map((l) => l.right)).toEqual([false, true]);
    expect(pickWinner(exp, exp.picks[0], { A: runs.A })).toBeNull();
  });

  it('drops anything it does not know from a saved state', () => {
    const st = cleanTeamState({
      teamName: 'Bots',
      current: 'nope',
      experiments: { pesticide: { guesses: { crop: 'C', helpers: 'A' }, because: 3, runs: { A: { foo: 1 } } }, other: {} }
    });
    expect(st.current).toBeNull();
    expect(st.teamName).toBe('Bots');
    expect(st.experiments.pesticide).toEqual({ ...emptyExperimentState(), guesses: { helpers: 'A' } });
    expect(cleanTeamState('junk')).toEqual(cleanTeamState(null));
  });

  it('writes a report page only for finished experiments, with the text escaped', () => {
    const runs = { A: fakeRun(80, 0), B: { ...fakeRun(70, 120), snapshot: 'javascript:alert(1)' } };
    const html = teamReportHtml({
      teamName: '<b>Team</b>',
      current: 'pesticide',
      experiments: { pesticide: { guesses: { crop: 'A' }, because: '', runs, found: 'Scent <script>x</script>', realWorld: '' }, sprayer: emptyExperimentState() }
    });
    expect(html).toContain('Pesticide or scent?');
    expect(html).not.toContain('Drone or ground robot?');
    expect(html).toContain('&lt;b&gt;Team&lt;/b&gt;');
    expect(html).toContain('Scent &lt;script&gt;');
    expect(html).not.toContain('javascript:alert');
  });
});
