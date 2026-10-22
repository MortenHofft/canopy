// Display order: ladderise and rotate change only the order of children, never the topology or lengths.

import { checkNode, draftOf, identity, result } from './draft.ts';
import type { OpResult, TreeInput } from './types.ts';

export interface LadderiseOptions {
  /** 'increasing' (default): smaller clades first (top in a rectangular layout), as FigTree's "increasing" order. */
  order?: 'increasing' | 'decreasing';
}

/** Sort the children of every node by number of descendant tips (stable on ties). Changes only the display order. */
export function ladderise(t: TreeInput, o: LadderiseOptions = {}): OpResult {
  const sign = o.order === 'decreasing' ? -1 : 1;
  const d = draftOf(t);
  const size = (i: number) => t.leafEnd[i] - t.leafStart[i];
  const kids: number[] = [];
  let moved = false;
  for (let v = 0; v < t.nodeCount; v++) {
    if (t.childCount[v] < 2) continue;
    kids.length = 0;
    for (let c = t.firstChild[v]; c >= 0; c = t.nextSibling[c]) kids.push(c);
    kids.sort((a, b) => sign * (size(a) - size(b)) || a - b);
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
