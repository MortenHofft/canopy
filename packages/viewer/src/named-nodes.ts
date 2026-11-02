// Which internal nodes have a name, for the markers of `namedNodeMarkers`: the rule of `cladeName` (the label without its support value,
// or what the app's `cladeLabel` returns, through `formatLabel`), so the markers agree with the legend, the tooltip and the search.

import { cladeName, type CladeLabelFn } from './clade-name.ts';
import type { TreeSnapshot } from './types.ts';

/** A test of snapshot rows: whether the row has a name by `cladeName`. Each row is decided once, when first asked (the draw asks for the
 *  rows it draws), and kept in one byte per row, so asking again costs a lookup and nothing is allocated. A `cladeLabel` or `formatLabel`
 *  that throws leaves the row unnamed, so one bad id does not stop a frame. Make a new test when the snapshot, `formatLabel` or
 *  `cladeLabel` changes. */
export function namedNodeTest(
  tree: TreeSnapshot,
  opts: { formatLabel: (s: string) => string; cladeLabel?: CladeLabelFn | null },
): (row: number) => boolean {
  const known = new Uint8Array(tree.nodeCount); // 0 not asked yet, 1 no name, 2 named
  return (row) => {
    let k = known[row];
    if (k === 0) {
      let name: string | null = null;
      try {
        name = cladeName(tree, row, opts);
      } catch {
        // an app's cladeLabel that fails for a node: no name, no marker
      }
      known[row] = k = name === null ? 1 : 2;
    }
    return k === 2;
  };
}
