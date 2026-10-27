// Scroll-only navigation on top of the public API: the viewer has no such mode yet (it zooms on the wheel), so this example
//  - catches the wheel on the table frame in the capture phase, before the viewer's own listener, and turns it into a vertical scroll of
//    whole rows through setViewport (the overview strip included: the wheel over it scrolls too);
//  - catches the zoom keys (+, -) and the double click the same way;
//  - and locks the window after any change (a pinch, a drag, the search focusing a tip, a resize): the height of the window is the fitted
//    one, which `rowHeight` sets, and the x window is the fitted one too, so the tree column never zooms. The rows stop at the first and
//    the last tip (the viewer allows 15% of overscroll when zoomed in).
// What it cannot do from outside: a pinch or a zoom is drawn by the viewer and then undone here (in the same task, so normally no frame
// shows it), and the viewer keeps its zoom cursor and behaviour everywhere else. See the README, "Gaps".

import type { TreeViewer, Viewport } from '@canopy/viewer';

const LINE_PX = 16; // a wheel 'line' (deltaMode 1)

export class RowScroller {
  private busy = false;

  constructor(
    private viewer: TreeViewer,
    frame: HTMLElement,
  ) {
    frame.addEventListener('wheel', this.onWheel, { capture: true, passive: false });
    frame.addEventListener('keydown', this.onKey, { capture: true });
    frame.addEventListener('dblclick', this.onDbl, { capture: true });
    viewer.on('viewchange', () => this.lock());
    viewer.on('resize', () => this.lock());
    viewer.on('optionschange', () => this.lock());
  }

  /** Rows in the window: the height of the fitted window, which `rowHeight` sets. */
  get pageRows(): number {
    const f = this.viewer.fitViewport();
    return f.y1 - f.y0;
  }

  /** The first row in view (fractional). */
  get top(): number {
    return this.viewer.getViewport().y0;
  }

  /** Scroll so that row `y0` is the first in view (clamped to the rows). */
  scrollTo(y0: number): void {
    this.apply(this.window(y0));
  }

  scrollBy(rows: number): void {
    this.scrollTo(this.top + rows);
  }

  private window(y0: number): Viewport {
    const f = this.viewer.fitViewport();
    const h = f.y1 - f.y0;
    const rows = this.viewer.layout.rows;
    const top = Math.max(0, Math.min(Math.max(0, rows - h), y0));
    return { x0: f.x0, x1: f.x1, y0: top, y1: top + h };
  }

  private apply(v: Viewport): void {
    this.busy = true;
    try {
      this.viewer.setViewport(v);
    } finally {
      this.busy = false;
    }
  }

  /** Put the window back to whole rows of the fitted size, keeping its centre where something else zoomed it. */
  lock(): void {
    if (this.busy) return;
    const v = this.viewer.getViewport();
    const f = this.viewer.fitViewport();
    const h = f.y1 - f.y0;
    const same = Math.abs(v.y1 - v.y0 - h) < 1e-6 && Math.abs(v.x0 - f.x0) < 1e-9 && Math.abs(v.x1 - f.x1) < 1e-9;
    const want = this.window(same ? v.y0 : (v.y0 + v.y1) / 2 - h / 2);
    if (same && Math.abs(want.y0 - v.y0) < 1e-6) return;
    this.apply(want);
  }

  private onWheel = (e: WheelEvent) => {
    if ((e.target as Element | null)?.closest?.('[data-phylo-scroll]')) return; // a list that scrolls itself (the search suggestions)
    e.preventDefault();
    e.stopPropagation();
    const unit = e.deltaMode === 1 ? LINE_PX : e.deltaMode === 2 ? this.pageRows * this.rowPx() : 1;
    const d = (Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : 0) * unit;
    if (d) this.scrollBy(d / this.rowPx());
  };

  private onKey = (e: KeyboardEvent) => {
    if (['+', '=', '-', '_'].includes(e.key) && !(e.target as Element | null)?.closest?.('input, textarea')) e.stopPropagation();
  };

  private onDbl = (e: MouseEvent) => {
    e.stopPropagation();
  };

  /** CSS px per row. This page only sets `rowHeight` in px (main.ts); the option may also be '<n>em' or 'auto' (#38), whose resolved
   *  px the viewer does not expose, and then the viewer's height over the rows in view is a close enough estimate for wheel steps. */
  private rowPx(): number {
    const rh = this.viewer.options.rowHeight;
    return Math.max(1, typeof rh === 'number' ? rh : this.viewer.size.height / Math.max(1, this.pageRows));
  }
}
