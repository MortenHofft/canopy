// Rooting: reroot on an edge, midpoint root. Both rewrite which edges point away from the root, so supports move with
// their edges (a support value describes the bipartition of the edge above a node) and names stay with their nodes.

import { addLen, checkNode, draftOf, identity, linkChildren, result } from './draft.ts';
import { compose, splitInternalLabel, supportPart } from './labels.ts';
import type { OpResult, TreeInput } from './types.ts';

export interface RerootOptions {
  /** Where on the edge above `node` the root goes, as a fraction of the edge length measured from `node`. Default 0.5.
   *  0 roots AT `node` (if it is internal; a tip cannot be the root, so a tip gets a zero-length edge), 1 roots at its parent:
   *  an existing node becomes the root and no node is added. */
  at?: number;
}

/**
 * Reroot on the edge above `node`: the root goes onto that edge (a new node splits it) or onto one of its ends, and every edge
 * between there and the old root is reversed. The old root is removed if it is left with one child (its two edges merge), as
 * most tools do; one-child nodes above it (a unary root edge) would become tips and are dropped. Rerooting on a child of the root changes only where the root sits on the
 * root edge; rooting where the root already is returns the input unchanged.
 */
export function reroot(t: TreeInput, node: number, o: RerootOptions = {}): OpResult {
  checkNode(t, node);
  const at = o.at ?? 0.5;
  if (!(at >= 0 && at <= 1)) throw new RangeError(`at must be in [0, 1], got ${at}`);
  if (node === 0) throw new RangeError('cannot reroot above the root');
  const n = t.nodeCount;
  // path from node to the old root
  const path: number[] = [];
  for (let u = node; u >= 0; u = t.parent[u]) path.push(u);
  // the new root: an existing node (path[s]) when `at` is at an end of the edge, otherwise a new node R above path[0]
  const atNode = at === 1 || (at === 0 && t.childCount[node] > 0);
  const s = at === 1 ? 1 : at === 0 && atNode ? 0 : 1; // path[k] for k > s get their edge reversed
  // a chain of one-child nodes at the top of the tree is the root's own edge: reversed, its nodes would become tips, so they
  // are dropped and the first node with two or more children acts as the old root
  let top = path.length - 1;
  while (top > s && t.childCount[path[top]] === 1) top--;
  const oldRoot = path[top];
  // already rooted there (above path[s] or on node's edge there is only the root's own chain of one-child nodes)
  if (atNode ? top === s : top === 1 && t.childCount[oldRoot] === 1) return identity(t);
  const R = n;
  const d = draftOf(t, atNode ? 0 : 1);
  // supports move with their edges; labels are split and recomposed only for the nodes whose edge changes
  const edgeSupport = new Map<number, string>(); // node -> support text of its new edge
  const supText = (i: number) => supportPart(t.labels[i], t.childCount[i] === 0).support;
  const sup = supText(node);
  // reversed: path[k] becomes a child of path[k-1] and takes the edge (length, support) that was above path[k-1]
  const late = new Uint8Array(n + 1); // children that go last in their new parent's list (the reversed edges)
  for (let k = path.length - 1; k > top; k--) d.parent[path[k]] = -1;
  for (let k = top; k > s; k--) {
    const below = path[k - 1],
      u = path[k];
    d.parent[u] = below;
    d.length[u] = t.length[below];
    edgeSupport.set(u, supText(below));
    late[u] = 1;
  }
  if (atNode) {
    d.root = path[s];
    d.parent[d.root] = -1;
    d.length[d.root] = NaN;
  } else {
    d.parent[R] = -1;
    d.length[R] = NaN;
    d.root = R;
    const len = t.length[node];
    d.parent[node] = R;
    d.length[node] = len * at;
    d.parent[path[1]] = R;
    d.length[path[1]] = len * (1 - at);
    edgeSupport.set(path[1], sup); // both halves of the split edge carry the same bipartition
  }
  // the old root, now hanging below the root, lost one child to the path: with two children it is left with one and suppressed
  if (top > s) {
    if (t.childCount[oldRoot] === 2) {
      const keep = t.firstChild[oldRoot] === path[top - 1] ? t.nextSibling[t.firstChild[oldRoot]] : t.firstChild[oldRoot];
      d.parent[keep] = d.parent[oldRoot];
      d.length[keep] = addLen(t.length[keep], d.length[oldRoot]);
      if (!supText(keep)) edgeSupport.set(keep, edgeSupport.get(oldRoot) ?? '');
      late[keep] = 1;
      d.parent[oldRoot] = -1;
    }
  } else if (!atNode && t.childCount[oldRoot] === 2) {
    // the old root is path[1], a child of the new node R (rerooting on a child of a binary root): suppressed as well
    const keep = t.firstChild[oldRoot] === node ? t.nextSibling[node] : t.firstChild[oldRoot];
    d.parent[keep] = R;
    d.length[keep] = addLen(t.length[keep], d.length[oldRoot]);
    if (!supText(keep)) edgeSupport.set(keep, sup);
    late[keep] = 1;
    d.parent[oldRoot] = -1;
  }
  for (const [u, text] of edgeSupport) {
    if (t.childCount[u] === 0) continue; // a tip's edge carries no support in Newick
    d.label[u] = compose(text, supportPart(t.labels[u], false).name);
    d.support[u] = text ? splitInternalLabel(text).support : NaN;
  }
  // children order: a new root gets [node, path[1]]; everywhere else the original order, with the reversed edge last
  const order: number[] = atNode ? [] : [node];
  for (let i = 0; i < n; i++) if (!late[i] && (atNode || i !== node)) order.push(i);
  for (let i = 0; i < n; i++) if (late[i]) order.push(i);
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
  const w = (i: number) => {
    const l = t.length[i];
    return l > 0 ? l : 0;
  };
  while (sp) {
    const v = stack[--sp];
    const p = t.parent[v];
    if (v > 0 && dist[p] < 0) {
      dist[p] = dist[v] + w(v);
      stack[sp++] = p;
    }
    for (let c = t.firstChild[v]; c >= 0; c = t.nextSibling[c])
      if (dist[c] < 0) {
        dist[c] = dist[v] + w(c);
        stack[sp++] = c;
      }
  }
  return dist;
}

/** Farthest tip from a distance array (first in tip order on ties). */
function farthestTip(t: TreeInput, dist: Float64Array): number {
  let best = t.tipNode[0];
  for (let r = 1; r < t.tipCount; r++) {
    const v = t.tipNode[r];
    if (dist[v] > dist[best]) best = v;
  }
  return best;
}

/** Relative to the diameter: how close to a node a midpoint must be to count as on it (see midpointRoot). */
const SNAP = 1e-6;

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
  for (const [end, dist] of [
    [c, dC],
    [b, dB],
  ] as const) {
    let v = end;
    while (v > 0 && onPath(t.parent[v]) && dist[t.parent[v]] < half - eps) v = t.parent[v];
    const p = t.parent[v];
    if (v > 0 && onPath(p) && dist[p] >= half - eps) {
      const w = t.length[v] > 0 ? t.length[v] : 0;
      const above = Math.min(w, Math.max(0, half - dist[v])); // distance of the midpoint above v
      let at = w > 0 ? above / w : 0;
      // A midpoint on a node roots at that node, not next to it. "On" allows for rounding in the file: Newick lengths are written with
      // a few decimals, so a dated tree's tips differ in depth by about 1e-6 and its exact midpoint lands that far from the root.
      // Within SNAP of the diameter the midpoint counts as the node (a dated tree then comes back unchanged).
      if (w - above <= SNAP * D) at = 1;
      else if (above <= SNAP * D) at = 0;
      return { ...reroot(t, v, { at }), info };
    }
  }
  throw new Error('midpoint not found (inconsistent distances)');
}
