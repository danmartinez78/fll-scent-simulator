import { useEffect, useRef, useState } from 'react';
import { ENTRY_FIELDS, summaryRows, type CapturedRun, type NotebookEntry } from '../notebook/notebook';

/** What the student writes when saving a run as a notebook experiment. */
export type ExperimentNotes = Pick<
  NotebookEntry,
  'name' | 'question' | 'prediction' | 'variablesChanged' | 'variablesSame' | 'result' | 'surprise' | 'next' | 'realWorld'
>;

interface Props {
  open: boolean;
  /** The run being saved (its settings and results are recorded with the notes). */
  run: CapturedRun | null;
  /** Starting values: name, and anything already known (question, prediction). */
  initial: ExperimentNotes;
  /** What changed since the previous run, offered as a hint for "Variables changed". */
  changeHint: string;
  /** True when this fills in an experiment the student already started in the notebook. */
  updating: boolean;
  onSave: (notes: ExperimentNotes) => void;
  onClose: () => void;
}

/** Results worth seeing while writing, in the order students read them. */
const KEY_RESULTS = ['Crop protected', 'Pests kept off crop (average)', 'Estimated cost', 'Insects killed', 'Helpful insects alive', 'Treatment'];

/** A notebook page in a pop-up: the student names the experiment, writes it up, and saves it. */
export function SaveExperimentDialog({ open, run, initial, changeHint, updating, onSave, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const [notes, setNotes] = useState<ExperimentNotes>(initial);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      setNotes(initial);
      d.showModal();
    }
    if (!open && d.open) d.close();
  }, [open]); // Reset the fields only when the dialog opens.
  const set = (k: keyof ExperimentNotes, v: string) => setNotes((n) => ({ ...n, [k]: v }));
  const results = run ? summaryRows(run).filter(([k]) => KEY_RESULTS.includes(k)) : [];
  return (
    <dialog
      ref={ref}
      className="loop-dialog save-dialog"
      aria-labelledby="save-dialog-title"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="loop-dialog-body">
        <button className="dialog-close" aria-label="Close" onClick={onClose}>
          ✕
        </button>
        <h2 id="save-dialog-title" className="notebook-dialog-title">
          📓 Save this experiment
        </h2>
        <p className="hint small">
          The settings and results are saved for you. Write down what you learned, so you can compare it with other experiments later.
        </p>
        {results.length > 0 && (
          <dl className="save-results">
            {results.map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        )}
        <label className="control">
          <span className="control-label">Experiment name</span>
          <input type="text" value={notes.name} onChange={(e) => set('name', e.target.value)} />
        </label>
        {ENTRY_FIELDS.map((f) => (
          <label key={f.key} className="control">
            <span className="control-label">
              {f.key === 'realWorld' ? '🌱 ' : ''}
              {f.label}
            </span>
            <textarea
              rows={2}
              placeholder={f.key === 'variablesChanged' && changeHint ? `Hint, what changed since last run: ${changeHint}` : f.hint}
              value={notes[f.key as keyof ExperimentNotes] as string}
              onChange={(e) => set(f.key as keyof ExperimentNotes, e.target.value)}
            />
          </label>
        ))}
        <div className="tool-row save-actions">
          <button className="btn primary" onClick={() => onSave({ ...notes, name: notes.name.trim() || initial.name })}>
            📓 {updating ? 'Save into my experiment' : 'Save to notebook'}
          </button>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </dialog>
  );
}
