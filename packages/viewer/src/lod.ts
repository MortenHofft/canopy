// Viewport cut: which nodes are drawn this frame, and how.
//
// The traversal is a single forward scan over the preorder arrays (no stack, no child lists): a node that is
// culled (outside the viewport) or collapsed (a clade whose rows are less than `minPx` tall, or one the app collapsed) is skipped
// together with its whole subtree by jumping to subtreeEnd[i]. Cost is O(nodes visited), which is bounded by
// the viewport for bushy trees, and the number of PRIMITIVES emitted is bounded by the draw budget:
//   rule A    collapse a clade whose pixel height (radial: arc length at the tips) is < minPx. Only the row direction counts: a clade
//             of near-identical tips (tiny branch lengths) is narrow at any zoom, and its tips get their rows once they fit (#87)
//   rule C    sub-pixel primitives that land on the same pixel cells as an earlier one are not emitted again
//             (this is what keeps a 200k caterpillar from emitting 400k segments)
//   rule R    a run of at least SLICE_MIN_CHILDREN adjacent siblings that would each be a tip or a collapsed clade smaller
//             than minPx is ONE entry (a slice, see DrawList.last), so a polytomy of thousands of small children costs one
//             primitive per run, while its large children stay their own entries (issue 13). Siblings outside the window still count
//             towards their run (they are not drawn, and a run with no member in view is not drawn), so which tips form a run depends on
//             the tree and the zoom, not on where the window is: a pan does not fold tips in view back into a slice (#77)
//   user      a clade the app collapsed (Layout.collapsed, one Uint8Array lookup per visited node) is always a summary and never opened;
//             its tips share one row (Layout.rowStart / rowEnd are in rows, the tip ranks stay in tree.leafStart / leafEnd)
//   rule D    if the list still exceeds the budget, minPx is raised and the cut is redone (cheap: the aborted
//             pass stops as soon as the budget is exceeded); the search is searchCut below
//
// There is one loop per layout (cutRect, cutRadial) with the per-node work inline (see `cut` for why); they share the draw list, the dedupe
// set, the result and the per-frame values of the layout projection (projection.ts: dedupe anchors, radial window, the run's dedupe key).
//
// Radial culling (2026-10, in cutRadial): a node is skipped when its annular sector (radius X[parent]..XMAX, angle rowStart..rowEnd, on
// the layout's fan from fan.start: cutRect has no angles, so the fan has no counterpart there) cannot touch the padded clip rectangle: a radius-range test (distance from the root to the nearest and the farthest
// point of the rectangle) and an angle-range test (the angular interval the rectangle subtends as seen from the root).
// Survivors then get the sector's exact bounding box test (cached boundary cos/sin, no trigonometry per node): the cheap tests
// alone keep more off-screen primitives in the list than a bounding box does when the window is wide and off-centre.

import { CULL_PAD_PX } from './constants.ts';
import type { TreeSnapshot } from './types.ts';
import type { LayoutProjection, RadialProjection, RectProjection } from './projection.ts';

// Primitive kinds of a draw-list entry and the polytomy-slice predicate. Defined in this module (not imported) because the cut loops read
// them per node: through an import binding the loops measured several percent slower.
export const K_NODE = 0; // expanded internal node: branch + connector, children follow
export const K_TIP = 1;
export const K_SUMMARY = 2; // collapsed clade drawn as a triangle
export const K_STUB = 3; // collapsed or cut clade drawn as its branch only

/** Dedupe-key kind of a run slice (after K_NODE..K_STUB); never stored in a draw list. */
export const K_RUN = 4;

/** A collapsed clade whose children are all tips (a polytomy of at least this many) is drawn as a slice: the band from the
 *  node's depth to the longest tip over the clade's angles (radial) or rows (rectangular), not as a fan or triangle. */
export const SLICE_MIN_CHILDREN = 16;

export function isSlice(tree: TreeSnapshot, i: number, collapsed: Uint8Array | null = null): boolean {
  const c = tree.childCount[i];
  return (
    c >= SLICE_MIN_CHILDREN &&
    tree.leafEnd[i] - tree.leafStart[i] === c &&
    (tree.stub === undefined || tree.stub === null || tree.stub[i] === 0) &&
    (collapsed === null || collapsed[i] === 0) // a clade the app collapsed is a triangle, whatever its children are
  );
}

/** A run (rule R) is a K_SUMMARY entry with last >= 0: `node` is its first member, `last` its last member (siblings, adjacent in
 *  preorder, so its tips are exactly [leafStart[node], leafEnd[last]) (in rows [rowStart[node], rowEnd[last]); its parent is parent[node]) and `xmax` the largest
 *  XMAX of the members. The slice spans from the parent's depth to xmax. Every other entry has last = -1. */
export class DrawList {
  node = new Int32Array(8192);
  kind = new Uint8Array(8192);
  cls = new Uint8Array(8192);
  last = new Int32Array(8192);
  xmax = new Float32Array(8192);
  count = 0;
  push(i: number, kind: number, cls: number, last = -1, xmax = 0): void {
    if (this.count === this.node.length) this.grow();
    const c = this.count++;
    this.node[c] = i;
    this.kind[c] = kind;
    this.cls[c] = cls;
    this.last[c] = last;
    this.xmax[c] = xmax;
  }
  private grow(): void {
    const n = this.node.length * 2;
    const d = new Int32Array(n);
    d.set(this.last);
    this.last = d;
    const e = new Float32Array(n);
    e.set(this.xmax);
    this.xmax = e;
    const a = new Int32Array(n);
    a.set(this.node);
    this.node = a;
    const b = new Uint8Array(n);
    b.set(this.kind);
    this.kind = b;
    const c = new Uint8Array(n);
    c.set(this.cls);
    this.cls = c;
  }
}

/** Hash set of pixel-cell keys with O(1) reset (generation stamps). */
/** What `cell` returns for a coordinate outside the cells; negative whatever kind * 8192 is added to it. */
export const OUT_OF_CELLS = -(1 << 20);

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
    if (a < 0 || b < 0 || c < 0 || d < 0 || e < 0) return true; // a coordinate beyond the cells (OUT_OF_CELLS): the position is not known, nothing to merge on
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

export interface CutResult {
  visited: number;
  summaries: number;
  tips: number;
  overflow: boolean;
  forced: number; // summaries whose clade the base threshold would have expanded (collapsed only because of the budget)
  summaryTips: number; // tips inside the summaries
  mergedTips: number; // tips of primitives skipped because they share pixel cells with an earlier one
}
export function newCutResult(): CutResult {
  return { visited: 0, summaries: 0, tips: 0, overflow: false, forced: 0, summaryTips: 0, mergedTips: 0 };
}

export interface CutParams {
  lod: boolean;
  minPx: number;
  baseMinPx?: number; // the threshold without any budget pressure (default minPx)
  budget: number;
  summaries: boolean;
}

function finishCut(
  res: CutResult,
  visited: number,
  summaries: number,
  tips: number,
  overflow: boolean,
  forced: number,
  summaryTips: number,
  mergedTips: number,
): CutResult {
  res.visited = visited;
  res.summaries = summaries;
  res.tips = tips;
  res.overflow = overflow;
  res.forced = forced;
  res.summaryTips = summaryTips;
  res.mergedTips = mergedTips;
  return res;
}

/** The cut of one frame: dispatches on the projection's layout. The two loops below are deliberately separate copies: the per-node
 *  work (cull, collapse test, dedupe key) and rule R's run accumulator are written inline in each, as locals. Asking the projection
 *  per node cost 20-30% on a caterpillar (200k: rect 20 -> 26 ms, radial 25 -> 30 ms; 1M: rect 100 -> 123 ms, radial 121 -> 158 ms,
 *  medians of fresh processes) because V8's cumulative inlining budget (--max-inlined-bytecode-size-cumulative=920, which a page
 *  cannot change) leaves the projection's `dedupe` and the radial `cull` as real calls and the loop's ~30 live locals spill around
 *  every call; a shared run-accumulator object cost another 4-5% on the same trees. What the two loops share is what does not run
 *  per node: the run's dedupe key (proj.dedupeRun), the dedupe anchors and radial window the projection computes once per frame,
 *  and the result. Fills `out` and `res` (both caller-owned; nothing is shared between calls).
 *
 *  Cost against the loops of e2897fb that this replaced (searchCut on 200k and 1M caterpillars, one layout per fresh Node 22 process,
 *  interleaved batches, medians, the machine's run-to-run noise is about 5-10%): +3% to +17% at fit views (worst: 1M radial, +6% to +17%
 *  over four batches), equal or faster zoomed. Not recovered by a literal PAD, an inline epilogue, computing the dedupe anchors locally or
 *  reading them and the radial window from a Float64Array: all within noise of each other. */
export function cut(proj: LayoutProjection, P: CutParams, classOf: Uint8Array | null, out: DrawList, seen: Seen, res: CutResult): CutResult {
  return proj.kind === 'rectangular' ? cutRect(proj, P, classOf, out, seen, res) : cutRadial(proj, P, classOf, out, seen, res);
}

function cutRect(proj: RectProjection, P: CutParams, classOf: Uint8Array | null, out: DrawList, seen: Seen, res: CutResult): CutResult {
  const { tree, L, T } = proj;
  const n = L.n;
  const { X, ROW, XMAX, LAST, rowStart, rowEnd } = L;
  const collapsed = L.collapsed;
  const { parent, subtreeEnd, leafStart, leafEnd, childCount, firstChild } = tree;
  const stub = tree.stub ?? null; // a plain TreeData (no stub field) is accepted too
  const { ox, oy, kx, ky, clipL, clipR, clipT, clipB } = T;
  const { lod, minPx, budget } = P;
  const PAD = CULL_PAD_PX;
  // dedupe cells are anchored at the whole-pixel part of the origin (see RectProjection): panning by a fraction of a pixel
  // does not change the cut
  const { oxs, oys } = proj;
  out.count = 0;
  seen.reset();
  let visited = 0,
    summaries = 0,
    tips = 0,
    forced = 0,
    summaryTips = 0,
    mergedTips = 0;
  const base = P.baseMinPx ?? minPx;
  let overflow = false;
  // RULE R ACCUMULATOR: this copy and the one in cutRadial are deliberately duplicated, not a shared helper object: a helper cost 4-5% on
  // caterpillars (V8's inlining budget, see `cut`). Change both together.
  // pending run of small siblings (rule R; only under a parent with at least SLICE_MIN_CHILDREN children, which keeps
  // binary trees off this path). Its first members are emitted as usual and taken back when the run reaches
  // SLICE_MIN_CHILDREN, so the common case (no run) costs nothing; snap* are the counters before the run's first member
  const canRun = lod && P.summaries;
  let runCount = 0,
    runFirst = 0,
    runLast = 0,
    runEnd = -1,
    runParent = -1,
    runCls = 0,
    runXmax = 0,
    runPx = 0,
    runVis = false, // a member of the run is in view: a run wholly outside the window is not drawn
    force = false;
  let snapOut = 0,
    snapS = 0,
    snapT = 0,
    snapF = 0,
    snapST = 0,
    snapM = 0;
  let i = 0;
  while (i < n || runCount >= SLICE_MIN_CHILDREN) {
    if (runCount !== 0 && (i >= n || i !== runEnd || force)) {
      force = false;
      if (runCount >= SLICE_MIN_CHILDREN && runVis) {
        const tipsRun = leafEnd[runLast] - leafStart[runFirst];
        if (proj.dedupeRun(seen, runFirst, runLast, runXmax)) {
          if (out.count >= budget) {
            overflow = true;
            break;
          }
          out.push(runFirst, K_SUMMARY, runCls, runLast, runXmax);
          summaries++;
          summaryTips += tipsRun;
          if (minPx > base && runPx >= base) forced++;
        } else mergedTips += tipsRun;
      }
      runCount = 0;
      if (i >= n) break;
    }
    visited++;
    const yTop = oy + rowStart[i] * ky;
    const yBot = oy + rowEnd[i] * ky;
    const sx = ox + X[i] * kx;
    const culled = yBot < clipT - PAD || yTop > clipB + PAD || ox + XMAX[i] * kx < clipL - PAD;
    // a culled node is skipped, unless it may belong to a run (rule R): it is not drawn, but it counts towards its run (see below)
    if (culled && !(canRun && i > 0 && yBot - yTop < minPx && childCount[parent[i]] >= SLICE_MIN_CHILDREN)) {
      i = subtreeEnd[i];
      continue;
    }
    const p = parent[i];
    const sxp = i > 0 ? ox + X[p] * kx : sx;
    // only the root can fail this: a descended node's parent starts at or before clipR + PAD (pastClip below stops the descent), so this is not a cull
    if (sxp > clipR + PAD) {
      i = subtreeEnd[i];
      continue;
    }
    let kind: number;
    let descend = false;
    if (childCount[i] === 0) kind = K_TIP;
    else if (stub !== null && stub[i] === 1)
      kind = P.summaries ? K_SUMMARY : K_STUB; // clade not loaded: a triangle, never opened
    else if (sx > clipR + PAD) kind = K_STUB;
    else if (collapsed !== null && collapsed[i] === 1)
      kind = K_SUMMARY; // the app collapsed it: a triangle whatever the zoom and the options, never opened
    else if (lod && i > 0 && yBot - yTop < minPx) kind = P.summaries ? K_SUMMARY : K_STUB;
    else {
      kind = K_NODE;
      descend = true;
    }
    if (canRun) {
      const px = yBot - yTop;
      // a small clade right of the window (a stub only because of the window) belongs to its run like any other
      if (
        i > 0 &&
        px < minPx &&
        childCount[parent[i]] >= SLICE_MIN_CHILDREN &&
        (kind === K_TIP || (kind !== K_NODE && (stub === null || stub[i] === 0) && (collapsed === null || collapsed[i] === 0)))
      ) {
        const cl = classOf ? classOf[i] : 0;
        if (runCount !== 0 && (parent[i] !== runParent || cl !== runCls)) {
          if (runCount >= SLICE_MIN_CHILDREN) {
            force = true;
            continue;
          }
          runCount = 0;
        }
        if (runCount === 0) {
          runFirst = i;
          runParent = parent[i];
          runCls = cl;
          runXmax = 0;
          runPx = 0;
          runVis = false;
          snapOut = out.count;
          snapS = summaries;
          snapT = tips;
          snapF = forced;
          snapST = summaryTips;
          snapM = mergedTips;
        }
        runCount++;
        runLast = i;
        runEnd = subtreeEnd[i];
        if (!culled) runVis = true;
        if (XMAX[i] > runXmax) runXmax = XMAX[i];
        if (px > runPx) runPx = px;
        if (runCount === SLICE_MIN_CHILDREN) {
          out.count = snapOut;
          summaries = snapS;
          tips = snapT;
          forced = snapF;
          summaryTips = snapST;
          mergedTips = snapM;
        }
        if (runCount >= SLICE_MIN_CHILDREN) {
          i = runEnd;
          continue;
        }
      } else if (runCount !== 0) {
        if (runCount >= SLICE_MIN_CHILDREN) {
          force = true;
          continue;
        }
        runCount = 0;
      }
    }
    if (culled) {
      i = subtreeEnd[i];
      continue;
    }
    let emit = true;
    if (lod) {
      let d: number, e: number;
      if (kind === K_NODE) {
        d = cell(oys + ROW[firstChild[i]] * ky);
        e = cell(oys + ROW[LAST[i]] * ky);
      } else if (kind === K_SUMMARY) {
        d = cell(oys + rowStart[i] * ky);
        e = cell(oys + rowEnd[i] * ky);
      } else {
        d = cell(oys + ROW[i] * ky);
        e = d;
      }
      emit = seen.add(cell(oxs + (i > 0 ? X[p] : X[i]) * kx), cell(oxs + X[i] * kx), cell(oys + ROW[i] * ky), d + kind * 8192, e);
    }
    if (emit) {
      if (out.count >= budget) {
        overflow = true;
        break;
      }
      out.push(i, kind, classOf ? classOf[i] : 0);
      if (kind === K_SUMMARY) {
        summaries++;
        summaryTips += leafEnd[i] - leafStart[i];
        if (minPx > base && (stub === null || stub[i] === 0) && (collapsed === null || collapsed[i] === 0) && yBot - yTop >= base) forced++;
      } else if (kind === K_TIP) tips++;
    } else if (kind !== K_NODE) mergedTips += leafEnd[i] - leafStart[i];
    i = descend ? i + 1 : subtreeEnd[i];
  }
  return finishCut(res, visited, summaries, tips, overflow, forced, summaryTips, mergedTips);
}

function cutRadial(proj: RadialProjection, P: CutParams, classOf: Uint8Array | null, out: DrawList, seen: Seen, res: CutResult): CutResult {
  const { tree, L, T } = proj;
  const n = L.n;
  const { X, ROW, XMAX, LAST, rowStart, rowEnd } = L;
  const collapsed = L.collapsed;
  const COS = L.COS!,
    SIN = L.SIN!,
    BC = L.BC!,
    BS = L.BS!;
  const { parent, subtreeEnd, leafStart, leafEnd, childCount, firstChild } = tree;
  const stub = tree.stub ?? null; // a plain TreeData (no stub field) is accepted too
  const { cx, cy, k, da, clipL, clipR, clipT, clipB } = T;
  const fa0 = L.fan.start; // the angle of row 0: angles below are canvas angles, in the projection's range (lo, hi and the quadrant test)
  const { lod, minPx, budget } = P;
  const base = P.baseMinPx ?? minPx;
  const PAD = CULL_PAD_PX;
  // dedupe cells live in tree space at a scale rounded down to a power of two (cells are 1 to 2 px), shifted by whole cells
  // only: a pan leaves every primitive's cell untouched, and zooming changes the grid once per doubling instead of every
  // frame, so which of two close clades survives does not flicker
  const { fq, ou, ov } = proj;
  const { rMin, rMax, all, lo, hi, wrap } = proj;
  out.count = 0;
  seen.reset();
  let visited = 0,
    summaries = 0,
    tips = 0,
    forced = 0,
    summaryTips = 0,
    mergedTips = 0;
  let overflow = false;
  // RULE R ACCUMULATOR: the copy of the one in cutRect (deliberately duplicated, see there); change both together.
  // pending run of small siblings (rule R), see cutRect
  const canRun = lod && P.summaries;
  let runCount = 0,
    runFirst = 0,
    runLast = 0,
    runEnd = -1,
    runParent = -1,
    runCls = 0,
    runXmax = 0,
    runPx = 0,
    runVis = false, // a member of the run is in view: a run wholly outside the window is not drawn
    force = false;
  let snapOut = 0,
    snapS = 0,
    snapT = 0,
    snapF = 0,
    snapST = 0,
    snapM = 0;
  let i = 0;
  while (i < n || runCount >= SLICE_MIN_CHILDREN) {
    if (runCount !== 0 && (i >= n || i !== runEnd || force)) {
      force = false;
      if (runCount >= SLICE_MIN_CHILDREN && runVis) {
        const tipsRun = leafEnd[runLast] - leafStart[runFirst];
        if (proj.dedupeRun(seen, runFirst, runLast, runXmax)) {
          if (out.count >= budget) {
            overflow = true;
            break;
          }
          out.push(runFirst, K_SUMMARY, runCls, runLast, runXmax);
          summaries++;
          summaryTips += tipsRun;
          if (minPx > base && runPx >= base) forced++;
        } else mergedTips += tipsRun;
      }
      runCount = 0;
      if (i >= n) break;
    }
    visited++;
    const r1 = XMAX[i] * k;
    const r0 = i > 0 ? X[parent[i]] * k : 0;
    const a0 = fa0 + rowStart[i] * da;
    const a1 = fa0 + rowEnd[i] * da;
    let culled = r1 < rMin || r0 > rMax || (!all && (wrap ? !(a1 >= lo || a0 <= hi) : !(a1 >= lo && a0 <= hi)));
    // exact enough: the sector's bounding box against the padded clip rectangle (corner points from the cached boundary
    // cos/sin, plus the axis crossings), after the cheap radius and angle tests above
    if (!culled) {
      const ls = rowStart[i],
        le = rowEnd[i];
      const c0 = BC[ls],
        s0 = BS[ls],
        c1 = BC[le],
        s1 = BS[le];
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
      culled = cx + bx1 < clipL - PAD || cx + bx0 > clipR + PAD || cy + by1 < clipT - PAD || cy + by0 > clipB + PAD;
    }
    // a culled node is skipped, unless it may belong to a run (rule R): it is not drawn, but it counts towards its run (see below)
    if (culled && !(canRun && i > 0 && (a1 - a0) * r1 < minPx && childCount[parent[i]] >= SLICE_MIN_CHILDREN)) {
      i = subtreeEnd[i];
      continue;
    }
    const ri = X[i] * k;
    const ca = COS[i],
      sa = SIN[i];
    const arc = (a1 - a0) * r1;
    let kind: number;
    let descend = false;
    if (childCount[i] === 0) kind = K_TIP;
    else if (stub !== null && stub[i] === 1) kind = P.summaries ? K_SUMMARY : K_STUB;
    else if (collapsed !== null && collapsed[i] === 1)
      kind = K_SUMMARY; // the app collapsed it: a fan whatever the zoom and the options, never opened
    // a polytomy of tips collapses once its children are closer than minPx on average, so thousands of siblings cost one slice
    else if (lod && i > 0 && (arc < minPx || (isSlice(tree, i) && arc < minPx * childCount[i]))) kind = P.summaries ? K_SUMMARY : K_STUB;
    else {
      kind = K_NODE;
      descend = true;
    }
    if (canRun) {
      if (
        i > 0 &&
        arc < minPx &&
        childCount[parent[i]] >= SLICE_MIN_CHILDREN &&
        (kind === K_TIP || (kind === K_SUMMARY && (stub === null || stub[i] === 0) && (collapsed === null || collapsed[i] === 0)))
      ) {
        const cl = classOf ? classOf[i] : 0;
        if (runCount !== 0 && (parent[i] !== runParent || cl !== runCls)) {
          if (runCount >= SLICE_MIN_CHILDREN) {
            force = true;
            continue;
          }
          runCount = 0;
        }
        if (runCount === 0) {
          runFirst = i;
          runParent = parent[i];
          runCls = cl;
          runXmax = 0;
          runPx = 0;
          runVis = false;
          snapOut = out.count;
          snapS = summaries;
          snapT = tips;
          snapF = forced;
          snapST = summaryTips;
          snapM = mergedTips;
        }
        runCount++;
        runLast = i;
        runEnd = subtreeEnd[i];
        if (!culled) runVis = true;
        if (XMAX[i] > runXmax) runXmax = XMAX[i];
        if (arc > runPx) runPx = arc;
        if (runCount === SLICE_MIN_CHILDREN) {
          out.count = snapOut;
          summaries = snapS;
          tips = snapT;
          forced = snapF;
          summaryTips = snapST;
          mergedTips = snapM;
        }
        if (runCount >= SLICE_MIN_CHILDREN) {
          i = runEnd;
          continue;
        }
      } else if (runCount !== 0) {
        if (runCount >= SLICE_MIN_CHILDREN) {
          force = true;
          continue;
        }
        runCount = 0;
      }
    }
    if (culled) {
      i = subtreeEnd[i];
      continue;
    }
    let emit = true;
    if (lod) {
      const rp = i > 0 ? r0 : ri;
      let e = 0;
      if (kind === K_NODE) e = Math.min(8191, Math.round((ROW[LAST[i]] - ROW[firstChild[i]]) * da * ri));
      else if (kind === K_SUMMARY) e = Math.min(8191, Math.round(arc));
      emit = seen.add(cell(ri * ca * fq - ou), cell(ri * sa * fq - ov), cell(rp * ca * fq - ou), cell(rp * sa * fq - ov) + kind * 8192, e);
    }
    if (emit) {
      if (out.count >= budget) {
        overflow = true;
        break;
      }
      out.push(i, kind, classOf ? classOf[i] : 0);
      if (kind === K_SUMMARY) {
        summaries++;
        summaryTips += leafEnd[i] - leafStart[i];
        if (
          minPx > base &&
          (stub === null || stub[i] === 0) &&
          (collapsed === null || collapsed[i] === 0) &&
          !(arc < base || (isSlice(tree, i) && arc < base * childCount[i]))
        )
          forced++;
      } else if (kind === K_TIP) tips++;
    } else if (kind !== K_NODE) mergedTips += leafEnd[i] - leafStart[i];
    i = descend ? i + 1 : subtreeEnd[i];
  }
  return finishCut(res, visited, summaries, tips, overflow, forced, summaryTips, mergedTips);
}

const HALF_PI = Math.PI / 2;
/** Dedupe cell of a pixel (or scaled tree-space) coordinate: offset so small negatives stay distinct, in the 13 bits Seen.add packs.
 *  A coordinate outside them is OUT_OF_CELLS, which makes Seen.add report the key as new: clamping it instead put every far point
 *  of a deep zoom in the same cell, and primitives a whole row apart were merged (#111).
 *  Defined here, not imported, in the module of the loops that call it per node: measured 10-25% slower on a polytomy when imported. */
export const cell = (v: number): number => {
  const c = Math.floor(v) + 1024;
  return c < 0 || c > 8191 ? OUT_OF_CELLS : c;
};
const LEVEL_STEP = 1.15; // ratio between neighbouring collapse thresholds
const LEVEL_DOWN_FILL = 0.9; // the next level down is taken only when its list uses at most this share of the budget
// passes of one search: enough rungs (1.15^99, about a million times the base) for a cold first frame (no hint) of a radial view zoomed
// into a comb, whose clades' arcs at the rim run to tens of thousands of px (#87); an overflowing pass stops at the budget, so they are cheap
const MAX_PASSES = 100;

export interface SearchOpts {
  lod: boolean;
  base: number; // collapse threshold without budget pressure (px)
  budget: number;
  summaries: boolean;
  hint: number; // threshold of the previous full frame, 0 for none
}

/** Run the cut, raising the collapse threshold until the draw list fits the budget, and no further than needed. Without
 *  budget pressure that is one pass. Under pressure the threshold moves on the fixed ladder base * LEVEL_STEP^n, starting
 *  from the previous full frame's rung (`hint`): up one rung per overflowing pass, down one rung only while the lower rung
 *  also fits with LEVEL_DOWN_FILL of the budget to spare (sticky, so nearly equal zooms do not flip rungs). The list left
 *  behind is the one for the rung returned. Passes that overflow stop at the budget. */
export function searchCut(
  proj: LayoutProjection,
  classOf: Uint8Array | null,
  list: DrawList,
  seen: Seen,
  o: SearchOpts,
): { res: CutResult; minPx: number; retries: number } {
  const { base, budget, summaries } = o;
  let lastM = -1;
  // one small result object per pass (not per node): a pass that is kept must not be overwritten by the next one
  const run = (minPx: number): CutResult => {
    lastM = minPx;
    const P: CutParams = { lod: o.lod, minPx, baseMinPx: base, budget, summaries };
    return cut(proj, P, classOf, list, seen, newCutResult());
  };
  // The threshold moves on a fixed ladder base * STEP^n and is sticky: it rises only when the list overflows and falls only
  // when the next level down also fits with room to spare. The number of primitives is not monotone in the threshold (the
  // pixel-cell dedupe), so a search for "the smallest threshold that fits" jumped between frames at nearly the same zoom.
  const lvl = (n: number): number => base * Math.pow(LEVEL_STEP, n);
  let n = o.hint > base ? Math.round(Math.log(o.hint / base) / Math.log(LEVEL_STEP)) : 0;
  let m = lvl(n);
  let res = run(m);
  let passes = 1;
  if (o.lod && res.visited < 80000) {
    if (res.overflow) {
      while (res.overflow && passes < MAX_PASSES) {
        n++;
        m = lvl(n);
        res = run(m);
        passes++;
      }
    } else {
      while (n > 0 && passes < MAX_PASSES) {
        const r = run(lvl(n - 1));
        passes++;
        if (r.overflow || list.count > LEVEL_DOWN_FILL * budget) break;
        n--;
        m = lvl(n);
        res = r;
      }
      if (lastM !== m) {
        res = run(m);
        passes++;
      }
    }
  } else if (res.overflow && o.lod) {
    // very expensive walks (caterpillar-like): no search, just double until it fits
    while (res.overflow && passes < 24) {
      m *= 2;
      res = run(m);
      passes++;
    }
  }
  return { res, minPx: m, retries: passes - 1 };
}
