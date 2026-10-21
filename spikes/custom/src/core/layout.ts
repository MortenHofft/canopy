// O(n) layout into typed arrays, shared by the rectangular and the radial view.
//   X   = distance from the root in [0,1] (phylogram: cumulative length; cladogram: tips aligned, internal nodes by height)
//   ROW = tip rank + 0.5 for tips, midpoint of first and last child for internal nodes
// Rectangular: screen x from X, screen y from ROW. Radial: angle = 2*pi*ROW/tips, radius = X.
// Three linear passes over preorder-ordered arrays, no recursion, no per-node objects.

import type { TreeSnapshot } from './types.ts';

export interface Layout {
  n: number;
  tips: number;
  usedLengths: boolean; // false for a cladogram or a tree without lengths
  maxLen: number; // largest root-to-tip distance in tree units (clamped lengths), 1 for a cladogram
  ultrametric: boolean;
  X: Float64Array;
  ROW: Float64Array;
  XMAX: Float32Array; // largest X in the subtree (clade extent for collapsing and culling)
  LAST: Int32Array; // last child, -1 for tips
  layoutMs: number;
  /** cos and sin of the node's radial angle (ROW * 2*pi/tips); built on first use by ensureTrig() (radial layout only) */
  COS: Float64Array | null;
  SIN: Float64Array | null;
  /** cos and sin of the tip-rank boundaries k * 2*pi/tips, k = 0..tips (sector bounding boxes without trigonometry) */
  BC: Float64Array | null;
  BS: Float64Array | null;
}

/** Cache cos/sin of every node's radial angle (the angle does not depend on the zoom or on branch lengths), so the cut,
 *  the drawing and the hit index never call Math.cos/sin per node. 16 bytes per node, only paid when radial is used. */
export function ensureTrig(L: Layout): void {
  if (L.COS) return;
  const n = L.n;
  const da = (2 * Math.PI) / Math.max(1, L.tips);
  const C = new Float64Array(n),
    S = new Float64Array(n);
  const ROW = L.ROW;
  for (let i = 0; i < n; i++) {
    const a = ROW[i] * da;
    C[i] = Math.cos(a);
    S[i] = Math.sin(a);
  }
  const T = L.tips;
  const BC = new Float64Array(T + 1),
    BS = new Float64Array(T + 1);
  for (let k = 0; k <= T; k++) {
    BC[k] = Math.cos(k * da);
    BS[k] = Math.sin(k * da);
  }
  L.COS = C;
  L.SIN = S;
  L.BC = BC;
  L.BS = BS;
}

/** Layout of a partially loaded tree: every row (loaded or stub) takes X, XMAX and ROW from the rollups of the snapshot, so no
 *  pass over descendants is needed and a stub gets the same numbers the full tree would give it (checked by
 *  parquet-experiment/test/overview_vs_layout.mjs). */
function layoutFromRollup(tree: TreeSnapshot, branchLengths: boolean, t0: number): Layout {
  const n = tree.nodeCount,
    R = tree.rollup!;
  const X = new Float64Array(n),
    XMAX = new Float32Array(n);
  const maxLen = R.maxCum[0]; // the root's rollup is the largest distance of the FULL tree, whatever is loaded
  const usedLengths = branchLengths && tree.hasLengths && maxLen > 0;
  let ultrametric = false;
  if (usedLengths) {
    const inv = 1 / maxLen;
    let lo = Infinity;
    for (let i = 0; i < n; i++) {
      X[i] = R.cumLength[i] * inv;
      XMAX[i] = R.maxCum[i] * inv;
      if (tree.childCount[i] === 0 && X[i] < lo) lo = X[i];
    }
    ultrametric = Number.isFinite(lo) && 1 - lo <= 1e-3;
  } else {
    const H = R.maxDepth[0] || 1;
    for (let i = 0; i < n; i++) {
      X[i] = tree.childCount[i] === 0 ? 1 : 1 - (R.maxDepth[i] - R.depth[i]) / H;
      XMAX[i] = 1;
    }
  }
  const LAST = new Int32Array(n).fill(-1);
  for (let i = 1; i < n; i++) LAST[tree.parent[i]] = i; // a stub has no rows below it, so its LAST stays -1
  return {
    n,
    tips: tree.tipCount,
    usedLengths,
    maxLen: usedLengths ? maxLen : 1,
    ultrametric,
    X,
    ROW: R.row,
    XMAX,
    LAST,
    layoutMs: performance.now() - t0,
    COS: null,
    SIN: null,
    BC: null,
    BS: null,
  };
}

export function computeLayout(tree: TreeSnapshot, branchLengths: boolean): Layout {
  const t0 = performance.now();
  if (tree.rollup) return layoutFromRollup(tree, branchLengths, t0);
  const n = tree.nodeCount;
  const parent = tree.parent;
  const X = new Float64Array(n);
  let maxLen = 0;
  // negative or missing lengths count as 0, so X never decreases from parent to child (culling relies on it)
  if (branchLengths && tree.hasLengths) {
    const len = tree.length;
    for (let i = 1; i < n; i++) {
      const l = len[i];
      X[i] = X[parent[i]] + (l > 0 ? l : 0);
      if (X[i] > maxLen) maxLen = X[i];
    }
  }
  const usedLengths = maxLen > 0;
  let ultrametric = false;
  if (usedLengths) {
    let lo = Infinity;
    for (let i = 0; i < n; i++) if (tree.childCount[i] === 0 && X[i] < lo) lo = X[i];
    ultrametric = (maxLen - lo) / maxLen <= 1e-3;
    const inv = 1 / maxLen;
    for (let i = 1; i < n; i++) X[i] *= inv;
  } else {
    maxLen = 1;
    const h = tree.heights();
    const H = h[0] || 1;
    for (let i = 0; i < n; i++) X[i] = tree.childCount[i] === 0 ? 1 : 1 - h[i] / H;
  }
  const ROW = new Float64Array(n);
  const LAST = new Int32Array(n).fill(-1);
  for (let i = 1; i < n; i++) LAST[parent[i]] = i; // preorder: the last assignment is the last child
  for (let r = 0; r < tree.tipCount; r++) ROW[tree.tipNode[r]] = r + 0.5;
  for (let i = n - 1; i >= 0; i--) if (LAST[i] >= 0) ROW[i] = (ROW[tree.firstChild[i]] + ROW[LAST[i]]) / 2;
  const XMAX = new Float32Array(n);
  for (let i = 0; i < n; i++) XMAX[i] = X[i];
  for (let i = n - 1; i > 0; i--) {
    const p = parent[i];
    if (XMAX[i] > XMAX[p]) XMAX[p] = XMAX[i];
  }
  return {
    n,
    tips: tree.tipCount,
    usedLengths,
    maxLen,
    ultrametric,
    X,
    ROW,
    XMAX,
    LAST,
    layoutMs: performance.now() - t0,
    COS: null,
    SIN: null,
    BC: null,
    BS: null,
  };
}
