// The data contract of tree-ops. Operations READ a tree through TreeInput (structural: the shared TreeModel of the spikes
// satisfies it, so does any model with these arrays) and RETURN plain TreeArrays, which the caller wraps in its own model
// (for the spikes: `new TreeModel(result.tree)`). Nothing here knows about rendering, React or the DOM.
//
// Node numbering in both: preorder, root = 0, parent[i] < i, the subtree of i is the index range [i, subtreeEnd[i]), and the
// tips below i are the tip-rank range [leafStart[i], leafEnd[i]) (tips ranked in preorder).

/** What an operation produces: the arrays a tree model is built from. */
export interface TreeArrays {
  readonly nodeCount: number;
  readonly tipCount: number;
  readonly parent: Int32Array; // -1 for the root
  readonly subtreeEnd: Int32Array;
  readonly depth: Int32Array; // edges from the root
  readonly length: Float64Array; // NaN when the edge has no length
  readonly support: Float64Array; // NaN when the internal label has no numeric support
  readonly leafStart: Int32Array;
  readonly leafEnd: Int32Array;
  readonly labels: string[]; // tip label, or the internal label as written (support and/or name, '' if none)
}

/** What an operation reads: the arrays plus child links and tip lookups. */
export interface TreeInput extends TreeArrays {
  readonly firstChild: Int32Array; // -1 for tips
  readonly nextSibling: Int32Array; // -1 for the last child
  readonly childCount: Int32Array;
  readonly tipNode: Int32Array; // tip rank -> node index
  readonly hasLengths: boolean;
}

export interface OpResult {
  /** The new tree, or the input itself when `changed` is false. */
  tree: TreeArrays;
  /** old node index -> new node index, -1 for nodes that were removed. A node added by the operation (the new root of
   *  reroot) is not in the map. */
  map: Int32Array;
  /** false when the operation had nothing to do (the input is returned as is). */
  changed: boolean;
}
