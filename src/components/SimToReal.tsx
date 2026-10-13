import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * A short, paged lesson: why engineers use simulators, why every simulator
 * is wrong, and how they still draw conclusions they can trust.
 */

/** Small dot plot of crop protected (%) for a few runs. Illustrative numbers, not real results. */
function DotRows({ rows }: { rows: Array<{ label: string; values: number[]; tone: string }> }) {
  const w = 300;
  const rowH = 34;
  const x = (v: number) => 46 + ((v - 30) / 70) * (w - 60);
  return (
    <svg className="dots" viewBox={`0 0 ${w} ${rows.length * rowH + 22}`} role="img" aria-label="Dot plot of crop protected for each run">
      {rows.map((r, i) => {
        const y = 18 + i * rowH;
        return (
          <g key={r.label}>
            <text x={0} y={y + 4} className="dots-label">
              {r.label}
            </text>
            <line x1={x(30)} x2={x(100)} y1={y} y2={y} className="dots-axis" />
            {r.values.map((v, k) => (
              <circle key={k} cx={x(v)} cy={y} r={5} className={`dot-${r.tone}`} />
            ))}
          </g>
        );
      })}
      {[30, 50, 70, 90].map((v) => (
        <text key={v} x={x(v)} y={rows.length * rowH + 16} className="dots-tick" textAnchor="middle">
          {v}%
        </text>
      ))}
    </svg>
  );
}

interface Page {
  title: string;
  body: ReactNode;
}

const PAGES: Page[] = [
  {
    title: 'Why use a simulator?',
    body: (
      <>
        <p>
          A crop grows once a season, so a real field gives you only a few tries a year. Real tests cost money, and a bad idea can ruin a crop.
        </p>
        <p>
          A simulator gives you hundreds of tries in an afternoon. You can fail safely, repeat an experiment exactly, and see things you can't see
          outside, like scent clouds.
        </p>
      </>
    )
  },
  {
    title: 'Every simulator is wrong',
    body: (
      <>
        <p>
          Our simulator leaves out a lot: real insects, rain, hills, and exactly how scent drifts. The difference between a simulator and the real
          world is called the <strong>sim-to-real gap</strong>. It will never be zero.
        </p>
        <p>So how can a simulator that is wrong still help us decide anything? Engineers use a few tricks. The next pages show them.</p>
      </>
    )
  },
  {
    title: 'Trick 1: Never trust one run',
    body: (
      <>
        <p>
          Pests move a little randomly, so one run is partly luck. Change the <strong>random seed</strong> and run again. Do that many times and
          look at the spread: the lowest, the highest and the middle.
        </p>
        <DotRows rows={[{ label: 'Plan A', values: [58, 63, 66, 69, 71, 72, 74, 77, 81], tone: 'a' }]} />
        <p className="hint small">Each dot is one run of the same plan with a different seed.</p>
      </>
    )
  },
  {
    title: "Trick 2: Wiggle what you're not sure about",
    body: (
      <>
        <p>
          We don't know exactly how well the real scent works. Maybe half the pests react, maybe 9 out of 10. So test your plan with{' '}
          <em>Scent effectiveness</em> at 50%, 70% and 90%. Do the same for other things you're unsure of, like wind or how fast pests fly.
        </p>
        <p>
          Engineers call this <strong>randomizing the parameters</strong>. A plan that does well across the whole range is called{' '}
          <strong>robust</strong>, and a robust plan is much more likely to work in the real world.
        </p>
      </>
    )
  },
  {
    title: 'Trick 3: Add the mess on purpose',
    body: (
      <>
        <p>
          Real cameras miss things, positions are a few meters off, and wind gusts. Our simulator adds that mess on purpose: the survey camera misses
          pests and reports fake ones, and the wind can swing back and forth. This is called <strong>noise modeling</strong>.
        </p>
        <p>If a plan only works when everything is perfect, it probably won't work outside.</p>
      </>
    )
  },
  {
    title: 'Trick 4: Let the evidence pile up',
    body: (
      <>
        <p>Run two plans many times each, with different seeds and settings, and compare them.</p>
        <DotRows
          rows={[
            { label: 'Plan A', values: [62, 66, 70, 72, 74, 77, 80], tone: 'a' },
            { label: 'Plan B', values: [40, 45, 48, 52, 55, 58, 64], tone: 'b' }
          ]}
        />
        <p>
          If A beats B in 18 of 20 runs, that's <strong>strong evidence</strong>. If A wins only 11 of 20, it's close to a coin flip, and you can't
          really tell them apart.
        </p>
      </>
    )
  },
  {
    title: 'What can we conclude?',
    body: (
      <>
        <div className="can-cant">
          <div className="can">
            <strong>✅ We can say</strong>
            <span>"Plan A beat Plan B in almost every condition we tried."</span>
            <span>"Putting repellent upwind helped every time."</span>
          </div>
          <div className="cant">
            <strong>❌ We can't say</strong>
            <span>"Plan A will save exactly 72% of a real crop."</span>
          </div>
        </div>
        <p>
          Comparisons and patterns cross the sim-to-real gap much better than exact numbers. So use the simulator to pick the winner, then test the
          winner for real.
        </p>
      </>
    )
  },
  {
    title: 'Close the gap',
    body: (
      <>
        <p>When the real test comes back, compare it with the simulator. If they disagree, the model is missing something, so fix it.</p>
        <div className="loop-example">
          <strong>Example:</strong> in a real test plot, only about 6 out of 10 pests moved away from the scent. Set <em>Scent effectiveness</em> to
          60% and run your plans again. Does the winner change?
        </div>
        <p>
          Every loop of <strong>simulate → test for real → fix the model</strong> makes the simulator a little more trustworthy. Robot teams do the
          same with the SPIKE simulator and the real mat.
        </p>
      </>
    )
  }
];

/** The lesson, one short page at a time. */
export function SimLesson({ onDone }: { onDone?: () => void }) {
  const [i, setI] = useState(0);
  const page = PAGES[i];
  const last = i === PAGES.length - 1;
  return (
    <div className="lesson">
      <div className="lesson-progress" aria-label={`Page ${i + 1} of ${PAGES.length}`}>
        {PAGES.map((p, k) => (
          <button
            key={p.title}
            className={k === i ? 'pip current' : k < i ? 'pip done' : 'pip'}
            aria-label={`Go to page ${k + 1}: ${p.title}`}
            onClick={() => setI(k)}
          />
        ))}
      </div>
      <h3 className="lesson-title">{page.title}</h3>
      <div className="lesson-body">{page.body}</div>
      <div className="lesson-nav">
        <button className="btn" disabled={i === 0} onClick={() => setI(i - 1)}>
          ← Back
        </button>
        <span className="muted">
          {i + 1} of {PAGES.length}
        </span>
        {last ? (
          onDone ? (
            <button className="btn primary" onClick={onDone}>
              Done
            </button>
          ) : (
            <button className="btn" onClick={() => setI(0)}>
              Start over
            </button>
          )
        ) : (
          <button className="btn primary" onClick={() => setI(i + 1)}>
            Next →
          </button>
        )}
      </div>
    </div>
  );
}

/** Pop-up version of the lesson, opened from the note at the bottom of the page. */
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
      aria-label="Simulators and the real world"
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
        {/* Remount on each open so the lesson starts at page 1. */}
        {open && <SimLesson onDone={onClose} />}
      </div>
    </dialog>
  );
}
