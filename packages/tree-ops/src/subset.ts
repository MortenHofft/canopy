// Subsets: prune to a set of tips, take one clade as its own tree.

import { addLen, checkNode, draftOf, linkChildren, result } from './draft.ts';
import type { OpResult, TreeInput } from './types.ts';

/**
 * Keep only the tips for which `keep(rank)` is true and the nodes that join them. Nodes left with one child are removed and
 * their edges merged, and edges above the new root are dropped. Throws if no tip is kept.
 */
export function prune(t: TreeInput, keep: (tipRank: number) => boolean): OpResult {
  const n = t.nodeCount;
  const present = new Int32Array(n); // number of children (or the tip itself) with kept tips below
  for (let r = 0; r < t.tipCount; r++) if (keep(r)) present[t.tipNode[r]] = 1;
  const kids = new Int32Array(n);
  for (let i = n - 1; i > 0; i--) if (present[i] > 0 || kids[i] > 0) kids[t.parent[i]]++;
  const d = draftOf(t);
  const anc = new Int32Array(n).fill(-1); // nearest kept ancestor-or-self
  const acc = new Float64Array(n).fill(NaN); // length from that ancestor down to here
  let root = -1;
  for (let i = 0; i < n; i++) {
    const has = t.childCount[i] === 0 ? present[i] > 0 : kids[i] > 0;
    d.parent[i] = -1;
    if (!has) continue;
    const up = i === 0 ? -1 : anc[t.parent[i]];
    const l = i === 0 ? NaN : addLen(acc[t.parent[i]], t.length[i]);
    const kept = t.childCount[i] === 0 || kids[i] >= 2;
    if (kept) {
      d.parent[i] = up;
      d.length[i] = up < 0 ? NaN : l;
      if (up < 0) root = i;
      anc[i] = i;
      acc[i] = NaN;
    } else {
      anc[i] = up;
      acc[i] = up < 0 ? NaN : l;
    }
  }
  if (root < 0) throw new Error('prune: no tips kept');
  d.root = root;
  const order = new Int32Array(n);
  for (let i = 0; i < n; i++) order[i] = i;
  linkChildren(d, order);
  return result(t, d);
}

/** The clade below `node` as a tree of its own (the edge above it is dropped). */
export function subtree(t: TreeInput, node: number): OpResult {
  checkNode(t, node);
  const d = draftOf(t);
  d.root = node;
  d.parent[node] = -1;
  // a subtree is a contiguous preorder range: nodes outside it are simply not reached by the builder
  return result(t, d);
}
