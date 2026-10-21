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
//   rule R    a run of at least SLICE_MIN_CHILDREN adjacent siblings that would each be a tip or a collapsed clade smaller
//             than minPx is ONE entry (a slice, see DrawList.last), so a polytomy of thousands of small children costs one
//             primitive per run, while its large children stay their own entries (issue 13)
//   rule D    if the list still exceeds the budget, minPx is raised and the cut is redone (cheap: the aborted
//             pass stops as soon as the budget is exceeded); the search is searchCut below
//
// The traversal is written once (`cut`). What differs between layouts (how big a clade is on screen, whether it is outside the
// viewport, the dedupe cell of a primitive, the polytomy-slice collapse) is asked of a LayoutProjection (projection.ts).
//
// Radial culling (2026-10, RadialProjection.cull): a node is skipped when its annular sector (radius X[parent]..XMAX, angle leafStart..leafEnd)
// cannot touch the padded clip rectangle: a radius-range test (distance from the root to the nearest and the farthest
// point of the rectangle) and an angle-range test (the angular interval the rectangle subtends as seen from the root).
// Survivors then get the sector's exact bounding box test (cached boundary cos/sin, no trigonometry per node): the cheap tests
// alone keep more off-screen primitives in the list than a bounding box does when the window is wide and off-centre.

import { K_NODE, K_STUB, K_SUMMARY, K_TIP, SLICE_MIN_CHILDREN } from './kinds.ts';
import { projectionFor, type LayoutProjection } from './projection.ts';
import type { Layout } from './layout.ts';
import type { Transform } from './geom.ts';
import type { TreeSnapshot } from './types.ts';

export { K_NODE, K_TIP, K_SUMMARY, K_STUB, SLICE_MIN_CHILDREN, isSlice } from './kinds.ts';

/** A run (rule R) is a K_SUMMARY entry with last >= 0: `node` is its first member, `last` its last member (siblings, adjacent in
 *  preorder, so its tips are exactly [leafStart[node], leafEnd[last]) and its parent is parent[node]) and `xmax` the largest
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

/** The cut: one forward scan over the preorder arrays, written once for every layout. Everything that depends on how the layout
 *  maps the tree to the screen (cull test, pixel extent, collapse rules, dedupe key) is asked of the projection; the traversal,
 *  the classification (tip / stub / summary / node), rule R's run accumulator and the counters live here. Fills `out` and `res`
 *  (both caller-owned; nothing is shared between calls). */
export function cut(proj: LayoutProjection, P: CutParams, classOf: Uint8Array | null, out: DrawList, seen: Seen, res: CutResult): CutResult {
  const { tree, L } = proj;
  const n = L.n;
  const { XMAX } = L;
  const { parent, subtreeEnd, leafStart, leafEnd, childCount } = tree;
  const stub = tree.stub ?? null; // a plain TreeData (no stub field) is accepted too
  const { lod, minPx, budget } = P;
  const base = P.baseMinPx ?? minPx;
  out.count = 0;
  seen.reset();
  let visited = 0,
    summaries = 0,
    tips = 0,
    forced = 0,
    summaryTips = 0,
    mergedTips = 0;
  let overflow = false;
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
      if (runCount >= SLICE_MIN_CHILDREN) {
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
    if (proj.cull(i)) {
      i = subtreeEnd[i];
      continue;
    }
    const px = proj.ext; // the clade's extent across the tips in px (rect: rows, radial: arc), set by cull()
    let kind: number;
    let descend = false;
    if (childCount[i] === 0) kind = K_TIP;
    else if (stub !== null && stub[i] === 1)
      kind = P.summaries ? K_SUMMARY : K_STUB; // clade not loaded: a triangle, never opened
    else if (proj.pastClip(i)) kind = K_STUB;
    else if (lod && i > 0 && proj.collapses(i, minPx)) kind = P.summaries ? K_SUMMARY : K_STUB;
    else {
      kind = K_NODE;
      descend = true;
    }
    if (canRun) {
      if (
        i > 0 &&
        px < minPx &&
        childCount[parent[i]] >= SLICE_MIN_CHILDREN &&
        (kind === K_TIP || (kind === K_SUMMARY && (stub === null || stub[i] === 0)))
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
    const emit = lod ? proj.dedupe(seen, i, kind) : true;
    if (emit) {
      if (out.count >= budget) {
        overflow = true;
        break;
      }
      out.push(i, kind, classOf ? classOf[i] : 0);
      if (kind === K_SUMMARY) {
        summaries++;
        summaryTips += leafEnd[i] - leafStart[i];
        if (minPx > base && (stub === null || stub[i] === 0) && !proj.collapses(i, base)) forced++;
      } else if (kind === K_TIP) tips++;
    } else if (kind !== K_NODE) mergedTips += leafEnd[i] - leafStart[i];
    i = descend ? i + 1 : subtreeEnd[i];
  }
  res.visited = visited;
  res.summaries = summaries;
  res.tips = tips;
  res.overflow = overflow;
  res.forced = forced;
  res.summaryTips = summaryTips;
  res.mergedTips = mergedTips;
  return res;
}

const LEVEL_STEP = 1.15; // ratio between neighbouring collapse thresholds
const LEVEL_DOWN_FILL = 0.9; // the next level down is taken only when its list uses at most this share of the budget

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
export function searchCut(
  tree: TreeSnapshot,
  L: Layout,
  T: Transform,
  classOf: Uint8Array | null,
  list: DrawList,
  seen: Seen,
  o: SearchOpts,
): { res: CutResult; minPx: number; retries: number } {
  const { base, budget, summaries } = o;
  const proj = projectionFor(tree, L, T); // per-frame precomputation happens once for all passes
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
      while (res.overflow && passes < 60) {
        n++;
        m = lvl(n);
        res = run(m);
        passes++;
      }
    } else {
      while (n > 0 && passes < 60) {
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
