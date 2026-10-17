import { compassName } from '../utils/geometry';
import { formatMoney } from '../utils/units';
import { compareChartHtml, runChartsHtml } from './reportCharts';
import { ENTRY_FIELDS, methodName, summaryRows, type CapturedRun, type NotebookEntry } from './notebook';

/** Short columns for the overview table and the spreadsheet. */
function overview(c: CapturedRun): Array<[string, string]> {
  const s = c.settings;
  const m = c.metrics;
  return [
    ['Scenario', c.scenarioName],
    ['Treatment', methodName(s.treatment)],
    ['Wind', s.wind.speedMph > 0 ? `${s.wind.speedMph} mph ${compassName(s.wind.direction)}` : 'None'],
    ['Crop protected', `${m.cropProtectedPct.toFixed(0)}%`],
    ['Pests kept off (avg)', `${m.pestsDeterredAvgPct.toFixed(0)}%`],
    ['Product used', `${m.productUsedGal.toFixed(1)} gal`],
    ['Flight time', `${m.flightTimeMin.toFixed(1)} min`],
    ['Cost', formatMoney(m.cost.total)],
    ['Insects killed', m.pestsKilled === undefined ? '—' : String(m.pestsKilled + (m.helpersKilled ?? 0))],
    ['Helpful alive', m.helpersAlivePct === undefined ? '—' : `${m.helpersAlivePct.toFixed(0)}%`]
  ];
}

const OVERVIEW_LABELS = ['Scenario', 'Treatment', 'Wind', 'Crop protected', 'Pests kept off (avg)', 'Product used', 'Flight time', 'Cost', 'Insects killed', 'Helpful alive'];

function csvCell(v: string): string {
  // Quote everything; a leading = + - @ would make a spreadsheet run it as a formula.
  const safe = /^[=+\-@]/.test(v) ? `'${v}` : v;
  return `"${safe.replace(/"/g, '""')}"`;
}

/** One row per experiment: notes, settings and results, ready for a spreadsheet. */
export function notebookCsv(entries: NotebookEntry[]): string {
  const sample = entries.find((e) => e.captured)?.captured;
  const resultLabels = sample ? summaryRows(sample).map(([k]) => k) : [];
  const header = ['Experiment', 'Saved', ...ENTRY_FIELDS.map((f) => f.label), ...resultLabels];
  const rows = entries.map((e) => {
    const results = e.captured ? summaryRows(e.captured).map(([, v]) => v) : resultLabels.map(() => '');
    return [e.name, e.captured ? new Date(e.captured.savedAt).toLocaleString() : '', ...ENTRY_FIELDS.map((f) => String(e[f.key] ?? '')), ...results];
  });
  return [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

function esc(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Only our own map pictures; anything else from an imported file is dropped. */
function safeSnapshot(src: string | undefined): string | null {
  return src && /^data:image\/(jpeg|png);base64,[A-Za-z0-9+/=]+$/.test(src) ? src : null;
}

const REPORT_CSS = `
body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#1e293b;max-width:960px;margin:0 auto;padding:24px;line-height:1.45}
h1{color:#1f6f3c;margin:0 0 4px}h2{margin:28px 0 8px;color:#1f6f3c;border-bottom:2px solid #d1fae5;padding-bottom:4px}
.meta{color:#64748b;margin:0 0 12px}.name{margin:12px 0;font-size:15px}
.note{background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:8px 12px;font-size:14px}
table{border-collapse:collapse;width:100%;font-size:13.5px;margin:8px 0}th,td{border:1px solid #cbd5e1;padding:4px 8px;text-align:left;vertical-align:top}
th{background:#f1f5f9}.overview td:first-child{font-weight:600}
.cols,.chart-block,.compare-chart{break-inside:avoid;page-break-inside:avoid}.cols{display:grid;grid-template-columns:1fr 1fr;gap:16px;align-items:start}
.notes p{margin:4px 0}.notes strong{display:block;font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:.4px;margin-top:8px}
.snap{width:100%;border:1px solid #cbd5e1;border-radius:6px}.muted{color:#94a3b8}
.actions{margin:12px 0}.actions button{font:inherit;padding:6px 14px;border-radius:8px;border:1px solid #1f6f3c;background:#2f8f4e;color:#fff;cursor:pointer}
.charts{display:grid;grid-template-columns:1fr 1fr;gap:10px 16px;margin-top:12px}.compare-chart{max-width:560px;margin:12px 0}h3{font-size:15px;margin:16px 0 0;color:#334155}
.chart{margin:0;border:1px solid #e2e8f0;border-radius:6px;padding:6px 8px}.chart figcaption{font-weight:600;font-size:13px;margin-bottom:2px}
.chart svg{width:100%;height:auto;display:block}.chart text{font-size:10px;fill:#64748b}.chart .grid{stroke:#e2e8f0}.chart .marker{stroke:#475569;stroke-dasharray:4 3}
.chart .rain{fill:#bfdbfe;opacity:.7}.legend{display:flex;flex-wrap:wrap;gap:2px 10px;font-size:11.5px;color:#475569}
.legend i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:4px;vertical-align:-1px}.legend .rain-key{background:#bfdbfe}
@media (max-width:700px){.cols,.charts{grid-template-columns:1fr}}
@media print{.actions{display:none}body{padding:0}.entry{break-before:page}h2,h3{break-after:avoid}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
`;

/** A self-contained HTML report a coach can open, print or save. */
export function notebookReportHtml(entries: NotebookEntry[], now = new Date()): string {
  const withResults = entries.filter((e) => e.captured);
  const overviewTable = withResults.length
    ? `<table class="overview"><thead><tr><th>Experiment</th>${OVERVIEW_LABELS.map((l) => `<th>${esc(l)}</th>`).join('')}</tr></thead><tbody>${withResults
        .map((e) => `<tr><td>${esc(e.name)}</td>${overview(e.captured!).map(([, v]) => `<td>${esc(v)}</td>`).join('')}</tr>`)
        .join('')}</tbody></table>`
    : '<p class="muted">No saved runs yet.</p>';

  const sections = entries
    .map((e) => {
      const notes = ENTRY_FIELDS.map((f) => {
        const v = String(e[f.key] ?? '').trim();
        return `<p><strong>${esc(f.label)}</strong>${v ? esc(v).replace(/\n/g, '<br>') : '<span class="muted">—</span>'}</p>`;
      }).join('');
      const snap = safeSnapshot(e.captured?.snapshot);
      const results = e.captured
        ? `${snap ? `<img class="snap" src="${snap}" alt="Map at the end of ${esc(e.name)}">` : ''}<table><tbody>${summaryRows(e.captured)
            .map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`)
            .join('')}</tbody></table>`
        : '<p class="muted">No run saved for this experiment.</p>';
      const chartGrid = e.captured ? runChartsHtml(e.captured.charts) : '';
      const charts = chartGrid && `<div class="chart-block"><h3>Charts for ${esc(e.name)}</h3>${chartGrid}</div>`;
      return `<section class="entry"><h2>${esc(e.name)}</h2><div class="cols"><div class="notes">${notes}</div><div>${results}</div></div>${charts}</section>`;
    })
    .join('');

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Experiment Report · Scent Dispersal Simulator</title><style>${REPORT_CSS}</style></head>
<body>
<h1>Experiment Report</h1>
<p class="meta">Scent Dispersal Simulator · ${esc(now.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }))} · ${entries.length} experiment${entries.length === 1 ? '' : 's'}</p>
<p class="name">Team or name: ______________________________</p>
<div class="actions"><button onclick="window.print()">🖨 Print or save as PDF</button></div>
<p class="note">⚠️ This is a simplified educational simulation, not the real world. Real insect behavior, scent movement, weather, crops and drones are much more complicated, so these numbers do not predict how a real product or method would perform.</p>
<h2>Overview</h2>
${overviewTable}
${compareChartHtml(withResults.map((e) => ({ name: e.name, charts: e.captured!.charts })), esc)}
${sections}
</body></html>
`;
}

export function reportFileStem(now = new Date()): string {
  const d = now.toISOString().slice(0, 10);
  return `scent-experiments-${d}`;
}
