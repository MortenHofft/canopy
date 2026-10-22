// Carrying per-node state (colours, collapsed clades, a focus, a selection) across an operation. An operation returns `map`
// (old node -> new node, -1 removed); a clade is not a node that survives but a set of tips, so `followClade` finds the clade
// the surviving tips form. `invertMap` and `composeMaps` turn maps around and chain them. Reads TreeInput only, no recursion.

import { checkNode } from './draft.ts';
import type { TreeArrays } from './types.ts';

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
  /** Tips of `after` that stand for the clade's parts: its surviving tips, and a collapsed clade inside it (now one tip) once. */
  tipsAfter: number;
}

const isTip = (t: TreeArrays, v: number) => t.subtreeEnd[v] === v + 1;

/** The deepest node of `after` whose tip range holds the ranks `first` (the node of the lowest-ranked tip) to `hi`, as a result:
 *  a clade when it holds exactly `n` tips, else a split. */
function resolve(after: TreeArrays, map: Int32Array, node: number, first: number, hi: number, n: number, o?: FollowOptions): Followed {
  if (n === 0) return { node: -1, split: false }; // nothing survives
  let m = first;
  while (after.leafEnd[m] <= hi) m = after.parent[m];
  if (after.leafEnd[m] - after.leafStart[m] === n) return { node: m, split: false };
  return { node: o?.onSplit === 'keep' ? map[node] : -1, split: true };
}

/**
 * Where clade `node` of `before` is in `after`, an operation's result with node map `map`: the clade its surviving tips form.
 * `split` when they no longer form one clade (a reroot inside it); `node` is then -1, or `map[node]` with `{ onSplit: 'keep' }`.
 * `node` is -1 and `split` false when nothing survives. The tips are counted as `after` has them: a clade that `collapseClades`
 * turned into a tip counts once, so it follows to itself, and a clade that contains one follows correctly. A clade whose tips
 * stay together is found whatever else changed (ladderise, a reroot elsewhere, collapsing weak branches). O(nodes of the clade)
 * plus the walk up. `before` and `after` can be an operation's `tree` (`TreeArrays`) or a `TreeInput`.
 */
export function followClade(before: TreeArrays, after: TreeArrays, map: Int32Array, node: number, o?: FollowOptions): FollowedClade {
  checkNode(before, node);
  let first = -1,
    lo = after.tipCount,
    hi = -1,
    n = 0;
  for (let v = node; v < before.subtreeEnd[node]; v++) {
    const w = map[v];
    if (w < 0 || !isTip(after, w)) continue;
    const r = after.leafStart[w];
    if (r < lo) {
      lo = r;
      first = w;
    }
    if (r > hi) hi = r;
    n++;
  }
  return { ...resolve(after, map, node, first, hi, n, o), tipsBefore: before.leafEnd[node] - before.leafStart[node], tipsAfter: n };
}

/**
 * `followClade` for many clades (colours, collapsed sets, a selection), in the order of `nodes`. One reverse pass over `before`
 * gathers every node's lowest and highest surviving rank and count, so the cost is O(nodes of `before`) however many or nested
 * the clades are.
 */
export function followClades(before: TreeArrays, after: TreeArrays, map: Int32Array, nodes: Iterable<number>, o?: FollowOptions): Followed[] {
  const nb = before.nodeCount;
  const first = new Int32Array(nb).fill(-1); // node of `after` holding the lowest rank below each node
  const lo = new Int32Array(nb).fill(after.tipCount);
  const hi = new Int32Array(nb).fill(-1);
  const cnt = new Int32Array(nb);
  for (let v = nb - 1; v >= 0; v--) {
    const w = map[v];
    if (w >= 0 && isTip(after, w)) {
      lo[v] = after.leafStart[w];
      first[v] = w;
      hi[v] = lo[v];
      cnt[v] = 1;
    }
    const p = before.parent[v];
    if (p < 0 || cnt[v] === 0) continue;
    if (lo[v] < lo[p]) {
      lo[p] = lo[v];
      first[p] = first[v];
    }
    if (hi[v] > hi[p]) hi[p] = hi[v];
    cnt[p] += cnt[v];
  }
  const out: Followed[] = [];
  for (const node of nodes) {
    checkNode(before, node);
    out.push(resolve(after, map, node, first[node], hi[node], cnt[node], o));
  }
  return out;
}

/** The other direction of a node map: new node -> old node, -1 for nodes the operation added (and for none other). Throws `RangeError` when `map` names a node beyond `newNodeCount`. */
export function invertMap(map: Int32Array, newNodeCount: number): Int32Array {
  const inv = new Int32Array(newNodeCount).fill(-1);
  for (let i = 0; i < map.length; i++) {
    if (map[i] >= newNodeCount) throw new RangeError(`map[${i}] = ${map[i]} is not a node of a tree with ${newNodeCount} nodes`);
    if (map[i] >= 0) inv[map[i]] = i;
  }
  return inv;
}

/** Two maps as one: old -> newer through both, -1 when `a` removed the node or `b` removed what `a` sent it to. Throws `RangeError` when `a` names a node `b` does not have. */
export function composeMaps(a: Int32Array, b: Int32Array): Int32Array {
  const out = new Int32Array(a.length);
  for (let i = 0; i < a.length; i++) {
    if (a[i] >= b.length) throw new RangeError(`a[${i}] = ${a[i]} is not in the second map (length ${b.length})`);
    out[i] = a[i] >= 0 ? b[a[i]] : -1;
  }
  return out;
}
