// Node ids and tips as the setters take them (`setClades`, `setCollapsed`, `setMarked`, `setSelected`, `setHighlighted`, `zoomToNode`, ...):
// what counts as a node of the tree, the warning for what is not (so a typo or a stale id does not fail quietly), the row of the snapshot a
// node id stands for, and the tips a highlight list names. Pure functions over a snapshot, so TreeViewer keeps only the state: test/node-ids.test.mjs
// runs them through the viewer's setters.

import type { TipRef, TreeSnapshot } from './types.ts';

/** A node handle is a preorder id of the tree the viewer holds: an integer in [0, limit) (see `nodeLimit`). */
export function isNodeOf(limit: number, id: unknown): id is number {
  return typeof id === 'number' && Number.isInteger(id) && id >= 0 && id < limit;
}

/** Ids that are not nodes of the tree are ignored, with this warning, so a typo or a stale id does not fail quietly. */
export function warnUnknownNodes(where: string, bad: unknown[], limit: number): void {
  const shown = bad.slice(0, 5).map((b) => (typeof b === 'string' ? JSON.stringify(b) : String(b)));
  const more = bad.length > 5 ? ` and ${bad.length - 5} more` : '';
  console.warn(
    `canopy: ${where}: ${shown.join(', ')}${more} ${bad.length === 1 ? 'is not a node' : 'are not nodes'} of this tree ` +
      `(nodes are numbers, the preorder ids 0 to ${limit - 1}); ignored`,
  );
}

/** The entries whose node is a node of a tree of `limit` nodes; the others are dropped with a warning (see `warnUnknownNodes`). */
export function knownNodes<T>(where: string, items: readonly T[], node: (x: T) => unknown, limit: number): T[] {
  if (items.every((x) => isNodeOf(limit, node(x)))) return items as T[];
  warnUnknownNodes(
    where,
    items.map(node).filter((k) => !isNodeOf(limit, k)),
    limit,
  );
  return items.filter((x) => isNodeOf(limit, node(x)));
}

/** False, with a warning, when `id` is not a node of a tree of `limit` nodes. */
export function knownNode(where: string, id: number, limit: number): boolean {
  if (isNodeOf(limit, id)) return true;
  warnUnknownNodes(where, [id], limit);
  return false;
}

/** Row of the snapshot for a node id of the public API (preorder id of the full tree), -1 when that node is not loaded. */
export function rowOfNode(tree: TreeSnapshot, node: number): number {
  return tree.globalId === null ? (node >= 0 && node < tree.nodeCount ? node : -1) : tree.toLocal(node);
}

/** The rows of the loaded tips with this label: all of them when the tree has `tipIndices`, else the one `tipIndex` finds. */
export function eachTipRow(tree: TreeSnapshot, label: string, fn: (row: number) => void): void {
  const first = tree.tipIndex(label);
  if (first < 0) return;
  const all = tree.tipIndices?.(label);
  if (!all) return fn(first);
  for (let k = 0; k < all.length; k++) fn(all[k]);
}

/** Warn about the entries of a highlight list that are neither a label nor a tip: numbers that are not nodes, and internal nodes that are
 *  loaded. They stay in the list (`getHighlighted` gives back what was set) and highlight nothing. */
export function checkHighlighted(where: string, ids: readonly TipRef[], tree: TreeSnapshot, limit: number): void {
  let bad: unknown[] | null = null;
  let inner: number[] | null = null;
  for (const id of ids) {
    if (typeof id === 'string') continue;
    if (!isNodeOf(limit, id)) (bad ??= []).push(id);
    else {
      const row = rowOfNode(tree, id);
      if (row >= 0 && tree.childCount[row] > 0) (inner ??= []).push(id);
    }
  }
  if (bad) warnUnknownNodes(where, bad, limit);
  if (inner) {
    const more = inner.length > 5 ? ` and ${inner.length - 5} more` : '';
    console.warn(
      `canopy: ${where}: ${inner.slice(0, 5).join(', ')}${more} ${inner.length === 1 ? 'is an internal node' : 'are internal nodes'}, ` +
        'not tips (a number highlights the tip with that node id, a string every tip with that label); ignored',
    );
  }
}

/** The ranks of the loaded tips among the highlight list `ids`, sorted and without repeats, and the flag per rank (null when there is
 *  none). With a partial source a match whose rows are not loaded has no rank yet. */
export function resolveHighlights(tree: TreeSnapshot, ids: readonly TipRef[]) {
  const N = tree.tipCount;
  const ranks: number[] = [];
  const add = (row: number) => {
    if (tree.childCount[row] === 0 && tree.tipRank[row] >= 0) ranks.push(tree.tipRank[row]);
  };
  for (const id of ids) {
    if (typeof id === 'string') eachTipRow(tree, id, add);
    else if (Number.isInteger(id)) {
      const row = rowOfNode(tree, id);
      if (row >= 0) add(row);
    }
  }
  const sorted = Int32Array.from(ranks).sort(); // a typed array sorts numerically, and much faster than an array with a comparator
  let n = 0;
  for (let k = 0; k < sorted.length; k++) if (k === 0 || sorted[k] !== sorted[k - 1]) sorted[n++] = sorted[k];
  const hlRanks = sorted.slice(0, n);
  let hl: Uint8Array<ArrayBuffer> | null = null;
  if (n) {
    hl = new Uint8Array(N);
    for (let k = 0; k < n; k++) hl[hlRanks[k]] = 1;
  }
  return { ranks: hlRanks, hl };
}
