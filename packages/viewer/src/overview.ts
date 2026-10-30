// Overview: the whole tree in a corner (a strip right of the plot for the rectangular layout, a disc bottom left for the radial one)
// with the current window drawn on it as a box, and pointer handling that moves the window by pressing or dragging on it. It owns its
// DOM (canvas and box inside the wrap it is given), its own small draw list and its dirty flag. The overview control
// (controls/overview.ts) sets `dirty` when the viewer's scene changed and calls updateBox() after every frame and draw() when dirty.
//
// The geometry (where the strip is, where the window box sits, which window a pointer position means) is pure functions of the layout
// kind and the numbers involved, exported for test/overview.test.mjs. What this module does NOT do: change the view itself (it asks the
// host's setViewport), run a frame or know about the main draw list.

import { OVERVIEW_DISC_PX, OVERVIEW_STRIP_W_PX, OVERVIEW_WORLD_HALF, OVERVIEW_WORLD_SPAN } from './constants.ts';
import { mk } from './dom.ts';
import { drawBody, type Scene, type TextMeasurer } from './draw.ts';
import { makeTransform, type Area } from './geom.ts';
import { wheelZoom } from './input.ts';
import type { Layout } from './layout.ts';
import { cut, DrawList, newCutResult, type CutParams, type Seen } from './lod.ts';
import { projectionFor } from './projection.ts';
import type { LayoutKind, TreeSnapshot, TreeTheme, Viewport } from './types.ts';

export interface OverviewRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Where the overview sits in the container (CSS px), or null when it is off. Rectangular: a strip along the right edge as tall as the
 *  plot area; radial: a square disc bottom left. */
export function overviewGeom(layout: LayoutKind, enabled: boolean, W: number, H: number, area: Area): OverviewRect | null {
  if (!enabled) return null;
  if (layout === 'rectangular') return { x: W - OVERVIEW_STRIP_W_PX - 4, y: area.ay, w: OVERVIEW_STRIP_W_PX, h: area.ah };
  return { x: 10, y: H - OVERVIEW_DISC_PX - 34, w: OVERVIEW_DISC_PX, h: OVERVIEW_DISC_PX };
}

/** The box of the window `view` inside the overview g (px relative to the overview), at least 4 x 3 (rectangular) / 4 x 4 (radial) px. */
export function overviewBox(layout: LayoutKind, g: OverviewRect, view: Viewport, tips: number): OverviewRect {
  const v = view;
  if (layout === 'rectangular') {
    const y0 = Math.max(0, (v.y0 / tips) * g.h),
      y1 = Math.min(g.h, (v.y1 / tips) * g.h);
    const x0 = Math.max(2, 2 + v.x0 * (g.w - 4)),
      x1 = Math.min(g.w - 2, 2 + v.x1 * (g.w - 4));
    return { x: x0, y: y0, w: Math.max(4, x1 - x0), h: Math.max(3, y1 - y0) };
  }
  const s2 = g.w / OVERVIEW_WORLD_SPAN; // world [-OVERVIEW_WORLD_HALF, OVERVIEW_WORLD_HALF] -> strip
  const toX = (x: number) => g.w / 2 + x * s2,
    toY = (y: number) => g.h / 2 + y * s2;
  const x0 = Math.max(0, toX(v.x0)),
    x1 = Math.min(g.w, toX(v.x1)),
    y0 = Math.max(0, toY(v.y0)),
    y1 = Math.min(g.h, toY(v.y1));
  return { x: x0, y: y0, w: Math.max(4, x1 - x0), h: Math.max(4, y1 - y0) };
}

/** The layout (world) point the overview shows at (px, py), px relative to the overview. Rectangular: x is the fraction of the tree's
 *  depth, y a row; radial: layout coordinates. */
export function overviewWorldPoint(layout: LayoutKind, g: OverviewRect, px: number, py: number, tips: number): { x: number; y: number } {
  if (layout === 'rectangular') return { x: (px - 2) / (g.w - 4), y: (py / g.h) * tips };
  const s2 = g.w / OVERVIEW_WORLD_SPAN;
  return { x: (px - g.w / 2) / s2, y: (py - g.h / 2) / s2 };
}

/** The window `view` moved so that its centre is where the pointer is (px relative to the overview). Rectangular: a window that already
 *  spans the whole tree in x keeps its x range. */
export function overviewTarget(layout: LayoutKind, g: OverviewRect, px: number, py: number, view: Viewport, tips: number): Viewport {
  const v = view;
  const w = v.x1 - v.x0,
    h = v.y1 - v.y0;
  const c = overviewWorldPoint(layout, g, px, py, tips);
  const cy = c.y;
  let cx = c.x;
  // keep the x window when it already spans the whole tree
  if (layout === 'rectangular' && w >= 0.999) cx = (v.x0 + v.x1) / 2;
  return { x0: cx - w / 2, x1: cx + w / 2, y0: cy - h / 2, y1: cy + h / 2 };
}

/** What the overview reads of the renderer (getters, read at call time) and the three things it asks of it. */
export interface OverviewHost {
  readonly layout: LayoutKind;
  readonly enabled: boolean;
  readonly W: number;
  readonly H: number;
  readonly dpr: number;
  readonly view: Viewport;
  readonly area: Area;
  readonly tree: TreeSnapshot;
  readonly L: Layout;
  readonly theme: TreeTheme;
  readonly classOf: Uint8Array | null;
  readonly colours: string[];
  readonly hlRanks: Int32Array;
  readonly measure: TextMeasurer;
  /** Scratch dedupe set of the renderer (the overview cut runs between the main cut and the next, never concurrently). */
  readonly seen: Seen;
  formatLabel(id: string): string;
  /** The user is moving the view: count as interaction. */
  noteInput(): void;
  /** Stop a running animation (a press takes over). */
  cancelAnim(): void;
  setViewport(v: Viewport): void;
  /** Zoom by factors (>1 zooms in) about a layout point. */
  zoomAtWorld(fx: number, fy: number, wx: number, wy: number): void;
}

export class Overview {
  readonly wrap: HTMLDivElement;
  /** The overview picture is stale (tree, colours, highlights, theme, size or layout changed): draw() it. */
  dirty = true;
  private canvas: HTMLCanvasElement;
  private box: HTMLDivElement;
  private ctx: CanvasRenderingContext2D;
  private list = new DrawList();
  private styleKey = '';
  private dragging = false;

  constructor(
    private host: OverviewHost,
    softwareCanvas: boolean,
    wrap: HTMLDivElement = document.createElement('div'),
  ) {
    this.wrap = wrap;
    wrap.style.cssText = 'position:absolute;overflow:hidden;cursor:pointer;touch-action:none;pointer-events:auto;display:none';
    this.wrap.setAttribute('aria-hidden', 'true');
    this.canvas = mk('canvas', 'position:absolute;left:0;top:0;width:100%;height:100%');
    this.box = mk('div', 'position:absolute;box-sizing:border-box;pointer-events:none');
    this.wrap.append(this.canvas, this.box);
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: softwareCanvas })!;
    this.wrap.addEventListener('pointerdown', this.onDown);
    this.wrap.addEventListener('pointermove', this.onMove);
    this.wrap.addEventListener('pointerup', this.onUp);
    this.wrap.addEventListener('pointercancel', this.onUp);
    this.wrap.addEventListener('wheel', this.onWheel, { passive: false });
  }

  private geom(): OverviewRect | null {
    const h = this.host;
    return overviewGeom(h.layout, h.enabled, h.W, h.H, h.area);
  }

  /** Place the overview and the window box (every frame; the container styles are only rewritten when something about them changed). */
  updateBox(): void {
    const h = this.host;
    const g = this.geom();
    if (!g) {
      this.wrap.style.display = 'none';
      this.styleKey = '';
      return;
    }
    const s = this.wrap.style;
    const theme = h.theme;
    const key = `${g.x}|${g.y}|${g.w}|${g.h}|${h.layout}|${theme.background}|${theme.muted}|${theme.highlight}`;
    const b = this.box.style;
    if (key !== this.styleKey) {
      this.styleKey = key;
      s.display = 'block';
      s.left = g.x + 'px';
      s.top = g.y + 'px';
      s.width = g.w + 'px';
      s.height = g.h + 'px';
      s.background = h.layout === 'radial' ? theme.background : 'transparent';
      s.border = h.layout === 'radial' ? `1px solid ${theme.muted}` : 'none';
      b.border = `1.5px solid ${theme.highlight}`;
      b.background = `color-mix(in srgb, ${theme.highlight} 14%, transparent)`;
    }
    const r = overviewBox(h.layout, g, h.view, h.L.rows);
    b.left = r.x + 'px';
    b.top = r.y + 'px';
    b.width = r.w + 'px';
    b.height = r.h + 'px';
  }

  /** Redraw the overview picture: the whole tree cut coarsely (threshold raised until it fits 6000 primitives), plus highlight ticks. */
  draw(): void {
    const h = this.host;
    this.dirty = false;
    const g = this.geom();
    if (!g) return;
    const dpr = h.dpr;
    const c = this.canvas;
    const cw = Math.round(g.w * dpr),
      ch = Math.round(g.h * dpr);
    if (c.width !== cw || c.height !== ch) {
      c.width = cw;
      c.height = ch;
    }
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, g.w, g.h);
    const rect = h.layout === 'rectangular';
    const N = h.L.rows; // rows: the overview shows the collapsed clades as the viewer does
    const area: Area = rect
      ? { ax: 2, ay: 0, aw: g.w - 4, ah: g.h, clipL: 0, clipT: 0, clipR: g.w, clipB: g.h }
      : { ax: 0, ay: 0, aw: g.w, ah: g.h, clipL: 0, clipT: 0, clipR: g.w, clipB: g.h };
    const vp: Viewport = rect
      ? { x0: 0, x1: 1, y0: 0, y1: N }
      : { x0: -OVERVIEW_WORLD_HALF, x1: OVERVIEW_WORLD_HALF, y0: -OVERVIEW_WORLD_HALF, y1: OVERVIEW_WORLD_HALF };
    const T = makeTransform(h.layout, g.w, g.h, vp, area, N, h.L.fan);
    const P: CutParams = { lod: true, minPx: 2.5, budget: 6000, summaries: true };
    const proj = projectionFor(h.tree, h.L, T);
    const ovRes = newCutResult();
    let minPx = 2.5;
    for (let k = 0; k < 6; k++) {
      P.minPx = minPx;
      const r = cut(proj, P, h.classOf, this.list, h.seen, ovRes);
      if (!r.overflow) break;
      minPx *= 2;
    }
    const S: Scene = {
      proj,
      list: this.list,
      theme: h.theme,
      colours: h.colours,
      classOf: h.classOf,
      cladeBoxes: null,
      labelReach: 0,
      highlight: null,
      hlPrefix: null,
      hlRanks: new Int32Array(0),
      alignLabels: false,
      labelRoom: 0,
      density: 'sparse',
      format: (id) => h.formatLabel(id),
      cladeText: null,
      nodeLabels: 'none',
      namedNode: null,
      formatNode: String,
      scale: h.dpr,
      thin: 0,
      measure: h.measure,
      summaryLines: false,
    };
    drawBody(ctx, S, 1);
    const hlRanks = h.hlRanks;
    if (rect && hlRanks.length) {
      ctx.fillStyle = h.theme.highlight;
      const rowOf = h.L.rowOfRank;
      // every match, one mark per pixel at most (the ranks are sorted, so y only grows; #58: it used to be the first 2,000 only)
      let last = -Infinity;
      for (let k = 0; k < hlRanks.length; k++) {
        const y = ((rowOf ? rowOf[hlRanks[k]] : hlRanks[k]) / N) * g.h - 1;
        if (y - last < 1) continue;
        last = y;
        ctx.fillRect(0, y, g.w, 2.5);
      }
    }
  }

  /** Release the canvas backing store and the wrap's content and listeners (the control was removed). */
  release(): void {
    this.canvas.width = 0;
    this.canvas.height = 0;
    this.canvas.remove();
    this.box.remove();
    this.wrap.style.display = 'none';
    this.wrap.removeEventListener('pointerdown', this.onDown);
    this.wrap.removeEventListener('pointermove', this.onMove);
    this.wrap.removeEventListener('pointerup', this.onUp);
    this.wrap.removeEventListener('pointercancel', this.onUp);
    this.wrap.removeEventListener('wheel', this.onWheel);
  }

  private move(e: PointerEvent): void {
    const h = this.host;
    const g = this.geom();
    if (!g) return;
    const r = this.wrap.getBoundingClientRect();
    h.setViewport(overviewTarget(h.layout, g, e.clientX - r.left, e.clientY - r.top, h.view, h.L.rows));
  }

  private onDown = (e: PointerEvent) => {
    e.stopPropagation();
    this.dragging = true;
    this.wrap.setPointerCapture(e.pointerId);
    this.host.cancelAnim();
    this.host.noteInput();
    this.move(e);
  };
  private onMove = (e: PointerEvent) => {
    e.stopPropagation();
    if (this.dragging) {
      this.host.noteInput();
      this.move(e);
    }
  };
  /** The wheel zooms about the tree point the pointer is over on the overview (like a map minimap), by the tree's own wheel rules. */
  private onWheel = (e: WheelEvent) => {
    const h = this.host;
    const g = this.geom();
    const z = wheelZoom(h.layout, e);
    if (!g || !z) return; // a mostly horizontal swipe (a pan) goes on to the control layer, which hands it to the tree
    e.preventDefault();
    e.stopPropagation(); // the control layer would forward it to the tree's wheel, which anchors at the pointer in the plot
    h.noteInput();
    const r = this.wrap.getBoundingClientRect();
    const p = overviewWorldPoint(h.layout, g, e.clientX - r.left, e.clientY - r.top, h.L.rows);
    h.zoomAtWorld(z.fx, z.fy, p.x, p.y);
  };
  private onUp = (e: PointerEvent) => {
    e.stopPropagation();
    this.dragging = false;
    if (this.wrap.hasPointerCapture(e.pointerId)) this.wrap.releasePointerCapture(e.pointerId);
  };
}
