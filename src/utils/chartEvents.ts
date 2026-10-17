import type { SimEventKind } from '../models/types';

/** An event as the charts draw it: x in farm days. */
export interface ChartEvent {
  day: number;
  kind: SimEventKind;
  label: string;
}

/** Icon and line color for each kind of event, the same in the app and the report. */
export const EVENT_STYLE: Record<SimEventKind, { icon: string; color: string }> = {
  spray: { icon: '💧', color: '#0284c7' },
  wind: { icon: '🌬️', color: '#0f766e' },
  plan: { icon: '✏️', color: '#475569' },
  survey: { icon: '📷', color: '#7c3aed' },
  budget: { icon: '💲', color: '#b91c1c' },
  product: { icon: '🧴', color: '#b91c1c' }
};

export function isEventKind(k: unknown): k is SimEventKind {
  return typeof k === 'string' && Object.prototype.hasOwnProperty.call(EVENT_STYLE, k);
}

/** "Day 8" for a time in farm days (Day 1 is the first day). */
export function dayName(day: number): string {
  return `Day ${Math.floor(day + 1e-6) + 1}`;
}

/** Most events listed under a chart; the rest are counted. */
export const MAX_LISTED_EVENTS = 8;
