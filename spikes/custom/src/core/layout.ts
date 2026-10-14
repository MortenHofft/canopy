// O(n) layout into typed arrays, shared by the rectangular and the radial view.
//   X   = distance from the root in [0,1] (phylogram: cumulative length; cladogram: tips aligned, internal nodes by height)
//   ROW = tip rank + 0.5 for tips, midpoint of first and last child for internal nodes
// Rectangular: screen x from X, screen y from ROW. Radial: angle = 2*pi*ROW/tips, radius = X.
// Three linear passes over preorder-ordered arrays, no recursion, no per-node objects.

import type { TreeData } from './types.ts';

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
}

export function computeLayout(tree: TreeData, branchLengths: boolean): Layout {
  const t0 = performance.now();
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
  return { n, tips: tree.tipCount, usedLengths, maxLen, ultrametric, X, ROW, XMAX, LAST, layoutMs: performance.now() - t0 };
}
