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
  return moved ? result(t, d) : identity(t);
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
  return result(t, d);
}
