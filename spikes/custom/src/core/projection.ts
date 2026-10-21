// Layout projections: everything the cut, the drawing and the hit index need to know about HOW a layout maps the tree to the
// screen, behind one interface, so those three can be written once and the rectangular / radial difference lives here.
//
// A projection is built per frame (per Transform) and owns its scratch state, so there is no module-level mutable state and
// two renderers (or the main and the overview cut of one renderer) never share any. Per-frame precomputation (dedupe grid
// anchors, the radial window) is done in the constructor. Per-node answers are plain methods that write into fields of the
// projection (`ext`, `d0`, ...) or into a caller-supplied point: nothing is allocated per node. There is exactly one class
// per layout and both have the same field order and method names, so the call sites in the hot loops stay monomorphic
// whenever one layout is in use.
//
// Two coordinates describe a point of either layout. DEPTH is the distance from the root in px along the branch axis (rect:
// screen x, radial: radius). The TIP AXIS is where a node sits across the tips (rect: screen y in px, radial: angle in rad).
// A clade occupies [d0, d1] x [t0, t1] (see summaryExtent); the pixel size of the tip-axis extent (rect: rows, radial: arc
// length at the clade's outer radius) is what the collapse rules compare against minPx.

import { CULL_PAD_PX } from './constants.ts';
import type { Layout } from './layout.ts';
import { ensureTrig } from './layout.ts';
import type { Transform } from './geom.ts';
import { K_NODE, K_RUN, K_SUMMARY, isSlice } from './kinds.ts';
import type { Seen } from './lod.ts';
import type { LayoutKind, TreeSnapshot } from './types.ts';

export interface Pt {
  x: number;
  y: number;
}

const TWO_PI = 2 * Math.PI;
const HALF_PI = Math.PI / 2;
const PAD = CULL_PAD_PX;

/** Dedupe cell of a pixel (or scaled tree-space) coordinate: offset so small negatives stay distinct, clamped to the 13 bits Seen.add packs. */
const cell = (v: number): number => {
  const c = Math.floor(v) + 1024;
  return c < 0 ? 0 : c > 8191 ? 8191 : c;
};

/** What every projection offers. The cut uses the first group per node, draw and hit use the second. */
export interface ProjectionCore {
  readonly kind: LayoutKind;
  readonly tree: TreeSnapshot;
  readonly L: Layout;
  readonly T: Transform;

  // ---- cut (lod.ts), per visited node. cull() must return false before collapses()/pastClip()/dedupe() are called for the same node.
  /** Pixel extent along the tip axis of the node last accepted by cull() (rect: rows, radial: arc at the clade's outer radius). */
  ext: number;
  /** true: the clade cannot touch the padded clip rectangle, skip its subtree. Otherwise sets `ext` and the per-node scratch. */
  cull(i: number): boolean;
  /** true: the node starts beyond the right clip edge, so it is never opened (rect only; radial culls such clades instead). */
  pastClip(i: number): boolean;
  /** Collapse rules A/B (extent or width below minPx, the latter while still shorter than 4 minPx) and, radial only, the
   *  polytomy-slice rule. Uses the scratch of the last cull(). */
  collapses(i: number, minPx: number): boolean;
  /** Add the dedupe key of a K_NODE / K_TIP / K_SUMMARY / K_STUB entry (rule C); false: an earlier primitive owns these cells. */
  dedupe(seen: Seen, i: number, kind: number): boolean;
  /** Same for a run of siblings first..last whose deepest member ends at xmax (rule R). */
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
  /** Tip-axis distance from node a to node b (as tip(b) - tip(a), without the origin's rounding). */
  tipSpan(a: number, b: number): number;
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
  ext = 0;
  d0 = 0;
  d1 = 0;
  t0 = 0;
  t1 = 0;
  readonly tipPitch: number;
  private sx = 0; // x of the node last accepted by cull()
  // copies of the transform and of the arrays the hot methods read: one field load instead of a chain (measured: the chain made the cut 30% slower)
  private readonly X: Float64Array;
  private readonly ROW: Float64Array;
  private readonly XMAX: Float32Array;
  private readonly LAST: Int32Array;
  private readonly parent: Int32Array;
  private readonly firstChild: Int32Array;
  private readonly leafStart: Int32Array;
  private readonly leafEnd: Int32Array;
  private readonly ox: number;
  private readonly oy: number;
  private readonly kx: number;
  private readonly ky: number;
  private readonly clipTm: number; // clip edges moved out by PAD
  private readonly clipBp: number;
  private readonly clipLm: number;
  private readonly clipRp: number;
  // dedupe cells are anchored at the whole-pixel part of the origin: panning by a fraction of a pixel does not change the cut
  private readonly oxs: number;
  private readonly oys: number;

  constructor(
    readonly tree: TreeSnapshot,
    readonly L: Layout,
    readonly T: Transform,
  ) {
    this.X = L.X;
    this.ROW = L.ROW;
    this.XMAX = L.XMAX;
    this.LAST = L.LAST;
    this.parent = tree.parent;
    this.firstChild = tree.firstChild;
    this.leafStart = tree.leafStart;
    this.leafEnd = tree.leafEnd;
    this.ox = T.ox;
    this.oy = T.oy;
    this.kx = T.kx;
    this.ky = T.ky;
    this.clipTm = T.clipT - PAD;
    this.clipBp = T.clipB + PAD;
    this.clipLm = T.clipL - PAD;
    this.clipRp = T.clipR + PAD;
    this.oxs = Math.floor(T.ox);
    this.oys = Math.floor(T.oy);
    this.tipPitch = T.ky;
  }

  cull(i: number): boolean {
    const { ox, oy, kx, ky } = this;
    const yTop = oy + this.leafStart[i] * ky;
    const yBot = oy + this.leafEnd[i] * ky;
    if (yBot < this.clipTm || yTop > this.clipBp) return true;
    const sx = ox + this.X[i] * kx;
    if (ox + this.XMAX[i] * kx < this.clipLm) return true;
    const sxp = i > 0 ? ox + this.X[this.parent[i]] * kx : sx;
    if (sxp > this.clipRp) return true;
    this.sx = sx;
    this.ext = yBot - yTop;
    return false;
  }

  pastClip(_i: number): boolean {
    return this.sx > this.clipRp;
  }

  collapses(i: number, minPx: number): boolean {
    const ext = this.ext;
    return ext < minPx || (this.ox + this.XMAX[i] * this.kx - this.sx < minPx && ext < 4 * minPx);
  }

  dedupe(seen: Seen, i: number, kind: number): boolean {
    const { ROW, oys, ky } = this;
    let d: number, e: number;
    if (kind === K_NODE) {
      d = cell(oys + ROW[this.firstChild[i]] * ky);
      e = cell(oys + ROW[this.LAST[i]] * ky);
    } else if (kind === K_SUMMARY) {
      d = cell(oys + this.leafStart[i] * ky);
      e = cell(oys + this.leafEnd[i] * ky);
    } else {
      d = cell(oys + ROW[i] * ky);
      e = d;
    }
    const X = this.X;
    return seen.add(
      cell(this.oxs + (i > 0 ? X[this.parent[i]] : X[i]) * this.kx),
      cell(this.oxs + X[i] * this.kx),
      cell(oys + ROW[i] * ky),
      d + kind * 8192,
      e,
    );
  }

  dedupeRun(seen: Seen, first: number, last: number, xmax: number): boolean {
    const { X, parent, leafStart, leafEnd, kx, ky, oxs, oys } = this;
    const d = cell(oys + leafStart[first] * ky);
    return seen.add(cell(oxs + X[parent[first]] * kx), cell(oxs + xmax * kx), d, d + K_RUN * 8192, cell(oys + leafEnd[last] * ky));
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

  tipSpan(a: number, b: number): number {
    return (this.ROW[b] - this.ROW[a]) * this.ky;
  }

  cladeSize(i: number): number {
    return (this.leafEnd[i] - this.leafStart[i]) * this.ky;
  }

  summaryExtent(i: number, last: number, xmax: number): void {
    const { X, XMAX, parent, leafStart, leafEnd } = this;
    const run = last >= 0;
    this.d0 = this.ox + X[run ? parent[i] : i] * this.kx;
    this.d1 = this.ox + (run ? xmax : XMAX[i]) * this.kx;
    this.t0 = this.oy + leafStart[i] * this.ky;
    this.t1 = this.oy + leafEnd[run ? last : i] * this.ky;
  }
}

export class RadialProjection implements ProjectionCore {
  readonly kind = 'radial' as const;
  ext = 0;
  d0 = 0;
  d1 = 0;
  t0 = 0;
  t1 = 0;
  readonly tipPitch: number;
  // the viewport as seen from the root (angles in 0..2pi): radius range, angle interval (lo..hi, or its complement when wrap)
  rMin = 0;
  rMax = 0;
  all = true;
  lo = 0;
  hi = 0;
  wrap = false;
  // scratch of the node last accepted by cull()
  private r0 = 0; // radius of the parent (0 for the root)
  private r1 = 0; // radius of the clade's outer edge
  private ri = 0; // radius of the node
  private readonly cx: number;
  private readonly cy: number;
  private readonly k: number;
  private readonly da: number;
  private readonly clipTm: number;
  private readonly clipBp: number;
  private readonly clipLm: number;
  private readonly clipRp: number;
  // dedupe cells live in tree space at a scale rounded down to a power of two (cells are 1 to 2 px), shifted by whole cells
  // only: a pan leaves every primitive's cell untouched, and zooming changes the grid once per doubling instead of every
  // frame, so which of two close clades survives does not flicker
  private readonly fq: number;
  private readonly ou: number;
  private readonly ov: number;
  private readonly X: Float64Array;
  private readonly ROW: Float64Array;
  private readonly XMAX: Float32Array;
  private readonly LAST: Int32Array;
  private readonly parent: Int32Array;
  private readonly firstChild: Int32Array;
  private readonly leafStart: Int32Array;
  private readonly leafEnd: Int32Array;
  private readonly COS: Float64Array;
  private readonly SIN: Float64Array;
  private readonly BC: Float64Array;
  private readonly BS: Float64Array;
  private readonly corner = new Float64Array(4);

  constructor(
    readonly tree: TreeSnapshot,
    readonly L: Layout,
    readonly T: Transform,
  ) {
    ensureTrig(L);
    this.X = L.X;
    this.ROW = L.ROW;
    this.XMAX = L.XMAX;
    this.LAST = L.LAST;
    this.parent = tree.parent;
    this.firstChild = tree.firstChild;
    this.leafStart = tree.leafStart;
    this.leafEnd = tree.leafEnd;
    this.COS = L.COS!;
    this.SIN = L.SIN!;
    this.BC = L.BC!;
    this.BS = L.BS!;
    this.cx = T.cx;
    this.cy = T.cy;
    this.k = T.k;
    this.da = T.da;
    this.clipTm = T.clipT - PAD;
    this.clipBp = T.clipB + PAD;
    this.clipLm = T.clipL - PAD;
    this.clipRp = T.clipR + PAD;
    this.tipPitch = (2 * Math.PI * T.k) / Math.max(1, tree.tipCount);
    const fq = Math.pow(2, Math.floor(Math.log2(T.k))) / T.k;
    this.fq = fq;
    this.ou = Math.floor(((T.clipL + T.clipR) / 2 - T.cx) * fq);
    this.ov = Math.floor(((T.clipT + T.clipB) / 2 - T.cy) * fq);
    this.window(this.clipLm, this.clipTm, this.clipRp, this.clipBp);
  }

  /** The rectangle L..R x T..B seen from the root (cx, cy): radius range and angle interval. */
  private window(L: number, T: number, R: number, B: number): void {
    const { cx, cy } = this;
    const dxMin = cx < L ? L - cx : cx > R ? cx - R : 0;
    const dyMin = cy < T ? T - cy : cy > B ? cy - B : 0;
    this.rMin = Math.hypot(dxMin, dyMin);
    this.rMax = Math.hypot(Math.max(Math.abs(cx - L), Math.abs(cx - R)), Math.max(Math.abs(cy - T), Math.abs(cy - B)));
    this.all = dxMin === 0 && dyMin === 0; // the root is inside the window: every angle is visible
    if (this.all) {
      this.lo = 0;
      this.hi = TWO_PI;
      this.wrap = false;
      return;
    }
    // the rectangle subtends less than pi seen from an outside point: its angular interval is the complement of the
    // largest gap between the four corner angles
    const c = this.corner;
    c[0] = Math.atan2(T - cy, L - cx);
    c[1] = Math.atan2(T - cy, R - cx);
    c[2] = Math.atan2(B - cy, L - cx);
    c[3] = Math.atan2(B - cy, R - cx);
    for (let q = 0; q < 4; q++) if (c[q] < 0) c[q] += TWO_PI;
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

  cull(i: number): boolean {
    const { X, XMAX, parent, leafStart, leafEnd, k, da } = this;
    const r1 = XMAX[i] * k;
    const r0 = i > 0 ? X[parent[i]] * k : 0;
    if (r1 < this.rMin || r0 > this.rMax) return true;
    const ls = leafStart[i],
      le = leafEnd[i];
    const a0 = ls * da;
    const a1 = le * da;
    if (!this.all && (this.wrap ? !(a1 >= this.lo || a0 <= this.hi) : !(a1 >= this.lo && a0 <= this.hi))) return true;
    // exact enough: the sector's bounding box against the padded clip rectangle (corner points from the cached boundary
    // cos/sin, plus the axis crossings), after the cheap radius and angle tests above
    const c0 = this.BC[ls],
      s0 = this.BS[ls],
      c1 = this.BC[le],
      s1 = this.BS[le];
    let bx0 = Math.min(r0 * c0, r1 * c0, r0 * c1, r1 * c1),
      bx1 = Math.max(r0 * c0, r1 * c0, r0 * c1, r1 * c1);
    let by0 = Math.min(r0 * s0, r1 * s0, r0 * s1, r1 * s1),
      by1 = Math.max(r0 * s0, r1 * s0, r0 * s1, r1 * s1);
    for (let q = Math.ceil(a0 / HALF_PI); q * HALF_PI <= a1; q++) {
      switch (q & 3) {
        case 0:
          if (r1 > bx1) bx1 = r1;
          break;
        case 1:
          if (r1 > by1) by1 = r1;
          break;
        case 2:
          if (-r1 < bx0) bx0 = -r1;
          break;
        default:
          if (-r1 < by0) by0 = -r1;
      }
    }
    if (this.cx + bx1 < this.clipLm || this.cx + bx0 > this.clipRp || this.cy + by1 < this.clipTm || this.cy + by0 > this.clipBp) return true;
    this.r0 = r0;
    this.r1 = r1;
    this.ri = X[i] * k;
    this.ext = (a1 - a0) * r1;
    return false;
  }

  pastClip(_i: number): boolean {
    return false;
  }

  collapses(i: number, minPx: number): boolean {
    const arc = this.ext;
    // a polytomy of tips collapses once its children are closer than minPx on average, so thousands of siblings cost one slice
    return arc < minPx || (this.r1 - this.ri < minPx && arc < 4 * minPx) || (isSlice(this.tree, i) && arc < minPx * this.tree.childCount[i]);
  }

  dedupe(seen: Seen, i: number, kind: number): boolean {
    const { ROW, LAST, firstChild, fq, ou, ov } = this;
    const ri = this.ri;
    const rp = i > 0 ? this.r0 : ri;
    const ca = this.COS[i],
      sa = this.SIN[i];
    let e = 0;
    if (kind === K_NODE) e = Math.min(8191, Math.round((ROW[LAST[i]] - ROW[firstChild[i]]) * this.da * ri));
    else if (kind === K_SUMMARY) e = Math.min(8191, Math.round(this.ext));
    return seen.add(cell(ri * ca * fq - ou), cell(ri * sa * fq - ov), cell(rp * ca * fq - ou), cell(rp * sa * fq - ov) + kind * 8192, e);
  }

  dedupeRun(seen: Seen, first: number, last: number, xmax: number): boolean {
    const { X, parent, leafStart, leafEnd, k, da, fq, ou, ov } = this;
    const rq = xmax * k,
      rp = X[parent[first]] * k;
    const sa0 = leafStart[first] * da,
      sa1 = leafEnd[last] * da,
      mid = (sa0 + sa1) / 2,
      cm = Math.cos(mid),
      sm = Math.sin(mid);
    return seen.add(
      cell(rq * cm * fq - ou),
      cell(rq * sm * fq - ov),
      cell(rp * cm * fq - ou),
      cell(rp * sm * fq - ov) + K_RUN * 8192,
      Math.min(8191, Math.round((sa1 - sa0) * rq)),
    );
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
    return this.ROW[j] * this.da;
  }

  tipSpan(a: number, b: number): number {
    return (this.ROW[b] - this.ROW[a]) * this.da;
  }

  cladeSize(i: number): number {
    return (this.leafEnd[i] - this.leafStart[i]) * this.da * this.XMAX[i] * this.k;
  }

  summaryExtent(i: number, last: number, xmax: number): void {
    const { X, XMAX, parent, leafStart, leafEnd } = this;
    const run = last >= 0;
    this.d0 = X[run ? parent[i] : i] * this.k;
    this.d1 = (run ? xmax : XMAX[i]) * this.k;
    this.t0 = leafStart[i] * this.da;
    this.t1 = leafEnd[run ? last : i] * this.da;
  }
}

export type LayoutProjection = RectProjection | RadialProjection;

/** The projection of one frame: chosen from the transform's kind. */
export function projectionFor(tree: TreeSnapshot, L: Layout, T: Transform): LayoutProjection {
  return T.kind === 'rectangular' ? new RectProjection(tree, L, T) : new RadialProjection(tree, L, T);
}
