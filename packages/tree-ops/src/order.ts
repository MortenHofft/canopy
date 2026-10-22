// Display order: ladderise and rotate change only the order of children, never the topology or lengths.

import { checkNode, draftOf, identity, result } from './draft.ts';
import type { OpResult, TreeInput } from './types.ts';

export interface LadderiseOptions {
  /** 'increasing' (default): smaller clades first (top in a rectangular layout), as FigTree's "increasing" order. */
  order?: 'increasing' | 'decreasing';
  /**
   * What "smaller" means for a child (default 'tips'):
   * - 'tips': number of descendant tips.
   * - 'depth': the most nested path from the child down to a tip, in nodes (a tip is 0).
   * - 'height': the longest path from the child down to a tip, in branch length (crown height, or age on a dated tree). The
   *   child's own edge is not counted: counting it would add the same amount to the tie-break of every dated sibling pair.
   *   Missing or negative lengths count as 0. Without any lengths every edge counts 1, so it equals 'depth'. Heights within
   *   1e-6 of the tree's greatest height (as midpointRoot) are equal, because Newick lengths are rounded.
   *
   * Ties are broken deterministically: by the other measures in a fixed order ('depth': then tips, then height; 'height':
   * then tips, then depth), and finally by the input order. For 'tips' they go straight to the input order, so the default
   * output is unchanged from before `by` existed. `order: 'decreasing'` reverses every measure, tie-breaks included, but not
   * the input-order tie-break. Unknown `by` or `order` values throw a RangeError.
   */
  by?: 'tips' | 'depth' | 'height';
}

/** Sort the children of every node by a clade measure (tips, depth or height; see `by`). Changes only the display order. */
export function ladderise(t: TreeInput, o: LadderiseOptions = {}): OpResult {
  const order = o.order ?? 'increasing';
  if (order !== 'increasing' && order !== 'decreasing') throw new RangeError(`unknown ladderise order '${String(order)}'`);
  const sign = order === 'decreasing' ? -1 : 1;
  const by = o.by ?? 'tips';
  if (by !== 'tips' && by !== 'depth' && by !== 'height') throw new RangeError(`unknown ladderise measure '${String(by)}'`);
  const d = draftOf(t);
  const n = t.nodeCount;
  const needDepth = by !== 'tips';
  const needHeight = by === 'height' || (by === 'depth' && t.hasLengths);
  // one reverse-preorder pass (children have larger indices than their parent), only for the measures in use
  const dep = needDepth ? new Int32Array(n) : null;
  const hei = needHeight && t.hasLengths ? new Float64Array(n) : null;
  for (let v = n - 1; v > 0; v--) {
    const p = t.parent[v];
    if (dep && dep[v] + 1 > dep[p]) dep[p] = dep[v] + 1;
    if (hei) {
      const len = t.length[v];
      const h = hei[v] + (len > 0 ? len : 0); // NaN and negative count as 0
      if (h > hei[p]) hei[p] = h;
    }
  }
  const tips = (i: number) => t.leafEnd[i] - t.leafStart[i];
  const depthOf = (i: number) => (dep ? dep[i] : 0);
  // without lengths every edge counts 1: height is depth
  const heights = hei ?? dep;
  const heightOf = (i: number) => (heights ? heights[i] : 0);
  const eps = (hei ? hei[0] : 0) * 1e-6;
  const byHeight = (a: number, b: number) => {
    const x = heightOf(a) - heightOf(b);
    return x > eps ? 1 : x < -eps ? -1 : 0;
  };
  const cmp =
    by === 'tips'
      ? (a: number, b: number) => sign * (tips(a) - tips(b)) || a - b
      : by === 'depth'
        ? (a: number, b: number) => sign * (depthOf(a) - depthOf(b)) || sign * (tips(a) - tips(b)) || sign * byHeight(a, b) || a - b
        : (a: number, b: number) => sign * byHeight(a, b) || sign * (tips(a) - tips(b)) || sign * (depthOf(a) - depthOf(b)) || a - b;
  const kids: number[] = [];
  let moved = false;
  for (let v = 0; v < n; v++) {
    if (t.childCount[v] < 2) continue;
    kids.length = 0;
    for (let c = t.firstChild[v]; c >= 0; c = t.nextSibling[c]) kids.push(c);
    kids.sort(cmp);
    // siblings are numbered in preorder, so the original order is increasing
    for (let k = 1; k < kids.length && !moved; k++) if (kids[k] < kids[k - 1]) moved = true;
    d.firstChild[v] = kids[0];
    for (let k = 0; k < kids.length; k++) d.nextSibling[kids[k]] = k + 1 < kids.length ? kids[k + 1] : -1;
  }
  return moved ? result(t, d, true) : identity(t);
}

/** Reverse the order of the children of `node` (swap the two sides of a bifurcation). Display only. */
export function rotate(t: TreeInput, node: number): OpResult {
  checkNode(t, node);
  const d = draftOf(t);
  const kids: number[] = [];
  for (let c = t.firstChild[node]; c >= 0; c = t.nextSibling[c]) kids.push(c);
  kids.reverse();
  if (kids.length < 2) return identity(t);
  d.firstChild[node] = kids[0];
  for (let k = 0; k < kids.length; k++) d.nextSibling[kids[k]] = k + 1 < kids.length ? kids[k + 1] : -1;
  return result(t, d, true);
}

/**
 * Give the children of `node` in the order listed. `order` must be a permutation of the node's current children (their
 * indices in `t`); anything else throws a RangeError. Display only (the root keeps its label and length). `changed` is false when the order is already that one.
 */
export function reorder(t: TreeInput, node: number, order: ArrayLike<number>): OpResult {
  checkNode(t, node);
  const k = t.childCount[node];
  if (order == null || typeof order.length !== 'number') throw new RangeError('order must be a list of nodes');
  if (order.length !== k) throw new RangeError(`order lists ${order.length} nodes, node ${node} has ${k} children`);
  const seen = new Uint8Array(t.nodeCount);
  let same = true;
  let c = t.firstChild[node];
  for (let i = 0; i < k; i++, c = t.nextSibling[c]) {
    const v = order[i];
    if (!Number.isInteger(v) || v < 0 || v >= t.nodeCount || t.parent[v] !== node) throw new RangeError(`${v} is not a child of node ${node}`);
    if (seen[v]) throw new RangeError(`${v} is listed twice`);
    seen[v] = 1;
    if (v !== c) same = false;
  }
  if (same) return identity(t);
  const d = draftOf(t);
  d.firstChild[node] = order[0];
  for (let i = 0; i < k; i++) d.nextSibling[order[i]] = i + 1 < k ? order[i + 1] : -1;
  return result(t, d, true);
}

/** Exchange two sibling branches `a` and `b` (same parent, different nodes); the others keep their places. Display only. */
export function swap(t: TreeInput, a: number, b: number): OpResult {
  checkNode(t, a);
  checkNode(t, b);
  if (a === b) throw new RangeError(`cannot swap node ${a} with itself`);
  const p = t.parent[a];
  if (p < 0 || t.parent[b] !== p) throw new RangeError(`nodes ${a} and ${b} are not siblings`);
  const order: number[] = [];
  for (let c = t.firstChild[p]; c >= 0; c = t.nextSibling[c]) order.push(c === a ? b : c === b ? a : c);
  return reorder(t, p, order);
}
