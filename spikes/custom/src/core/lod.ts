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
//   rule D    if the list still exceeds the budget, minPx is doubled and the cut is redone (cheap: the aborted
//             pass stops as soon as the budget is exceeded)

import type { Layout } from './layout.ts';
import { sectorBBox, type Transform } from './geom.ts';
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
}
const res: CutResult = { visited: 0, summaries: 0, tips: 0, overflow: false };
const bb = new Float64Array(4);

export interface CutParams {
  lod: boolean;
  minPx: number;
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
  let visited = 0, summaries = 0, tips = 0;
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
      if (kind === K_SUMMARY) summaries++;
      else if (kind === K_TIP) tips++;
    }
    i = descend ? i + 1 : subtreeEnd[i];
  }
  res.visited = visited; res.summaries = summaries; res.tips = tips; res.overflow = overflow;
  return res;
}

export function cutRadial(tree: TreeData, L: Layout, T: Transform, P: CutParams, classOf: Uint8Array | null, out: DrawList, seen: Seen): CutResult {
  const n = L.n;
  const { X, ROW, XMAX, LAST } = L;
  const { parent, subtreeEnd, leafStart, leafEnd, childCount, firstChild } = tree;
  const { cx, cy, k, da, clipL, clipR, clipT, clipB } = T;
  const { lod, minPx, budget } = P;
  const PAD = 8;
  out.count = 0;
  seen.reset();
  let visited = 0, summaries = 0, tips = 0;
  let overflow = false;
  let i = 0;
  while (i < n) {
    visited++;
    const p = parent[i];
    const r1 = XMAX[i] * k;
    const r0 = i > 0 ? X[p] * k : 0;
    const a0 = leafStart[i] * da;
    const a1 = leafEnd[i] * da;
    sectorBBox(cx, cy, r0, r1, a0, a1, bb);
    if (bb[2] < clipL - PAD || bb[0] > clipR + PAD || bb[3] < clipT - PAD || bb[1] > clipB + PAD) { i = subtreeEnd[i]; continue; }
    const ri = X[i] * k;
    const ang = ROW[i] * da;
    const ca = Math.cos(ang), sa = Math.sin(ang);
    const sx = cx + ri * ca, sy = cy + ri * sa;
    let kind: number;
    let descend = false;
    if (childCount[i] === 0) kind = K_TIP;
    else if (lod && i > 0 && ((a1 - a0) * r1 < minPx || (r1 - ri < minPx && (a1 - a0) * r1 < 4 * minPx))) kind = P.summaries ? K_SUMMARY : K_STUB;
    else { kind = K_NODE; descend = true; }
    let emit = true;
    if (lod) {
      const rp = i > 0 ? r0 : ri;
      let e = 0;
      if (kind === K_NODE) e = Math.min(8191, Math.round((ROW[LAST[i]] - ROW[firstChild[i]]) * da * ri));
      else if (kind === K_SUMMARY) e = Math.min(8191, Math.round((a1 - a0) * r1));
      emit = seen.add(cell(sx), cell(sy), cell(cx + rp * ca), cell(cy + rp * sa) + kind * 8192, e);
    }
    if (emit) {
      if (out.count >= budget) { overflow = true; break; }
      out.push(i, kind, classOf ? classOf[i] : 0);
      if (kind === K_SUMMARY) summaries++;
      else if (kind === K_TIP) tips++;
    }
    i = descend ? i + 1 : subtreeEnd[i];
  }
  res.visited = visited; res.summaries = summaries; res.tips = tips; res.overflow = overflow;
  return res;
}
