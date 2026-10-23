// Unrooted layout, equal-angle (#42, spike). Not part of the viewer yet: no cut, LOD, hit-testing or `layout: 'unrooted'`; the note
// docs/design/unrooted.md has the pictures, the timings and the decision.
//
// Every tip gets the same share of the full circle, unit = 2pi / tips. A node's wedge is the angle of its tips, (tips below it) * unit,
// starting where the wedges of its earlier siblings end; the root's wedge is the whole circle. The branch to a node points along the middle
// of its wedge and is drawn at its length, so a node is its parent's point plus length * (cos, sin) of its wedge's middle angle.
//
// Why starting from the root is fine. At any node, the angle between two neighbouring edges (two children, or the last child and the edge
// back towards the root) is half the sum of the two components' tips, times unit. That only depends on the unrooted tree and the cyclic
// order of the neighbours, so the drawing is the same, up to a rotation, from whichever node it is started (a degree-2 root: its two edges
// are pi apart, a straight line through it). Started from a centroid node every wedge is at most pi, a convex cone, and each subtree stays
// inside its cone from its parent, so subtrees of siblings never overlap and no two branches cross. The same drawing started at the root
// therefore has no crossings either, although a wedge there can be wider than pi (test/unrooted.test.mjs checks crossings on random trees).
//
// Lengths. With `branchLengths` and a tree that has a positive length somewhere, a branch is its length; a missing (NaN) or negative length
// counts as 0, as in computeLayout, so that node sits on its parent. Otherwise (a cladogram, or a topology-only tree such as the OTL ones)
// every branch has length 1: equal-angle with unit lengths still separates the clades, it just says nothing about distances.
//
// One preorder pass over the arrays: no recursion, no per-node objects. Output: X, Y and the wedge start W0 (Float64Array each, 24 bytes per
// node); the wedge span is (leafEnd - leafStart) * unit, so it is not stored.

import type { TreeData } from './types.ts';

export interface UnrootedLayout {
  n: number;
  /** Node position in tree units (branch lengths, or 1 per branch), the root at (0, 0). Canvas orientation: angles clockwise from 3 o'clock
   *  when y points down. */
  X: Float64Array;
  Y: Float64Array;
  /** By node: where its wedge starts (rad); it spans (leafEnd - leafStart) * unit. The root's wedge is [0, 2pi). */
  W0: Float64Array;
  /** Angle per tip: 2pi / tips. */
  unit: number;
  /** false: every branch was drawn at length 1 (no lengths asked for, or none in the tree). */
  usedLengths: boolean;
  /** Bounding box of all nodes. */
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  layoutMs: number;
}

/** Equal-angle unrooted layout of `tree` (see the header). `branchLengths` false draws every branch at length 1. */
export function unrootedLayout(tree: TreeData, branchLengths = true): UnrootedLayout {
  const t0 = performance.now();
  const n = tree.nodeCount;
  const { firstChild, nextSibling, leafStart, leafEnd, length } = tree;
  const X = new Float64Array(n),
    Y = new Float64Array(n),
    W0 = new Float64Array(n);
  const unit = (2 * Math.PI) / Math.max(1, tree.tipCount);
  let usedLengths = false;
  if (branchLengths && tree.hasLengths)
    for (let i = 1; i < n; i++)
      if (length[i] > 0) {
        usedLengths = true;
        break;
      }
  let minX = 0,
    maxX = 0,
    minY = 0,
    maxY = 0;
  for (let i = 0; i < n; i++) {
    const x = X[i],
      y = Y[i];
    let a = W0[i];
    for (let c = firstChild[i]; c >= 0; c = nextSibling[c]) {
      const w = (leafEnd[c] - leafStart[c]) * unit;
      const mid = a + w / 2;
      let l = 1;
      if (usedLengths) l = length[c] > 0 ? length[c] : 0;
      const cx = x + l * Math.cos(mid),
        cy = y + l * Math.sin(mid);
      X[c] = cx;
      Y[c] = cy;
      W0[c] = a;
      if (cx < minX) minX = cx;
      else if (cx > maxX) maxX = cx;
      if (cy < minY) minY = cy;
      else if (cy > maxY) maxY = cy;
      a += w;
    }
  }
  return { n, X, Y, W0, unit, usedLengths, minX, maxX, minY, maxY, layoutMs: performance.now() - t0 };
}
