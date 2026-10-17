import { useEffect, useRef, type ReactNode } from 'react';

interface Props {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}

/** The full notebook in a pop-up, for Guided mode (which has no side panel). */
export function NotebookDialog({ open, onClose, children }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className="loop-dialog notebook-dialog"
      aria-labelledby="notebook-dialog-title"
      onClose={onClose}
      onClick={(e) => {
        // A click on the dark area around the box closes it.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="loop-dialog-body">
        <button className="dialog-close" aria-label="Close" onClick={onClose}>
          ✕
        </button>
        <h2 id="notebook-dialog-title" className="notebook-dialog-title">
          📓 Experiment notebook
        </h2>
        {open && children}
      </div>
    </dialog>
  );
}
