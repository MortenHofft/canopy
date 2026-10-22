// Subsets: prune to a set of tips, take one clade as its own tree, collapse clades into single tips.

import { addLen, checkNode, draftOf, identity, linkChildren, result } from './draft.ts';
import { splitInternalLabel } from './labels.ts';
import type { OpResult, TreeInput } from './types.ts';

/**
 * Keep only the tips for which `keep(rank)` is true and the nodes that join them. Nodes the pruning leaves with one child are
 * removed and their edges merged. The new root is the MRCA of the kept tips: everything above it is dropped, one-child nodes
 * included (as reroot treats a one-child chain at the top as the root's own edge). Below it, nodes that already had one child
 * (named monotypic taxa in Open Tree of Life trees) are kept. Throws if no tip is kept.
 */
export function prune(t: TreeInput, keep: (tipRank: number) => boolean): OpResult {
  const n = t.nodeCount;
  const present = new Int32Array(n); // number of children (or the tip itself) with kept tips below
  for (let r = 0; r < t.tipCount; r++) if (keep(r)) present[t.tipNode[r]] = 1;
  const kids = new Int32Array(n);
  for (let i = n - 1; i > 0; i--) if (present[i] > 0 || kids[i] > 0) kids[t.parent[i]]++;
  const d = draftOf(t);
  const anc = new Int32Array(n).fill(-1); // nearest kept ancestor-or-self
  const acc = new Float64Array(n).fill(NaN); // length from that ancestor down to here
  let root = -1;
  let keptNodes = 0;
  for (let i = 0; i < n; i++) {
    const has = t.childCount[i] === 0 ? present[i] > 0 : kids[i] > 0;
    d.parent[i] = -1;
    if (!has) continue;
    const up = i === 0 ? -1 : anc[t.parent[i]];
    const l = i === 0 ? NaN : addLen(acc[t.parent[i]], t.length[i]);
    const kept = t.childCount[i] === 0 || kids[i] >= 2 || (t.childCount[i] === 1 && up >= 0);
    if (kept) {
      keptNodes++;
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
  if (keptNodes === n) return identity(t);
  d.root = root;
  const order = new Int32Array(n);
  for (let i = 0; i < n; i++) order[i] = i;
  linkChildren(d, order);
  return result(t, d);
}

/** The clade below `node` as a tree of its own (the edge above it is dropped). */
export function subtree(t: TreeInput, node: number): OpResult {
  checkNode(t, node);
  if (node === 0) return identity(t);
  const d = draftOf(t);
  d.root = node;
  d.parent[node] = -1;
  // a subtree is a contiguous preorder range: nodes outside it are simply not reached by the builder
  return result(t, d);
}

/** How `collapseClades({ extend })` measures a clade's height: the depth from its node to its tips, taken as the longest, the mean or the shortest. */
export type CladeDepth = 'max' | 'mean' | 'min';

export interface CollapseOptions {
  /**
   * Lengthen each new tip's edge by the clade's height, so that the tip ends where the clade's tips did. On a dated (ultrametric)
   * tree the shown tree then stays ultrametric. `true` means `'max'`; `'max'`, `'mean'` (over the clade's tips) or `'min'` choose the clade's depth to its
   * tips (they agree when the clade is ultrametric, up to rounding of the lengths in the file; on a clade that is not, `'max'` keeps the
   * longest root-to-tip path of the shown tree equal to the original's). Negative and missing lengths count as 0 (in the heights, and in the node's own edge when it is extended), and
   * the edge stays as it was when the tree has no lengths or the clade has height 0. Default: off, the edge is kept as it is.
   */
  extend?: boolean | CladeDepth;
}

/**
 * Collapse clades into single tips: each listed internal node becomes a tip that stands for its clade (its descendants are removed).
 * A viewer draws such tips as collapsed clades; with the input kept, expanding is collapsing fewer. Nodes inside another listed
 * clade are covered by it. The new tip's label is `label(node, tips)`, by default the clade's name with its tip count, or its first
 * tip and how many more ('Gezophiium_megaborealis and 7 more'), which is unique among disjoint clades. `map` sends each collapsed
 * node to its tip and its descendants to -1. O(n).
 *
 * The new tip's length is the node's own edge, so on a dated tree it ends at the clade's node and the shown tree is no longer
 * ultrametric. With `options.extend` it is the own edge plus the clade's height, so the tip ends at the present. The length of a
 * collapsed tip then is not the original edge: the original is the new length minus the height. Where the clade is ultrametric the
 * tip's root distance is the depth of the clade's tips; otherwise it is the depth the rule gives ('mean' is the mean over the clade's
 * tips, not over its children). Nothing is stored for it beyond the input tree, which the caller keeps.
 */
export function collapseClades(
  t: TreeInput,
  nodes: Iterable<number>,
  label?: (node: number, tips: number) => string,
  options: CollapseOptions = {},
): OpResult {
  const d = draftOf(t);
  const ext = options.extend;
  if (ext !== undefined && ext !== true && ext !== false && ext !== 'max' && ext !== 'mean' && ext !== 'min') {
    throw new RangeError(`collapseClades: extend must be true, false, 'max', 'mean' or 'min', not ${JSON.stringify(ext)}`);
  }
  const rule: CladeDepth | null = ext === true ? 'max' : ext || null;
  let height: Float64Array | null = null; // lazily: the clade height of every node under `rule`
  let any = false;
  for (const v of nodes) {
    checkNode(t, v);
    if (v === 0 || t.childCount[v] === 0) continue; // a tip is already a single leaf; the root would leave a one-node tree
    const tips = t.leafEnd[v] - t.leafStart[v];
    if (rule) {
      height ??= cladeHeights(t, rule);
      if (height[v] > 0) {
        const own = d.length[v];
        d.length[v] = (own > 0 ? own : 0) + height[v]; // a negative or missing own edge counts as 0, as in the heights
      }
    }
    d.firstChild[v] = -1; // the builder treats it as a tip; its subtree is no longer reached
    d.support[v] = NaN;
    d.label[v] = label ? label(v, tips) : defaultCollapsedLabel(t, v, tips);
    any = true;
  }
  return any ? result(t, d) : identity(t);
}

/** For every node, the depth to its tips (longest, mean or shortest path; missing lengths are 0). Reverse preorder, no recursion. */
function cladeHeights(t: TreeInput, rule: CladeDepth): Float64Array {
  const n = t.nodeCount;
  const h = new Float64Array(n);
  if (rule === 'mean') {
    const sum = new Float64Array(n); // sum of the distances to the node's tips
    for (let i = n - 1; i > 0; i--) {
      const p = t.parent[i];
      const l = t.length[i] > 0 ? t.length[i] : 0;
      sum[p] += sum[i] + l * (t.leafEnd[i] - t.leafStart[i]);
    }
    for (let i = 0; i < n; i++) h[i] = t.childCount[i] === 0 ? 0 : sum[i] / (t.leafEnd[i] - t.leafStart[i]);
    return h;
  }
  const max = rule === 'max';
  const seen = new Uint8Array(n); // has a child set h yet (min needs a first value)
  for (let i = n - 1; i > 0; i--) {
    const p = t.parent[i];
    const l = t.length[i] > 0 ? t.length[i] : 0;
    const x = h[i] + l;
    if (!seen[p] || (max ? x > h[p] : x < h[p])) h[p] = x;
    seen[p] = 1;
  }
  return h;
}

function defaultCollapsedLabel(t: TreeInput, v: number, tips: number): string {
  const name = splitInternalLabel(t.labels[v]).name;
  if (name) return `${name} (${tips} tips)`;
  const first = t.labels[t.tipNode[t.leafStart[v]]];
  return first ? `${first} and ${tips - 1} more` : `${tips} tips`;
}
