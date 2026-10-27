// A synthetic tree as the arrays the Parquet layout needs, without going through Newick: the split of every clade is uniform (the Yule
// model), nodes are numbered in preorder, tips are ranked in preorder, no recursion. Memory: about 120 bytes per tip.

import { mulberry32 } from './rng.mjs';

/**
 * @param {number} tips  number of tips (at least 2)
 * @param {number} seed
 * @param {{ lengths?: boolean }} [o]  lengths: draw branch lengths (default true); false is a cladogram (NaN lengths)
 */
export function makeTree(tips, seed, { lengths = true } = {}) {
  if (!(tips >= 2)) throw new Error('a tree needs at least 2 tips');
  const n = 2 * tips - 1;
  const rng = mulberry32(seed);
  const parent = new Int32Array(n);
  const stackK = new Int32Array(n + 1);
  const stackP = new Int32Array(n + 1);
  let sp = 0;
  stackK[0] = tips;
  stackP[0] = -1;
  sp = 1;
  for (let i = 0; sp > 0; i++) {
    sp--;
    const k = stackK[sp];
    parent[i] = stackP[sp];
    if (k > 1) {
      const j = 1 + Math.floor(rng() * (k - 1)); // tips in the left clade, uniform on 1..k-1
      stackK[sp] = k - j;
      stackP[sp++] = i;
      stackK[sp] = j;
      stackP[sp++] = i; // popped first, so the left clade gets the next ids
    }
  }
  const depth = new Int32Array(n);
  for (let i = 1; i < n; i++) depth[i] = depth[parent[i]] + 1;
  const end = new Int32Array(n);
  for (let i = 0; i < n; i++) end[i] = i + 1;
  for (let i = n - 1; i > 0; i--) if (end[i] > end[parent[i]]) end[parent[i]] = end[i];
  const tipCount = new Int32Array(n);
  const leafStart = new Int32Array(n);
  let rank = 0;
  for (let i = 0; i < n; i++) {
    leafStart[i] = rank;
    if (end[i] === i + 1) {
      tipCount[i] = 1;
      rank++;
    }
  }
  for (let i = n - 1; i > 0; i--) tipCount[parent[i]] += tipCount[i];
  const len = new Float32Array(n).fill(NaN);
  if (lengths) for (let i = 1; i < n; i++) len[i] = -Math.log(1 - rng()) * 0.1;
  const cum = new Float64Array(n);
  for (let i = 1; i < n; i++) cum[i] = cum[parent[i]] + (len[i] > 0 ? len[i] : 0);
  const maxCum = Float64Array.from(cum);
  const maxDepth = Int32Array.from(depth);
  for (let i = n - 1; i > 0; i--) {
    const p = parent[i];
    if (maxCum[i] > maxCum[p]) maxCum[p] = maxCum[i];
    if (maxDepth[i] > maxDepth[p]) maxDepth[p] = maxDepth[i];
  }
  // the layout row (y) of a node: a tip's rank + 0.5, an internal node the midpoint of its first and last child
  const lastChild = new Int32Array(n).fill(-1);
  for (let i = 1; i < n; i++) lastChild[parent[i]] = i;
  const row = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) row[i] = lastChild[i] < 0 ? leafStart[i] + 0.5 : (row[i + 1] + row[lastChild[i]]) / 2;
  const tipNode = new Int32Array(tips);
  for (let i = 0; i < n; i++) if (end[i] === i + 1) tipNode[leafStart[i]] = i;
  return { n, tips, parent, depth, end, tipCount, leafStart, len, cum, maxCum, maxDepth, row, tipNode, hasLen: lengths, maxDepthAll: maxDepth[0] };
}
