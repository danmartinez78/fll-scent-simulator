import { describe, expect, it } from 'vitest';
import { CHART_POINTS, captureRun, newEntry } from '../src/notebook/notebook';
import { notebookCsv, notebookReportHtml } from '../src/notebook/report';
import { Simulation } from '../src/simulation/Simulation';
import { getScenario } from '../src/simulation/scenarios';

function sampleEntries() {
  const sc = getScenario('windy')!;
  const sim = new Simulation(sc.settings, sc.plan);
  sim.advance(60);
  const run = { ...newEntry('Experiment 1'), question: 'Where, "exactly"?', prediction: '=SUM(A1)', captured: captureRun(sim, sc.name) };
  const notes = { ...newEntry('Experiment 2'), prediction: '<script>alert(1)</script>' };
  return [run, notes];
}

describe('notebook report', () => {
  it('makes one CSV row per experiment and keeps formulas and quotes harmless', () => {
    const csv = notebookCsv(sampleEntries());
    const lines = csv.trim().split('\r\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('"Crop protected"');
    expect(csv).toContain('"Where, ""exactly""?"');
    expect(csv).toContain(`"'=SUM(A1)"`);
  });

  it('builds an HTML report with an overview and escapes student text', () => {
    const html = notebookReportHtml(sampleEntries());
    expect(html).toContain('<h2>Experiment 1</h2>');
    expect(html).toContain('Windy Field');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>alert');
  });

  it('only shows map pictures that are real images', () => {
    const [run] = sampleEntries();
    const good = { ...run, captured: { ...run.captured!, snapshot: 'data:image/jpeg;base64,AAAA' } };
    const bad = { ...run, id: 'x', captured: { ...run.captured!, snapshot: 'javascript:alert(1)' } };
    const html = notebookReportHtml([good, bad]);
    expect(html.match(/<img /g)).toHaveLength(1);
    expect(html).not.toContain('javascript:');
  });

  it('draws the four Results charts for each saved run, and a comparison when there are two', () => {
    const [run, notes] = sampleEntries();
    expect(run.captured!.charts!.days.length).toBeGreaterThan(1);
    expect(run.captured!.charts!.days.length).toBeLessThanOrEqual(CHART_POINTS + 1);
    const one = notebookReportHtml([run, notes]);
    expect(one.match(/<figure class="chart">/g)).toHaveLength(4);
    expect(one).not.toContain('Crop damaged in each experiment');
    const two = notebookReportHtml([run, { ...run, id: 'b', name: 'Experiment 1B' }]);
    expect(two.match(/<figure class="chart">/g)).toHaveLength(9);
    expect(two).toContain('Crop damaged in each experiment');
  });

  it('skips charts from older saves or tampered files', () => {
    const [run] = sampleEntries();
    const old = { ...run, captured: { ...run.captured!, charts: undefined } };
    const bad = { ...run, id: 'x', captured: { ...run.captured!, charts: { ...run.captured!.charts!, crop: ['"/><script>'] } as never } };
    const html = notebookReportHtml([old, bad]);
    expect(html).not.toContain('<figure class="chart">');
    expect(html).not.toContain('<script>');
  });
});
