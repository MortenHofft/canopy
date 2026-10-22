// treeBytes: what one more tree costs in memory, for an app that keeps earlier trees for Undo and wants a memory budget for them
// (docs/design/undo-memory.md has the measurements behind it).

/** Bytes per element of a plain array (a pointer). V8 uses 8 without pointer compression (Node) and 4 with it (Chrome); 8 errs high. */
const SLOT_BYTES = 8;

/**
 * An estimate of the memory a tree holds, in bytes: every typed array among its own properties (`byteLength`) plus 8 bytes per
 * element of its plain arrays (`labels`, and a model's derived arrays such as `TreeModel.tipLabels`). The label strings are not
 * counted: an operation's result shares them with the tree it came from, so they are paid once, by the tree as parsed. Maps,
 * caches that are not arrays and annotations are not counted either.
 *
 * For a `TreeModel` this is 74 to 78 bytes per node, a little above the 66 to 68 that one more edited tree was measured to keep in
 * Node (`bench/tree-bytes.mjs`), so a budget built on it errs on the safe side.
 * Constant time in the tree's size: it looks at the tree's properties, not at its nodes.
 */
export function treeBytes(tree: object): number {
  let bytes = 0;
  for (const v of Object.values(tree)) {
    if (ArrayBuffer.isView(v)) bytes += v.byteLength;
    else if (Array.isArray(v)) bytes += v.length * SLOT_BYTES;
  }
  return bytes;
}
