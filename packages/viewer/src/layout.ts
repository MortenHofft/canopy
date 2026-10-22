// O(n) layout into typed arrays, shared by the rectangular and the radial view.
//   X   = distance from the root in [0,1] (phylogram: cumulative length; cladogram: tips aligned, internal nodes by height)
//   ROW = row + 0.5 for tips, midpoint of first and last child for internal nodes
// Rectangular: screen x from X, screen y from ROW. Radial: angle = 2*pi*ROW/rows, radius = X.
// Three linear passes over preorder-ordered arrays, no recursion, no per-node objects.
//
// ROWS. A row is a place across the tips. Without collapsed clades every tip has its own row and row = tip rank. A collapsed clade
// (`collapsed`, see below) has ONE row for all its tips, so rank and row are no longer the same number and everything that puts a tip
// on the screen goes through `rowOfRank` / `rankOfRow` (null = identity). The invariants are in docs/internals.md ("Collapsed clades").

import type { TreeSnapshot } from './types.ts';

export interface Layout {
  n: number;
  tips: number;
  /** Number of rows: `tips` minus the tips freed by collapsed clades (a collapsed clade is one row). The viewport's y and the radial
   *  angle step are in rows. */
  rows: number;
  /** By node: the rows [rowStart, rowEnd) the node's tips occupy. The tip ranks [leafStart, leafEnd) when nothing is collapsed (the very
   *  same arrays). A node below a collapsed clade has the clade's single row. */
  rowStart: Int32Array;
  rowEnd: Int32Array;
  /** By node: 1 = a collapsed clade, drawn as one summary and never opened by the cut. Only the outermost of nested collapsed clades is
   *  marked (the rest is hidden inside it); a tip, or a clade of one tip, is never marked. null = none. */
  collapsed: Uint8Array | null;
  /** By node: 1 = strictly inside a collapsed clade (not drawn, no place of its own). null = none. */
  hidden: Uint8Array | null;
  /** By tip rank: its row (the clade's row for a tip below a collapsed clade). null = identity (nothing collapsed). */
  rowOfRank: Int32Array | null;
  /** By row (length rows + 1, the last entry is `tips`): the first tip rank of the row. A row holds the tips [rankOfRow[r], rankOfRow[r+1]):
   *  exactly one for a tip's row, more for a collapsed clade's. null = identity. */
  rankOfRow: Int32Array | null;
  /** By row: the node that stands for it, the tip or the collapsed clade (preorder index). null = the tip of that rank. */
  rowNode: Int32Array | null;
  usedLengths: boolean; // false for a cladogram or a tree without lengths
  maxLen: number; // largest root-to-tip distance in tree units (clamped lengths), 1 for a cladogram
  ultrametric: boolean;
  X: Float64Array;
  ROW: Float64Array;
  XMAX: Float32Array; // largest X in the subtree (clade extent for collapsing and culling)
  LAST: Int32Array; // last child, -1 for tips
  layoutMs: number;
  /** cos and sin of the node's radial angle (ROW * 2*pi/rows); built on first use by ensureTrig() (radial layout only) */
  COS: Float64Array | null;
  SIN: Float64Array | null;
  /** cos and sin of the row boundaries k * 2*pi/rows, k = 0..rows (sector bounding boxes without trigonometry) */
  BC: Float64Array | null;
  BS: Float64Array | null;
}

/** Cache cos/sin of every node's radial angle (the angle does not depend on the zoom or on branch lengths), so the cut,
 *  the drawing and the hit index never call Math.cos/sin per node. 16 bytes per node, only paid when radial is used. */
export function ensureTrig(L: Layout): void {
  if (L.COS) return;
  const n = L.n;
  const da = (2 * Math.PI) / Math.max(1, L.rows);
  const C = new Float64Array(n),
    S = new Float64Array(n);
  const ROW = L.ROW;
  for (let i = 0; i < n; i++) {
    const a = ROW[i] * da;
    C[i] = Math.cos(a);
    S[i] = Math.sin(a);
  }
  const T = L.rows;
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
 *  parquet-experiment/test/overview_vs_layout.mjs on the research branch). */
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
    rows: tree.tipCount,
    rowStart: tree.leafStart,
    rowEnd: tree.leafEnd,
    collapsed: null, // a partially loaded tree has no collapsing: its rows come from the rollups of the full tree
    hidden: null,
    rowOfRank: null,
    rankOfRow: null,
    rowNode: null,
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

/** `collapsed`: by node, 1 = a clade to draw as one row (ignored for a partially loaded tree, and for a tip). */
export function computeLayout(tree: TreeSnapshot, branchLengths: boolean, collapsed: Uint8Array | null = null): Layout {
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
  const R = collapsedRows(tree, collapsed);
  if (R === null) for (let r = 0; r < tree.tipCount; r++) ROW[tree.tipNode[r]] = r + 0.5;
  else for (let r = 0; r < tree.tipCount; r++) ROW[tree.tipNode[r]] = R.rowOfRank[r] + 0.5;
  for (let i = n - 1; i >= 0; i--) if (LAST[i] >= 0) ROW[i] = (ROW[tree.firstChild[i]] + ROW[LAST[i]]) / 2;
  let rowStart = tree.leafStart,
    rowEnd = tree.leafEnd;
  if (R !== null) {
    // every node's rows from its first and last tip: the tips below a collapsed clade share its row, so the clade and everything in it
    // get the one row
    rowStart = new Int32Array(n);
    rowEnd = new Int32Array(n);
    for (let i = 0; i < n; i++) {
      rowStart[i] = R.rowOfRank[tree.leafStart[i]];
      rowEnd[i] = R.rowOfRank[tree.leafEnd[i] - 1] + 1;
    }
  }
  const XMAX = new Float32Array(n);
  for (let i = 0; i < n; i++) XMAX[i] = X[i];
  for (let i = n - 1; i > 0; i--) {
    const p = parent[i];
    if (XMAX[i] > XMAX[p]) XMAX[p] = XMAX[i];
  }
  return {
    n,
    tips: tree.tipCount,
    rows: R === null ? tree.tipCount : R.rows,
    rowStart,
    rowEnd,
    collapsed: R === null ? null : R.mask,
    hidden: R === null ? null : R.hidden,
    rowOfRank: R === null ? null : R.rowOfRank,
    rankOfRow: R === null ? null : R.rankOfRow,
    rowNode: R === null ? null : R.rowNode,
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

interface CollapsedRows {
  mask: Uint8Array;
  hidden: Uint8Array;
  rows: number;
  rowOfRank: Int32Array;
  rankOfRow: Int32Array;
  rowNode: Int32Array;
}

/** The rows of a tree with collapsed clades, or null when no clade collapses a row (no internal node in the mask, or only tips). One
 *  preorder scan jumping over the clades (outermost wins), then one scan over the tips; no recursion. */
function collapsedRows(tree: TreeSnapshot, mask: Uint8Array | null): CollapsedRows | null {
  if (mask === null) return null;
  const n = tree.nodeCount,
    T = tree.tipCount;
  const { subtreeEnd, childCount, leafStart, leafEnd } = tree;
  // cont[r] = 1: tip r continues the row of the tip before it (it is inside a collapsed clade, not its first tip)
  const cont = new Uint8Array(T);
  const hidden = new Uint8Array(n);
  const top: number[] = []; // the outermost collapsed clades, in preorder
  let any = false;
  for (let i = 0; i < n;) {
    if (mask[i] === 1 && childCount[i] > 0 && leafEnd[i] - leafStart[i] > 1) {
      for (let r = leafStart[i] + 1; r < leafEnd[i]; r++) cont[r] = 1;
      hidden.fill(1, i + 1, subtreeEnd[i]);
      top.push(i);
      any = true;
      i = subtreeEnd[i];
    } else i++;
  }
  if (!any) return null;
  const rowOfRank = new Int32Array(T);
  let row = -1;
  for (let r = 0; r < T; r++) {
    if (cont[r] === 0) row++;
    rowOfRank[r] = row;
  }
  const rows = row + 1;
  const rankOfRow = new Int32Array(rows + 1);
  const rowNode = new Int32Array(rows);
  for (let r = T - 1; r >= 0; r--) {
    rankOfRow[rowOfRank[r]] = r;
    rowNode[rowOfRank[r]] = tree.tipNode[r];
  }
  rankOfRow[rows] = T;
  for (const c of top) rowNode[rowOfRank[leafStart[c]]] = c;
  const m = new Uint8Array(n);
  for (const c of top) m[c] = 1;
  return { mask: m, hidden, rows, rowOfRank, rankOfRow, rowNode };
}

/** A position y in rows of layout `from` as a position in rows of layout `to`, through the tip ranks (a collapsed clade's row spans its
 *  tips, so the position inside it is kept proportionally). Used to keep the window when clades are collapsed or expanded; the same
 *  tree is assumed on both sides. y outside 0..rows extrapolates. */
export function remapRow(y: number, from: Layout, to: Layout): number {
  let k = y;
  if (from.rankOfRow) {
    const r = Math.min(from.rows - 1, Math.max(0, Math.floor(y)));
    const k0 = from.rankOfRow[r];
    k = k0 + (y - r) * (from.rankOfRow[r + 1] - k0);
  }
  if (!to.rowOfRank || !to.rankOfRow) return k;
  const r = to.rowOfRank[Math.min(to.tips - 1, Math.max(0, Math.floor(k)))];
  const k0 = to.rankOfRow[r];
  return r + (k - k0) / (to.rankOfRow[r + 1] - k0);
}
