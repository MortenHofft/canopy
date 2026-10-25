// Spatial lookup for click and hover. The index is a uniform grid over the CURRENT draw list (what is on screen),
// built lazily on the first pointer query after a frame, so a mouse move costs one grid cell read and a handful
// of candidate tests, never a scan of all nodes. Works for both layouts: geometry of a candidate is recomputed
// from the layout projection (positions, clade extents) when tested, only (node, type) is stored.

import { fanTheta } from './layout.ts';
import { K_NODE, K_SUMMARY, K_TIP, isSlice, lineTip, type DrawList } from './lod.ts';
import type { LayoutProjection, Pt } from './projection.ts';
import { TIP_DOT_PX } from './sizes.ts';
import type { Hit } from './types.ts';

export const MARKER_PX = 12; // internal node markers are drawn (and hittable) when the clade is at least this tall
const CELL = 24;
const T_TIPPT = 0,
  T_NODEPT = 1,
  T_SUMMARY = 2,
  T_STUB = 3,
  T_CONN = 4;
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
  private pt: Pt = { x: 0, y: 0 }; // scratch positions (node, and where its branch starts)
  private pp: Pt = { x: 0, y: 0 };

  invalidate(): void {
    this.valid = false;
  }

  private addItem(node: number, type: number, last = -1, xmax = 0): number {
    if (this.nI === this.iNode.length) {
      const a = new Int32Array(this.nI * 2);
      a.set(this.iNode);
      this.iNode = a;
      const b = new Uint8Array(this.nI * 2);
      b.set(this.iType);
      this.iType = b;
      const c = new Int32Array(this.nI * 2);
      c.set(this.iLast);
      this.iLast = c;
      const d = new Float32Array(this.nI * 2);
      d.set(this.iXmax);
      this.iXmax = d;
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
      const a = new Int32Array(this.nE * 2);
      a.set(this.eItem);
      this.eItem = a;
      const b = new Int32Array(this.nE * 2);
      b.set(this.eNext);
      this.eNext = b;
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
      if (c !== last) {
        this.addEntry(item, cx, cy);
        last = c;
      }
    }
  }

  /** `lines`: summaries folded by size are drawn as a branch to their deepest tip (Scene.summaryLines): the line is the summary's, its end
   *  the tip's, so the tip is hovered there as one drawn (#126). */
  build(list: DrawList, proj: LayoutProjection, lines = false): void {
    const t0 = performance.now();
    const { tree, L, T } = proj;
    this.gw = Math.ceil(T.W / CELL) + 1;
    this.gh = Math.ceil(T.H / CELL) + 1;
    if (this.head.length < this.gw * this.gh) this.head = new Int32Array(this.gw * this.gh);
    this.head.fill(-1, 0, this.gw * this.gh);
    this.nE = 0;
    this.nI = 0;
    const rect = proj.kind === 'rectangular';
    const { LAST } = L;
    const dotDepth = proj.minTipDepth(TIP_DOT_PX); // as drawMarkers: a tip has a dot when its depth reaches this
    const { pt, pp } = this;
    for (let e = 0; e < list.count; e++) {
      const i = list.node[e];
      const kind = list.kind[e];
      const lm = list.last[e];
      if (lm >= 0) {
        this.addRun(i, lm, list.xmax[e], proj);
        continue;
      }
      proj.nodeXY(i, pt);
      proj.parentXY(i, pp);
      const x = pt.x,
        y = pt.y;
      if (i > 0) this.addSegment(this.addItem(i, T_STUB), pp.x, pp.y, x, y);
      if (kind === K_TIP) {
        if (proj.depth(i) >= dotDepth) this.addPoint(this.addItem(i, T_TIPPT), x, y);
      } else if (kind === K_NODE) {
        if (proj.cladeSize(i) >= MARKER_PX) this.addPoint(this.addItem(i, T_NODEPT), x, y);
        const it = this.addItem(i, T_CONN);
        const a0 = proj.tip(tree.firstChild[i]),
          a1 = proj.tip(LAST[i]);
        if (rect) this.addSegment(it, x, a0, x, a1);
        else {
          // the connector is an arc: a polyline of chords about CELL apart
          const r = proj.depth(i);
          const nseg = Math.min(400, Math.max(1, Math.ceil(((a1 - a0) * r) / (CELL * 0.75))));
          let lx = T.cx + r * Math.cos(a0),
            ly = T.cy + r * Math.sin(a0);
          for (let s = 1; s <= nseg; s++) {
            const a = a0 + ((a1 - a0) * s) / nseg;
            const nx = T.cx + r * Math.cos(a),
              ny = T.cy + r * Math.sin(a);
            this.addSegment(it, lx, ly, nx, ny);
            lx = nx;
            ly = ny;
          }
        }
      } else if (kind === K_SUMMARY) {
        const it = this.addItem(i, T_SUMMARY);
        const t = lines ? lineTip(tree, L, i, -1) : -1;
        if (t >= 0) {
          proj.nodeXY(t, pp);
          this.addSegment(it, x, y, pp.x, pp.y);
          this.addPoint(this.addItem(t, T_TIPPT), pp.x, pp.y);
        } else {
          proj.summaryExtent(i, -1, 0);
          this.addExtent(it, proj, 24);
          if (!rect) this.addPoint(it, x, y);
        }
      }
    }
    this.valid = true;
    this.items = this.nI;
    this.entries = this.nE;
    this.builtMs = performance.now() - t0;
  }

  /** Grid entries for the extent set by proj.summaryExtent(): rectangular, every cell of the box; radial, points along its inner and
   *  outer arc (at most `steps` + 1 of each). */
  private addExtent(it: number, proj: LayoutProjection, steps: number): void {
    const { d0, d1, t0, t1 } = proj;
    if (proj.kind === 'rectangular') {
      for (let cy = Math.floor(t0 / CELL); cy <= Math.floor(t1 / CELL); cy++)
        for (let cx = Math.floor(d0 / CELL); cx <= Math.floor(d1 / CELL); cx++) this.addEntry(it, cx, cy);
    } else {
      const { cx, cy } = proj.T;
      const n = Math.max(2, Math.min(steps, Math.ceil(((t1 - t0) * d1) / CELL) + 1));
      for (let s = 0; s <= n; s++) {
        const a = t0 + ((t1 - t0) * s) / n;
        this.addPoint(it, cx + d1 * Math.cos(a), cy + d1 * Math.sin(a));
        this.addPoint(it, cx + d0 * Math.cos(a), cy + d0 * Math.sin(a));
      }
    }
  }

  /** A run of small siblings (rule R in lod.ts): one summary item over the slice, no branch or marker of its own. */
  private addRun(first: number, last: number, xmax: number, proj: LayoutProjection): void {
    const it = this.addItem(first, T_SUMMARY, last, xmax);
    proj.summaryExtent(first, last, xmax);
    this.addExtent(it, proj, 400);
  }

  /** Best hit under (mx, my) in container CSS px, or null. A run is reported as its parent node with kind 'summary' and `run`
   *  (first and last member): the tips it stands for are exactly [leafStart[first], leafEnd[last]), not the parent's. */
  query(mx: number, my: number, proj: LayoutProjection): Hit | null {
    if (!this.valid) return null;
    const { tree, L, T } = proj;
    const rect = proj.kind === 'rectangular';
    const { pt, pp } = this;
    const cx0 = Math.floor(mx / CELL),
      cy0 = Math.floor(my / CELL);
    let bestNode = -1,
      bestType = -1,
      bestScore = Infinity,
      bestItem = -1;
    for (let cy = cy0 - 1; cy <= cy0 + 1; cy++) {
      if (cy < 0 || cy >= this.gh) continue;
      for (let cx = cx0 - 1; cx <= cx0 + 1; cx++) {
        if (cx < 0 || cx >= this.gw) continue;
        for (let e = this.head[cy * this.gw + cx]; e >= 0; e = this.eNext[e]) {
          const item = this.eItem[e];
          const i = this.iNode[item];
          const type = this.iType[item];
          const lm = this.iLast[item]; // >= 0: a run (type is T_SUMMARY)
          proj.nodeXY(i, pt);
          const x = pt.x,
            y = pt.y;
          let d: number;
          if (type === T_TIPPT) {
            if (rect) {
              const dx = Math.abs(mx - x),
                dy = Math.abs(my - y);
              if (dx > 8 || dy > Math.max(6, proj.tipPitch * 0.5)) continue;
              d = Math.hypot(dx, dy);
            } else {
              d = Math.hypot(mx - x, my - y);
              if (d > 8) continue;
            }
          } else if (type === T_NODEPT) {
            d = Math.hypot(mx - x, my - y);
            if (d > MARKER_PX) continue;
          } else if (type === T_SUMMARY) {
            proj.summaryExtent(i, lm, this.iXmax[item]);
            if (rect) {
              const y0 = proj.t0,
                y1 = proj.t1;
              const xs = proj.d0;
              const xm = Math.max(xs + 2, proj.d1);
              if (mx < xs - 2 || mx > xm + 2) continue;
              const ym = Math.max(y1, y0 + 2);
              const yt = ym - Math.max(y1 - y0, 2);
              if (lm >= 0 || isSlice(tree, i, L.collapsed)) {
                if (my < yt - 2 || my > ym + 2) continue;
                d = 0;
              } else {
                // triangle apex (x, y), base at xm from yt to ym (with 2 px slack)
                const f = xm > x ? (mx - x) / (xm - x) : 1;
                const lo = y + (yt - y) * f - 2,
                  hi = y + (ym - y) * f + 2;
                if (my < lo || my > hi) continue;
                d = 0;
              }
            } else {
              const rr = Math.hypot(mx - T.cx, my - T.cy);
              const th = fanTheta(L.fan, Math.atan2(my - T.cy, mx - T.cx));
              const a0 = proj.t0,
                a1 = proj.t1;
              const r1 = proj.d1;
              const rs = proj.d0;
              const slack = 3 / Math.max(rr, 1);
              if (rr < rs - 3 || rr > r1 + 3 || th < a0 - slack || th > a1 + slack) continue;
              // inside the fan scores 0; inside the 3 px slack only, the distance outside (px), so the fan under the pointer
              // beats a neighbour whose slack reaches the same point
              d = (th < a0 ? a0 - th : th > a1 ? th - a1 : 0) * rr + (rr < rs ? rs - rr : rr > r1 ? rr - r1 : 0);
            }
          } else if (type === T_STUB) {
            proj.parentXY(i, pp);
            if (rect) {
              const dy = Math.abs(my - y);
              if (dy > 4 || mx < Math.min(pp.x, x) - 4 || mx > Math.max(pp.x, x) + 4) continue;
              d = dy;
            } else {
              d = distSeg(mx, my, pp.x, pp.y, x, y);
              if (d > 4) continue;
            }
          } else if (rect) {
            const y0 = proj.tip(tree.firstChild[i]),
              y1 = proj.tip(L.LAST[i]);
            const dx = Math.abs(mx - x);
            if (dx > 4 || my < y0 - 4 || my > y1 + 4) continue;
            d = dx;
          } else {
            const r = proj.depth(i);
            const rr = Math.hypot(mx - T.cx, my - T.cy);
            const th = fanTheta(L.fan, Math.atan2(my - T.cy, mx - T.cx));
            const a0 = proj.tip(tree.firstChild[i]),
              a1 = proj.tip(L.LAST[i]);
            const slack = 4 / Math.max(r, 1);
            d = Math.abs(rr - r);
            if (d > 4 || th < a0 - slack || th > a1 + slack) continue;
          }
          const score = d + PENALTY[type];
          if (score < bestScore) {
            bestScore = score;
            bestNode = i;
            bestType = type;
            bestItem = item;
          }
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
  const dx = x1 - x0,
    dy = y1 - y0;
  const l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / l2)) : 0;
  return Math.hypot(px - (x0 + t * dx), py - (y0 + t * dy));
}
