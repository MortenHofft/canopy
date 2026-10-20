// Rooting: reroot on an edge, midpoint root. Both rewrite which edges point away from the root, so supports move with
// their edges (a support value describes the bipartition of the edge above a node) and names stay with their nodes.

import { addLen, checkNode, draftOf, identity, linkChildren, result } from './draft.ts';
import { compose, splitInternalLabel, supportPart } from './labels.ts';
import type { OpResult, TreeInput } from './types.ts';

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
export function reroot(t: TreeInput, node: number, o: RerootOptions = {}): OpResult {
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
function distancesFrom(t: TreeInput, src: number): Float64Array {
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
function farthestTip(t: TreeInput, dist: Float64Array): number {
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
export function midpointRoot(t: TreeInput): OpResult & { info: MidpointInfo } {
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
