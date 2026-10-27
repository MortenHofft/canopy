// Tips named by label or node id (`TipRef`): the lookup behind `TreeViewer.focusTip` / `columnCell` and `<TreeView>`'s handle.

import type { TipRef } from './types.ts';

/** The part of the viewer's `TreeSnapshot` that `tipRow` reads. */
export interface TipLookup {
  readonly nodeCount: number;
  readonly childCount: Int32Array;
  readonly globalId: Int32Array | null;
  tipIndex(label: string): number;
  tipIndices?(label: string): ArrayLike<number>;
  toLocal(globalId: number): number;
}

/** Row of the snapshot for a tip named by label (a string: the first tip that carries it) or by node id (a number); -1 when there is no
 *  such tip or its row is not loaded. With `where`, a label that several tips carry, a number that is not a node and an internal node are
 *  each reported with a `console.warn` naming `where`.
 *  `nodeLimit` is one past the largest node id of the full tree (`TreeSource.nodeCount`); a snapshot's own `nodeCount` is its row count,
 *  which is smaller for a partial source, so pass the source's. Left out, an in-memory snapshot is bounded by its own `nodeCount` and a
 *  partial one is not bounded. */
export function tipRow(snap: TipLookup, tip: TipRef, where?: string, nodeLimit: number = snap.globalId === null ? snap.nodeCount : Infinity): number {
  return typeof tip === 'string' ? labelRow(snap, tip, where) : nodeRow(snap, tip, where, nodeLimit);
}

/** `tipRow` of a label: its first tip, with a warning (given `where`) when several tips carry it. */
function labelRow(snap: TipLookup, label: string, where?: string): number {
  const row = snap.tipIndex(label);
  const n = where && row >= 0 ? (snap.tipIndices?.(label).length ?? 1) : 1;
  if (n > 1) console.warn(`canopy: ${where}: ${n} tips have the label ${JSON.stringify(label)}; the first is used (pass a node id for another)`);
  return row;
}

/** `tipRow` of a node id: -1 (with a warning, given `where`) for a number that is not a node or is an internal node. */
function nodeRow(snap: TipLookup, node: number, where: string | undefined, nodeLimit: number): number {
  const inMemory = snap.globalId === null;
  const isNode = Number.isInteger(node) && node >= 0 && node < nodeLimit;
  if (!isNode) {
    if (where) console.warn(`canopy: ${where}: ${String(node)} is not a node of this tree (nodes are numbers, preorder ids); ignored`);
    return -1;
  }
  const row = inMemory ? node : snap.toLocal(node);
  if (row < 0 || snap.childCount[row] === 0) return row;
  if (where) console.warn(`canopy: ${where}: ${node} is an internal node, not a tip; ignored`);
  return -1;
}
