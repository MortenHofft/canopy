// Collapse: contract internal edges into polytomies (by support or by length).

import { addLen, draftOf, identity, linkChildren, result } from './draft.ts';
import type { OpResult, TreeInput } from './types.ts';

/** Contract every internal non-root edge for which `drop(node)` is true: the node's children join its parent, in its place.
 *  The contracted edge's length is lost, as when a branch collapses into a polytomy (ape di2multi, ETE delete), unless `extend`:
 *  then it is added to each child's own length, so every tip keeps its distance from the root and an ultrametric tree stays so. */
function contract(t: TreeInput, drop: (i: number) => boolean, extend = false): OpResult {
  const d = draftOf(t);
  const up = new Int32Array(t.nodeCount); // nearest surviving ancestor-or-self
  let any = false;
  for (let i = 1; i < t.nodeCount; i++) {
    d.parent[i] = up[t.parent[i]]; // preorder: the parent is resolved first
    if (t.childCount[i] > 0 && drop(i)) {
      up[i] = d.parent[i];
      d.parent[i] = -1;
      any = true;
      // preorder: d.length[i] already holds what a contracted parent passed down
      if (extend) for (let c = t.firstChild[i]; c >= 0; c = t.nextSibling[c]) d.length[c] = addLen(d.length[c], d.length[i]);
    } else up[i] = i;
  }
  if (!any) return identity(t);
  const order = new Int32Array(t.nodeCount);
  for (let i = 0; i < order.length; i++) order[i] = i; // preorder keeps the siblings in place
  linkChildren(d, order);
  return result(t, d);
}

/** Nodes `collapseBySupport` and `collapseShortBranches` must not contract: a set of node indexes, an array of them, or a predicate. */
export type KeepNodes = ReadonlySet<number> | readonly number[] | ((node: number) => boolean);

export interface CollapseEdgesOptions {
  /** Give the contracted edge's length to the node's children (default false: the length is lost). Every tip keeps its distance from
   *  the root, so a dated (ultrametric) tree stays ultrametric and the viewer's time axis is unchanged. */
  extend?: boolean;
  /** Nodes whose edge is kept whatever its value, e.g. the clades a viewer shows collapsed (so they stay nodes of the result). */
  keep?: KeepNodes;
}

function keeper(keep: KeepNodes | undefined): ((i: number) => boolean) | null {
  if (keep === undefined) return null;
  if (typeof keep === 'function') return keep;
  const set: ReadonlySet<number> = keep instanceof Set ? keep : new Set(keep as readonly number[]);
  return (i) => set.has(i);
}

/** Collapse internal edges whose support is below `threshold` into polytomies. Nodes without a support value are kept, and so are the
 *  nodes in `opts.keep`. */
export function collapseBySupport(t: TreeInput, threshold: number, opts: CollapseEdgesOptions = {}): OpResult {
  const keep = keeper(opts.keep);
  return contract(t, (i) => t.support[i] < threshold && !(keep && keep(i)), opts.extend);
}

/** Collapse internal edges shorter than `minLength` (missing lengths are kept, and so are the nodes in `opts.keep`). */
export function collapseShortBranches(t: TreeInput, minLength: number, opts: CollapseEdgesOptions = {}): OpResult {
  const keep = keeper(opts.keep);
  return contract(t, (i) => t.length[i] < minLength && !(keep && keep(i)), opts.extend);
}
