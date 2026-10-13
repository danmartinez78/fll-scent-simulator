import type { Rect, Vec } from '../models/types';

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by);
}

export function inRect(x: number, y: number, r: Rect): boolean {
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}

/** Closest point inside a rectangle. */
export function closestInRect(x: number, y: number, r: Rect): Vec {
  return { x: clamp(x, r.x, r.x + r.w), y: clamp(y, r.y, r.y + r.h) };
}

/** Rectangle from two corner points in any order. */
export function rectFromPoints(a: Vec, b: Vec): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(a.x - b.x),
    h: Math.abs(a.y - b.y)
  };
}

/** Overlap of a rectangle with another (null when they don't touch). */
export function intersectRect(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  if (x2 <= x || y2 <= y) return null;
  return { x, y, w: x2 - x, h: y2 - y };
}

/**
 * Back-and-forth ("lawnmower") passes covering a rectangle, like a farmer
 * mowing a lawn. Passes run along the longer side. Returns pairs of points:
 * each pass goes from [i] to [i + 1].
 */
export function lawnmower(r: Rect, spacing: number): Array<[Vec, Vec]> {
  const legs: Array<[Vec, Vec]> = [];
  const alongX = r.w >= r.h;
  const across = alongX ? r.h : r.w;
  const n = Math.max(1, Math.ceil(across / spacing));
  const step = across / n;
  for (let i = 0; i < n; i++) {
    const off = step * (i + 0.5);
    let a: Vec;
    let b: Vec;
    if (alongX) {
      a = { x: r.x, y: r.y + off };
      b = { x: r.x + r.w, y: r.y + off };
    } else {
      a = { x: r.x + off, y: r.y };
      b = { x: r.x + off, y: r.y + r.h };
    }
    legs.push(i % 2 === 0 ? [a, b] : [b, a]);
  }
  return legs;
}

/** Compass label for a direction in degrees (0 = north). */
export function compassLabel(deg: number): string {
  const names = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const i = Math.round((((deg % 360) + 360) % 360) / 45) % 8;
  return names[i];
}

export function compassName(deg: number): string {
  const names = [
    'north',
    'northeast',
    'east',
    'southeast',
    'south',
    'southwest',
    'west',
    'northwest'
  ];
  const i = Math.round((((deg % 360) + 360) % 360) / 45) % 8;
  return names[i];
}
