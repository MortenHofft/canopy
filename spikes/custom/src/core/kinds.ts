// Primitive kinds of a draw-list entry and the polytomy-slice predicate; shared by the cut (lod.ts), the layout projections
// (projection.ts), the drawing and the hit index. Kept free of imports from those so none of them forms a cycle.

import type { TreeSnapshot } from './types.ts';

export const K_NODE = 0; // expanded internal node: branch + connector, children follow
export const K_TIP = 1;
export const K_SUMMARY = 2; // collapsed clade drawn as a triangle
export const K_STUB = 3; // collapsed or cut clade drawn as its branch only

/** Dedupe-key kind of a run slice (after K_NODE..K_STUB); never stored in a draw list. */
export const K_RUN = 4;

/** A collapsed clade whose children are all tips (a polytomy of at least this many) is drawn as a slice: the band from the
 *  node's depth to the longest tip over the clade's angles (radial) or rows (rectangular), not as a fan or triangle. */
export const SLICE_MIN_CHILDREN = 16;

export function isSlice(tree: TreeSnapshot, i: number): boolean {
  const c = tree.childCount[i];
  return (
    c >= SLICE_MIN_CHILDREN && tree.leafEnd[i] - tree.leafStart[i] === c && (tree.stub === undefined || tree.stub === null || tree.stub[i] === 0)
  );
}
