import { useEffect, useRef } from 'react';

const LOOP = [
  {
    icon: '🧠',
    title: 'Model',
    text: 'Write down what we think is true: pests avoid repellent, wind carries scent, a heavy drone flies for less time. The simulator is these ideas turned into math.'
  },
  {
    icon: '💻',
    title: 'Simulate',
    text: 'Try many plans fast, cheaply and safely. Find the ideas worth testing for real, and the ones that are not.'
  },
  {
    icon: '🌱',
    title: 'Test for real',
    text: 'Run a small real trial with the best idea: a test plot, a real device, a real drone flight. Measure the same things the simulator measures.'
  },
  {
    icon: '🔧',
    title: 'Compare and improve',
    text: 'If the real result is different, the model is missing something. Change its numbers to match what you measured (this is called calibrating), then simulate again.'
  }
];

/** The sim-to-real loop: how engineers use a simulator and make it more trustworthy. */
export function SimToRealLoop() {
  return (
    <div className="loop">
      <p className="lead">
        Engineers don't trust a simulator because it looks real. They trust it because they keep checking it against the real world and fixing it when it's wrong.
      </p>
      <ol className="loop-steps">
        {LOOP.map((s, i) => (
          <li key={s.title}>
            <span className="loop-icon" aria-hidden="true">{s.icon}</span>
            <div>
              <strong>
                {i + 1}. {s.title}
              </strong>
              <span>{s.text}</span>
            </div>
          </li>
        ))}
      </ol>
      <p className="loop-again">🔁 Then go around again. Every loop makes the model a little more trustworthy.</p>
      <div className="loop-example">
        <strong>Example:</strong> the simulator says 80% of pests react to the scent. In a real test plot, only about 6 out of 10 pests moved away.
        Set <em>Scent effectiveness</em> to 60% and run your plans again. Does the best plan change?
      </div>
      <p className="hint small">
        Robot teams work the same way: test a program in the SPIKE simulator, run it on the real mat, and adjust when the robot doesn't do what the simulator showed.
      </p>
    </div>
  );
}

/** Pop-up version of the loop, opened from the note at the bottom of the page. */
export function SimToRealDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
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
      className="loop-dialog"
      aria-labelledby="loop-title"
      onClose={onClose}
      onClick={(e) => {
        // A click on the dark area around the box closes it.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="loop-dialog-body">
        <h2 id="loop-title">How engineers use simulators</h2>
        <SimToRealLoop />
        <button className="btn primary wide" onClick={onClose}>
          Got it
        </button>
      </div>
    </dialog>
  );
}
