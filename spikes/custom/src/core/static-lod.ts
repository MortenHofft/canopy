// Static level of detail (spike, radial layout only): the drawn state of a clade is a pure function of
// (static per-node data, a quantised zoom, a detail level that depends only on the zoom or on a fixed tile of the plane),
// never of the viewport contents, the pan, or the previous frame. See docs/results/static-lod-spike.md.
//
// 1. Critical zoom. The radial collapse rule of lod.ts (arc < minPx, or r1 - ri < minPx while arc < 4 minPx, or a polytomy of tips
//    whose children are closer than minPx) is linear in the zoom k, so every node has a fixed number crit[i] with
//    "expanded  <=>  crit[i] <= k / minPx". One O(n) pass fills a Float32Array; parents never expand later than children.
// 2. Detail level. A level d stands for q(d) = step^d / base, where step is the zoom ladder ratio and base the smallest clade
//    drawn (px). At the quantised zoom kq = step^zi the clade threshold in pixels is kq / q(d) = base * step^(zi - d), so d = zi is
//    "no budget pressure" and a smaller d is a coarser cut. The cut at level d is {nodes whose parent has crit <= q(d)}.
//      global  d depends on zi only: the finest level whose densest viewport-sized window holds at most the budget. The cut at a
//              fixed d is the same set at every zoom and a window only shrinks when zooming in, so d(zi) can only rise; the chain
//              d(zi) = max(d(zi - 1), finest feasible) is monotone by construction. "Fits" is decided by (i) the entries of the
//              cut binned by anchor into cells of at most window / 8, the largest block of cells that can hold a window (a bound,
//              with a coarse pre-filter), (ii) real walks (the cull's own idea of an entry) at the densest blocks and at the
//              deepest entries of the cut, which catch entries anchored outside a window that reach into it (ancestors on a deep
//              spine), and (iii) for small windows a shortcut: all nodes of the tree in the densest window plus the tree depth fit.
//              (i) is a bound for anchored entries only; (ii) is a verification, not a proof, for the crossing ones.
//      tiles   the plane is cut into 256 px tiles at the ladder scale, anchored at the root; a node belongs to the tile of its
//              anchor point (x, y) = X * (cos, sin) * kq; each tile gets the finest level whose cut has at most budget / tiles-a-view-
//              can-meet entries anchored in it, from the tile's own content only. A node is expanded when its parent is and
//              crit[i] <= q(level of its own tile). Tiles of one zoom step nest in those of the previous one only on a power-of-two
//              ladder, which is when zooming in is strictly monotone; the budget is not guaranteed (see the write-up).
// An entry that is a tip or an expanded node is emitted only when what it draws itself (its branch, its connector arc) reaches the
// window; the walk descends through it either way. Without this a deep spine fills the list with entries whose only link to the
// window is a sector that contains it.
// 3. Runs. Siblings of a node with SLICE_MIN_CHILDREN or more children that are tips or collapsed and smaller than the threshold
//    form maximal runs (left to right, from the first child, independent of the view); a run of at least SLICE_MIN_CHILDREN is ONE
//    entry (DrawList.last, as rule R in lod.ts), a shorter one is drawn member by member. No pixel-cell dedupe is used.
// The walk emits the same DrawList entries as lod.ts, so draw.ts and hit.ts are untouched.

import type { Layout } from './layout.ts';
import { ensureTrig } from './layout.ts';
import type { Transform } from './geom.ts';
import type { TreeSnapshot } from './types.ts';
import { DrawList, K_NODE, K_STUB, K_SUMMARY, K_TIP, SLICE_MIN_CHILDREN, isSlice, radialWindow, radialWindowState, type CutResult } from './lod.ts';

export type CutMethod = 'current' | 'static-global' | 'static-tiles';

const TWO_PI = 2 * Math.PI;
const HALF_PI = Math.PI / 2;
const PAD = 8;
const CELL_DIV = 8; // anchors are binned in cells of at most window / 8
const PROBES = 6; // densest blocks verified with a real walk
export const TILE_PX = 256;
const TILE_OFF = 1 << 22;
const TILE_SPAN = 1 << 23;

export interface StaticOpts {
  method: 'static-global' | 'static-tiles';
  ladder: number; // zoom ladder ratio (2, 1.4142, 1.1892, 1.15 ...)
  base: number; // smallest clade drawn (px)
  budget: number;
  summaries: boolean;
}

export interface StaticResult extends CutResult {
  minPx: number; // coarsest clade threshold in force this frame (px at the real zoom)
  minPxFine: number; // finest one (equals minPx for the global level)
  zoomIndex: number;
  level: number; // global: d; tiles: the coarsest level used by the frame
  levelMax: number;
  tilesUsed: number; // distinct tiles whose level was read this frame
  tilesComputed: number; // tile levels computed (not cached) during this frame
  ancMs: number;
}

interface WalkRes { visited: number; summaries: number; tips: number; overflow: boolean; aborted: boolean; forced: number; summaryTips: number; }
interface WalkOpts {
  summaries: boolean;
  budget: number;
  classOf: Uint8Array | null;
  out: DrawList | null; // entries go here ...
  sink: ((i: number, kind: number, last: number, xmax: number) => boolean) | null; // ... or to this counter (returns true to abort the walk)
  qBase: number; // q of the finest level (kq / base): summaries a finer level would have expanded count as forced
  kq: number;
  filter: boolean; // only entries whose anchor lies in [fx0, fx1) x [fy0, fy1) (px at kq) count
  fx0: number; fx1: number; fy0: number; fy1: number;
}

/** Open-addressing counter of integer cell coordinates (typed arrays, grows by doubling). */
class CellCounter {
  cap: number;
  kx: Int32Array;
  ky: Int32Array;
  v: Int32Array;
  used: Uint8Array;
  n = 0;
  maxV = 0;
  constructor(cap = 1 << 16) {
    this.cap = cap;
    this.kx = new Int32Array(cap); this.ky = new Int32Array(cap); this.v = new Int32Array(cap); this.used = new Uint8Array(cap);
  }
  clear(): void {
    this.used.fill(0);
    this.n = 0;
    this.maxV = 0;
  }
  private slot(x: number, y: number): number {
    const mask = this.cap - 1;
    let h = (Math.imul(x, 0x9e3779b1) ^ Math.imul(y, 0x85ebca6b)) >>> 7;
    for (;;) {
      h &= mask;
      if (this.used[h] === 0 || (this.kx[h] === x && this.ky[h] === y)) return h;
      h++;
    }
  }
  inc(x: number, y: number): void {
    this.add(x, y, 1);
  }
  add(x: number, y: number, by: number): void {
    if (this.n * 2 > this.cap) this.grow();
    const h = this.slot(x, y);
    if (this.used[h] === 0) { this.used[h] = 1; this.kx[h] = x; this.ky[h] = y; this.v[h] = 0; this.n++; }
    const c = (this.v[h] += by);
    if (c > this.maxV) this.maxV = c;
  }
  get(x: number, y: number): number {
    const h = this.slot(x, y);
    return this.used[h] === 0 ? 0 : this.v[h];
  }
  private grow(): void {
    const ox = this.kx, oy = this.ky, ov = this.v, ou = this.used, oc = this.cap;
    this.cap = oc * 2;
    this.kx = new Int32Array(this.cap); this.ky = new Int32Array(this.cap); this.v = new Int32Array(this.cap); this.used = new Uint8Array(this.cap);
    for (let s = 0; s < oc; s++) {
      if (ou[s] === 0) continue;
      const h = this.slot(ox[s], oy[s]);
      this.used[h] = 1; this.kx[h] = ox[s]; this.ky[h] = oy[s]; this.v[h] = ov[s];
    }
  }
}

export class StaticLod {
  readonly crit: Float32Array; // critical k / minPx per node (Infinity: tips and stubs, never expanded)
  fixups = 0; // nodes whose own critical zoom was below their parent's (raised to it)
  buildMs = 0;
  private enumD = -1e9;
  private enumKey = '';
  private ex0 = new Float32Array(1 << 16);
  private ey0 = new Float32Array(1 << 16);
  private ne = 0;
  private cdepth = new Int32Array(0);
  private deepest: Array<[number, number]> = [];
  private hot: Array<[number, number]> = [];
  private grid = new CellCounter();
  private coarse = new CellCounter();
  private pl = new DrawList();
  probes = 0;
  checkMonotone = false; // diagnostic: at every zoom step also test that the previous step's level still fits
  monotoneTests = 0;
  monotoneBreaks = 0;
  private maxDepth = -1;
  private allGrids = new Map<number, CellCounter>();
  private chains = new Map<string, Map<number, number>>();
  private tiles = new Map<string, TileLevels>();
  enumMs = 0;
  enumCount = 0; // enumerations of a full-tree cut done so far (global level)
  densestTests = 0;
  lastDensest = 0;

  constructor(readonly tree: TreeSnapshot, readonly L: Layout) {
    const t0 = performance.now();
    const n = L.n;
    const crit = new Float32Array(n);
    const { X, XMAX } = L;
    const { parent, childCount, leafStart, leafEnd } = tree;
    const stub = tree.stub ?? null;
    const da = TWO_PI / Math.max(1, L.tips);
    let fix = 0;
    crit[0] = 0;
    for (let i = 1; i < n; i++) {
      if (childCount[i] === 0 || (stub !== null && stub[i] === 1)) { crit[i] = Infinity; continue; }
      const cnt = leafEnd[i] - leafStart[i];
      const A = cnt * da * XMAX[i]; // arc length per unit of k at the clade's outer radius
      const D = XMAX[i] - X[i]; // radial extent per unit of k
      const inv = A > 0 ? 1 / A : Infinity;
      let c = inv;
      let alt = D > 0 ? 1 / D : Infinity; // r1 - ri >= minPx or arc >= 4 minPx
      if (A > 0 && 4 * inv < alt) alt = 4 * inv;
      if (alt > c) c = alt;
      if (isSlice(tree, i)) { const s = childCount[i] * inv; if (s > c) c = s; } // children of a polytomy of tips at least minPx apart
      const pc = crit[parent[i]];
      if (c < pc) { fix++; c = pc; }
      crit[i] = c;
    }
    this.crit = crit;
    this.fixups = fix;
    this.buildMs = performance.now() - t0;
  }

  /** Bytes held by the static tables (crit, plus the caches when built). */
  get bytes(): number {
    return this.crit.byteLength + this.ex0.byteLength * 2 + this.cdepth.byteLength;
  }

  // ------------------------------------------------------------------------------------------------ the cut

  cut(T: Transform, o: StaticOpts, classOf: Uint8Array | null, out: DrawList): StaticResult {
    const s = o.ladder;
    const zi = Math.floor(Math.log(T.k) / Math.log(s) + 1e-9);
    const kq = Math.pow(s, zi);
    const qBase = kq / o.base;
    const wo: WalkOpts = { summaries: o.summaries, budget: o.budget, classOf, out, sink: null, qBase, kq, filter: false, fx0: 0, fx1: 0, fy0: 0, fy1: 0 };
    const res = newRes();
    let lvl = zi, lvlMax = zi, used = 0, computed = 0, ancMs = 0;
    if (o.method === 'static-global') {
      const t0 = performance.now();
      const d = this.levelGlobal(zi, T, o);
      ancMs = performance.now() - t0;
      lvl = lvlMax = d;
      this.walk(T, wo, null, Math.pow(s, d) / o.base, res);
    } else {
      const lv = this.tileLevels(zi, T, o);
      lv.beginFrame();
      this.walk(T, wo, lv, 0, res);
      if (lv.dMinUsed > 1e8) { lv.dMinUsed = zi; lv.dMaxUsed = zi; }
      lvl = lv.dMinUsed; lvlMax = lv.dMaxUsed; used = lv.usedTiles; computed = lv.computedThisFrame; ancMs = lv.computeMs;
    }
    const q = (d: number): number => T.k / (Math.pow(s, d) / o.base);
    return { visited: res.visited, summaries: res.summaries, tips: res.tips, overflow: res.overflow, forced: res.forced, summaryTips: res.summaryTips, mergedTips: 0, minPx: q(lvl), minPxFine: q(lvlMax), zoomIndex: zi, level: lvl, levelMax: lvlMax, tilesUsed: used, tilesComputed: computed, ancMs };
  }

  /** The walk. Same traversal as cutRadial (one forward scan, subtrees skipped by subtreeEnd) with the decision "expanded" replaced
   *  by crit[i] <= q, q constant (global level) or read from the node's tile (levels). */
  walk(T: Transform, w: WalkOpts, levels: TileLevels | null, qc: number, res: WalkRes): WalkRes {
    const { tree, L, crit } = this;
    ensureTrig(L);
    const n = L.n;
    const { X, XMAX } = L;
    const COS = L.COS!, SIN = L.SIN!, BC = L.BC!, BS = L.BS!;
    const { parent, subtreeEnd, leafStart, leafEnd, childCount, firstChild } = tree;
    const stub = tree.stub ?? null;
    const { cx, cy, k, da, clipL, clipR, clipT, clipB } = T;
    const kq = w.kq, qBase = w.qBase, classOf = w.classOf, out = w.out, sink = w.sink, budget = w.budget;
    const filter = w.filter, fx0 = w.fx0, fx1 = w.fx1, fy0 = w.fy0, fy1 = w.fy1;
    const summaries = w.summaries;
    radialWindow(cx, cy, clipL - PAD, clipT - PAD, clipR + PAD, clipB + PAD);
    const W = radialWindowState;
    const rMin = W.rMin, rMax = W.rMax, all = W.all, lo = W.lo, hi = W.hi, wrap = W.wrap;
    if (out !== null) out.count = 0;
    const c = { sum: 0, tips: 0, forced: 0, sumTips: 0, over: false, stop: false };

    const vis = (r0: number, r1: number, ls: number, le: number): boolean => {
      if (r1 < rMin || r0 > rMax) return false;
      const a0 = ls * da, a1 = le * da;
      if (!all && (wrap ? !(a1 >= lo || a0 <= hi) : !(a1 >= lo && a0 <= hi))) return false;
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
      return !(cx + bx1 < clipL - PAD || cx + bx0 > clipR + PAD || cy + by1 < clipT - PAD || cy + by0 > clipB + PAD);
    };
    // exact visibility of what a tip or an expanded node draws itself (branch segment, connector arc) against the padded window
    const wL = clipL - PAD, wR = clipR + PAD, wT = clipT - PAD, wB = clipB + PAD;
    const segHits = (x0: number, y0: number, x1: number, y1: number): boolean => {
      let t0 = 0, t1 = 1;
      const dx = x1 - x0, dy = y1 - y0;
      for (let e = 0; e < 4; e++) {
        const p = e === 0 ? -dx : e === 1 ? dx : e === 2 ? -dy : dy;
        const q = e === 0 ? x0 - wL : e === 1 ? wR - x0 : e === 2 ? y0 - wT : wB - y0;
        if (p === 0) { if (q < 0) return false; continue; }
        const r = q / p;
        if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; } else { if (r < t0) return false; if (r < t1) t1 = r; }
      }
      return true;
    };
    const inWin = (x: number, y: number): boolean => x >= wL && x <= wR && y >= wT && y <= wB;
    const angIn = (dy: number, dx: number, a0: number, a1: number): boolean => { let a = Math.atan2(dy, dx); if (a < 0) a += TWO_PI; return a >= a0 && a <= a1; };
    const arcHits = (r: number, a0: number, a1: number): boolean => {
      if (r < rMin || r > rMax) return false;
      if (inWin(cx + r * Math.cos(a0), cy + r * Math.sin(a0)) || inWin(cx + r * Math.cos(a1), cy + r * Math.sin(a1))) return true;
      for (let e = 0; e < 2; e++) {
        const dx = (e === 0 ? wL : wR) - cx;
        if (Math.abs(dx) <= r) { const dy = Math.sqrt(r * r - dx * dx); if (((cy + dy >= wT && cy + dy <= wB) && angIn(dy, dx, a0, a1)) || ((cy - dy >= wT && cy - dy <= wB) && angIn(-dy, dx, a0, a1))) return true; }
        const dy2 = (e === 0 ? wT : wB) - cy;
        if (Math.abs(dy2) <= r) { const dx2 = Math.sqrt(r * r - dy2 * dy2); if (((cx + dx2 >= wL && cx + dx2 <= wR) && angIn(dy2, dx2, a0, a1)) || ((cx - dx2 >= wL && cx - dx2 <= wR) && angIn(dy2, -dx2, a0, a1))) return true; }
      }
      return false;
    };
    const qOf = (i: number): number => (levels === null ? qc : levels.qAt(X[i] * COS[i] * kq, X[i] * SIN[i] * kq));
    const small = (j: number, q: number): boolean => !(crit[j] <= q) && (stub === null || stub[j] === 0) && (leafEnd[j] - leafStart[j]) * da * XMAX[j] * q < 1;
    // false = stop the walk (budget overflow or the sink aborted)
    const put = (i: number, kind: number, last: number, xmax: number): boolean => {
      if (filter) {
        const ax = X[i] * COS[i] * kq, ay = X[i] * SIN[i] * kq;
        if (!(ax >= fx0 && ax < fx1 && ay >= fy0 && ay < fy1)) return true;
      }
      if (sink !== null) { if (sink(i, kind, last, xmax)) { c.stop = true; return false; } } else if (out !== null) {
        if (out.count >= budget) { c.over = true; return false; }
        out.push(i, kind, classOf ? classOf[i] : 0, last, xmax);
      }
      if (kind === K_SUMMARY) {
        c.sum++;
        c.sumTips += last >= 0 ? leafEnd[last] - leafStart[i] : leafEnd[i] - leafStart[i];
        if (last < 0 && (stub === null || stub[i] === 0) && crit[i] <= qBase) c.forced++;
      } else if (kind === K_TIP) c.tips++;
      return true;
    };

    let visited = 0, i = 0, indivUntil = 0;
    while (i < n) {
      visited++;
      const p = i > 0 ? parent[i] : 0;
      // runs of small siblings under a wide parent: found from the first child on, so the partition does not depend on the view
      if (summaries && i > 0 && i >= indivUntil && childCount[p] >= SLICE_MIN_CHILDREN && (childCount[i] === 0 || (stub === null || stub[i] === 0))) {
        const q0 = qOf(i);
        if (small(i, q0)) {
          const end = subtreeEnd[p];
          const cl = classOf ? classOf[i] : 0;
          let cnt = 0, last = i, xm = 0, j = i;
          while (j < end) {
            if (j !== i && !small(j, qOf(j))) break;
            if (classOf && classOf[j] !== cl) break;
            cnt++; last = j; if (XMAX[j] > xm) xm = XMAX[j];
            j = subtreeEnd[j];
          }
          visited += cnt;
          if (cnt >= SLICE_MIN_CHILDREN) {
            if (vis(X[p] * k, xm * k, leafStart[i], leafEnd[last]) && !put(i, K_SUMMARY, last, xm)) break;
            i = j;
            continue;
          }
          indivUntil = j;
        }
      }
      const r1 = XMAX[i] * k;
      const r0 = i > 0 ? X[p] * k : 0;
      if (!vis(r0, r1, leafStart[i], leafEnd[i])) { i = subtreeEnd[i]; continue; }
      let kind: number;
      let descend = false;
      if (childCount[i] === 0) kind = K_TIP;
      else if (stub !== null && stub[i] === 1) kind = summaries ? K_SUMMARY : K_STUB;
      else if (i > 0 && !(crit[i] <= qOf(i))) kind = summaries ? K_SUMMARY : K_STUB;
      else { kind = K_NODE; descend = true; }
      if (kind === K_NODE || kind === K_TIP) {
        // a tip or an expanded node is emitted only when what it draws itself (branch, connector arc) reaches the window; the
        // descendants of an expanded node are visited either way
        const ca = COS[i], sa = SIN[i], ri = X[i] * k;
        let hit = i > 0 && segHits(cx + r0 * ca, cy + r0 * sa, cx + ri * ca, cy + ri * sa);
        if (!hit && kind === K_NODE) hit = arcHits(ri, L.ROW[firstChild[i]] * da, L.ROW[L.LAST[i]] * da);
        if (!hit && kind === K_TIP) hit = inWin(cx + ri * ca, cy + ri * sa);
        if (!hit) { i = descend ? i + 1 : subtreeEnd[i]; continue; }
      }
      if (!put(i, kind, -1, 0)) break;
      i = descend ? i + 1 : subtreeEnd[i];
    }
    res.visited = visited; res.summaries = c.sum; res.tips = c.tips; res.overflow = c.over; res.aborted = c.stop; res.forced = c.forced; res.summaryTips = c.sumTips;
    return res;
  }

  // ------------------------------------------------------------------------------------------------ global level

  /** Entries of the cut at level d over the whole tree as anchor points in world units (root at the origin, outer circle radius 1),
   *  plus the anchors of the deepest entries (most expanded ancestors: where a spine piles up entries whose anchors lie elsewhere). */
  private enumerate(d: number, o: StaticOpts): void {
    const key = `${o.ladder}|${o.base}|${o.summaries}`;
    if (this.enumD === d && this.enumKey === key) return;
    const t0 = performance.now();
    const { L, tree } = this;
    ensureTrig(L);
    const X = L.X, COS = L.COS!, SIN = L.SIN!;
    const parent = tree.parent;
    if (this.cdepth.length < L.n) this.cdepth = new Int32Array(L.n);
    const cdepth = this.cdepth;
    let ne = 0;
    const deep: Array<[number, number, number]> = []; // depth, x, y of the deepest entries (a few, spread over the plane)
    const self = this;
    const sink = (i: number, kind: number): boolean => {
      if (ne === self.ex0.length) {
        const a = new Float32Array(ne * 2); a.set(self.ex0); self.ex0 = a;
        const b = new Float32Array(ne * 2); b.set(self.ey0); self.ey0 = b;
      }
      const x = X[i] * COS[i], y = X[i] * SIN[i];
      self.ex0[ne] = x; self.ey0[ne] = y;
      ne++;
      const dp = i > 0 ? cdepth[parent[i]] + 1 : 1;
      if (kind === K_NODE) cdepth[i] = dp;
      if (deep.length < 4 || dp > deep[deep.length - 1][0]) {
        deep.push([dp, x, y]);
        deep.sort((p, q) => q[0] - p[0]);
        if (deep.length > 4) deep.pop();
      }
      return false;
    };
    const T = { cx: 0, cy: 0, k: 1, da: TWO_PI / Math.max(1, L.tips), clipL: -1e9, clipR: 1e9, clipT: -1e9, clipB: 1e9 } as unknown as Transform;
    const wo: WalkOpts = { summaries: o.summaries, budget: Infinity, classOf: null, out: null, sink, qBase: 0, kq: 1, filter: false, fx0: 0, fx1: 0, fy0: 0, fy1: 0 };
    this.walk(T, wo, null, Math.pow(o.ladder, d) / o.base, newRes());
    this.ne = ne;
    this.deepest = deep.map((e) => [e[1], e[2]] as [number, number]);
    this.enumD = d;
    this.enumKey = key;
    this.enumCount++;
    this.enumMs += performance.now() - t0;
  }

  /** Bound of the entries anchored in any winX x winY window at level d (binned, conservative). Cells are a power of two of at
   *  most window / CELL_DIV, so a window touches at most (mx + 1) x (my + 1) cells; a block anchored at an occupied cell covers
   *  every window (shifting it until its first cell is occupied loses nothing), so the largest block sum bounds the densest window.
   *  A pre-filter on coarse cells skips blocks far from the budget, so the value is exact only above half of it. The
   *  centres of the densest blocks are left in `this.hot` for the verification walks. */
  densest(d: number, winX: number, winY: number, budget: number, o: StaticOpts): number {
    this.enumerate(d, o);
    this.densestTests++;
    const long = Math.max(winX, winY);
    const c = Math.pow(2, Math.floor(Math.log2(long / CELL_DIV)));
    const inv = 1 / c;
    const g = this.grid;
    g.clear();
    const { ex0, ey0, ne } = this;
    for (let e = 0; e < ne; e++) g.inc(Math.floor(ex0[e] * inv), Math.floor(ey0[e] * inv));
    this.hot.length = 0;
    const room = budget;
    if (g.maxV > room && room !== Infinity) return (this.lastDensest = g.maxV);
    const mx = Math.ceil(winX * inv), my = Math.ceil(winY * inv);
    // coarse pre-filter: a block lies inside 2 x 2 coarse cells (edge 2^k fine cells, at least the block side)
    const cs = Math.pow(2, Math.ceil(Math.log2(Math.max(mx, my) + 1)));
    const cg = this.coarse;
    cg.clear();
    for (let s = 0; s < g.cap; s++) if (g.used[s] !== 0) cg.add(Math.floor(g.kx[s] / cs), Math.floor(g.ky[s] / cs), g.v[s]);
    let best = 0;
    const top: Array<[number, number, number]> = []; // the densest blocks: sum, x, y (lower-left cell)
    const floor = room * 0.5; // blocks whose coarse bound is below this are not examined: they are far from the budget
    for (let s = 0; s < g.cap; s++) {
      if (g.used[s] === 0) continue;
      const x0 = g.kx[s], y0 = g.ky[s];
      const X = Math.floor(x0 / cs), Y = Math.floor(y0 / cs);
      if (cg.get(X, Y) + cg.get(X + 1, Y) + cg.get(X, Y + 1) + cg.get(X + 1, Y + 1) <= floor) continue;
      let sum = 0;
      for (let b = 0; b <= my; b++) for (let a = 0; a <= mx; a++) sum += a === 0 && b === 0 ? g.v[s] : g.get(x0 + a, y0 + b);
      if (sum > best) best = sum;
      if (sum > room) break;
      if (top.length < PROBES || sum > top[top.length - 1][0]) {
        top.push([sum, x0, y0]);
        top.sort((p, q) => q[0] - p[0]);
        if (top.length > PROBES) top.pop();
      }
    }
    for (const t of top) this.hot.push([(t[1] + (mx + 1) / 2) * c, (t[2] + (my + 1) / 2) * c]);
    return (this.lastDensest = best);
  }

  /** Verification: the real walk (the cull's own idea of an entry, so ancestors and fans whose anchors lie outside the window are
   *  included) at windows centred on `centres`; the largest list is returned (stops one above the budget). */
  private probe(d: number, kq: number, T: Transform, centres: Array<[number, number]>, o: StaticOpts): number {
    const { L } = this;
    const W = T.clipR - T.clipL, H = T.clipB - T.clipT;
    const da = TWO_PI / Math.max(1, L.tips);
    const q = Math.pow(o.ladder, d) / o.base;
    let worst = 0;
    this.probes += centres.length;
    for (const [px, py] of centres) {
      const P = { cx: W / 2 - px * kq, cy: H / 2 - py * kq, k: kq, da, clipL: 0, clipR: W, clipT: 0, clipB: H } as unknown as Transform;
      const wo: WalkOpts = { summaries: o.summaries, budget: o.budget + 1, classOf: null, out: this.pl, sink: null, qBase: 0, kq, filter: false, fx0: 0, fx1: 0, fy0: 0, fy1: 0 };
      this.walk(P, wo, null, q, newRes());
      if (this.pl.count > worst) worst = this.pl.count;
      if (worst > o.budget) break;
    }
    return worst;
  }

  /** Is level d feasible at zoom index z: the anchor bound of the densest window fits and so do the verification walks at the
   *  densest blocks and at the deepest entries of the cut. */
  private feasible(d: number, z: number, winX: number, winY: number, T: Transform, o: StaticOpts): boolean {
    const kq = Math.pow(o.ladder, z);
    // the cull pads the window by PAD px on every side
    const px = (T.clipR - T.clipL + 2 * PAD) / kq, py = (T.clipB - T.clipT + 2 * PAD) / kq;
    void winX; void winY;
    // small windows: if every node of the tree that lies in the densest window, plus the deepest chain of ancestors, fits, so does
    // any cut; this skips the enumeration of the cut (millions of entries at deep zoom on a large tree)
    if (px * py < 0.04 && this.allNodesFit(px, py, o.budget)) return true;
    if (this.densest(d, px, py, o.budget, o) > o.budget) return false;
    const centres = this.hot.length ? this.hot.slice(0, PROBES) : [];
    for (const dp of this.deepest) centres.push(dp);
    return this.probe(d, kq, T, centres, o) <= o.budget;
  }

  /** Every node of the tree, binned by anchor at the cell size of a window: the densest block bound of ALL nodes (an upper bound for
   *  any cut) plus the tree's depth (crossing ancestors) fits the budget. Grids are built on demand (O(n) each) and the last two kept. */
  private allNodesFit(winX: number, winY: number, budget: number): boolean {
    const { L, tree } = this;
    if (this.maxDepth < 0) {
      const dep = new Int32Array(L.n);
      let md = 0;
      for (let i = 1; i < L.n; i++) { const v = dep[tree.parent[i]] + 1; dep[i] = v; if (v > md) md = v; }
      this.maxDepth = md;
    }
    if (this.maxDepth >= budget) return false;
    const long = Math.max(winX, winY);
    const e = Math.floor(Math.log2(long / CELL_DIV));
    const c = Math.pow(2, e), inv = 1 / c;
    let g = this.allGrids.get(e);
    if (!g) {
      g = new CellCounter(1 << 16);
      const X = L.X, COS = L.COS!, SIN = L.SIN!;
      for (let i = 0; i < L.n; i++) g.inc(Math.floor(X[i] * COS[i] * inv), Math.floor(X[i] * SIN[i] * inv));
      if (this.allGrids.size >= 2) this.allGrids.delete(this.allGrids.keys().next().value as number);
      this.allGrids.set(e, g);
    }
    const room = budget - this.maxDepth;
    if (g.maxV > room) return false;
    const mx = Math.ceil(winX * inv), my = Math.ceil(winY * inv);
    const cs = Math.pow(2, Math.ceil(Math.log2(Math.max(mx, my) + 1)));
    const cg = this.coarse;
    cg.clear();
    for (let s = 0; s < g.cap; s++) if (g.used[s] !== 0) cg.add(Math.floor(g.kx[s] / cs), Math.floor(g.ky[s] / cs), g.v[s]);
    for (let s = 0; s < g.cap; s++) {
      if (g.used[s] === 0) continue;
      const x0 = g.kx[s], y0 = g.ky[s];
      const X = Math.floor(x0 / cs), Y = Math.floor(y0 / cs);
      if (cg.get(X, Y) + cg.get(X + 1, Y) + cg.get(X, Y + 1) + cg.get(X + 1, Y + 1) <= room) continue;
      let sum = 0;
      for (let b = 0; b <= my; b++) for (let a = 0; a <= mx; a++) sum += a === 0 && b === 0 ? g.v[s] : g.get(x0 + a, y0 + b);
      if (sum > room) return false;
    }
    return true;
  }

  private levelGlobal(zi: number, T: Transform, o: StaticOpts): number {
    const key = `${o.ladder}|${o.base}|${o.budget}|${o.summaries}|${Math.round(T.clipR - T.clipL)}x${Math.round(T.clipB - T.clipT)}`;
    let memo = this.chains.get(key);
    if (!memo) { if (this.chains.size > 8) this.chains.clear(); memo = new Map(); this.chains.set(key, memo); }
    // the chain starts at a zoom far below any practical view (k = 4 px per unit) and walks up to zi
    const z0 = Math.floor(Math.log(4) / Math.log(o.ladder));
    if (zi < z0) zi = z0;
    const hit = memo.get(zi);
    if (hit !== undefined) return hit;
    let z = z0;
    let d = z0 - 1;
    // resume from the highest memoised zoom below zi
    for (let zz = zi - 1; zz >= z0; zz--) { const m = memo.get(zz); if (m !== undefined) { z = zz + 1; d = m; break; } }
    for (; z <= zi; z++) {
      const kq = Math.pow(o.ladder, z);
      const winX = (T.clipR - T.clipL) / kq, winY = (T.clipB - T.clipT) / kq;
      if (z === z0) {
        // base of the chain: the finest level that fits at this (tiny) zoom, searching downwards
        d = z0;
        for (let guard = 0; guard < 64 && !this.feasible(d, z, winX, winY, T, o); guard++) d--;
      } else {
        // numerical check of the monotonicity argument: the level of the previous zoom must still fit the (smaller) window
        if (this.checkMonotone) { this.monotoneTests++; if (!this.feasible(d, z, winX, winY, T, o)) this.monotoneBreaks++; }
        while (d < z && this.feasible(d + 1, z, winX, winY, T, o)) d++;
      }
      memo.set(z, d);
    }
    return memo.get(zi)!;
  }

  // ------------------------------------------------------------------------------------------------ tiles

  private tileLevels(zi: number, T: Transform, o: StaticOpts): TileLevels {
    const W = T.clipR - T.clipL, H = T.clipB - T.clipT;
    const key = `${o.ladder}|${o.base}|${o.budget}|${o.summaries}|${zi}|${Math.round(W)}x${Math.round(H)}`;
    let lv = this.tiles.get(key);
    if (!lv) {
      if (this.tiles.size > 24) this.tiles.clear();
      // a view meets at most (ceil(W / 256) + 1) x (ceil(H / 256) + 1) tiles, and never more tiles than the root's disk (radius kq) covers
      const disk = Math.floor((2 * Math.pow(o.ladder, zi)) / TILE_PX) + 2;
      const perTile = Math.max(1, Math.floor(o.budget / (Math.min(disk, Math.ceil(W / TILE_PX) + 1) * Math.min(disk, Math.ceil(H / TILE_PX) + 1))));
      lv = new TileLevels(this, zi, o, perTile);
      this.tiles.set(key, lv);
    }
    return lv;
  }
}

function newRes(): WalkRes {
  return { visited: 0, summaries: 0, tips: 0, overflow: false, aborted: false, forced: 0, summaryTips: 0 };
}

/** Detail levels of the tiles at one zoom index. A tile's level is computed on demand from the tile's own content (the cut at
 *  each level, entries anchored in the tile) and cached; it never depends on the view. */
export class TileLevels {
  private map = new Map<number, number>();
  private lastKey = -1;
  private lastQ = 0;
  private lastD = 0;
  private readonly kq: number;
  private readonly da: number;
  private readonly dMin: number;
  dMinUsed = 0;
  dMaxUsed = 0;
  usedTiles = 0;
  computedThisFrame = 0;
  computeMs = 0;
  private seen = new Set<number>();
  computedTotal = 0;

  constructor(private S: StaticLod, readonly zi: number, private o: StaticOpts, readonly perTile: number) {
    this.kq = Math.pow(o.ladder, zi);
    this.da = TWO_PI / Math.max(1, S.L.tips);
    this.dMin = zi - Math.ceil(Math.log(2000) / Math.log(o.ladder));
  }

  beginFrame(): void {
    this.dMinUsed = 1e9; this.dMaxUsed = -1e9; this.usedTiles = 0; this.computedThisFrame = 0; this.computeMs = 0;
    this.seen.clear();
    this.lastKey = -1;
  }

  q(d: number): number {
    return Math.pow(this.o.ladder, d) / this.o.base;
  }

  /** Level of the tile containing the anchor point (ax, ay), px at the ladder zoom. */
  qAt(ax: number, ay: number): number {
    const tx = Math.floor(ax / TILE_PX), ty = Math.floor(ay / TILE_PX);
    const key = (tx + TILE_OFF) * TILE_SPAN + (ty + TILE_OFF);
    if (key === this.lastKey) return this.lastQ;
    let d = this.map.get(key);
    if (d === undefined) {
      const t0 = performance.now();
      d = this.compute(tx, ty);
      this.computeMs += performance.now() - t0;
      this.computedThisFrame++; this.computedTotal++;
      if (this.map.size > 400000) this.map.clear();
      this.map.set(key, d);
    }
    if (!this.seen.has(key)) { this.seen.add(key); this.usedTiles++; }
    if (d < this.dMinUsed) this.dMinUsed = d;
    if (d > this.dMaxUsed) this.dMaxUsed = d;
    this.lastKey = key;
    this.lastD = d;
    this.lastQ = this.q(d);
    return this.lastQ;
  }

  /** Entries of the cut at level d anchored in tile (tx, ty), counting stops one above the limit. */
  count(tx: number, ty: number, d: number): number {
    const kq = this.kq, S = this.S;
    const x0 = tx * TILE_PX, y0 = ty * TILE_PX;
    const T = { cx: 0, cy: 0, k: kq, da: this.da, clipL: x0, clipR: x0 + TILE_PX, clipT: y0, clipB: y0 + TILE_PX } as unknown as Transform;
    let cnt = 0;
    const limit = this.perTile;
    const wo: WalkOpts = { summaries: this.o.summaries, budget: Infinity, classOf: null, out: null, sink: () => ++cnt > limit, qBase: 0, kq, filter: true, fx0: x0, fx1: x0 + TILE_PX, fy0: y0, fy1: y0 + TILE_PX };
    S.walk(T, wo, null, this.q(d), newRes());
    return cnt;
  }

  /** The finest level in [dMin, zi] whose tile content fits (counts rise with the level, so a bisection); the coarsest if none does. */
  private compute(tx: number, ty: number): number {
    const limit = this.perTile;
    let hi = this.zi;
    if (this.count(tx, ty, hi) <= limit) return hi;
    let lo = this.dMin;
    if (this.count(tx, ty, lo) > limit) return lo;
    while (hi - lo > 1) {
      const mid = (hi + lo) >> 1;
      if (this.count(tx, ty, mid) <= limit) lo = mid; else hi = mid;
    }
    return lo;
  }
}

// ------------------------------------------------------------------------------------------------ cache per layout

const cache = new WeakMap<Layout, StaticLod>();
/** The static tables of a layout (built on first use, about 4 bytes per node; rebuilt when the snapshot changes). */
export function staticFor(tree: TreeSnapshot, L: Layout): StaticLod {
  let s = cache.get(L);
  if (!s || s.tree !== tree) { s = new StaticLod(tree, L); cache.set(L, s); }
  return s;
}
