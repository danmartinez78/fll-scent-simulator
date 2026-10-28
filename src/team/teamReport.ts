import { MODEL_NOTE } from '../content/help';
import { PLAN_KEYS, pickResultLines, TEAM_EXPERIMENTS, type TeamExperiment, type TeamNumber, type TeamRun } from './experiments';
import type { TeamExperimentState, TeamState } from './teamState';

export const PLAN_COLORS = { A: '#d97706', B: '#2f8f4e' } as const;

function esc(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Only our own map pictures; anything else from a stored file is dropped. */
function safeSnapshot(src: string | undefined): string | null {
  return src && /^data:image\/(jpeg|png);base64,[A-Za-z0-9+/=]+$/.test(src) ? src : null;
}

/** Both experiments' runs are done. */
export function experimentDone(st: TeamExperimentState | undefined): boolean {
  return !!st?.runs.A && !!st?.runs.B;
}

/** Two bars, plan A and plan B, for one number. */
function barsSvg(n: TeamNumber, a: TeamRun, b: TeamRun): string {
  const va = n.value(a.metrics);
  const vb = n.value(b.metrics);
  const max = n.max(va, vb);
  const w = 220;
  const bar = (v: number, y: number, color: string, label: string) =>
    `<rect x="0" y="${y}" width="${Math.max(2, (Math.min(v, max) / max) * w).toFixed(1)}" height="14" rx="3" fill="${color}"/>` +
    `<text x="${w + 6}" y="${y + 11}">${esc(label)}</text>`;
  return `<svg viewBox="0 0 300 36" role="img" aria-label="${esc(n.label)}">${bar(va, 0, PLAN_COLORS.A, n.text(a.metrics, a.settings))}${bar(vb, 20, PLAN_COLORS.B, n.text(b.metrics, b.settings))}</svg>`;
}

function textBlock(label: string, value: string): string {
  const v = value.trim();
  return `<div class="write"><strong>${esc(label)}</strong><p>${v ? esc(v).replace(/\n/g, '<br>') : '<span class="blank">&nbsp;</span>'}</p></div>`;
}

function experimentSection(exp: TeamExperiment, st: TeamExperimentState): string {
  const a = st.runs.A!;
  const b = st.runs.B!;
  const head = PLAN_KEYS.map((k) => {
    const p = exp.plans[k];
    const snap = safeSnapshot(st.runs[k]?.snapshot);
    return `<div class="plan"><h3><span class="tag" style="background:${PLAN_COLORS[k]}">${k}</span> ${p.icon} ${esc(p.name)}</h3><p class="muted">${esc(p.detail)}</p>${snap ? `<img src="${snap}" alt="Map at the end of plan ${k}">` : ''}</div>`;
  }).join('');
  const rows = exp.numbers
    .map((n) => `<tr><th>${esc(n.label)}</th><td>${barsSvg(n, a, b)}</td></tr>`)
    .join('');
  const picks = pickResultLines(exp, st.guesses, st.runs)
    .map(
      (l) =>
        `<tr><td>${esc(l.question)}</td><td>${esc(l.guess)}</td><td>${esc(l.answer)}</td><td>${l.right === null ? '' : l.right ? '✓' : '✗'}</td></tr>`
    )
    .join('');
  return `<section class="exp">
<h2>${exp.icon} ${esc(exp.title)}</h2>
<p class="question">❓ ${esc(exp.question)}</p>
<p class="muted">${esc(exp.setup)}</p>
<div class="plans">${head}</div>
<table class="numbers"><tbody>${rows}</tbody></table>
<p class="legend"><i style="background:${PLAN_COLORS.A}"></i>A: ${esc(exp.plans.A.name)} <i style="background:${PLAN_COLORS.B}"></i>B: ${esc(exp.plans.B.name)}</p>
<h3>Our prediction</h3>
<table class="picks"><thead><tr><th>Question</th><th>We guessed</th><th>What happened</th><th></th></tr></thead><tbody>${picks}</tbody></table>
${textBlock('Why we thought so', st.because)}
${textBlock('What we found', st.found)}
${textBlock('How we could check it in the real world', st.realWorld)}
<p class="note">⚠️ ${esc(MODEL_NOTE)}</p>
</section>`;
}

const CSS = `
body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#1e293b;max-width:860px;margin:0 auto;padding:20px;line-height:1.4;font-size:14px}
h1{color:#1f6f3c;margin:0;font-size:24px}h2{color:#1f6f3c;margin:0 0 4px;font-size:21px}h3{margin:10px 0 4px;font-size:15px}
.meta{color:#64748b;margin:2px 0 10px}.muted{color:#64748b;margin:2px 0}.question{font-weight:600;font-size:15px;margin:4px 0}
.plans{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin:8px 0}.plan h3{margin:0}.plan img{width:100%;border:1px solid #cbd5e1;border-radius:6px;margin-top:4px}
.tag{display:inline-block;color:#fff;border-radius:4px;padding:0 6px;font-size:13px}
table{border-collapse:collapse;width:100%;margin:4px 0}th,td{border:1px solid #cbd5e1;padding:4px 8px;text-align:left;vertical-align:middle}
.numbers th{width:34%;background:#f8fafc}.numbers svg{width:100%;max-width:360px;height:auto;display:block}.numbers text{font-size:11px;fill:#1e293b}
.picks th{background:#f1f5f9;font-size:13px}.picks td{font-size:13px}
.legend{font-size:12.5px;color:#475569;margin:2px 0 6px}.legend i{display:inline-block;width:10px;height:10px;border-radius:2px;margin:0 4px 0 10px;vertical-align:-1px}.legend i:first-child{margin-left:0}
.write{margin:6px 0}.write strong{display:block;font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:.4px}.write p{margin:2px 0;min-height:1.4em}
.blank{display:block;border-bottom:1px solid #94a3b8;height:1.6em}
.note{background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:6px 10px;font-size:12.5px;margin-top:10px}
.actions{margin:8px 0}.actions button{font:inherit;padding:6px 14px;border-radius:8px;border:1px solid #1f6f3c;background:#2f8f4e;color:#fff;cursor:pointer}
.exp+.exp{margin-top:28px}
@media (max-width:600px){.plans{grid-template-columns:1fr}}
@media print{@page{margin:12mm}.actions{display:none}body{padding:0;font-size:12.5px}.exp+.exp{break-before:page;margin-top:0}.exp{break-inside:avoid}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
`;

/** A one-page-per-experiment report for the team presentation. */
export function teamReportHtml(state: TeamState, now = new Date()): string {
  const sections = TEAM_EXPERIMENTS.filter((e) => experimentDone(state.experiments[e.id]))
    .map((e) => experimentSection(e, state.experiments[e.id]!))
    .join('');
  const team = state.teamName.trim();
  const date = now.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Team Experiment Report · Scent Dispersal Simulator</title><style>${CSS}</style></head>
<body>
<h1>Our Experiment Report</h1>
<p class="meta">${team ? `${esc(team)} · ` : ''}Scent Dispersal Simulator · ${esc(date)}</p>
<div class="actions"><button onclick="window.print()">🖨 Print or save as PDF</button></div>
${sections || '<p class="muted">Run both plans of an experiment to fill in this report.</p>'}
</body></html>
`;
}

export function teamFileStem(now = new Date()): string {
  return `team-experiment-${now.toISOString().slice(0, 10)}`;
}
