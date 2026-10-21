// Collapse: contract internal edges into polytomies (by support or by length).

import { draftOf, identity, linkChildren, result } from './draft.ts';
import type { OpResult, TreeInput } from './types.ts';

/** Contract every internal non-root edge for which `drop(node)` is true: the node's children join its parent, in its place.
 *  The contracted edge's length is lost, as when a branch collapses into a polytomy (ape di2multi, ETE delete). */
function contract(t: TreeInput, drop: (i: number) => boolean): OpResult {
  const d = draftOf(t);
  const up = new Int32Array(t.nodeCount); // nearest surviving ancestor-or-self
  let any = false;
  for (let i = 1; i < t.nodeCount; i++) {
    d.parent[i] = up[t.parent[i]]; // preorder: the parent is resolved first
    if (t.childCount[i] > 0 && drop(i)) {
      up[i] = d.parent[i];
      d.parent[i] = -1;
      any = true;
    } else up[i] = i;
  }
  if (!any) return identity(t);
  const order = new Int32Array(t.nodeCount);
  for (let i = 0; i < order.length; i++) order[i] = i; // preorder keeps the siblings in place
  linkChildren(d, order);
  return result(t, d);
}

/** Collapse internal edges whose support is below `threshold` into polytomies. Nodes without a support value are kept. */
export function collapseBySupport(t: TreeInput, threshold: number): OpResult {
  return contract(t, (i) => t.support[i] < threshold);
}

/** Collapse internal edges shorter than `minLength` (missing lengths are kept). */
export function collapseShortBranches(t: TreeInput, minLength: number): OpResult {
  return contract(t, (i) => t.length[i] < minLength);
}
