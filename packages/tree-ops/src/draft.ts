// The draft every operation edits and the builder that turns it back into preorder arrays. A draft is the input tree with
// its child lists as linked lists and room for added nodes; operations rewire parent / child links, lengths and labels, and
// build() renumbers the reachable nodes in preorder and recomputes subtree and tip ranges in two O(n) passes.

import { splitInternalLabel, supportPart } from './labels.ts';
import type { OpResult, TreeArrays, TreeInput } from './types.ts';

/** A tree under construction: any node numbering, children as linked lists. Nodes not reachable from `root` are dropped. */
export interface Draft {
  n: number;
  root: number;
  parent: Int32Array;
  firstChild: Int32Array;
  nextSibling: Int32Array;
  length: Float64Array;
  label: string[]; // as in TreeInput.labels: tip label, or internal label (support and/or name)
  support: Float64Array; // NaN when none
}

/** The input tree as a draft with room for `extra` added nodes. */
export function draftOf(t: TreeInput, extra = 0): Draft {
  const n = t.nodeCount + extra;
  const parent = new Int32Array(n).fill(-1);
  parent.set(t.parent);
  parent[0] = -1;
  const firstChild = new Int32Array(n).fill(-1);
  firstChild.set(t.firstChild);
  const nextSibling = new Int32Array(n).fill(-1);
  nextSibling.set(t.nextSibling);
  const length = new Float64Array(n).fill(NaN);
  length.set(t.length);
  const label = t.labels.slice();
  for (let i = t.nodeCount; i < n; i++) label.push('');
  const support = new Float64Array(n).fill(NaN);
  support.set(t.support);
  return { n, root: 0, parent, firstChild, nextSibling, length, label, support };
}

/** Child lists from a parent array: children of each node in the order they appear in `order`. */
export function linkChildren(d: Draft, order: ArrayLike<number>): void {
  d.firstChild.fill(-1);
  d.nextSibling.fill(-1);
  const last = new Int32Array(d.n).fill(-1);
  for (let k = 0; k < order.length; k++) {
    const c = order[k];
    const p = d.parent[c];
    if (p < 0) continue;
    if (last[p] < 0) d.firstChild[p] = c;
    else d.nextSibling[last[p]] = c;
    last[p] = c;
  }
}

/** Draft -> TreeArrays in preorder. Returns the model and draft id -> new index (-1 when not reachable from the root). */
function build(d: Draft, keepRoot: boolean): { tree: TreeArrays; index: Int32Array } {
  const index = new Int32Array(d.n).fill(-1);
  let count = 0;
  // pass 1: preorder numbering (walk with firstChild / nextSibling / parent, no stack)
  const order: number[] = [];
  for (let v = d.root; ;) {
    index[v] = count++;
    order.push(v);
    if (d.firstChild[v] >= 0) {
      v = d.firstChild[v];
      continue;
    }
    while (v !== d.root && d.nextSibling[v] < 0) v = d.parent[v];
    if (v === d.root) break;
    v = d.nextSibling[v];
  }
  const parent = new Int32Array(count);
  const subtreeEnd = new Int32Array(count);
  const depth = new Int32Array(count);
  const length = new Float64Array(count);
  const support = new Float64Array(count);
  const leafStart = new Int32Array(count);
  const leafEnd = new Int32Array(count);
  const labels: string[] = new Array(count);
  let tips = 0;
  for (let k = 0; k < count; k++) {
    const v = order[k];
    const p = k === 0 ? -1 : index[d.parent[v]];
    parent[k] = p;
    depth[k] = p < 0 ? 0 : depth[p] + 1;
    length[k] = k === 0 && !keepRoot ? NaN : d.length[v];
    const isTip = d.firstChild[v] < 0;
    // a support value at the root describes no edge: keep only the name
    // (in `support` or only in the label: both are read, as in reroot)
    const rootSupport = k === 0 && !keepRoot && !isTip && (!Number.isNaN(d.support[v]) || !Number.isNaN(splitInternalLabel(d.label[v]).support));
    labels[k] = rootSupport ? supportPart(d.label[v], false).name : d.label[v];
    support[k] = rootSupport || isTip ? NaN : d.support[v];
    subtreeEnd[k] = k + 1;
    if (isTip) {
      leafStart[k] = tips;
      leafEnd[k] = ++tips;
    } else {
      leafStart[k] = 0x7fffffff;
      leafEnd[k] = -1;
    }
  }
  for (let k = count - 1; k > 0; k--) {
    const p = parent[k];
    if (subtreeEnd[k] > subtreeEnd[p]) subtreeEnd[p] = subtreeEnd[k];
    if (leafStart[k] < leafStart[p]) leafStart[p] = leafStart[k];
    if (leafEnd[k] > leafEnd[p]) leafEnd[p] = leafEnd[k];
  }
  return { tree: { nodeCount: count, tipCount: tips, parent, subtreeEnd, depth, length, support, leafStart, leafEnd, labels }, index };
}

/** `keepRoot`: the root keeps its label, support and length (order-only operations change nothing else). */
export function result(t: TreeInput, d: Draft, keepRoot = false): OpResult {
  const { tree, index } = build(d, keepRoot);
  return { tree, map: index.slice(0, t.nodeCount), changed: true };
}

/** The input unchanged (an operation with nothing to do). */
export function identity(t: TreeInput): OpResult {
  const map = new Int32Array(t.nodeCount);
  for (let i = 0; i < map.length; i++) map[i] = i;
  return { tree: t, map, changed: false };
}

/** Sum of two lengths where a missing one counts as 0, NaN only if both are missing. */
export function addLen(a: number, b: number): number {
  if (Number.isNaN(a)) return b;
  if (Number.isNaN(b)) return a;
  return a + b;
}

export function checkNode(t: TreeArrays, v: number): void {
  if (!Number.isInteger(v) || v < 0 || v >= t.nodeCount) throw new RangeError(`node ${v} is not in the tree (0..${t.nodeCount - 1})`);
}
