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
// No trigonometry per visited node, and a sector that merely has its bounding box over the viewport is culled too.

import type { Layout } from './layout.ts';
import type { Transform } from './geom.ts';
import { ensureTrig } from './layout.ts';
import type { TreeData } from './types.ts';

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

export function cutRect(tree: TreeData, L: Layout, T: Transform, P: CutParams, classOf: Uint8Array | null, out: DrawList, seen: Seen): CutResult {
  const n = L.n;
  const { X, ROW, XMAX, LAST } = L;
  const { parent, subtreeEnd, leafStart, leafEnd, childCount, firstChild } = tree;
  const { ox, oy, kx, ky, clipL, clipR, clipT, clipB } = T;
  const { lod, minPx, budget } = P;
  const PAD = 8;
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
    else if (sx > clipR + PAD) kind = K_STUB;
    else if (lod && i > 0 && (yBot - yTop < minPx || (ox + XMAX[i] * kx - sx < minPx && yBot - yTop < 4 * minPx))) kind = P.summaries ? K_SUMMARY : K_STUB;
    else { kind = K_NODE; descend = true; }
    let emit = true;
    if (lod) {
      let d: number, e: number;
      if (kind === K_NODE) { d = cell(oy + ROW[firstChild[i]] * ky); e = cell(oy + ROW[LAST[i]] * ky); }
      else if (kind === K_SUMMARY) { d = cell(yTop) + 8192 * 0; e = cell(yBot); }
      else { d = cell(sy); e = d; }
      emit = seen.add(cell(sxp), cell(sx), cell(sy), d + kind * 8192, e);
    }
    if (emit) {
      if (out.count >= budget) { overflow = true; break; }
      out.push(i, kind, classOf ? classOf[i] : 0);
      if (kind === K_SUMMARY) {
        summaries++;
        summaryTips += leafEnd[i] - leafStart[i];
        if (minPx > base && !(yBot - yTop < base || (ox + XMAX[i] * kx - sx < base && yBot - yTop < 4 * base))) forced++;
      } else if (kind === K_TIP) tips++;
    } else if (kind !== K_NODE) mergedTips += leafEnd[i] - leafStart[i];
    i = descend ? i + 1 : subtreeEnd[i];
  }
  res.visited = visited; res.summaries = summaries; res.tips = tips; res.overflow = overflow; res.forced = forced; res.summaryTips = summaryTips; res.mergedTips = mergedTips;
  return res;
}

const TWO_PI = 2 * Math.PI;
// the viewport as seen from the root (radial culling), recomputed per cut: scratch values, no allocation
let wRmin = 0, wRmax = 0, wAll = true, wLo = 0, wHi = 0, wWrap = false;
const cornerA = [0, 0, 0, 0];

function radialWindow(cx: number, cy: number, L: number, T: number, R: number, B: number): void {
  const dxMin = cx < L ? L - cx : cx > R ? cx - R : 0;
  const dyMin = cy < T ? T - cy : cy > B ? cy - B : 0;
  wRmin = Math.hypot(dxMin, dyMin);
  wRmax = Math.hypot(Math.max(Math.abs(cx - L), Math.abs(cx - R)), Math.max(Math.abs(cy - T), Math.abs(cy - B)));
  wAll = dxMin === 0 && dyMin === 0; // the root is inside the window: every angle is visible
  if (wAll) { wLo = 0; wHi = TWO_PI; wWrap = false; return; }
  // the rectangle subtends less than pi seen from an outside point: its angular interval is the complement of the
  // largest gap between the four corner angles
  const c = cornerA;
  c[0] = Math.atan2(T - cy, L - cx); c[1] = Math.atan2(T - cy, R - cx); c[2] = Math.atan2(B - cy, L - cx); c[3] = Math.atan2(B - cy, R - cx);
  for (let k = 0; k < 4; k++) if (c[k] < 0) c[k] += TWO_PI;
  c.sort((p, q) => p - q);
  let gap = c[0] + TWO_PI - c[3], at = 3;
  for (let k = 0; k < 3; k++) if (c[k + 1] - c[k] > gap) { gap = c[k + 1] - c[k]; at = k; }
  if (at === 3) { wLo = c[0]; wHi = c[3]; wWrap = false; }
  else { wLo = c[at + 1]; wHi = c[at]; wWrap = true; }
  const eps = 1e-9;
  wLo -= eps; wHi += eps;
}

export function cutRadial(tree: TreeData, L: Layout, T: Transform, P: CutParams, classOf: Uint8Array | null, out: DrawList, seen: Seen): CutResult {
  ensureTrig(L);
  const n = L.n;
  const { X, ROW, XMAX, LAST } = L;
  const COS = L.COS!, SIN = L.SIN!;
  const { parent, subtreeEnd, leafStart, leafEnd, childCount, firstChild } = tree;
  const { cx, cy, k, da, clipL, clipR, clipT, clipB } = T;
  const { lod, minPx, budget } = P;
  const base = P.baseMinPx ?? minPx;
  const PAD = 8;
  radialWindow(cx, cy, clipL - PAD, clipT - PAD, clipR + PAD, clipB + PAD);
  const rMin = wRmin, rMax = wRmax, all = wAll, lo = wLo, hi = wHi, wrap = wWrap;
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
    const ri = X[i] * k;
    const ca = COS[i], sa = SIN[i];
    const sx = cx + ri * ca, sy = cy + ri * sa;
    const arc = (a1 - a0) * r1;
    let kind: number;
    let descend = false;
    if (childCount[i] === 0) kind = K_TIP;
    else if (lod && i > 0 && (arc < minPx || (r1 - ri < minPx && arc < 4 * minPx))) kind = P.summaries ? K_SUMMARY : K_STUB;
    else { kind = K_NODE; descend = true; }
    let emit = true;
    if (lod) {
      const rp = i > 0 ? r0 : ri;
      let e = 0;
      if (kind === K_NODE) e = Math.min(8191, Math.round((ROW[LAST[i]] - ROW[firstChild[i]]) * da * ri));
      else if (kind === K_SUMMARY) e = Math.min(8191, Math.round(arc));
      emit = seen.add(cell(sx), cell(sy), cell(cx + rp * ca), cell(cy + rp * sa) + kind * 8192, e);
    }
    if (emit) {
      if (out.count >= budget) { overflow = true; break; }
      out.push(i, kind, classOf ? classOf[i] : 0);
      if (kind === K_SUMMARY) {
        summaries++;
        summaryTips += leafEnd[i] - leafStart[i];
        if (minPx > base && !(arc < base || (r1 - ri < base && arc < 4 * base))) forced++;
      } else if (kind === K_TIP) tips++;
    } else if (kind !== K_NODE) mergedTips += leafEnd[i] - leafStart[i];
    i = descend ? i + 1 : subtreeEnd[i];
  }
  res.visited = visited; res.summaries = summaries; res.tips = tips; res.overflow = overflow; res.forced = forced; res.summaryTips = summaryTips; res.mergedTips = mergedTips;
  return res;
}
