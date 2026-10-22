// The name of a clade, shared by every place the viewer names one (the legend, the node menu title, the default tooltip, the live-region
// announcement), so they all apply the same rule: an internal node's label with its support value taken off, shown as the app's
// `formatLabel` shows a tip. A tip is named by its own label, whole.

import type { TreeSnapshot } from './types.ts';

/**
 * `(node, tree)`: the name of the internal node `node` (its preorder id in the full tree, as `setClades` and `TreeEvent.node` use), or
 * null for none. `tree` is the viewer's snapshot: read the label as `tree.labels[tree.toLocal(node)]`. The viewer formats what it returns.
 */
export type CladeLabelFn = (node: number, tree: TreeSnapshot) => string | null | undefined;

const NUMERIC_PREFIX = /^\s*[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?\s*(?::(.*))?$/s;

/**
 * The name part of an internal node label. Labels in the wild are names ('Canidae_ott770319'), support values ('0.95', '100') or both
 * ('98.0:c__Nitrososphaeria'); a support-only label has no name (''). The same rule as `splitInternalLabel` in @gbif-phylo/io, which the
 * viewer does not depend on.
 */
export function internalName(label: string): string {
  if (label === '') return '';
  const m = NUMERIC_PREFIX.exec(label);
  return m ? (m[1] ?? '') : label;
}

/**
 * The display name of the node at snapshot row `row`, or null when it has none: a tip's label through `formatLabel`; an internal
 * node's name (from `cladeLabel`, called with the node's full-tree id, when set, else its label without the support) through
 * `formatLabel`. Whitespace-only names count as none.
 */
export function cladeName(
  tree: TreeSnapshot,
  row: number,
  opts: { formatLabel: (s: string) => string; cladeLabel?: CladeLabelFn | null },
): string | null {
  if (row < 0) return null;
  const label = tree.labels[row] ?? '';
  const node = tree.globalId === null ? row : tree.globalId[row];
  const raw = tree.childCount[row] === 0 ? label : opts.cladeLabel ? opts.cladeLabel(node, tree) : internalName(label);
  const s = raw ? opts.formatLabel(raw).trim() : '';
  return s === '' ? null : s;
}
