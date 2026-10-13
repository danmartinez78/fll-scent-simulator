import { describe, expect, it } from 'vitest';
import { captureRun, newEntry } from '../src/notebook/notebook';
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
});
