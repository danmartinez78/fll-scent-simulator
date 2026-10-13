import { useState } from 'react';
import { createPortal } from 'react-dom';
import {
  compareRows,
  duplicateEntry,
  ENTRY_FIELDS,
  entrySetup,
  exportNotebook,
  neutralSummary,
  newEntry,
  nextName,
  parseNotebook,
  summaryRows,
  type EntrySetup,
  type NotebookEntry
} from '../notebook/notebook';
import { downloadText, pickTextFile } from './ui';
import { ReportButtons } from './ReportButtons';

interface Props {
  entries: NotebookEntry[];
  activeId: string | null;
  simTime: number;
  onActive: (id: string | null) => void;
  onEntries: (e: NotebookEntry[] | ((prev: NotebookEntry[]) => NotebookEntry[])) => void;
  onSaveRun: (entryId: string) => void;
  onLoadSetup: (s: EntrySetup) => void;
}

const FLOW = ['question', 'prediction', 'run', 'save results', 'what happened', 'what next'];

export function NotebookPanel({ entries, activeId, simTime, onActive, onEntries, onSaveRun, onLoadSetup }: Props) {
  const [mode, setMode] = useState<'edit' | 'compare'>('edit');
  const [aId, setAId] = useState<string>('');
  const [bId, setBId] = useState<string>('');
  const active = entries.find((e) => e.id === activeId) ?? null;

  const update = (id: string, patch: Partial<NotebookEntry>) =>
    onEntries((list) => list.map((e) => (e.id === id ? { ...e, ...patch } : e)));

  const add = () => {
    const e = newEntry(nextName(entries));
    onEntries([...entries, e]);
    onActive(e.id);
    setMode('edit');
  };

  const withResults = entries.filter((e) => e.captured);
  const a = withResults.find((e) => e.id === aId) ?? withResults[withResults.length - 2];
  const b = withResults.find((e) => e.id === bId) ?? withResults[withResults.length - 1];

  return (
    <div className="notebook">
      <p className="flow">Each experiment: {FLOW.join(' → ')}.</p>

      <div className="tool-row">
        <button className="btn small primary" onClick={add}>
          ＋ New experiment
        </button>
        <button className={mode === 'compare' ? 'btn small active' : 'btn small'} onClick={() => setMode(mode === 'compare' ? 'edit' : 'compare')} disabled={withResults.length < 2}>
          ⇆ Compare two
        </button>
      </div>
      <div className="tool-row share-row">
        <span className="row-label">Save or share</span>
        <ReportButtons entries={entries} />
        <button
          className="btn small"
          onClick={() => downloadText('experiment-notebook.json', exportNotebook(entries))}
          disabled={!entries.length}
          title="Save a notebook file you can import on another computer"
        >
          ⬇ Export
        </button>
        <button
          className="btn small"
          onClick={async () => {
            const text = await pickTextFile();
            if (!text) return;
            try {
              const imported = parseNotebook(text);
              const ids = new Set(entries.map((e) => e.id));
              onEntries([...entries, ...imported.filter((e) => !ids.has(e.id))]);
            } catch (err) {
              alert(`Could not read that notebook file: ${(err as Error).message}`);
            }
          }}
        >
          ⬆ Import
        </button>
      </div>

      {entries.length === 0 && (
        <p className="empty">
          No experiments yet. Press <strong>New experiment</strong>, write your question and prediction, then run the simulation and save the results here.
        </p>
      )}

      <div className="entry-list">
        {entries.map((e) => (
          <button key={e.id} className={e.id === activeId ? 'entry-chip active' : 'entry-chip'} onClick={() => { onActive(e.id); setMode('edit'); }}>
            {e.name}
            {e.captured ? ' ✅' : ''}
          </button>
        ))}
      </div>

      {mode === 'edit' && active && (
        <div className="entry">
          <label className="control">
            <span className="control-label">Experiment name</span>
            <input type="text" value={active.name} onChange={(ev) => update(active.id, { name: ev.target.value })} />
          </label>
          {ENTRY_FIELDS.map((f) => (
            <label key={f.key} className="control">
              <span className="control-label">{f.label}</span>
              <textarea
                rows={2}
                placeholder={f.hint}
                value={active[f.key] as string}
                onChange={(ev) => update(active.id, { [f.key]: ev.target.value } as Partial<NotebookEntry>)}
              />
            </label>
          ))}

          {active.captured ? (
            <>
              <h3>Saved results</h3>
              <table className="table compact">
                <tbody>
                  {summaryRows(active.captured).map(([k, v]) => (
                    <tr key={k}>
                      <td>{k}</td>
                      <td>{v}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : (
            <p className="hint">
              {simTime > 0 ? 'Press the button below to save the current run (settings and results) into this experiment.' : 'Run the simulation, then save the results here.'}
            </p>
          )}

          <div className="tool-row">
            <button
              className="btn small primary"
              disabled={simTime === 0}
              onClick={() => {
                if (active.captured && !confirm('Replace the saved results in this experiment with the current run?')) return;
                onSaveRun(active.id);
              }}
            >
              📥 Save current run here
            </button>
            <button
              className="btn small"
              onClick={() => {
                const d = duplicateEntry(active, entries);
                onEntries([...entries, d]);
                onActive(d.id);
              }}
              title="Copy this experiment so you can change one variable and run it again"
            >
              ⧉ Duplicate (change one thing)
            </button>
            <button className="btn small" disabled={!entrySetup(active)} onClick={() => { const s = entrySetup(active); if (s) onLoadSetup(s); }}>
              ↩ Load this setup
            </button>
            <button
              className="btn small danger"
              onClick={() => {
                if (!confirm(`Delete ${active.name}?`)) return;
                onEntries(entries.filter((e) => e.id !== active.id));
                onActive(null);
              }}
            >
              🗑 Delete
            </button>
          </div>
        </div>
      )}

      {mode === 'compare' && a && b && (
        <div className="compare">
          <div className="compare-pick">
            <label>
              A
              <select value={a.id} onChange={(e) => setAId(e.target.value)}>
                {withResults.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              B
              <select value={b.id} onChange={(e) => setBId(e.target.value)}>
                {withResults.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <table className="table compact">
            <thead>
              <tr>
                <th>Measure</th>
                <th>{a.name}</th>
                <th>{b.name}</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Prediction</td>
                <td>{a.prediction || '—'}</td>
                <td>{b.prediction || '—'}</td>
              </tr>
              {compareRows(a.captured!, b.captured!).map((r) => (
                <tr key={r.label} className={r.differs ? 'differs' : ''}>
                  <td>{r.label}</td>
                  <td>{r.a}</td>
                  <td>{r.b}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="hint small">Highlighted rows are different between the two experiments.</p>
          <p className="neutral">{neutralSummary(a.name, a.captured!, b.name, b.captured!)}</p>
          <p className="question-prompt">What do you notice? Did the results support your predictions?</p>
        </div>
      )}

      {createPortal(<PrintableNotebook entries={entries} />, document.body)}
    </div>
  );
}

function PrintableNotebook({ entries }: { entries: NotebookEntry[] }) {
  return (
    <div className="print-area" aria-hidden="true">
      <h1>Experiment Notebook</h1>
      <p>Scent Dispersal Simulator · printed {new Date().toLocaleDateString()}</p>
      <p className="print-note">
        This is a simplified educational simulation. Real insect behavior, scent movement, weather, crop conditions, and drone performance are much more complicated.
      </p>
      {entries.map((e) => (
        <section key={e.id} className="print-entry">
          <h2>{e.name}</h2>
          {ENTRY_FIELDS.map((f) => (
            <p key={f.key}>
              <strong>{f.label}:</strong> {(e[f.key] as string) || '—'}
            </p>
          ))}
          {e.captured && (
            <table>
              <tbody>
                {summaryRows(e.captured).map(([k, v]) => (
                  <tr key={k}>
                    <td>{k}</td>
                    <td>{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      ))}
    </div>
  );
}
