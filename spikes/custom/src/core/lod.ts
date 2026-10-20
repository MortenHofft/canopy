// Viewport cut: which nodes are drawn this frame, and how.
//
// The traversal is a single forward scan over the preorder arrays (no stack, no child lists): a node that is
// culled (outside the viewport) or collapsed (a clade smaller than `minPx` in either direction) is skipped
// together with its whole subtree by jumping to subtreeEnd[i]. Cost is O(nodes visited), which is bounded by
// the viewport for bushy trees, and the number of PRIMITIVES emitted is bounded by the draw budget:
//   rule A/B  collapse a clade whose pixel height (radial: arc length at the tips) is < minPx, or whose width is
//             < minPx while it is still shorter than 4*minPx (a tall thin comb keeps its rows, labels and links)
//   rule C    sub-pixel primitives that land on the same pixel cells as an earlier one are not emitted again
//             (this is what keeps a 200k caterpillar from emitting 400k segments)
//   rule D    if the list still exceeds the budget, minPx is raised and the cut is redone (cheap: the aborted
//             pass stops as soon as the budget is exceeded); the search is in the renderer (fitCut)
//
// Radial culling (2026-10): a node is skipped when its annular sector (radius X[parent]..XMAX, angle leafStart..leafEnd)
// cannot touch the padded clip rectangle: a radius-range test (distance from the root to the nearest and the farthest
// point of the rectangle) and an angle-range test (the angular interval the rectangle subtends as seen from the root).
// Survivors then get the sector's exact bounding box test (cached boundary cos/sin, no trigonometry per node): the cheap tests
// alone keep more off-screen primitives in the list than a bounding box does when the window is wide and off-centre.

import type { Layout } from './layout.ts';
import type { Transform } from './geom.ts';
import { ensureTrig } from './layout.ts';
import type { TreeSnapshot } from './types.ts';

export const K_NODE = 0; // expanded internal node: branch + connector, children follow
export const K_TIP = 1;
export const K_SUMMARY = 2; // collapsed clade drawn as a triangle
export const K_STUB = 3; // collapsed or cut clade drawn as its branch only

export class DrawList {
  node = new Int32Array(8192);
  kind = new Uint8Array(8192);
  cls = new Uint8Array(8192);
  count = 0;
  push(i: number, kind: number, cls: number): void {
    if (this.count === this.node.length) this.grow();
    const c = this.count++;
    this.node[c] = i;
    this.kind[c] = kind;
    this.cls[c] = cls;
  }
  private grow(): void {
    const n = this.node.length * 2;
    const a = new Int32Array(n); a.set(this.node); this.node = a;
    const b = new Uint8Array(n); b.set(this.kind); this.kind = b;
    const c = new Uint8Array(n); c.set(this.cls); this.cls = c;
  }
}

/** Hash set of pixel-cell keys with O(1) reset (generation stamps). */
export class Seen {
  private k1 = new Float64Array(1 << 19);
  private k2 = new Int32Array(1 << 19);
  private st = new Uint32Array(1 << 19);
  private cur = 1;
  private n = 0;
  reset(): void {
    this.cur++;
    this.n = 0;
    if (this.cur >= 0xfffffff0) {
      this.st.fill(0);
      this.cur = 1;
    }
  }
  /** true if the key was new (and is now recorded), false if already present. */
  add(a: number, b: number, c: number, d: number, e: number): boolean {
    if (this.n > 380000) return true; // table nearly full: stop deduplicating rather than loop
    const key1 = (a * 8192 + b) * 8192 + c;
    const key2 = d * 8192 + e;
    const lo = key1 % 4294967296;
    const hi = (key1 - lo) / 4294967296;
    let h = (Math.imul(lo | 0, 0x9e3779b1) ^ Math.imul(hi | 0, 0x85ebca6b) ^ Math.imul(key2, 0xc2b2ae35)) >>> 13;
    const mask = (1 << 19) - 1;
    for (;;) {
      h &= mask;
      if (this.st[h] !== this.cur) {
        this.st[h] = this.cur;
        this.k1[h] = key1;
        this.k2[h] = key2;
        this.n++;
        return true;
      }
      if (this.k1[h] === key1 && this.k2[h] === key2) return false;
      h++;
    }
  }
}

const cell = (v: number): number => {
  const c = Math.floor(v) + 1024;
  return c < 0 ? 0 : c > 8191 ? 8191 : c;
};

export interface CutResult {
  visited: number;
  summaries: number;
  tips: number;
  overflow: boolean;
  forced: number; // summaries whose clade the base threshold would have expanded (collapsed only because of the budget)
  summaryTips: number; // tips inside the summaries
  mergedTips: number; // tips of primitives skipped because they share pixel cells with an earlier one
}
const res: CutResult = { visited: 0, summaries: 0, tips: 0, overflow: false, forced: 0, summaryTips: 0, mergedTips: 0 };

export interface CutParams {
  lod: boolean;
  minPx: number;
  baseMinPx?: number; // the threshold without any budget pressure (default minPx)
  budget: number;
  summaries: boolean;
}

export function cutRect(tree: TreeSnapshot, L: Layout, T: Transform, P: CutParams, classOf: Uint8Array | null, out: DrawList, seen: Seen): CutResult {
  const n = L.n;
  const { X, ROW, XMAX, LAST } = L;
  const { parent, subtreeEnd, leafStart, leafEnd, childCount, firstChild } = tree;
  const stub = tree.stub ?? null; // a plain TreeData (no stub field) is accepted too
  const { ox, oy, kx, ky, clipL, clipR, clipT, clipB } = T;
  const { lod, minPx, budget } = P;
  const PAD = 8;
  // dedupe cells are anchored at the whole-pixel part of the origin (see cutRadial): panning by a fraction of a pixel
  // does not change the cut
  const oxs = Math.floor(ox), oys = Math.floor(oy);
  out.count = 0;
  seen.reset();
  let visited = 0, summaries = 0, tips = 0, forced = 0, summaryTips = 0, mergedTips = 0;
  const base = P.baseMinPx ?? minPx;
  let overflow = false;
  let i = 0;
  while (i < n) {
    visited++;
    const yTop = oy + leafStart[i] * ky;
    const yBot = oy + leafEnd[i] * ky;
    if (yBot < clipT - PAD || yTop > clipB + PAD) { i = subtreeEnd[i]; continue; }
    const sx = ox + X[i] * kx;
    if (ox + XMAX[i] * kx < clipL - PAD) { i = subtreeEnd[i]; continue; }
    const p = parent[i];
    const sxp = i > 0 ? ox + X[p] * kx : sx;
    if (sxp > clipR + PAD) { i = subtreeEnd[i]; continue; }
    const sy = oy + ROW[i] * ky;
    let kind: number;
    let descend = false;
    if (childCount[i] === 0) kind = K_TIP;
    else if (stub !== null && stub[i] === 1) kind = P.summaries ? K_SUMMARY : K_STUB; // clade not loaded: a triangle, never opened
    else if (sx > clipR + PAD) kind = K_STUB;
    else if (lod && i > 0 && (yBot - yTop < minPx || (ox + XMAX[i] * kx - sx < minPx && yBot - yTop < 4 * minPx))) kind = P.summaries ? K_SUMMARY : K_STUB;
    else { kind = K_NODE; descend = true; }
    let emit = true;
    if (lod) {
      let d: number, e: number;
      if (kind === K_NODE) { d = cell(oys + ROW[firstChild[i]] * ky); e = cell(oys + ROW[LAST[i]] * ky); }
      else if (kind === K_SUMMARY) { d = cell(oys + leafStart[i] * ky); e = cell(oys + leafEnd[i] * ky); }
      else { d = cell(oys + ROW[i] * ky); e = d; }
      emit = seen.add(cell(oxs + (i > 0 ? X[p] : X[i]) * kx), cell(oxs + X[i] * kx), cell(oys + ROW[i] * ky), d + kind * 8192, e);
    }
    if (emit) {
      if (out.count >= budget) { overflow = true; break; }
      out.push(i, kind, classOf ? classOf[i] : 0);
      if (kind === K_SUMMARY) {
        summaries++;
        summaryTips += leafEnd[i] - leafStart[i];
        if (minPx > base && (stub === null || stub[i] === 0) && !(yBot - yTop < base || (ox + XMAX[i] * kx - sx < base && yBot - yTop < 4 * base))) forced++;
      } else if (kind === K_TIP) tips++;
    } else if (kind !== K_NODE) mergedTips += leafEnd[i] - leafStart[i];
    i = descend ? i + 1 : subtreeEnd[i];
  }
  res.visited = visited; res.summaries = summaries; res.tips = tips; res.overflow = overflow; res.forced = forced; res.summaryTips = summaryTips; res.mergedTips = mergedTips;
  return res;
}

const TWO_PI = 2 * Math.PI;
const HALF_PI = Math.PI / 2;
// the viewport as seen from the root (radial culling), recomputed per cut: scratch values, no allocation
export const radialWindowState = { rMin: 0, rMax: 0, all: true, lo: 0, hi: 0, wrap: false };
const cornerA = [0, 0, 0, 0];

export function radialWindow(cx: number, cy: number, L: number, T: number, R: number, B: number): void {
  const dxMin = cx < L ? L - cx : cx > R ? cx - R : 0;
  const dyMin = cy < T ? T - cy : cy > B ? cy - B : 0;
  const W = radialWindowState;
  W.rMin = Math.hypot(dxMin, dyMin);
  W.rMax = Math.hypot(Math.max(Math.abs(cx - L), Math.abs(cx - R)), Math.max(Math.abs(cy - T), Math.abs(cy - B)));
  W.all = dxMin === 0 && dyMin === 0; // the root is inside the window: every angle is visible
  if (W.all) { W.lo = 0; W.hi = TWO_PI; W.wrap = false; return; }
  // the rectangle subtends less than pi seen from an outside point: its angular interval is the complement of the
  // largest gap between the four corner angles
  const c = cornerA;
  c[0] = Math.atan2(T - cy, L - cx); c[1] = Math.atan2(T - cy, R - cx); c[2] = Math.atan2(B - cy, L - cx); c[3] = Math.atan2(B - cy, R - cx);
  for (let k = 0; k < 4; k++) if (c[k] < 0) c[k] += TWO_PI;
  c.sort((p, q) => p - q);
  let gap = c[0] + TWO_PI - c[3], at = 3;
  for (let k = 0; k < 3; k++) if (c[k + 1] - c[k] > gap) { gap = c[k + 1] - c[k]; at = k; }
  if (at === 3) { W.lo = c[0]; W.hi = c[3]; W.wrap = false; }
  else { W.lo = c[at + 1]; W.hi = c[at]; W.wrap = true; }
  const eps = 1e-9;
  W.lo -= eps; W.hi += eps;
}

export function cutRadial(tree: TreeSnapshot, L: Layout, T: Transform, P: CutParams, classOf: Uint8Array | null, out: DrawList, seen: Seen): CutResult {
  ensureTrig(L);
  const n = L.n;
  const { X, ROW, XMAX, LAST } = L;
  const COS = L.COS!, SIN = L.SIN!, BC = L.BC!, BS = L.BS!;
  const { parent, subtreeEnd, leafStart, leafEnd, childCount, firstChild } = tree;
  const stub = tree.stub ?? null; // a plain TreeData (no stub field) is accepted too
  const { cx, cy, k, da, clipL, clipR, clipT, clipB } = T;
  const { lod, minPx, budget } = P;
  const base = P.baseMinPx ?? minPx;
  const PAD = 8;
  // dedupe cells are anchored at the whole-pixel part of the origin, so a sub-pixel pan moves every primitive by the same
  // amount relative to the cell grid, i.e. leaves the cut unchanged
  const cxs = Math.floor(cx), cys = Math.floor(cy);
  radialWindow(cx, cy, clipL - PAD, clipT - PAD, clipR + PAD, clipB + PAD);
  const W = radialWindowState;
  const rMin = W.rMin, rMax = W.rMax, all = W.all, lo = W.lo, hi = W.hi, wrap = W.wrap;
  out.count = 0;
  seen.reset();
  let visited = 0, summaries = 0, tips = 0, forced = 0, summaryTips = 0, mergedTips = 0;
  let overflow = false;
  let i = 0;
  while (i < n) {
    visited++;
    const r1 = XMAX[i] * k;
    const r0 = i > 0 ? X[parent[i]] * k : 0;
    if (r1 < rMin || r0 > rMax) { i = subtreeEnd[i]; continue; }
    const a0 = leafStart[i] * da;
    const a1 = leafEnd[i] * da;
    if (!all && (wrap ? !(a1 >= lo || a0 <= hi) : !(a1 >= lo && a0 <= hi))) { i = subtreeEnd[i]; continue; }
    // exact enough: the sector's bounding box against the padded clip rectangle (corner points from the cached boundary
    // cos/sin, plus the axis crossings), after the cheap radius and angle tests above
    {
      const ls = leafStart[i], le = leafEnd[i];
      const c0 = BC[ls], s0 = BS[ls], c1 = BC[le], s1 = BS[le];
      let bx0 = Math.min(r0 * c0, r1 * c0, r0 * c1, r1 * c1), bx1 = Math.max(r0 * c0, r1 * c0, r0 * c1, r1 * c1);
      let by0 = Math.min(r0 * s0, r1 * s0, r0 * s1, r1 * s1), by1 = Math.max(r0 * s0, r1 * s0, r0 * s1, r1 * s1);
      for (let q = Math.ceil(a0 / HALF_PI); q * HALF_PI <= a1; q++) {
        switch (q & 3) {
          case 0: if (r1 > bx1) bx1 = r1; break;
          case 1: if (r1 > by1) by1 = r1; break;
          case 2: if (-r1 < bx0) bx0 = -r1; break;
          default: if (-r1 < by0) by0 = -r1;
        }
      }
      if (cx + bx1 < clipL - PAD || cx + bx0 > clipR + PAD || cy + by1 < clipT - PAD || cy + by0 > clipB + PAD) { i = subtreeEnd[i]; continue; }
    }
    const ri = X[i] * k;
    const ca = COS[i], sa = SIN[i];
    const sx = cx + ri * ca, sy = cy + ri * sa;
    const arc = (a1 - a0) * r1;
    let kind: number;
    let descend = false;
    if (childCount[i] === 0) kind = K_TIP;
    else if (stub !== null && stub[i] === 1) kind = P.summaries ? K_SUMMARY : K_STUB;
    else if (lod && i > 0 && (arc < minPx || (r1 - ri < minPx && arc < 4 * minPx))) kind = P.summaries ? K_SUMMARY : K_STUB;
    else { kind = K_NODE; descend = true; }
    let emit = true;
    if (lod) {
      const rp = i > 0 ? r0 : ri;
      let e = 0;
      if (kind === K_NODE) e = Math.min(8191, Math.round((ROW[LAST[i]] - ROW[firstChild[i]]) * da * ri));
      else if (kind === K_SUMMARY) e = Math.min(8191, Math.round(arc));
      emit = seen.add(cell(cxs + ri * ca), cell(cys + ri * sa), cell(cxs + rp * ca), cell(cys + rp * sa) + kind * 8192, e);
    }
    if (emit) {
      if (out.count >= budget) { overflow = true; break; }
      out.push(i, kind, classOf ? classOf[i] : 0);
      if (kind === K_SUMMARY) {
        summaries++;
        summaryTips += leafEnd[i] - leafStart[i];
        if (minPx > base && (stub === null || stub[i] === 0) && !(arc < base || (r1 - ri < base && arc < 4 * base))) forced++;
      } else if (kind === K_TIP) tips++;
    } else if (kind !== K_NODE) mergedTips += leafEnd[i] - leafStart[i];
    i = descend ? i + 1 : subtreeEnd[i];
  }
  res.visited = visited; res.summaries = summaries; res.tips = tips; res.overflow = overflow; res.forced = forced; res.summaryTips = summaryTips; res.mergedTips = mergedTips;
  return res;
}

export interface SearchOpts {
  lod: boolean;
  base: number; // collapse threshold without budget pressure (px)
  budget: number;
  summaries: boolean;
  hint: number; // threshold of the previous full frame, 0 for none
}

/** Run the cut, raising the collapse threshold until the draw list fits the budget, and no further than needed. Without
 *  budget pressure that is one pass. Under pressure: start at the previous full frame's threshold (relaxed by 1.3x), step
 *  by 1.3x down or up until a fit and an overflow bracket the answer, bisect the bracket (3 steps, geometric), and make
 *  sure the list left behind is the one for the smallest threshold that fits. Passes that overflow stop at the budget. */
export function searchCut(rect: boolean, tree: TreeSnapshot, L: Layout, T: Transform, classOf: Uint8Array | null, list: DrawList, seen: Seen, o: SearchOpts): { res: CutResult; minPx: number; retries: number } {
  const { base, budget, summaries } = o;
  let lastM = -1;
  const run = (minPx: number): CutResult => {
    lastM = minPx;
    const P: CutParams = { lod: o.lod, minPx, baseMinPx: base, budget, summaries };
    return rect ? cutRect(tree, L, T, P, classOf, list, seen) : cutRadial(tree, L, T, P, classOf, list, seen);
  };
  let m = o.hint > base ? Math.max(base, o.hint / 1.3) : base;
  let res = run(m);
  let passes = 1;
  if (o.lod && (res.overflow || m > base) && res.visited < 80000) {
    let hi = res.overflow ? -1 : m; // smallest threshold known to fit
    let lo = res.overflow ? m : -1; // largest threshold known to overflow
    while (passes < 40 && (hi < 0 || lo < 0) && !(hi >= 0 && hi <= base)) {
      m = hi >= 0 ? Math.max(base, hi / 1.3) : lo * 1.3;
      const r = run(m);
      passes++;
      if (r.overflow) lo = m;
      else { hi = m; res = r; }
    }
    for (let k = 0; k < 3 && lo > 0 && hi > 0 && hi / lo > 1.04; k++) {
      m = Math.sqrt(lo * hi);
      const r = run(m);
      passes++;
      if (r.overflow) lo = m;
      else { hi = m; res = r; }
    }
    if (hi > 0) { if (lastM !== hi) res = run(hi); m = hi; passes++; }
  } else if (res.overflow && o.lod) {
    // very expensive walks (caterpillar-like): no search, just double until it fits
    while (res.overflow && passes < 24) { m *= 2; res = run(m); passes++; }
  }
  return { res, minPx: m, retries: passes - 1 };
}
