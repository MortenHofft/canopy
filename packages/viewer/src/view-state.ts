// ViewState: the visible window (Viewport) and everything that is arithmetic over it: the plotting area, the fit viewport, the limits
// (clampView), zoom about a point, the target windows of focusTip / zoomToNode / keyboard-cursor scrolling, and the animation between
// two windows. It owns `view`, `fitted`, `area` and the running animation.
//
// It does NOT touch the DOM, the canvas or the renderer, and its only impure call is performance.now() in animateTo: what it needs of
// the world is read through a ViewEnv (container size, options, tree, layout, columns), and every change is reported through
// ViewEvents. So it imports in Node and test/view-state.test.mjs covers clamp, fit, zoom and the targets numerically.

import {
  ANIMATION_MS,
  FOCUS_TIP_MAX_ROW_PX,
  FOCUS_TIP_MIN_ROW_PX,
  FOCUS_TIP_RADIAL_PITCH_PX,
  OVERSCROLL_FRAC,
  OVERSCROLL_KEEP_FRAC,
  OVERVIEW_STRIP_W_PX,
  RADIAL_FIT_MARGIN_PX,
  RADIAL_FIT_MIN_R_PX,
  RADIAL_GEOMETRIC_ZOOM,
  RADIAL_MAX_TIP_PX,
  RADIAL_MAX_ZOOM,
  RADIAL_MIN_ZOOM,
  RADIAL_PAN_LIMIT,
  RECT_MAX_VIEW_H_FACTOR,
  RECT_MAX_ZOOM_X,
  RECT_MAX_ZOOM_Y,
  ZOOM_NODE_RADIAL_PAD,
} from './constants.ts';
import { COL_GAP, FILL_MIN_PX } from './columns.ts';
import { resolveTreeWidth, scaledPx, type TreeWidth } from './sizes.ts';
import { makeTransform, sectorBBox, viewportEquals, type Area } from './geom.ts';
import { FULL_FAN, fanAngle, type Layout, type RadialFan } from './layout.ts';
import { projectionFor } from './projection.ts';
import type { LayoutKind, TreeSnapshot, Viewport } from './types.ts';

const LABEL_W = 190; // cap of the room right of the tips for labels (rectangular)
const HEAD_H = 24; // room above the plot for column headers
const FOOT_H = 36; // room below the plot for the axis
const AUTO_FILL_TREE_MIN_PX = 240; // 'auto' with a fill column: the tree keeps at least this (room for its labels) before the half split
const MIN_HEAD = 8; // top and (without an axis) bottom margin
const RADIAL_LABEL_ROOM_FRAC = 0.2; // radial aligned labels keep at most this share of the smaller container side for their text

/** What a ViewState reads of the world. Plain getters over the renderer's current values (read at call time, never cached). */
export interface ViewEnv {
  readonly layout: LayoutKind;
  readonly overview: boolean;
  readonly axis: boolean;
  /** Fixed row height in px (the option resolved against the label size), null (or 0) = fit all tips into the height. */
  readonly rowHeight: number | null;
  /** Most px between two neighbouring tips (the option resolved against the label size); Infinity = only the hard ceilings. */
  readonly maxTipSpacing: number;
  /** The theme's label size (px): the font-relative minimums scale with it. */
  readonly labelSize: number;
  /** Widest x window in tree widths (rectangular). */
  readonly maxViewWidth: number;
  /** The `treeWidth` option (rectangular). */
  readonly treeWidth: TreeWidth;
  /** The `alignLabels` option (it acts only in a phylogram, see ViewState.alignsLabels). */
  readonly alignLabels: boolean;
  /** Container size in CSS px. */
  readonly W: number;
  readonly H: number;
  readonly tree: TreeSnapshot;
  readonly L: Layout;
  /** Width of the data columns that have one (px) plus a gap per column, 0 without columns. */
  readonly columnsWidth: number;
  /** How many columns are `'fill'` (they share what the tree and the other columns leave). */
  readonly fillColumns: number;
  readonly hasColumns: boolean;
  /** Place the columns' left edge (they sit right of the clip rectangle); each fill column gets `fillWidth` px. */
  placeColumns(left: number, fillWidth: number): void;
}

/** How a ViewState reports. All three are called synchronously from the method that caused them. */
export interface ViewEvents {
  /** The window changed. `step`: it is an animation frame (the next frame is already scheduled by the loop), otherwise a jump. */
  changed(step: boolean): void;
  /** An animation was started: make sure a frame will be drawn. */
  needFrame(): void;
  /** The window moves because of an animation step: counts as interaction (reduced quality until it settles). */
  moving(): void;
}

interface Anim {
  from: Viewport;
  to: Viewport;
  t0: number;
  ms: number;
}

/** Radial: the fit view, the fan's bounding box (root included, radius 1) in the container with a margin for labels and the scale bar,
 *  plus `labelRoom` px on every side (aligned labels, see ViewState.radialLabelRoom): `k` px per unit radius and the world point (cx, cy)
 *  at the container's centre. The whole circle is centred on the root; a fan with a large opening is framed by what it covers, so a half
 *  circle in a wide container gets about twice the scale. */
export function radialFit(W: number, H: number, fan: RadialFan = FULL_FAN, labelRoom = 0): { k: number; cx: number; cy: number } {
  const bb = new Float64Array(4);
  sectorBBox(0, 0, 0, 1, fan.start, fan.start + fan.span, bb);
  const bw = bb[2] - bb[0],
    bh = bb[3] - bb[1];
  const m = 2 * (RADIAL_FIT_MARGIN_PX + labelRoom);
  const k = Math.max(RADIAL_FIT_MIN_R_PX, Math.min((W - m) / Math.max(bw, 1e-6), (H - m) / Math.max(bh, 1e-6)));
  return { k, cx: (bb[0] + bb[2]) / 2, cy: (bb[1] + bb[3]) / 2 };
}

/** Radial: pixels per unit radius at the fit view (see radialFit). */
export function radialFitScale(W: number, H: number, fan: RadialFan = FULL_FAN, labelRoom = 0): number {
  return radialFit(W, H, fan, labelRoom).k;
}

/** Radial: the smallest radius (unit radius, 0..1) of a row's tip, a collapsed clade's at its outer edge. Labels need room at the tip's
 *  own radius (#110), so the zoom ceiling is worked out there. Cached by layout: one pass over the nodes per layout. */
const innerRadii = new WeakMap<Layout, number>();
export function innerTipRadius(L: Layout): number {
  let r = innerRadii.get(L);
  if (r !== undefined) return r;
  r = 1;
  for (let i = 0; i < L.n; i++) {
    if (L.hidden?.[i]) continue;
    if (L.collapsed?.[i]) r = Math.min(r, L.XMAX[i]);
    else if (L.LAST[i] < 0) r = Math.min(r, L.X[i]);
  }
  innerRadii.set(L, r);
  return r;
}

export class ViewState {
  view: Viewport = { x0: 0, x1: 1, y0: 0, y1: 1 };
  /** True while the view is the fit view (a resize then re-fits instead of keeping the window). */
  fitted = true;
  area: Area = { ax: 0, ay: 0, aw: 0, ah: 0, clipL: 0, clipT: 0, clipR: 0, clipB: 0 };
  private anim: Anim | null = null;
  private fitAfterAnim = false;
  private maxChars = -1;

  constructor(
    private env: ViewEnv,
    private ev: ViewEvents,
  ) {}

  get animating(): boolean {
    return this.anim !== null;
  }
  /** Stop an animation where it is (a press or the overview takes over). */
  cancelAnim(): void {
    this.anim = null;
    this.fitAfterAnim = false; // a cancelled fit animation must not make a later one end fitted
  }

  // ------------------------------------------------------------- area

  /** The tree changed: the label reserve is measured again at its next use. */
  resetLabelReserve(): void {
    this.maxChars = -1;
  }

  /** Labels are aligned: in one column right of the farthest tip, or radial on one circle outside it (a phylogram with `alignLabels`). */
  alignsLabels(): boolean {
    return this.env.alignLabels && this.env.L.usedLengths;
  }

  /** Radial with aligned labels: the room (px) kept for their text outside the circle they start on, at the fit (on every side) and when
   *  the circle is pinned (see alignedR in draw.ts): the rectangular label reserve, at most RADIAL_LABEL_ROOM_FRAC of the smaller container
   *  side. 0 otherwise. */
  radialLabelRoom(): number {
    if (this.env.layout !== 'radial' || !this.alignsLabels()) return 0;
    return Math.min(this.labelReserve(), RADIAL_LABEL_ROOM_FRAC * Math.min(this.env.W, this.env.H));
  }

  /** Room right of the tips for labels: from the longest label, capped (rectangular layout). */
  labelReserve(): number {
    if (this.maxChars < 0) {
      let m = 0;
      const t = this.env.tree.tipLabels;
      if (this.env.tree.stub)
        m = 28; // partial tree: labels are not loaded, assume a typical binomial
      else for (let i = 0; i < t.length; i++) if (t[i].length > m) m = t[i].length;
      this.maxChars = m;
    }
    return Math.max(70, Math.min(LABEL_W, this.maxChars * 6.3 + 14));
  }

  /** The plotting area for the current container size, options and columns; places the columns as a side effect (they follow the clip). */
  computeArea(): Area {
    const { W, H, layout } = this.env;
    if (layout === 'radial') {
      this.area = { ax: 0, ay: 0, aw: W, ah: H, clipL: 0, clipT: 0, clipR: W, clipB: H };
    } else {
      const ovG = this.env.overview ? OVERVIEW_STRIP_W_PX + 8 : 0;
      const colsW = this.env.columnsWidth;
      const avail = W - ovG;
      const nf = this.env.fillColumns;
      // 'auto': the columns keep their widths and the tree takes the rest; with fill columns the tree and they split what the fixed ones leave
      const fixedTree = resolveTreeWidth(this.env.treeWidth, avail);
      const room = avail - colsW - nf * FILL_MIN_PX; // what the tree may take: the fixed columns and the fill minimums stay on screen
      const clipR = Math.max(
        120,
        fixedTree !== null
          ? Math.min(fixedTree, room)
          : nf > 0
            ? Math.min(room, Math.max(AUTO_FILL_TREE_MIN_PX, (avail - colsW) / 2))
            : avail - colsW,
      );
      const head = this.env.hasColumns ? HEAD_H : MIN_HEAD;
      const foot = this.env.axis && this.env.L.usedLengths ? FOOT_H : MIN_HEAD;
      const ax = 10;
      const labelW = Math.min(this.labelReserve(), clipR * 0.4);
      const aw = Math.max(40, clipR - ax - labelW);
      this.area = { ax, ay: head, aw, ah: Math.max(40, H - head - foot), clipL: 0, clipT: head, clipR, clipB: head + Math.max(40, H - head - foot) };
      this.env.placeColumns(clipR + COL_GAP, nf > 0 ? (avail - clipR - colsW) / nf : 0);
    }
    return this.area;
  }

  // ------------------------------------------------------------- fit, limits

  /** The window that shows the whole tree in the current area (computeArea first). */
  fitViewport(): Viewport {
    const a = this.area;
    if (this.env.layout === 'rectangular') {
      const rows = this.env.rowHeight ? a.ah / this.env.rowHeight : this.env.L.rows;
      return { x0: 0, x1: 1, y0: 0, y1: Math.max(1, rows) };
    }
    const { k, cx, cy } = radialFit(this.env.W, this.env.H, this.env.L.fan, this.radialLabelRoom());
    return { x0: cx - a.aw / 2 / k, x1: cx + a.aw / 2 / k, y0: cy - a.ah / 2 / k, y1: cy + a.ah / 2 / k };
  }

  /** v with the zoom and pan limits applied (a new object). Rectangular: width and height between the zoom limits, the tree stays
   *  inside the window when zoomed out and may overscroll by 15% when zoomed in. Radial: scale between the limits, centre near the root. */
  clampView(v: Viewport): Viewport {
    const a = this.area;
    if (this.env.layout === 'rectangular') {
      const N = this.env.L.rows;
      const wmax = Math.max(1, this.env.maxViewWidth),
        wmin = a.aw / RECT_MAX_ZOOM_X;
      let w = v.x1 - v.x0;
      w = Math.min(wmax, Math.max(wmin, w));
      // the cap never forces the view below the fitted one: most px per row = max(fit, min(cap, ceiling)); fit is the y span of fitViewport
      const hfit = this.env.rowHeight ? a.ah / this.env.rowHeight : N;
      const hmax = Math.max(N * RECT_MAX_VIEW_H_FACTOR, a.ah / 4),
        hmin = Math.min(Math.max(1, hfit), a.ah / Math.min(RECT_MAX_ZOOM_Y, this.env.maxTipSpacing));
      let h = v.y1 - v.y0;
      h = Math.min(hmax, Math.max(hmin, h));
      let x0 = v.x0,
        y0 = v.y0;
      // zoomed out beyond the tree: keep the whole tree inside the window; zoomed in: allow 15% overscroll
      x0 = w >= 0.999 ? Math.min(0, Math.max(1 - w, x0)) : Math.min(1 - OVERSCROLL_KEEP_FRAC * w, Math.max(-OVERSCROLL_FRAC * w, x0));
      y0 = h >= N * 0.999 ? Math.min(0, Math.max(N - h, y0)) : Math.min(N - OVERSCROLL_KEEP_FRAC * h, Math.max(-OVERSCROLL_FRAC * h, y0));
      return { x0, x1: x0 + w, y0, y1: y0 + h };
    }
    const fan = this.env.L.fan;
    const kfit = radialFitScale(this.env.W, this.env.H, fan, this.radialLabelRoom());
    let k = a.aw / (v.x1 - v.x0);
    // arc between neighbouring tips = k * span / N * r, at most maxTipSpacing at the innermost tip's radius r (the outer ring when every
    // tip is on it), so tips on short branches can be zoomed until they have room for labels; but always up to RADIAL_GEOMETRIC_ZOOM times
    // the fit (a small tree reaches its tip cap at once, and short branches near the root still need pulling apart)
    const tipCap = (this.env.maxTipSpacing * this.env.L.rows) / fan.span / Math.max(innerTipRadius(this.env.L), 1e-9);
    // the hard ceiling is RADIAL_MAX_ZOOM times the fit or tips RADIAL_MAX_TIP_PX apart, whichever is deeper: a multiple of the fit alone
    // stopped a tree of millions of tips before its tips were far enough apart to be drawn one by one (#76)
    const hard = Math.max(kfit * RADIAL_MAX_ZOOM, (RADIAL_MAX_TIP_PX * this.env.L.rows) / fan.span);
    const kcap = Math.min(hard, Math.max(kfit * RADIAL_GEOMETRIC_ZOOM, tipCap));
    k = Math.min(kcap, Math.max(kfit * RADIAL_MIN_ZOOM, k));
    let cx = (v.x0 + v.x1) / 2,
      cy = (v.y0 + v.y1) / 2;
    cx = Math.max(-RADIAL_PAN_LIMIT, Math.min(RADIAL_PAN_LIMIT, cx));
    cy = Math.max(-RADIAL_PAN_LIMIT, Math.min(RADIAL_PAN_LIMIT, cy));
    return { x0: cx - a.aw / 2 / k, x1: cx + a.aw / 2 / k, y0: cy - a.ah / 2 / k, y1: cy + a.ah / 2 / k };
  }

  // ------------------------------------------------------------- resize

  /** Call before the container size changes: what a later afterResize needs to keep a zoomed radial window centred on the same point
   *  at the same scale. null when there is nothing to keep (rectangular, or no size yet). */
  beforeResize(): { k: number; cx: number; cy: number } | null {
    const v = this.view;
    const k = this.env.layout === 'radial' && this.env.W > 0 ? this.area.aw / (v.x1 - v.x0) : 0;
    return k ? { k, cx: (v.x0 + v.x1) / 2, cy: (v.y0 + v.y1) / 2 } : null;
  }

  /** The container has its new size: recompute the area; the fit view follows the size, a zoomed radial view keeps centre and scale. */
  afterResize(keep: { k: number; cx: number; cy: number } | null): void {
    this.computeArea();
    if (this.fitted || !(this.view.x1 > this.view.x0)) this.view = this.fitViewport();
    else if (keep) {
      const a = this.area;
      const { k, cx, cy } = keep;
      this.view = { x0: cx - a.aw / 2 / k, x1: cx + a.aw / 2 / k, y0: cy - a.ah / 2 / k, y1: cy + a.ah / 2 / k };
    }
  }

  // ------------------------------------------------------------- changing the view

  setViewport(v: Viewport, animate = false): void {
    if (!(v.x1 > v.x0 && v.y1 > v.y0)) return;
    if (animate) return this.animateTo(v);
    // the same window as now changes nothing, and must not stop an animation either: a controlled viewport echoes the window it was given
    if (viewportEquals(v, this.view)) return;
    this.cancelAnim();
    this.view = this.clampView({ ...v });
    this.fitted = false;
    this.ev.changed(false);
  }

  /** Fit the whole tree (and the columns) into the container. */
  fit(animate = true): void {
    this.computeArea();
    const f = this.fitViewport();
    if (animate) this.animateTo(f, true);
    else {
      this.cancelAnim();
      this.view = f;
      this.fitted = true;
      this.ev.changed(false);
    }
  }

  /** Zoom by factors fx, fy (>1 zooms in) keeping the layout point under (px, py) fixed. */
  zoomBy(fx: number, fy: number, px: number, py: number): void {
    const a = this.area;
    const v = this.view;
    // through zoomAtWorld: an axis at its zoom limit keeps its window instead of scrolling
    this.zoomAtWorld(fx, fy, v.x0 + ((px - a.ax) / a.aw) * (v.x1 - v.x0), v.y0 + ((py - a.ay) / a.ah) * (v.y1 - v.y0));
  }

  /** The window zoomBy goes to (radial: already clamped; rectangular: setViewport clamps). */
  zoomedView(fx: number, fy: number, px: number, py: number): Viewport {
    const a = this.area;
    const v = this.view;
    return this.zoomedViewAt(fx, fy, v.x0 + ((px - a.ax) / a.aw) * (v.x1 - v.x0), v.y0 + ((py - a.ay) / a.ah) * (v.y1 - v.y0));
  }

  /** Zoom by factors fx, fy (>1 zooms in) about the layout (world) point (wx, wy), which keeps its relative place in the window. The
   *  point may lie outside the window (the overview): the window then moves toward it. */
  zoomAtWorld(fx: number, fy: number, wx: number, wy: number): void {
    const nv = this.zoomedViewAt(fx, fy, wx, wy);
    if (fx >= 1 && fy >= 1) {
      // at a zoom limit nothing zooms, and the window must not slide toward the point either: an axis that is at its limit keeps its
      // window (the other axis may still zoom, e.g. y at maxTipSpacing while x is free)
      const v = this.view;
      const c = this.clampView({ ...nv });
      const atLimit = (f: number, a0: number, a1: number, b0: number, b1: number) =>
        f === 1 || Math.abs(b1 - b0 - (a1 - a0)) <= 1e-12 * Math.abs(a1 - a0);
      const xLim = fx > 1 && atLimit(fx, v.x0, v.x1, c.x0, c.x1);
      const yLim = fy > 1 && atLimit(fy, v.y0, v.y1, c.y0, c.y1);
      if ((xLim || fx === 1) && (yLim || fy === 1)) return;
      if (this.env.layout === 'rectangular') {
        if (xLim) {
          nv.x0 = v.x0;
          nv.x1 = v.x1;
        }
        if (yLim) {
          nv.y0 = v.y0;
          nv.y1 = v.y1;
        }
      }
    }
    this.setViewport(nv);
  }

  /** The window zoomAtWorld goes to (radial: already clamped; rectangular: setViewport clamps). The one place the zoom arithmetic lives. */
  zoomedViewAt(fx: number, fy: number, wx: number, wy: number): Viewport {
    const v = this.view;
    // zooming out about a point outside the window would push the window away from it: anchor at the nearest point of the window
    if (fx < 1) wx = Math.min(v.x1, Math.max(v.x0, wx));
    if (fy < 1) wy = Math.min(v.y1, Math.max(v.y0, wy));
    const nv = { x0: wx - (wx - v.x0) / fx, x1: wx + (v.x1 - wx) / fx, y0: wy - (wy - v.y0) / fy, y1: wy + (v.y1 - wy) / fy };
    return this.env.layout === 'radial' ? this.clampView(nv) : nv;
  }

  // ------------------------------------------------------------- targets

  /** The window that brings tip node `node` (a row of the snapshot) into view at a readable size. Recomputes the area first. */
  focusViewport(node: number): Viewport {
    const { L } = this.env;
    this.computeArea();
    const v = this.view;
    const a = this.area;
    if (this.env.layout === 'rectangular') {
      const kyNow = a.ah / (v.y1 - v.y0);
      const minRow = Math.min(scaledPx(FOCUS_TIP_MIN_ROW_PX, this.env.labelSize), this.env.maxTipSpacing);
      const ky = Math.min(FOCUS_TIP_MAX_ROW_PX, Math.max(kyNow, minRow));
      const h = a.ah / ky;
      const row = L.ROW[node];
      let { x0, x1 } = v;
      const w = x1 - x0;
      const xt = L.X[node];
      if (xt < x0 || xt > x1) {
        x0 = xt - w / 2;
        x1 = x0 + w;
      }
      return { x0, x1, y0: row - h / 2, y1: row + h / 2 };
    }
    // the wanted pitch at the tip's own radius (a collapsed clade's outer edge), not the outer ring's: a tip on a short branch gets label room
    const r = L.collapsed?.[node] ? L.XMAX[node] : L.X[node];
    const k = Math.max(
      a.aw / (v.x1 - v.x0),
      (Math.min(scaledPx(FOCUS_TIP_RADIAL_PITCH_PX, this.env.labelSize), this.env.maxTipSpacing) * L.rows) / L.fan.span / Math.max(r, 1e-9),
    );
    const ang = fanAngle(L.fan, L.rows, L.ROW[node]);
    const px = L.X[node] * Math.cos(ang),
      py = L.X[node] * Math.sin(ang);
    return { x0: px - a.aw / 2 / k, x1: px + a.aw / 2 / k, y0: py - a.ah / 2 / k, y1: py + a.ah / 2 / k };
  }

  /** The window that shows the clade below `node` (a row of the snapshot) with room around it. Recomputes the area first. */
  cladeViewport(node: number): Viewport {
    const { L } = this.env;
    this.computeArea();
    const a = this.area;
    const ls = L.rowStart[node],
      le = L.rowEnd[node];
    if (this.env.layout === 'rectangular') {
      const rows = Math.max(le - ls, 6);
      const mid = (ls + le) / 2;
      const h = rows * 1.12 + 1;
      const x0 = Math.max(-0.02, L.X[node] - 0.03);
      const spanX = L.XMAX[node] - L.X[node];
      const labelFrac = Math.min(0.5, this.labelReserve() / a.aw);
      const w = Math.max(0.0005, (spanX + 0.035) / (1 - labelFrac));
      return { x0, x1: x0 + w, y0: mid - h / 2, y1: mid + h / 2 };
    }
    const bb = new Float64Array(4);
    sectorBBox(0, 0, L.X[node], L.XMAX[node], fanAngle(L.fan, L.rows, ls), fanAngle(L.fan, L.rows, le), bb);
    const cx = (bb[0] + bb[2]) / 2,
      cy = (bb[1] + bb[3]) / 2;
    const half = Math.max((bb[2] - bb[0]) / 2, (bb[3] - bb[1]) / 2, 1e-4) * ZOOM_NODE_RADIAL_PAD;
    const k = Math.min(a.aw, a.ah) / 2 / half;
    return { x0: cx - a.aw / 2 / k, x1: cx + a.aw / 2 / k, y0: cy - a.ah / 2 / k, y1: cy + a.ah / 2 / k };
  }

  /** The window that scrolls `node` (a row of the snapshot) into view with the least movement, or null when it already is.
   *  Recomputes the area first. */
  visibleViewport(node: number): Viewport | null {
    const { L, tree, W, H } = this.env;
    this.computeArea();
    const a = this.area;
    const v = this.view;
    if (this.env.layout === 'rectangular') {
      const row = L.ROW[node];
      const h = v.y1 - v.y0;
      const m = Math.min(h * 0.12, 3);
      let { y0, y1, x0, x1 } = v;
      if (row < y0 + m) {
        y0 = row - m;
        y1 = y0 + h;
      } else if (row > y1 - m) {
        y1 = row + m;
        y0 = y1 - h;
      }
      const xt = L.X[node];
      const w = x1 - x0;
      if (xt < x0 || xt > x1) {
        x0 = xt - w / 2;
        x1 = x0 + w;
      }
      return y0 !== v.y0 || x0 !== v.x0 ? { x0, x1, y0, y1 } : null;
    }
    const p = { x: 0, y: 0 };
    projectionFor(tree, L, makeTransform('radial', W, H, v, a, L.rows, L.fan)).nodeXY(node, p);
    const pad = 30;
    if (!(p.x < pad || p.y < pad || p.x > W - pad || p.y > H - pad)) return null;
    const k = a.aw / (v.x1 - v.x0);
    const ang = fanAngle(L.fan, L.rows, L.ROW[node]);
    const wx = L.X[node] * Math.cos(ang),
      wy = L.X[node] * Math.sin(ang);
    return { x0: wx - a.aw / 2 / k, x1: wx + a.aw / 2 / k, y0: wy - a.ah / 2 / k, y1: wy + a.ah / 2 / k };
  }

  // ------------------------------------------------------------- animation

  private animateTo(v: Viewport, isFit = false): void {
    const to = isFit ? v : this.clampView({ ...v });
    this.anim = { from: { ...this.view }, to, t0: performance.now(), ms: ANIMATION_MS };
    this.fitted = false;
    this.fitAfterAnim = isFit;
    this.ev.needFrame();
  }

  /** Advance the running animation to time `now` (a requestAnimationFrame timestamp). No-op without one. */
  stepAnim(now: number): void {
    const an = this.anim;
    if (!an) return;
    const t = Math.min(1, (now - an.t0) / an.ms);
    this.ev.moving();
    const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    const lerp = (p: number, q: number) => p + (q - p) * e;
    // interpolate window centre linearly and size geometrically (feels like a constant-rate zoom)
    const wf = an.from.x1 - an.from.x0,
      wt = an.to.x1 - an.to.x0,
      hf = an.from.y1 - an.from.y0,
      ht = an.to.y1 - an.to.y0;
    const w = wf * Math.pow(wt / wf, e),
      h = hf * Math.pow(ht / hf, e);
    const cx = lerp((an.from.x0 + an.from.x1) / 2, (an.to.x0 + an.to.x1) / 2),
      cy = lerp((an.from.y0 + an.from.y1) / 2, (an.to.y0 + an.to.y1) / 2);
    this.view = { x0: cx - w / 2, x1: cx + w / 2, y0: cy - h / 2, y1: cy + h / 2 };
    if (t >= 1) {
      this.view = { ...an.to };
      this.anim = null;
      if (this.fitAfterAnim) {
        this.fitted = true;
        this.fitAfterAnim = false;
      }
    }
    this.ev.changed(true);
  }
}
