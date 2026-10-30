// searchIndex: the matching behind the `Search` control as plain data, for an app that draws its own search. Every node that has a name
// (a tip's label, an internal node's name as `cladeName` gives it: `cladeLabel` and `formatLabel` apply, a support value is no name) is
// searched, case-insensitively, as a substring of the displayed name in which a run of spaces and underscores counts as one space, so
// 'c spirochaetia' finds 'c__Spirochaetia'. Prefix matches come first, then the others, each in preorder. Build it once per tree and
// options (it holds the lowercased names; the `Search` control rebuilds it on `treechange`, `sourcechange` and a change of `formatLabel` or
// `cladeLabel`) and call `viewer.focusTip(hit.node, true)` or, for a clade, `viewer.zoomToNode(hit.node, true)` when one is chosen.

import { cladeName, type CladeLabelFn } from './clade-name.ts';
import type { TreeSnapshot } from './types.ts';

/** A node that matched: its node id (preorder id of the full tree, as the public API speaks) and whether it is an internal node. */
export interface SearchHit {
  node: number;
  clade: boolean;
}

/** What `SearchIndex.find` found: the nodes to list (prefix matches first, at most `max`) and how many nodes match in all. */
export interface SearchResult {
  hits: SearchHit[];
  total: number;
}

export interface SearchIndex {
  find(query: string, max?: number): SearchResult;
}

const SEPARATORS = /[\s_]+/g;
const normalise = (s: string): string => s.toLowerCase().replace(SEPARATORS, ' ').trim();

/** The search index of a snapshot: `formatLabel` and `cladeLabel` are the viewer's options of those names. */
export function createSearchIndex(tree: TreeSnapshot, opts: { formatLabel: (s: string) => string; cladeLabel?: CladeLabelFn | null }): SearchIndex {
  const rows: number[] = [];
  const text: string[] = [];
  for (let row = 0; row < tree.nodeCount; row++) {
    const name = cladeName(tree, row, opts);
    if (name === null) continue;
    rows.push(row);
    text.push(normalise(name));
  }
  return {
    find(query, max = Infinity) {
      const q = normalise(query);
      if (!q) return { hits: [], total: 0 };
      const pre: number[] = [];
      const any: number[] = [];
      let total = 0;
      for (let k = 0; k < text.length; k++) {
        const at = text[k].indexOf(q);
        if (at < 0) continue;
        total++;
        if (at === 0) {
          if (pre.length < max) pre.push(rows[k]);
        } else if (any.length < max) any.push(rows[k]);
      }
      const hits = pre
        .concat(any)
        .slice(0, max)
        .map((row) => ({
          node: tree.globalId === null ? row : tree.globalId[row],
          clade: tree.childCount[row] > 0,
        }));
      return { hits, total };
    },
  };
}
