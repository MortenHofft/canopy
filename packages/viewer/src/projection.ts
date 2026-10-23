// Layout projections: what the drawing and the hit index need to know about HOW a layout maps the tree to the screen, behind
// one interface, so those two are written once and the rectangular / radial difference lives here (node and branch positions, clade
// extents, the summary / run geometry), plus the per-frame values the cut needs (the dedupe grid anchors, the radial window, the
// run's dedupe key).
//
// A projection is built per frame (per Transform) and owns its scratch state, so there is no module-level mutable state and
// two renderers (or the main and the overview cut of one renderer) never share any. Answers are plain methods that write into
// fields of the projection (`d0`, ...) or into a caller-supplied point: nothing is allocated per node.
//
// What it does NOT do is serve the cut per node. The cut (lod.ts) keeps its cull test, collapse rules and dedupe key inline in one
// loop per layout: asking the projection for them per node was measured 20-30% slower on a 1M caterpillar (200k: rect 20 -> 26 ms,
// radial 25 -> 30 ms; 1M: rect 100 -> 123 ms, radial 121 -> 158 ms, medians of fresh processes), not because of polymorphism but
// because of V8's cumulative inlining budget (--max-inlined-bytecode-size-cumulative=920): the methods stay real calls and the loop's
// many live locals spill around each one. Draw and hit run per drawn primitive (thousands), where the calls are cheap.
//
// Two coordinates describe a point of either layout. DEPTH is the distance from the root in px along the branch axis (rect:
// screen x, radial: radius). The TIP AXIS is where a node sits across the tips (rect: screen y in px, radial: canvas angle in rad, in the
// fan's range of angles: fan.start .. fan.start + span for the rows, see RadialFan in layout.ts).
// A clade occupies [d0, d1] x [t0, t1] (see summaryExtent; the tip axis is in ROWS, see layout.ts); the pixel size of the tip-axis extent (rect: rows, radial: arc
// length at the clade's outer radius) is what the collapse rules compare against minPx.

import { CULL_PAD_PX } from './constants.ts';
import type { Layout } from './layout.ts';
import { ensureTrig, fanTheta, sameFan } from './layout.ts';
import type { Transform } from './geom.ts';
import { CELL_HI, CELL_LO, CLIP, K_RUN, cell, clipRay, type Seen } from './lod.ts';
import type { LayoutKind, TreeSnapshot } from './types.ts';

export interface Pt {
  x: number;
  y: number;
}

const TWO_PI = 2 * Math.PI;
const PAD = CULL_PAD_PX;

/** What every projection offers. */
export interface ProjectionCore {
  readonly kind: LayoutKind;
  readonly tree: TreeSnapshot;
  readonly L: Layout;
  readonly T: Transform;

  // ---- cut (lod.ts), once per run of small siblings
  /** Add the dedupe key of a run of siblings first..last whose deepest member ends at xmax (rule R); false: an earlier primitive owns these cells. */
  dedupeRun(seen: Seen, first: number, last: number, xmax: number): boolean;

  // ---- drawing and hit-testing
  /** Pixel distance between neighbouring tips (rect: row height, radial: along the circle of radius 1 * k, i.e. at the tips). */
  readonly tipPitch: number;
  /** Screen position of node i (its marker position). */
  nodeXY(i: number, out: Pt): void;
  /** Screen position where node i's branch starts (its parent's depth on the node's own tip-axis line; the node itself for the root). */
  parentXY(i: number, out: Pt): void;
  /** Depth of node i in px. */
  depth(i: number): number;
  /** Tip-axis coordinate of node j (rect: px, radial: rad). */
  tip(j: number): number;
  /** Pixel size of the clade below node i across the tips, at its outer edge (marker threshold). */
  cladeSize(i: number): number;
  /** Sets d0 / d1 (depth at the clade's apex, at its outer edge) and t0 / t1 (tip axis, first to last tip) for a summary of node
   *  i, or for a run first=i..last (apex at the parent's depth, outer edge at xmax); last < 0 for a plain summary. Not widened to a
   *  minimum size: draw and hit each apply their own. */
  summaryExtent(i: number, last: number, xmax: number): void;
  d0: number;
  d1: number;
  t0: number;
  t1: number;
}

export class RectProjection implements ProjectionCore {
  readonly kind = 'rectangular' as const;
  d0 = 0;
  d1 = 0;
  t0 = 0;
  t1 = 0;
  readonly tipPitch: number;
  // copies of the transform and of the arrays the methods below read
  private readonly X: Float64Array;
  private readonly ROW: Float64Array;
  private readonly XMAX: Float32Array;
  private readonly parent: Int32Array;
  private readonly rowStart: Int32Array;
  private readonly rowEnd: Int32Array;
  private readonly ox: number;
  private readonly oy: number;
  private readonly kx: number;
  private readonly ky: number;
  // dedupe cells are anchored at the whole-pixel part of the origin: panning by a fraction of a pixel does not change the cut
  readonly oxs: number;
  readonly oys: number;

  constructor(
    readonly tree: TreeSnapshot,
    readonly L: Layout,
    readonly T: Transform,
  ) {
    this.X = L.X;
    this.ROW = L.ROW;
    this.XMAX = L.XMAX;
    this.parent = tree.parent;
    this.rowStart = L.rowStart;
    this.rowEnd = L.rowEnd;
    this.ox = T.ox;
    this.oy = T.oy;
    this.kx = T.kx;
    this.ky = T.ky;
    this.oxs = Math.floor(T.ox);
    this.oys = Math.floor(T.oy);
    this.tipPitch = T.ky;
  }

  dedupeRun(seen: Seen, first: number, last: number, xmax: number): boolean {
    const { X, parent, rowStart, rowEnd, kx, ky, oxs, oys } = this;
    const d = cell(oys + rowStart[first] * ky);
    return seen.add(cell(oxs + X[parent[first]] * kx), cell(oxs + xmax * kx), d, d + K_RUN * 8192, cell(oys + rowEnd[last] * ky));
  }

  nodeXY(i: number, out: Pt): void {
    out.x = this.ox + this.X[i] * this.kx;
    out.y = this.oy + this.ROW[i] * this.ky;
  }

  parentXY(i: number, out: Pt): void {
    out.x = this.ox + this.X[i > 0 ? this.parent[i] : i] * this.kx;
    out.y = this.oy + this.ROW[i] * this.ky;
  }

  depth(i: number): number {
    return this.ox + this.X[i] * this.kx;
  }

  tip(j: number): number {
    return this.oy + this.ROW[j] * this.ky;
  }

  cladeSize(i: number): number {
    return (this.rowEnd[i] - this.rowStart[i]) * this.ky;
  }

  summaryExtent(i: number, last: number, xmax: number): void {
    const { X, XMAX, parent, rowStart, rowEnd } = this;
    const run = last >= 0;
    this.d0 = this.ox + X[run ? parent[i] : i] * this.kx;
    this.d1 = this.ox + (run ? xmax : XMAX[i]) * this.kx;
    this.t0 = this.oy + rowStart[i] * this.ky;
    this.t1 = this.oy + rowEnd[run ? last : i] * this.ky;
  }
}

export class RadialProjection implements ProjectionCore {
  readonly kind = 'radial' as const;
  d0 = 0;
  d1 = 0;
  t0 = 0;
  t1 = 0;
  readonly tipPitch: number;
  // the viewport as seen from the root: radius range, angle interval lo..hi (or, when wrap, the angles from lo up and from hi down: the
  // window is across the middle of the fan's opening), in the fan's range of angles (fanTheta), where the rows are a0..a0 + span
  rMin = 0;
  rMax = 0;
  all = true;
  lo = 0;
  hi = 0;
  wrap = false;
  private readonly cx: number;
  private readonly cy: number;
  private readonly k: number;
  private readonly da: number;
  /** Canvas angle of row position 0 (the fan's start). */
  readonly a0: number;
  // dedupe cells live in tree space at a scale rounded down to a power of two (cells are 1 to 2 px), shifted by whole cells
  // only: a pan leaves every primitive's cell untouched, and zooming changes the grid once per doubling instead of every
  // frame, so which of two close clades survives does not flicker
  readonly fq: number;
  readonly ou: number;
  readonly ov: number;
  private readonly X: Float64Array;
  private readonly ROW: Float64Array;
  private readonly XMAX: Float32Array;
  private readonly parent: Int32Array;
  private readonly rowStart: Int32Array;
  private readonly rowEnd: Int32Array;
  private readonly COS: Float64Array;
  private readonly SIN: Float64Array;
  private readonly corner = new Float64Array(4);

  constructor(
    readonly tree: TreeSnapshot,
    readonly L: Layout,
    readonly T: Transform,
  ) {
    // the fan is the layout's (setLayoutFan); the projection only reads it, and a transform made for another fan is a caller's mistake
    if (!sameFan(T.fan, L.fan)) throw new Error("makeTransform was given a radial fan other than the layout's (pass L.fan)");
    ensureTrig(L);
    this.X = L.X;
    this.ROW = L.ROW;
    this.XMAX = L.XMAX;
    this.parent = tree.parent;
    this.rowStart = L.rowStart;
    this.rowEnd = L.rowEnd;
    this.COS = L.COS!;
    this.SIN = L.SIN!;
    this.cx = T.cx;
    this.cy = T.cy;
    this.k = T.k;
    this.da = T.da;
    this.a0 = L.fan.start;
    this.tipPitch = T.da * T.k;
    const fq = Math.pow(2, Math.floor(Math.log2(T.k))) / T.k;
    this.fq = fq;
    this.ou = Math.floor(((T.clipL + T.clipR) / 2 - T.cx) * fq);
    this.ov = Math.floor(((T.clipT + T.clipB) / 2 - T.cy) * fq);
    this.window(T.clipL - PAD, T.clipT - PAD, T.clipR + PAD, T.clipB + PAD);
  }

  /** The rectangle L..R x T..B seen from the root (cx, cy): radius range and angle interval. */
  private window(L: number, T: number, R: number, B: number): void {
    const { cx, cy } = this;
    const dxMin = cx < L ? L - cx : cx > R ? cx - R : 0;
    const dyMin = cy < T ? T - cy : cy > B ? cy - B : 0;
    this.rMin = Math.hypot(dxMin, dyMin);
    this.rMax = Math.hypot(Math.max(Math.abs(cx - L), Math.abs(cx - R)), Math.max(Math.abs(cy - T), Math.abs(cy - B)));
    this.all = dxMin === 0 && dyMin === 0; // the root is inside the window: every angle is visible
    const fan = this.L.fan;
    const base = fan.start + (fan.span / 2 - Math.PI); // the lowest angle of the fan's range (the middle of the opening, see fanTheta)
    if (this.all) {
      this.lo = base;
      this.hi = base + TWO_PI;
      this.wrap = false;
      return;
    }
    // the rectangle subtends less than pi seen from an outside point: its angular interval is the complement of the
    // largest gap between the four corner angles
    const c = this.corner;
    c[0] = fanTheta(fan, Math.atan2(T - cy, L - cx));
    c[1] = fanTheta(fan, Math.atan2(T - cy, R - cx));
    c[2] = fanTheta(fan, Math.atan2(B - cy, L - cx));
    c[3] = fanTheta(fan, Math.atan2(B - cy, R - cx));
    c.sort(); // typed arrays sort numerically
    let gap = c[0] + TWO_PI - c[3],
      at = 3;
    for (let q = 0; q < 3; q++)
      if (c[q + 1] - c[q] > gap) {
        gap = c[q + 1] - c[q];
        at = q;
      }
    if (at === 3) {
      this.lo = c[0];
      this.hi = c[3];
      this.wrap = false;
    } else {
      this.lo = c[at + 1];
      this.hi = c[at];
      this.wrap = true;
    }
    const eps = 1e-9;
    this.lo -= eps;
    this.hi += eps;
  }

  dedupeRun(seen: Seen, first: number, last: number, xmax: number): boolean {
    const { X, parent, rowStart, rowEnd, k, da, a0, fq, ou, ov } = this;
    const rq = xmax * k,
      rp = X[parent[first]] * k;
    const sa0 = a0 + rowStart[first] * da,
      sa1 = a0 + rowEnd[last] * da,
      mid = (sa0 + sa1) / 2,
      cm = Math.cos(mid),
      sm = Math.sin(mid);
    const e = Math.min(8191, Math.round((sa1 - sa0) * rq));
    const ux = rq * cm * fq - ou,
      uy = rq * sm * fq - ov,
      vx = rp * cm * fq - ou,
      vy = rp * sm * fq - ov;
    if (ux >= CELL_LO && ux < CELL_HI && uy >= CELL_LO && uy < CELL_HI && vx >= CELL_LO && vx < CELL_HI && vy >= CELL_LO && vy < CELL_HI)
      return seen.add(cell(ux), cell(uy), cell(vx), cell(vy) + K_RUN * 8192, e);
    clipRay(rp * fq, rq * fq, cm, sm, ou, ov); // the part of the run's ray inside the cells (see clipRay)
    return seen.add(CLIP[0], CLIP[1], CLIP[2], CLIP[3] + K_RUN * 8192, e);
  }

  nodeXY(i: number, out: Pt): void {
    const r = this.X[i] * this.k;
    out.x = this.cx + r * this.COS[i];
    out.y = this.cy + r * this.SIN[i];
  }

  parentXY(i: number, out: Pt): void {
    const r = this.X[i > 0 ? this.parent[i] : i] * this.k;
    out.x = this.cx + r * this.COS[i];
    out.y = this.cy + r * this.SIN[i];
  }

  depth(i: number): number {
    return this.X[i] * this.k;
  }

  tip(j: number): number {
    return this.a0 + this.ROW[j] * this.da;
  }

  /** Angle from node a to node b (as tip(b) - tip(a), without the origin's rounding; the sagitta test of a connector arc). */
  tipSpan(a: number, b: number): number {
    return (this.ROW[b] - this.ROW[a]) * this.da;
  }

  cladeSize(i: number): number {
    return (this.rowEnd[i] - this.rowStart[i]) * this.da * this.XMAX[i] * this.k;
  }

  summaryExtent(i: number, last: number, xmax: number): void {
    const { X, XMAX, parent, rowStart, rowEnd } = this;
    const run = last >= 0;
    this.d0 = X[run ? parent[i] : i] * this.k;
    this.d1 = (run ? xmax : XMAX[i]) * this.k;
    this.t0 = this.a0 + rowStart[i] * this.da;
    this.t1 = this.a0 + rowEnd[run ? last : i] * this.da;
  }
}

export type LayoutProjection = RectProjection | RadialProjection;

/** The projection of one frame: chosen from the transform's kind. */
export function projectionFor(tree: TreeSnapshot, L: Layout, T: Transform): LayoutProjection {
  return T.kind === 'rectangular' ? new RectProjection(tree, L, T) : new RadialProjection(tree, L, T);
}
