// Tree operations a user can apply to a tree in the viewer: rerooting, midpoint rooting, ladderising, rotating a node,
// collapsing weakly supported or short branches, pruning to a set of tips and taking a clade as its own tree. Every
// operation is a pure function: it returns a NEW TreeModel (the input is untouched, so "reset" is keeping the original)
// plus `map`, old node index -> new node index (-1 when the node is gone), so callers can carry selections and clade
// colours across. All passes are iterative and O(n) (ladderise: O(n log k) for k children); measured in docs/results/tree-ops.md.
//
// Conventions:
//  * A support value describes the EDGE above a node (the bipartition it splits off), a name describes the NODE. When an
//    edge is reversed by rerooting, the support moves with the edge and the name stays with the node. Labels like
//    '98.0:c__X' (GTDB) are split and recomposed; a label that is only a name or only a number is kept as written.
//  * Missing lengths stay missing (NaN); when two edges are merged, a missing length counts as 0 unless both are missing.
//  * Distances (midpoint) count missing and negative lengths as 0, as the layout does.
//  * In-memory trees only: a partially loaded source (src/parquet) has no whole tree to rewrite.

import { TreeModel, splitInternalLabel, type RawTree } from './tree.ts';

export interface OpResult {
  tree: TreeModel;
  /** old node index -> new node index, -1 for nodes that were removed. A node added by the operation (the new root of
   *  reroot) is not in the map. */
  map: Int32Array;
}

// ------------------------------------------------------------------------------------------ draft and builder

/** A tree under construction: any node numbering, children as linked lists. Nodes not reachable from `root` are dropped. */
interface Draft {
  n: number;
  root: number;
  parent: Int32Array;
  firstChild: Int32Array;
  nextSibling: Int32Array;
  length: Float64Array;
  label: string[]; // as in TreeModel.labels: tip label, or internal label (support and/or name)
  support: Float64Array; // NaN when none
}

function supportPart(label: string, isTip: boolean): { support: string; name: string } {
  if (isTip) return { support: '', name: label };
  const { support, name } = splitInternalLabel(label);
  if (support !== support) return { support: '', name: label };
  return { support: (name ? label.slice(0, label.lastIndexOf(name) - 1) : label).trim(), name };
}

/** The input tree as a draft with room for `extra` added nodes. */
function draftOf(t: TreeModel, extra = 0): Draft {
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
function linkChildren(d: Draft, order: ArrayLike<number>): void {
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

const compose = (support: string, name: string): string => (support && name ? support + ':' + name : support || name);

/** Draft -> TreeModel in preorder. Returns the model and draft id -> new index (-1 when not reachable from the root). */
function build(d: Draft): { tree: TreeModel; index: Int32Array } {
  const index = new Int32Array(d.n).fill(-1);
  let count = 0;
  // pass 1: preorder numbering (walk with firstChild / nextSibling / parent, no stack)
  const order: number[] = [];
  for (let v = d.root; ; ) {
    index[v] = count++;
    order.push(v);
    if (d.firstChild[v] >= 0) { v = d.firstChild[v]; continue; }
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
    length[k] = k === 0 ? NaN : d.length[v];
    const isTip = d.firstChild[v] < 0;
    // a support value at the root describes no edge: keep only the name
    const rootSupport = k === 0 && !isTip && d.support[v] === d.support[v];
    labels[k] = rootSupport ? supportPart(d.label[v], false).name : d.label[v];
    support[k] = rootSupport || isTip ? NaN : d.support[v];
    subtreeEnd[k] = k + 1;
    if (isTip) { leafStart[k] = tips; leafEnd[k] = ++tips; } else { leafStart[k] = 0x7fffffff; leafEnd[k] = -1; }
  }
  for (let k = count - 1; k > 0; k--) {
    const p = parent[k];
    if (subtreeEnd[k] > subtreeEnd[p]) subtreeEnd[p] = subtreeEnd[k];
    if (leafStart[k] < leafStart[p]) leafStart[p] = leafStart[k];
    if (leafEnd[k] > leafEnd[p]) leafEnd[p] = leafEnd[k];
  }
  const raw: RawTree = { nodeCount: count, tipCount: tips, parent, subtreeEnd, depth, length, support, leafStart, leafEnd, labels };
  return { tree: new TreeModel(raw), index };
}

function result(t: TreeModel, d: Draft): OpResult {
  const { tree, index } = build(d);
  return { tree, map: index.slice(0, t.nodeCount) };
}

/** Sum of two lengths where a missing one counts as 0, NaN only if both are missing. */
function addLen(a: number, b: number): number {
  if (a !== a) return b;
  if (b !== b) return a;
  return a + b;
}

function checkNode(t: TreeModel, v: number): void {
  if (!Number.isInteger(v) || v < 0 || v >= t.nodeCount) throw new RangeError(`node ${v} is not in the tree (0..${t.nodeCount - 1})`);
}

// ------------------------------------------------------------------------------------------ rooting

export interface RerootOptions {
  /** Where on the edge above `node` the new root goes, as a fraction of the edge length measured from `node` (0 = at the node,
   *  1 = at its parent). Default 0.5. */
  at?: number;
}

/**
 * Reroot on the edge above `node`: a new root node splits that edge, and every edge on the path from `node` to the old root
 * is reversed. The old root is removed if it is left with one child (its two edges merge), as most tools do. Rerooting on a
 * child of the root changes only where the root sits on the root edge.
 */
export function reroot(t: TreeModel, node: number, o: RerootOptions = {}): OpResult {
  checkNode(t, node);
  const at = o.at ?? 0.5;
  if (!(at >= 0 && at <= 1)) throw new RangeError(`at must be in [0, 1], got ${at}`);
  if (node === 0) throw new RangeError('cannot reroot above the root');
  const n = t.nodeCount;
  const R = n; // the new root
  const d = draftOf(t, 1);
  const oldParent = t.parent;
  // path from node to the old root
  const path: number[] = [];
  for (let u = node; u >= 0; u = oldParent[u]) path.push(u);
  const len = t.length[node];
  // supports move with their edges; labels are split and recomposed only for the nodes whose edge changes
  const edgeSupport = new Map<number, string>(); // node -> support text of its new edge
  const supText = (i: number) => supportPart(t.labels[i], t.childCount[i] === 0).support;
  const sup = supText(node);
  // reversed: path[k+1] becomes a child of path[k] and takes the edge (length, support) that was above path[k]
  for (let k = path.length - 1; k >= 2; k--) {
    const below = path[k - 1], u = path[k];
    d.parent[u] = below;
    d.length[u] = t.length[below];
    edgeSupport.set(u, supText(below));
  }
  d.parent[R] = -1;
  d.length[R] = NaN;
  d.root = R;
  d.parent[node] = R;
  d.length[node] = len * at;
  const p1 = path[1];
  d.parent[p1] = R;
  d.length[p1] = len * (1 - at);
  edgeSupport.set(p1, sup); // both halves of the split edge carry the same bipartition
  // children order: new root -> [node, p1]; everywhere else the original order, with the reversed edge last
  const late = new Uint8Array(n + 1);
  for (let k = 2; k < path.length; k++) late[path[k]] = 1;
  // the old root left with one child is suppressed: that child takes its place (and its edge)
  const oldRoot = path[path.length - 1];
  if (path.length > 2 && t.childCount[oldRoot] === 2) {
    const keep = t.firstChild[oldRoot] === path[path.length - 2] ? t.nextSibling[t.firstChild[oldRoot]] : t.firstChild[oldRoot];
    d.parent[keep] = d.parent[oldRoot];
    d.length[keep] = addLen(t.length[keep], d.length[oldRoot]);
    if (!supText(keep)) edgeSupport.set(keep, edgeSupport.get(oldRoot) ?? '');
    d.parent[oldRoot] = -1;
    late[keep] = 1;
  } else if (path.length === 2 && t.childCount[oldRoot] === 2) {
    // rerooting on a child of a binary root: the old root keeps one child and is suppressed as well
    const keep = t.firstChild[oldRoot] === node ? t.nextSibling[node] : t.firstChild[oldRoot];
    d.parent[keep] = R;
    d.length[keep] = addLen(t.length[keep], d.length[oldRoot]);
    if (!supText(keep)) edgeSupport.set(keep, sup);
    d.parent[oldRoot] = -1;
    late[keep] = 1;
  }
  for (const [u, text] of edgeSupport) {
    if (t.childCount[u] === 0) continue; // a tip's edge carries no support in Newick
    d.label[u] = compose(text, supportPart(t.labels[u], t.childCount[u] === 0).name);
    d.support[u] = text ? splitInternalLabel(text).support : NaN;
  }
  const order: number[] = [node];
  for (let i = 0; i < n; i++) if (!late[i] && i !== node) order.push(i);
  for (let i = 0; i < n; i++) if (late[i] && i !== node) order.push(i);
  linkChildren(d, order);
  return result(t, d);
}

/** Distances from `src` to every node over the unrooted tree, counting missing and negative lengths as 0. O(n). */
function distancesFrom(t: TreeModel, src: number): Float64Array {
  const n = t.nodeCount;
  const dist = new Float64Array(n).fill(-1);
  const stack = new Int32Array(n);
  let sp = 0;
  dist[src] = 0;
  stack[sp++] = src;
  const w = (i: number) => { const l = t.length[i]; return l > 0 ? l : 0; };
  while (sp) {
    const v = stack[--sp];
    const p = t.parent[v];
    if (v > 0 && dist[p] < 0) { dist[p] = dist[v] + w(v); stack[sp++] = p; }
    for (let c = t.firstChild[v]; c >= 0; c = t.nextSibling[c]) if (dist[c] < 0) { dist[c] = dist[v] + w(c); stack[sp++] = c; }
  }
  return dist;
}

/** Farthest tip from a distance array (first in tip order on ties). */
function farthestTip(t: TreeModel, dist: Float64Array): number {
  let best = t.tipNode[0];
  for (let r = 1; r < t.tipCount; r++) { const v = t.tipNode[r]; if (dist[v] > dist[best]) best = v; }
  return best;
}

export interface MidpointInfo {
  /** The two tips farthest apart (node indexes in the INPUT tree) and their distance. */
  tips: [number, number];
  diameter: number;
}

/**
 * Midpoint rooting: root the tree halfway along the longest tip-to-tip path. Needs branch lengths. Two O(n) distance passes
 * find the path (the farthest tip from any tip is one end of it), then the edge holding the midpoint is rerooted.
 */
export function midpointRoot(t: TreeModel): OpResult & { info: MidpointInfo } {
  if (!t.hasLengths) throw new Error('midpoint rooting needs branch lengths');
  if (t.tipCount < 2) throw new Error('midpoint rooting needs at least two tips');
  const b = farthestTip(t, distancesFrom(t, t.tipNode[0]));
  const dB = distancesFrom(t, b);
  const c = farthestTip(t, dB);
  const dC = distancesFrom(t, c);
  const D = dB[c];
  const half = D / 2;
  const info: MidpointInfo = { tips: [b, c], diameter: D };
  if (!(D > 0)) throw new Error('all tip-to-tip distances are 0');
  const eps = 1e-12 * D;
  const onPath = (u: number) => Math.abs(dB[u] + dC[u] - D) <= eps * 10;
  // the b-c path climbs from each end to their MRCA; the midpoint is on one of the two climbs
  for (const [end, dist] of [[c, dC], [b, dB]] as const) {
    let v = end;
    while (v > 0 && onPath(t.parent[v]) && dist[t.parent[v]] < half - eps) v = t.parent[v];
    const p = t.parent[v];
    if (v > 0 && onPath(p) && dist[p] >= half - eps) {
      const w = t.length[v] > 0 ? t.length[v] : 0;
      const at = w > 0 ? Math.min(1, Math.max(0, (half - dist[v]) / w)) : 0;
      if (at >= 1 - 1e-12 && p === 0) return { ...identity(t), info }; // the midpoint is the current root
      return { ...reroot(t, v, { at }), info };
    }
  }
  throw new Error('midpoint not found (inconsistent distances)');
}

function identity(t: TreeModel): OpResult {
  const map = new Int32Array(t.nodeCount);
  for (let i = 0; i < map.length; i++) map[i] = i;
  return { tree: t, map };
}

// ------------------------------------------------------------------------------------------ order (display only)

export interface LadderiseOptions {
  /** 'increasing' (default): smaller clades first (top in a rectangular layout), as FigTree's "increasing" order. */
  order?: 'increasing' | 'decreasing';
}

/** Sort the children of every node by number of descendant tips (stable on ties). Changes only the display order. */
export function ladderise(t: TreeModel, o: LadderiseOptions = {}): OpResult {
  const sign = o.order === 'decreasing' ? -1 : 1;
  const d = draftOf(t);
  const size = (i: number) => t.leafEnd[i] - t.leafStart[i];
  const kids: number[] = [];
  for (let v = 0; v < t.nodeCount; v++) {
    if (t.childCount[v] < 2) continue;
    kids.length = 0;
    for (let c = t.firstChild[v]; c >= 0; c = t.nextSibling[c]) kids.push(c);
    kids.sort((a, b) => sign * (size(a) - size(b)) || a - b);
    d.firstChild[v] = kids[0];
    for (let k = 0; k < kids.length; k++) d.nextSibling[kids[k]] = k + 1 < kids.length ? kids[k + 1] : -1;
  }
  return result(t, d);
}

/** Reverse the order of the children of `node` (swap the two sides of a bifurcation). Display only. */
export function rotate(t: TreeModel, node: number): OpResult {
  checkNode(t, node);
  const d = draftOf(t);
  const kids = t.children(node).reverse();
  if (kids.length < 2) return identity(t);
  d.firstChild[node] = kids[0];
  for (let k = 0; k < kids.length; k++) d.nextSibling[kids[k]] = k + 1 < kids.length ? kids[k + 1] : -1;
  return result(t, d);
}

// ------------------------------------------------------------------------------------------ edges and subsets

/** Contract every internal non-root edge for which `drop(node)` is true: the node's children join its parent, in its place.
 *  The contracted edge's length is lost, as when a branch collapses into a polytomy (ape di2multi, ETE delete). */
function contract(t: TreeModel, drop: (i: number) => boolean): OpResult {
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
export function collapseBySupport(t: TreeModel, threshold: number): OpResult {
  return contract(t, (i) => t.support[i] < threshold);
}

/** Collapse internal edges shorter than `minLength` (missing lengths are kept). */
export function collapseShortBranches(t: TreeModel, minLength: number): OpResult {
  return contract(t, (i) => t.length[i] < minLength);
}

/**
 * Keep only the tips for which `keep(rank)` is true and the nodes that join them. Nodes left with one child are removed and
 * their edges merged, and edges above the new root are dropped. Throws if no tip is kept.
 */
export function prune(t: TreeModel, keep: (tipRank: number) => boolean): OpResult {
  const n = t.nodeCount;
  const present = new Int32Array(n); // number of children (or the tip itself) with kept tips below
  for (let r = 0; r < t.tipCount; r++) if (keep(r)) present[t.tipNode[r]] = 1;
  const kids = new Int32Array(n);
  for (let i = n - 1; i > 0; i--) if (present[i] > 0 || kids[i] > 0) kids[t.parent[i]]++;
  const d = draftOf(t);
  const anc = new Int32Array(n).fill(-1); // nearest kept ancestor-or-self
  const acc = new Float64Array(n).fill(NaN); // length from that ancestor down to here
  let root = -1;
  for (let i = 0; i < n; i++) {
    const has = t.childCount[i] === 0 ? present[i] > 0 : kids[i] > 0;
    d.parent[i] = -1;
    if (!has) continue;
    const up = i === 0 ? -1 : anc[t.parent[i]];
    const l = i === 0 ? NaN : addLen(acc[t.parent[i]], t.length[i]);
    const kept = t.childCount[i] === 0 || kids[i] >= 2;
    if (kept) {
      d.parent[i] = up;
      d.length[i] = up < 0 ? NaN : l;
      if (up < 0) root = i;
      anc[i] = i;
      acc[i] = NaN;
    } else {
      anc[i] = up;
      acc[i] = up < 0 ? NaN : l;
    }
  }
  if (root < 0) throw new Error('prune: no tips kept');
  d.root = root;
  const order = new Int32Array(n);
  for (let i = 0; i < n; i++) order[i] = i;
  linkChildren(d, order);
  return result(t, d);
}

/** The clade below `node` as a tree of its own (the edge above it is dropped). */
export function subtree(t: TreeModel, node: number): OpResult {
  checkNode(t, node);
  const d = draftOf(t);
  d.root = node;
  d.parent[node] = -1;
  // a subtree is a contiguous preorder range: nodes outside it are simply not reached by the builder
  return result(t, d);
}
