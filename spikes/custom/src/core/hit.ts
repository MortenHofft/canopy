// Spatial lookup for click and hover. The index is a uniform grid over the CURRENT draw list (what is on screen),
// built lazily on the first pointer query after a frame, so a mouse move costs one grid cell read and a handful
// of candidate tests, never a scan of all nodes. Works for both layouts: geometry of a candidate is recomputed
// from the layout arrays when tested, only (node, type) is stored.

import type { Layout } from './layout.ts';
import type { Transform } from './geom.ts';
import { DrawList, K_NODE, K_STUB, K_SUMMARY, K_TIP, isSlice } from './lod.ts';
import type { Hit, TreeSnapshot } from './types.ts';

export const MARKER_PX = 12; // internal node markers are drawn (and hittable) when the clade is at least this tall
const CELL = 24;
const T_TIPPT = 0, T_NODEPT = 1, T_SUMMARY = 2, T_STUB = 3, T_CONN = 4;
// score = distance + penalty: a close hit on a lower-priority target (branch) loses to a slightly farther marker
const PENALTY = [0, 0.5, 12, 14, 14];

export class HitIndex {
  private head = new Int32Array(0);
  private eItem = new Int32Array(1 << 14);
  private eNext = new Int32Array(1 << 14);
  private nE = 0;
  private iNode = new Int32Array(1 << 14);
  private iType = new Uint8Array(1 << 14);
  private iLast = new Int32Array(1 << 14); // run entries (see DrawList.last): the last member, else -1
  private iXmax = new Float32Array(1 << 14); // run entries: the deepest member's XMAX
  private nI = 0;
  private gw = 0;
  private gh = 0;
  valid = false;
  builtMs = 0;
  items = 0;
  entries = 0;

  constructor(private tree: TreeSnapshot, private L: Layout) {}

  setLayout(L: Layout): void {
    this.L = L;
    this.valid = false;
  }

  invalidate(): void {
    this.valid = false;
  }

  private addItem(node: number, type: number, last = -1, xmax = 0): number {
    if (this.nI === this.iNode.length) {
      const a = new Int32Array(this.nI * 2); a.set(this.iNode); this.iNode = a;
      const b = new Uint8Array(this.nI * 2); b.set(this.iType); this.iType = b;
      const c = new Int32Array(this.nI * 2); c.set(this.iLast); this.iLast = c;
      const d = new Float32Array(this.nI * 2); d.set(this.iXmax); this.iXmax = d;
    }
    this.iNode[this.nI] = node;
    this.iType[this.nI] = type;
    this.iLast[this.nI] = last;
    this.iXmax[this.nI] = xmax;
    return this.nI++;
  }

  private addEntry(item: number, cx: number, cy: number): void {
    if (cx < 0 || cy < 0 || cx >= this.gw || cy >= this.gh) return;
    if (this.nE === this.eItem.length) {
      if (this.nE > 3_000_000) return;
      const a = new Int32Array(this.nE * 2); a.set(this.eItem); this.eItem = a;
      const b = new Int32Array(this.nE * 2); b.set(this.eNext); this.eNext = b;
    }
    const c = cy * this.gw + cx;
    this.eItem[this.nE] = item;
    this.eNext[this.nE] = this.head[c];
    this.head[c] = this.nE++;
  }

  private addPoint(item: number, x: number, y: number): void {
    this.addEntry(item, Math.floor(x / CELL), Math.floor(y / CELL));
  }

  private addSegment(item: number, x0: number, y0: number, x1: number, y1: number): void {
    const len = Math.hypot(x1 - x0, y1 - y0);
    const steps = Math.max(1, Math.ceil(len / (CELL * 0.75)));
    let last = -1;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const cx = Math.floor((x0 + (x1 - x0) * t) / CELL);
      const cy = Math.floor((y0 + (y1 - y0) * t) / CELL);
      const c = cy * 100000 + cx;
      if (c !== last) { this.addEntry(item, cx, cy); last = c; }
    }
  }

  build(list: DrawList, T: Transform): void {
    const t0 = performance.now();
    const { tree, L } = this;
    this.gw = Math.ceil(T.W / CELL) + 1;
    this.gh = Math.ceil(T.H / CELL) + 1;
    if (this.head.length < this.gw * this.gh) this.head = new Int32Array(this.gw * this.gh);
    this.head.fill(-1, 0, this.gw * this.gh);
    this.nE = 0;
    this.nI = 0;
    const rect = T.kind === 'rectangular';
    const { X, ROW, LAST } = L;
    const tipPitch = rect ? T.ky : (2 * Math.PI * T.k) / Math.max(1, tree.tipCount);
    for (let e = 0; e < list.count; e++) {
      const i = list.node[e];
      const kind = list.kind[e];
      const lm = list.last[e];
      if (lm >= 0) { this.addRun(i, lm, list.xmax[e], T); continue; }
      let x: number, y: number, px: number, py: number;
      if (rect) {
        x = T.ox + X[i] * T.kx;
        y = T.oy + ROW[i] * T.ky;
        px = i > 0 ? T.ox + X[tree.parent[i]] * T.kx : x;
        py = y;
      } else {
        const ca = L.COS ? L.COS[i] : Math.cos(ROW[i] * T.da), sa = L.SIN ? L.SIN[i] : Math.sin(ROW[i] * T.da);
        x = T.cx + X[i] * T.k * ca;
        y = T.cy + X[i] * T.k * sa;
        const rp = i > 0 ? X[tree.parent[i]] * T.k : X[i] * T.k;
        px = T.cx + rp * ca;
        py = T.cy + rp * sa;
      }
      if (i > 0) this.addSegment(this.addItem(i, T_STUB), px, py, x, y);
      if (kind === K_TIP) { if (tipPitch >= 6) this.addPoint(this.addItem(i, T_TIPPT), x, y); }
      else if (kind === K_NODE) {
        const hpx = rect ? (tree.leafEnd[i] - tree.leafStart[i]) * T.ky : (tree.leafEnd[i] - tree.leafStart[i]) * T.da * L.XMAX[i] * T.k;
        if (hpx >= MARKER_PX) this.addPoint(this.addItem(i, T_NODEPT), x, y);
        const it = this.addItem(i, T_CONN);
        if (rect) this.addSegment(it, x, T.oy + ROW[tree.firstChild[i]] * T.ky, x, T.oy + ROW[LAST[i]] * T.ky);
        else {
          const r = X[i] * T.k;
          const a0 = ROW[tree.firstChild[i]] * T.da, a1 = ROW[LAST[i]] * T.da;
          const nseg = Math.min(400, Math.max(1, Math.ceil(((a1 - a0) * r) / (CELL * 0.75))));
          let lx = T.cx + r * Math.cos(a0), ly = T.cy + r * Math.sin(a0);
          for (let s = 1; s <= nseg; s++) {
            const a = a0 + ((a1 - a0) * s) / nseg;
            const nx = T.cx + r * Math.cos(a), ny = T.cy + r * Math.sin(a);
            this.addSegment(it, lx, ly, nx, ny);
            lx = nx; ly = ny;
          }
        }
      } else if (kind === K_SUMMARY) {
        const it = this.addItem(i, T_SUMMARY);
        if (rect) {
          const y0 = T.oy + tree.leafStart[i] * T.ky, y1 = T.oy + tree.leafEnd[i] * T.ky;
          const xm = T.ox + L.XMAX[i] * T.kx;
          for (let cy = Math.floor(y0 / CELL); cy <= Math.floor(y1 / CELL); cy++) for (let cx = Math.floor(x / CELL); cx <= Math.floor(xm / CELL); cx++) this.addEntry(it, cx, cy);
        } else {
          // sector bounding box
          const r1 = L.XMAX[i] * T.k, r0 = X[i] * T.k;
          const a0 = tree.leafStart[i] * T.da, a1 = tree.leafEnd[i] * T.da;
          const n = Math.max(2, Math.min(24, Math.ceil(((a1 - a0) * r1) / CELL) + 1));
          for (let s = 0; s <= n; s++) {
            const a = a0 + ((a1 - a0) * s) / n;
            this.addPoint(it, T.cx + r1 * Math.cos(a), T.cy + r1 * Math.sin(a));
            this.addPoint(it, T.cx + r0 * Math.cos(a), T.cy + r0 * Math.sin(a));
          }
          this.addPoint(it, x, y);
        }
      }
    }
    this.valid = true;
    this.items = this.nI;
    this.entries = this.nE;
    this.builtMs = performance.now() - t0;
  }

  /** A run of small siblings (rule R in lod.ts): one summary item over the slice, no branch or marker of its own. */
  private addRun(first: number, last: number, xmax: number, T: Transform): void {
    const { tree, L } = this;
    const it = this.addItem(first, T_SUMMARY, last, xmax);
    const p = tree.parent[first];
    if (T.kind === 'rectangular') {
      const y0 = T.oy + tree.leafStart[first] * T.ky, y1 = T.oy + tree.leafEnd[last] * T.ky;
      const x0 = T.ox + L.X[p] * T.kx, x1 = T.ox + xmax * T.kx;
      for (let cy = Math.floor(y0 / CELL); cy <= Math.floor(y1 / CELL); cy++) for (let cx = Math.floor(x0 / CELL); cx <= Math.floor(x1 / CELL); cx++) this.addEntry(it, cx, cy);
    } else {
      const r1 = xmax * T.k, r0 = L.X[p] * T.k;
      const a0 = tree.leafStart[first] * T.da, a1 = tree.leafEnd[last] * T.da;
      const n = Math.max(2, Math.min(400, Math.ceil(((a1 - a0) * r1) / CELL) + 1));
      for (let s = 0; s <= n; s++) {
        const a = a0 + ((a1 - a0) * s) / n;
        this.addPoint(it, T.cx + r1 * Math.cos(a), T.cy + r1 * Math.sin(a));
        this.addPoint(it, T.cx + r0 * Math.cos(a), T.cy + r0 * Math.sin(a));
      }
    }
  }

  /** Best hit under (mx, my) in container CSS px, or null. A run is reported as its parent node with kind 'summary' and `run`
   *  (first and last member): the tips it stands for are exactly [leafStart[first], leafEnd[last]), not the parent's. */
  query(mx: number, my: number, T: Transform): Hit | null {
    if (!this.valid) return null;
    const { tree, L } = this;
    const rect = T.kind === 'rectangular';
    const cx0 = Math.floor(mx / CELL), cy0 = Math.floor(my / CELL);
    let bestNode = -1, bestType = -1, bestScore = Infinity, bestItem = -1;
    for (let cy = cy0 - 1; cy <= cy0 + 1; cy++) {
      if (cy < 0 || cy >= this.gh) continue;
      for (let cx = cx0 - 1; cx <= cx0 + 1; cx++) {
        if (cx < 0 || cx >= this.gw) continue;
        for (let e = this.head[cy * this.gw + cx]; e >= 0; e = this.eNext[e]) {
          const item = this.eItem[e];
          const i = this.iNode[item];
          const type = this.iType[item];
          const lm = this.iLast[item]; // >= 0: a run (type is T_SUMMARY)
          let d: number;
          if (rect) {
            const x = T.ox + L.X[i] * T.kx;
            const y = T.oy + L.ROW[i] * T.ky;
            if (type === T_TIPPT) {
              const dx = Math.abs(mx - x), dy = Math.abs(my - y);
              if (dx > 8 || dy > Math.max(6, T.ky * 0.5)) continue;
              d = Math.hypot(dx, dy);
            } else if (type === T_NODEPT) {
              d = Math.hypot(mx - x, my - y);
              if (d > MARKER_PX) continue;
            } else if (type === T_SUMMARY) {
              const y0 = T.oy + tree.leafStart[i] * T.ky, y1 = T.oy + tree.leafEnd[lm >= 0 ? lm : i] * T.ky;
              const xs = lm >= 0 ? T.ox + L.X[tree.parent[i]] * T.kx : x;
              const xm = Math.max(xs + 2, T.ox + (lm >= 0 ? this.iXmax[item] : L.XMAX[i]) * T.kx);
              if (mx < xs - 2 || mx > xm + 2) continue;
              const ym = Math.max(y1, y0 + 2);
              const yt = ym - Math.max(y1 - y0, 2);
              if (lm >= 0 || isSlice(tree, i)) { if (my < yt - 2 || my > ym + 2) continue; d = 0; } else {
              // triangle apex (x, y), base at xm from yt to ym (with 2 px slack)
              const f = xm > x ? (mx - x) / (xm - x) : 1;
              const lo = y + (yt - y) * f - 2, hi = y + (ym - y) * f + 2;
              if (my < lo || my > hi) continue;
              d = 0; }
            } else if (type === T_STUB) {
              const px = T.ox + L.X[tree.parent[i]] * T.kx;
              const dy = Math.abs(my - y);
              if (dy > 4 || mx < Math.min(px, x) - 4 || mx > Math.max(px, x) + 4) continue;
              d = dy;
            } else {
              const y0 = T.oy + L.ROW[tree.firstChild[i]] * T.ky, y1 = T.oy + L.ROW[L.LAST[i]] * T.ky;
              const dx = Math.abs(mx - x);
              if (dx > 4 || my < y0 - 4 || my > y1 + 4) continue;
              d = dx;
            }
          } else {
            const a = L.ROW[i] * T.da;
            const ca = Math.cos(a), sa = Math.sin(a);
            const r = L.X[i] * T.k;
            const x = T.cx + r * ca, y = T.cy + r * sa;
            if (type === T_TIPPT) {
              d = Math.hypot(mx - x, my - y);
              if (d > 8) continue;
            } else if (type === T_NODEPT) {
              d = Math.hypot(mx - x, my - y);
              if (d > MARKER_PX) continue;
            } else if (type === T_SUMMARY) {
              const rr = Math.hypot(mx - T.cx, my - T.cy);
              let th = Math.atan2(my - T.cy, mx - T.cx);
              if (th < 0) th += 2 * Math.PI;
              const a0 = tree.leafStart[i] * T.da, a1 = tree.leafEnd[lm >= 0 ? lm : i] * T.da;
              const r1 = (lm >= 0 ? this.iXmax[item] : L.XMAX[i]) * T.k;
              const rs = lm >= 0 ? L.X[tree.parent[i]] * T.k : r;
              const slack = 3 / Math.max(rr, 1);
              if (rr < rs - 3 || rr > r1 + 3 || th < a0 - slack || th > a1 + slack) continue;
              // inside the fan scores 0; inside the 3 px slack only, the distance outside (px), so the fan under the pointer
              // beats a neighbour whose slack reaches the same point
              d = (th < a0 ? a0 - th : th > a1 ? th - a1 : 0) * rr + (rr < rs ? rs - rr : rr > r1 ? rr - r1 : 0);
            } else if (type === T_STUB) {
              const rp = L.X[tree.parent[i]] * T.k;
              const x0 = T.cx + rp * ca, y0 = T.cy + rp * sa;
              d = distSeg(mx, my, x0, y0, x, y);
              if (d > 4) continue;
            } else {
              const rr = Math.hypot(mx - T.cx, my - T.cy);
              let th = Math.atan2(my - T.cy, mx - T.cx);
              if (th < 0) th += 2 * Math.PI;
              const a0 = L.ROW[tree.firstChild[i]] * T.da, a1 = L.ROW[L.LAST[i]] * T.da;
              const slack = 4 / Math.max(r, 1);
              d = Math.abs(rr - r);
              if (d > 4 || th < a0 - slack || th > a1 + slack) continue;
            }
          }
          const score = d + PENALTY[type];
          if (score < bestScore) { bestScore = score; bestNode = i; bestType = type; bestItem = item; }
        }
      }
    }
    if (bestNode < 0) return null;
    const kind = bestType === T_TIPPT ? 'tip' : bestType === T_NODEPT ? 'node' : bestType === T_SUMMARY ? 'summary' : 'branch';
    const last = bestType === T_SUMMARY ? this.iLast[bestItem] : -1;
    if (last >= 0) return { node: tree.parent[bestNode], kind, run: { first: bestNode, last } };
    return { node: bestNode, kind };
  }
}

function distSeg(px: number, py: number, x0: number, y0: number, x1: number, y1: number): number {
  const dx = x1 - x0, dy = y1 - y0;
  const l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / l2)) : 0;
  return Math.hypot(px - (x0 + t * dx), py - (y0 + t * dy));
}

export { K_STUB };
