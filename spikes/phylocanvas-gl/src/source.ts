// Converts the shared TreeModel into the `biojs` source object Phylocanvas.gl accepts
// ({ name, branch_length, children }, see utils/parse-source-as-graph.js in the library).
//
// Why not hand the Newick text to the library: its tokenizer splits on `; ( ) , :` with a regex, so quoted labels that
// contain those characters, comments and NHX break it (verified in source, utils/newick.js). A gbif.org integration has to
// parse Newick/Nexus/phyloXML itself anyway, so it would hand over a tree object. Iterative, no recursion.
//
// The library MUTATES the object it is given (adds preIndex, parent, ..., deletes branch_length), so build a fresh one per use.

import type { TreeModel } from '../../shared/tree.ts';

export interface BiojsNode {
  name?: string;
  branch_length?: number;
  children?: BiojsNode[];
}

export type LengthMode = 'lengths' | 'cladogram';

/**
 * 'lengths' = phylogram (branch lengths of the file; NaN becomes 0, negative becomes 0 because the library takes Math.abs
 * of every length, which would draw -0.1 as +0.1).
 * 'cladogram' = the library has no cladogram mode, so we feed synthetic lengths that put the tips on one line:
 * node x = (root height - node height), i.e. branch length = parentHeight - height.
 */
export function buildBiojs(tm: TreeModel, mode: LengthMode): BiojsNode {
  const n = tm.nodeCount;
  const nodes: BiojsNode[] = new Array(n);
  const heights = mode === 'cladogram' ? tm.heights() : null;
  for (let i = 0; i < n; i++) {
    const node: BiojsNode = {};
    const tip = tm.childCount[i] === 0;
    node.name = tip ? tm.labels[i] : tm.labels[i] || undefined;
    if (!tip) node.children = [];
    if (i === 0) node.branch_length = 0;
    else if (heights) node.branch_length = heights[tm.parent[i]] - heights[i];
    else {
      const l = tm.length[i];
      node.branch_length = Number.isFinite(l) && l > 0 ? l : 0;
    }
    nodes[i] = node;
    if (i > 0) nodes[tm.parent[i]].children!.push(node);
  }
  return nodes[0];
}
