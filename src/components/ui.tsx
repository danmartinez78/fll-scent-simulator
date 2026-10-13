import { useEffect, useRef, useState, type ReactNode } from 'react';
import { HELP } from '../content/help';

/** Small "i" button that shows a one- or two-sentence explanation. */
export function InfoButton({ topic }: { topic: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const help = HELP[topic];
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  if (!help) return null;
  return (
    <span className="info" ref={ref}>
      <button
        type="button"
        className="info-btn"
        aria-label={`What is ${help.title}?`}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        i
      </button>
      {open && (
        <span className="info-pop" role="tooltip">
          <strong>{help.title}</strong>
          <span>{help.text}</span>
        </span>
      )}
    </span>
  );
}

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  info?: string;
  format?: (v: number) => string;
  onChange: (v: number) => void;
  disabled?: boolean;
}

export function Slider({ label, value, min, max, step = 1, unit = '', info, format, onChange, disabled }: SliderProps) {
  const shown = format ? format(value) : `${value}${unit ? ` ${unit}` : ''}`;
  return (
    <label className={`control ${disabled ? 'disabled' : ''}`}>
      <span className="control-label">
        {label}
        {info && <InfoButton topic={info} />}
        <span className="control-value">{shown}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}

interface NumberFieldProps {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  info?: string;
  onChange: (v: number) => void;
}

export function NumberField({ label, value, min, max, step = 1, unit, info, onChange }: NumberFieldProps) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = () => {
    const v = Number(text);
    if (Number.isFinite(v)) {
      let c = v;
      if (min !== undefined) c = Math.max(min, c);
      if (max !== undefined) c = Math.min(max, c);
      onChange(c);
      setText(String(c));
    } else setText(String(value));
  };
  return (
    <label className="control control-row">
      <span className="control-label">
        {label}
        {info && <InfoButton topic={info} />}
      </span>
      <span className="number-wrap">
        <input
          type="number"
          value={text}
          min={min}
          max={max}
          step={step}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === 'Enter' && commit()}
        />
        {unit && <span className="unit">{unit}</span>}
      </span>
    </label>
  );
}

interface SelectProps<T extends string> {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  info?: string;
  onChange: (v: T) => void;
}

export function Select<T extends string>({ label, value, options, info, onChange }: SelectProps<T>) {
  return (
    <label className="control control-row">
      <span className="control-label">
        {label}
        {info && <InfoButton topic={info} />}
      </span>
      <select value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function Toggle({
  label,
  checked,
  info,
  onChange
}: {
  label: string;
  checked: boolean;
  info?: string;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="control toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
      {info && <InfoButton topic={info} />}
    </label>
  );
}

export function Section({
  title,
  icon,
  children,
  open = false,
  note
}: {
  title: string;
  icon?: string;
  children: ReactNode;
  open?: boolean;
  note?: string;
}) {
  return (
    <details className="section" open={open}>
      <summary>
        {icon && <span className="section-icon" aria-hidden="true">{icon}</span>}
        {title}
        {note && <span className="section-note">{note}</span>}
      </summary>
      <div className="section-body">{children}</div>
    </details>
  );
}

/** Save text as a file the browser downloads. */
export function downloadText(filename: string, text: string, type = 'application/json'): void {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Ask for a file and read it as text. */
export function pickTextFile(accept = '.json,application/json'): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => {
      const f = input.files?.[0];
      if (!f) return resolve(null);
      f.text().then(resolve, () => resolve(null));
    };
    input.click();
  });
}
