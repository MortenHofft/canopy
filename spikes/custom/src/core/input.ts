// InputController: turns the root element's wheel, pointer (drag, pinch, hover, click), double-click and key events into calls on an
// InputHost. It owns the gesture state (the pointers down, the drag, the pinch, the click that a drag must swallow) and the window
// listeners that follow a drag outside the element; the gesture arithmetic (pinch factors, drag deltas, wheel to zoom factors) is here.
//
// It does NOT own what the gestures act on: the view, the cursor node, hover and the frame loop stay in the renderer and are reached
// through the host. The interaction-LOD timer (noteInput) is the renderer's too: it is tied to the frame state (reduced frames, refine
// timer), so the controller only says "the user is moving the view" before it moves it. The overview strip has its own pointer
// handling (overview.ts); the focus ring styling is the renderer's (it knows the theme).

import { DRAG_START_PX, PINCH_MIN_AXIS_PX, WHEEL_ZOOM_RATE } from './constants.ts';
import type { Area } from './geom.ts';
import { defaultActiveNode, isNavigationKey, navigate, pageRows } from './keyboard.ts';
import type { Hit, LayoutKind, TreeSnapshot, Viewport } from './types.ts';

export interface Point {
  x: number;
  y: number;
}

/** What the controller reads of the renderer (getters, read at call time) and the actions it asks of it. Points are container px. */
export interface InputHost {
  readonly layout: LayoutKind;
  readonly area: Area;
  readonly view: Viewport;
  readonly tree: TreeSnapshot;
  /** Keyboard cursor, -1 for none. */
  readonly activeNode: number;
  /** A node is hovered (the pointer cursor is shown). */
  readonly hovering: boolean;

  /** The user is about to move the view: interaction quality until it settles. */
  noteInput(): void;
  /** Stop a running view animation (a press takes over). */
  cancelAnim(): void;
  setViewport(v: Viewport): void;
  zoomBy(fx: number, fy: number, px: number, py: number): void;
  fit(animate: boolean): void;
  zoomToNode(node: number, animate: boolean): void;
  setCursor(cursor: 'grab' | 'grabbing' | 'pointer'): void;
  /** What a click at (x, y) would hit, in full quality (draws a settled frame first). */
  pick(x: number, y: number): Hit | null;
  /** A click on a hit. */
  click(h: Hit, clientX: number, clientY: number): void;
  /** The pointer is over (x, y): look up the hover on the next frame. null: it left. */
  hover(p: Point | null): void;
  /** Clear the hover now (a drag started). */
  dropHover(): void;
  /** Move the keyboard cursor to a node and scroll it into view. */
  setActive(node: number): void;
  /** Enter / Space on a node: report it as a click. */
  activate(node: number): void;
}

interface Drag {
  sx: number;
  sy: number;
  v0: Viewport;
  moved: boolean;
  id: number;
}
interface Pinch {
  v0: Viewport;
  mid: Point;
  dx: number;
  dy: number;
}

export class InputController {
  private pointers = new Map<number, Point>();
  private drag: Drag | null = null;
  private pinch: Pinch | null = null;
  private suppressClick = false;
  private winBound = false;

  constructor(
    private root: HTMLElement,
    private host: InputHost,
  ) {
    root.addEventListener('wheel', this.onWheel, { passive: false });
    root.addEventListener('pointerdown', this.onPointerDown);
    root.addEventListener('pointermove', this.onPointerMove);
    root.addEventListener('pointerleave', this.onPointerLeave);
    root.addEventListener('click', this.onClickCapture, true);
    root.addEventListener('keydown', this.onKey);
    root.addEventListener('dblclick', this.onDbl);
  }

  /** A drag (moved past the threshold) or a pinch is going on: hover is not looked up meanwhile. */
  get gesturing(): boolean {
    return !!(this.drag?.moved || this.pinch);
  }

  /** Remove the window listeners (the element's own go with the element). */
  destroy(): void {
    this.unbindWindow();
  }

  private local(e: { clientX: number; clientY: number }): Point {
    const r = this.root.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private bindWindow(): void {
    if (this.winBound) return;
    this.winBound = true;
    window.addEventListener('pointermove', this.onWinMove);
    window.addEventListener('pointerup', this.onWinUp);
    window.addEventListener('pointercancel', this.onWinUp);
  }

  private unbindWindow(): void {
    if (!this.winBound) return;
    this.winBound = false;
    window.removeEventListener('pointermove', this.onWinMove);
    window.removeEventListener('pointerup', this.onWinUp);
    window.removeEventListener('pointercancel', this.onWinUp);
  }

  // ------------------------------------------------------------- wheel

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const h = this.host;
    h.noteInput();
    const p = this.local(e);
    const unit = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1;
    const a = h.area;
    if (h.layout === 'rectangular') {
      const horizontal = e.shiftKey || e.ctrlKey;
      const d = (e.deltaY !== 0 ? e.deltaY : e.deltaX) * unit;
      if (!horizontal && Math.abs(e.deltaX) > Math.abs(e.deltaY) * 1.5) {
        const w = h.view.x1 - h.view.x0;
        const dx = ((e.deltaX * unit) / a.aw) * w;
        h.setViewport({ ...h.view, x0: h.view.x0 + dx, x1: h.view.x1 + dx });
        return;
      }
      const f = Math.exp(-d * WHEEL_ZOOM_RATE);
      if (e.altKey) h.zoomBy(f, f, p.x, p.y);
      else if (horizontal) h.zoomBy(f, 1, p.x, p.y);
      else h.zoomBy(1, f, p.x, p.y);
    } else {
      const f = Math.exp(-(e.deltaY || e.deltaX) * unit * WHEEL_ZOOM_RATE);
      h.zoomBy(f, f, p.x, p.y);
    }
  };

  // ------------------------------------------------------------- pointer

  private onPointerDown = (e: PointerEvent) => {
    if ((e.target as Element).closest?.('[data-ov]')) return;
    const h = this.host;
    this.pointers.set(e.pointerId, this.local(e));
    h.cancelAnim();
    if (this.pointers.size === 2) {
      const [p, q] = [...this.pointers.values()];
      this.pinch = { v0: { ...h.view }, mid: { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 }, dx: Math.abs(p.x - q.x), dy: Math.abs(p.y - q.y) };
      this.drag = null;
      return;
    }
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const p = this.local(e);
    this.drag = { sx: p.x, sy: p.y, v0: { ...h.view }, moved: false, id: e.pointerId };
    this.suppressClick = false;
    this.bindWindow();
  };

  private onWinMove = (e: PointerEvent) => {
    const h = this.host;
    if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, this.local(e));
    if (this.pinch && this.pointers.size >= 2) {
      const [p, q] = [...this.pointers.values()];
      const dx = Math.abs(p.x - q.x),
        dy = Math.abs(p.y - q.y);
      const pc = this.pinch;
      const dist = Math.hypot(dx, dy),
        dist0 = Math.hypot(pc.dx, pc.dy);
      const fx = pc.dx >= PINCH_MIN_AXIS_PX ? Math.max(0.2, Math.min(5, dx / pc.dx)) : dist0 > 0 ? dist / dist0 : 1;
      const fy = pc.dy >= PINCH_MIN_AXIS_PX ? Math.max(0.2, Math.min(5, dy / pc.dy)) : dist0 > 0 ? dist / dist0 : 1;
      const mid = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
      const a = h.area;
      const v0 = pc.v0;
      const rad = h.layout === 'radial';
      const ffx = rad ? dist / Math.max(1, dist0) : fx,
        ffy = rad ? dist / Math.max(1, dist0) : fy;
      const w2 = (v0.x1 - v0.x0) / ffx,
        h2 = (v0.y1 - v0.y0) / ffy;
      const wx = v0.x0 + ((pc.mid.x - a.ax) / a.aw) * (v0.x1 - v0.x0),
        wy = v0.y0 + ((pc.mid.y - a.ay) / a.ah) * (v0.y1 - v0.y0);
      const x0 = wx - ((mid.x - a.ax) / a.aw) * w2,
        y0 = wy - ((mid.y - a.ay) / a.ah) * h2;
      this.suppressClick = true;
      h.noteInput();
      h.setViewport({ x0, x1: x0 + w2, y0, y1: y0 + h2 });
      return;
    }
    const d = this.drag;
    if (!d || e.pointerId !== d.id) return;
    const p = this.local(e);
    const dx = p.x - d.sx,
      dy = p.y - d.sy;
    if (!d.moved && Math.hypot(dx, dy) > DRAG_START_PX) {
      d.moved = true;
      this.suppressClick = true;
      h.setCursor('grabbing');
      h.dropHover();
    }
    if (d.moved) {
      h.noteInput();
      const a = h.area;
      const w = d.v0.x1 - d.v0.x0,
        ht = d.v0.y1 - d.v0.y0;
      const ddx = (dx / a.aw) * w,
        ddy = (dy / a.ah) * ht;
      h.setViewport({ x0: d.v0.x0 - ddx, x1: d.v0.x1 - ddx, y0: d.v0.y0 - ddy, y1: d.v0.y1 - ddy });
    }
  };

  private onWinUp = (e: PointerEvent) => {
    const h = this.host;
    this.pointers.delete(e.pointerId);
    if (this.pinch && this.pointers.size < 2) this.pinch = null;
    const d = this.drag;
    if (d && e.pointerId === d.id) {
      this.drag = null;
      h.setCursor(h.hovering ? 'pointer' : 'grab');
      if (!d.moved && e.type === 'pointerup' && !this.suppressClick) {
        const p = this.local(e);
        const hit = h.pick(p.x, p.y);
        if (hit) h.click(hit, e.clientX, e.clientY);
      }
    }
    if (!this.pointers.size) this.unbindWindow();
  };

  private onPointerMove = (e: PointerEvent) => {
    if (e.pointerType === 'touch' || this.drag?.moved || this.pinch) return;
    this.host.hover(this.local(e));
  };

  private onPointerLeave = () => {
    this.host.hover(null);
  };

  /** A drag must not open a tip link; real clicks on the anchors go through. */
  private onClickCapture = (e: MouseEvent) => {
    if (this.suppressClick) {
      e.preventDefault();
      e.stopPropagation();
      this.suppressClick = false;
    }
  };

  private onDbl = (e: MouseEvent) => {
    const h = this.host;
    const p = this.local(e);
    const hit = h.pick(p.x, p.y);
    if (hit && h.tree.childCount[hit.node] > 0) h.zoomToNode(hit.node, true);
    else if (!hit) h.fit(true);
  };

  // ------------------------------------------------------------- keyboard

  private onKey = (e: KeyboardEvent) => {
    if (e.altKey || e.metaKey) return;
    const h = this.host;
    const tree = h.tree;
    let node = h.activeNode >= 0 ? h.activeNode : defaultActiveNode(tree, h.layout, h.view);
    if (node < 0) node = 0; // partial tree: the tip row at the view centre is not loaded
    if (isNavigationKey(e.key)) {
      const next = navigate(tree, node, e.key, pageRows(h.layout, h.view));
      e.preventDefault();
      if (next >= 0) h.setActive(next);
      return;
    }
    const a = h.area;
    switch (e.key) {
      case 'Enter':
      case ' ':
        e.preventDefault();
        h.activate(node);
        return;
      case '+':
      case '=':
        h.zoomBy(1, 1.4, a.ax + a.aw / 2, a.ay + a.ah / 2);
        e.preventDefault();
        return;
      case '-':
      case '_':
        h.zoomBy(1, 1 / 1.4, a.ax + a.aw / 2, a.ay + a.ah / 2);
        e.preventDefault();
        return;
      case '0':
        h.fit(true);
        e.preventDefault();
    }
  };
}
