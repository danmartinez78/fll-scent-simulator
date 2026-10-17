import { useEffect, useRef } from 'react';

const STEPS: Array<[string, string]> = [
  ['🗺️ Mission', 'Pick a farm problem to work on.'],
  ['🤔 Predict', 'Write down what you think will happen.'],
  ['✏️ Plan', 'Choose spray or scent devices and place them on the field.'],
  ['▶ Run', 'Watch the drone work and the pests react.'],
  ['📊 Compare', 'Check the results against your prediction.']
];

interface Props {
  open: boolean;
  onClose: () => void;
  /** Phone-sized screen: mention that the full simulator needs a bigger screen. */
  phone: boolean;
}

/** Short introduction shown the first time someone opens the site. */
export function WelcomeDialog({ open, onClose, phone }: Props) {
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
      className="loop-dialog welcome-dialog"
      aria-labelledby="welcome-title"
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
        <h2 id="welcome-title" className="welcome-title">
          👋 Welcome to the Scent Dispersal Simulator
        </h2>
        <p>
          Insect pests eat crops. One idea is to use drones to put scents in a field: a <strong>repellent</strong> that pushes pests away, or an{' '}
          <strong>attractant</strong> that pulls them somewhere else. Here you can test ideas like that safely before anyone tries them on a real
          farm.
        </p>
        <p className="welcome-bio">
          🐝 <strong>The big goal: protect the crop without killing insects.</strong> Pesticides kill pests, but they also kill bees that
          pollinate crops and ladybugs that eat pests for free. Scents move pests instead of killing them. Every run counts the insects killed,
          so you can see the cost of each plan.
        </p>
        <ol className="welcome-steps">
          {STEPS.map(([name, text]) => (
            <li key={name}>
              <strong>{name}</strong> <span>{text}</span>
            </li>
          ))}
        </ol>
        <p className="welcome-clock">
          ⏱ Drone flights play in <strong>real time</strong>. Once the drone lands, the field <strong>fast-forwards</strong> through several weeks
          so you can see what happens to the crop.
        </p>
        {phone && (
          <p className="welcome-phone">📱 On a phone you can try the guided missions. The full simulator works best on a tablet or computer.</p>
        )}
        <p className="hint small">This is a simplified model, so treat its results as ideas to test, not answers.</p>
        <button className="btn primary wide" onClick={onClose} autoFocus>
          Start with a mission →
        </button>
      </div>
    </dialog>
  );
}
