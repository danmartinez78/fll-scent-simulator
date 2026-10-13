/**
 * Decides whether a press on the map is a real click on the map.
 *
 * Native dropdown menus (the scenario picker, the "Where they start" list)
 * draw outside the page, so they can sit on top of the map. Depending on the
 * browser and on touch vs. mouse, picking an option or clicking away to close
 * the menu can also send a press to the map underneath. Placing a device on
 * every pointerdown turned those presses into stray devices.
 *
 * The rules:
 * - A device is placed (or erased) only on a full click: a press and a release
 *   on the map with the same pointer, with little movement in between.
 * - While a dropdown is open, the next press on the map only closes it.
 * - For a short moment after a dropdown closes, presses on the map are ignored.
 */

export interface Press {
  pointerId: number;
  x: number;
  y: number;
}

/** How long after a menu closes that map presses are ignored, in ms. */
export const MENU_QUIET_MS = 400;
/** How far a press may move (in screen pixels) and still count as a click. */
export const CLICK_SLOP_PX = 8;

export class ClickGuard {
  private menuOpen: unknown = null;
  private quietUntil = 0;
  private press: Press | null = null;

  /** A dropdown was pressed: it opens, or closes if it was the one already open. */
  menuPressed(menu: unknown, now: number): void {
    if (this.menuOpen === menu) this.menuClosed(now);
    else this.menuOpen = menu;
  }

  /** A dropdown closed (an option was picked, or it lost focus). */
  menuClosed(now: number): void {
    this.menuOpen = null;
    this.quietUntil = Math.max(this.quietUntil, now + MENU_QUIET_MS);
  }

  /** Something else on the page was pressed, which closes any open dropdown. */
  pressedElsewhere(now: number): void {
    if (this.menuOpen !== null) this.menuClosed(now);
  }

  /** Called on pointerdown on the map. Returns false if the press should be ignored. */
  down(p: Press, now: number, primary = true): boolean {
    this.press = null;
    if (!primary) return false;
    if (this.menuOpen !== null) {
      // This press closes the open dropdown; it is not meant for the map.
      this.menuClosed(now);
      return false;
    }
    if (now < this.quietUntil) return false;
    this.press = p;
    return true;
  }

  /** Called on pointerup on the map. Returns true if this completes a click on the map. */
  up(p: Press, now: number): boolean {
    const start = this.press;
    this.press = null;
    if (!start || start.pointerId !== p.pointerId) return false;
    if (now < this.quietUntil) return false;
    return Math.hypot(p.x - start.x, p.y - start.y) <= CLICK_SLOP_PX;
  }

  /** Forget a press in progress (pointercancel). */
  cancel(): void {
    this.press = null;
  }
}
