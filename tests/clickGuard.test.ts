import { describe, expect, it } from 'vitest';
import { ClickGuard, MENU_QUIET_MS } from '../src/components/clickGuard';

const at = (x: number, y: number, pointerId = 1) => ({ pointerId, x, y });

describe('map click guard', () => {
  it('counts a press and release in the same spot as a click', () => {
    const g = new ClickGuard();
    expect(g.down(at(100, 100), 1000)).toBe(true);
    expect(g.up(at(102, 101), 1100)).toBe(true);
  });

  it('ignores a release with no press on the map (a press that started in a menu)', () => {
    const g = new ClickGuard();
    expect(g.up(at(100, 100), 1000)).toBe(false);
  });

  it('ignores a release from a different pointer', () => {
    const g = new ClickGuard();
    g.down(at(100, 100, 1), 1000);
    expect(g.up(at(100, 100, 2), 1050)).toBe(false);
  });

  it('ignores a press that moved too far', () => {
    const g = new ClickGuard();
    g.down(at(100, 100), 1000);
    expect(g.up(at(140, 100), 1100)).toBe(false);
  });

  it('ignores non-primary buttons', () => {
    const g = new ClickGuard();
    expect(g.down(at(100, 100), 1000, false)).toBe(false);
    expect(g.up(at(100, 100), 1050)).toBe(false);
  });

  it('uses the first map press after opening a dropdown to close it', () => {
    const g = new ClickGuard();
    const menu = {};
    g.menuPressed(menu, 1000);
    expect(g.down(at(100, 100), 3000)).toBe(false);
    expect(g.up(at(100, 100), 3050)).toBe(false);
    // The next click works.
    expect(g.down(at(100, 100), 4000)).toBe(true);
    expect(g.up(at(100, 100), 4050)).toBe(true);
  });

  it('ignores map presses right after an option is picked', () => {
    const g = new ClickGuard();
    const menu = {};
    g.menuPressed(menu, 1000);
    g.menuClosed(2000);
    expect(g.down(at(100, 100), 2000 + MENU_QUIET_MS / 2)).toBe(false);
    expect(g.down(at(100, 100), 2000 + MENU_QUIET_MS + 1)).toBe(true);
  });

  it('ignores a release that leaks through just after a menu closes', () => {
    const g = new ClickGuard();
    g.down(at(100, 100), 1000);
    g.menuClosed(1010);
    expect(g.up(at(100, 100), 1020)).toBe(false);
  });

  it('pressing the same dropdown again closes it', () => {
    const g = new ClickGuard();
    const menu = {};
    g.menuPressed(menu, 1000);
    g.menuPressed(menu, 1500);
    expect(g.down(at(100, 100), 1500 + MENU_QUIET_MS + 1)).toBe(true);
  });

  it('pressing other buttons does not delay map clicks when no menu is open', () => {
    const g = new ClickGuard();
    g.pressedElsewhere(1000);
    expect(g.down(at(100, 100), 1010)).toBe(true);
  });
});
