// Carrying per-node state (colours, collapsed clades, a focus, a selection) across an operation. An operation returns `map`
// (old node -> new node, -1 removed); a clade is not a node that survives but a set of tips, so `followClade` finds the clade
// the surviving tips form. `invertMap` and `composeMaps` turn maps around and chain them. Reads TreeInput only, no recursion.

import { checkNode } from './draft.ts';
import type { TreeInput } from './types.ts';

export interface FollowOptions {
  /** What a clade whose surviving tips no longer form one clade (a reroot inside it) becomes: -1 ('drop', default), or the node
   *  that was there, `map[node]` ('keep'; it now holds other tips, so tell the user). */
  onSplit?: 'drop' | 'keep';
}

export interface Followed {
  /** The clade in `after`, or -1. */
  node: number;
  /** The surviving tips are not one clade of `after`. */
  split: boolean;
}

export interface FollowedClade extends Followed {
  /** Tips of the clade in `before`. */
  tipsBefore: number;
  /** Of those, the tips that survive in `after`. */
  tipsAfter: number;
}

/** The clade `node` of `before` as the deepest `after` node whose tips contain all `n` surviving tips (given the smallest and largest
 *  of their ranks in `after`), or a split result. */
function resolve(after: TreeInput, map: Int32Array, node: number, lo: number, hi: number, n: number, o?: FollowOptions): Followed {
  if (n === 0) return { node: -1, split: false }; // every tip is gone
  // the MRCA is the deepest node whose tip range [leafStart, leafEnd) holds [lo, hi]: walk up from the first tip
  let m = after.tipNode[lo];
  while (after.leafEnd[m] <= hi) m = after.parent[m];
  if (after.leafEnd[m] - after.leafStart[m] === n) return { node: m, split: false };
  return { node: o?.onSplit === 'keep' ? map[node] : -1, split: true };
}

/**
 * Where clade `node` of `before` is in `after`, an operation's result with node map `map`: the clade its surviving tips form.
 * `split` when they no longer form one clade (a reroot inside it); `node` is then -1, or `map[node]` with `{ onSplit: 'keep' }`.
 * `node` is -1 and `split` false when no tip survives. A clade whose tips all survive in one clade is found whatever else changed
 * (ladderise, rotate, a reroot elsewhere, collapsing weak branches). O(tips of the clade) plus the walk up.
 */
export function followClade(before: TreeInput, after: TreeInput, map: Int32Array, node: number, o?: FollowOptions): FollowedClade {
  checkNode(before, node);
  const tipsBefore = before.leafEnd[node] - before.leafStart[node];
  let lo = after.tipCount,
    hi = -1,
    n = 0;
  for (let rk = before.leafStart[node]; rk < before.leafEnd[node]; rk++) {
    const v = map[before.tipNode[rk]];
    if (v < 0) continue;
    const r = after.leafStart[v];
    if (r < lo) lo = r;
    if (r > hi) hi = r;
    n++;
  }
  return { ...resolve(after, map, node, lo, hi, n, o), tipsBefore, tipsAfter: n };
}

/**
 * `followClade` for many clades (colours, collapsed sets, a selection), in the order of `nodes`. The new rank of every tip is
 * worked out once, so each clade then costs its own tip count in array reads.
 */
export function followClades(before: TreeInput, after: TreeInput, map: Int32Array, nodes: Iterable<number>, o?: FollowOptions): Followed[] {
  const rank = new Int32Array(before.tipCount); // old tip rank -> new tip rank, -1 when the tip is gone
  for (let rk = 0; rk < before.tipCount; rk++) {
    const v = map[before.tipNode[rk]];
    rank[rk] = v < 0 ? -1 : after.leafStart[v];
  }
  const out: Followed[] = [];
  for (const node of nodes) {
    checkNode(before, node);
    let lo = after.tipCount,
      hi = -1,
      n = 0;
    for (let rk = before.leafStart[node]; rk < before.leafEnd[node]; rk++) {
      const r = rank[rk];
      if (r < 0) continue;
      if (r < lo) lo = r;
      if (r > hi) hi = r;
      n++;
    }
    out.push(resolve(after, map, node, lo, hi, n, o));
  }
  return out;
}

/** The other direction of a node map: new node -> old node, -1 for nodes the operation added (and for none other). */
export function invertMap(map: Int32Array, newNodeCount: number): Int32Array {
  const inv = new Int32Array(newNodeCount).fill(-1);
  for (let i = 0; i < map.length; i++) if (map[i] >= 0) inv[map[i]] = i;
  return inv;
}

/** Two maps as one: old -> newer through both, -1 when `a` removed the node or `b` removed what `a` sent it to. */
export function composeMaps(a: Int32Array, b: Int32Array): Int32Array {
  const out = new Int32Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i] >= 0 ? b[a[i]] : -1;
  return out;
}
