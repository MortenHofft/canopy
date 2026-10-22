# @gbif-phylo/io

Parsers for phylogenetic tree files and the tree model they produce.

* `parseNewick(text, options?)`: an iterative, quote-aware Newick parser. There is no recursion, so a 1,000,000-deep caterpillar tree parses. It handles comments (BEAST `[&...]`, NHX), internal labels (names, support values, `support:name`), and missing, zero and negative lengths.
* `parseNexus(text, treeIndex?, options?)` (or `parseNexus(text, options)`): reads a NEXUS `TREES` block, including a `TRANSLATE` table and files with several trees.
* `toNewick(tree, options?)`: writes a tree back to Newick. `{ annotations: true }` writes `tree.annotations` back in BEAST syntax.
* `toNexus(tree, options?)`: writes a NEXUS file (a TAXA block and the tree, through a TRANSLATE table unless `translate: false`; `treeName`; `annotations: true` as for `toNewick`).
* `TreeModel`: a rooted tree on typed arrays in preorder. The descendant tips of every node are a contiguous rank range, and every query is iterative. It satisfies the `TreeData` interface of `@gbif-phylo/viewer`, so it can be passed to the viewer as it is.

Only single-quoted labels are handled, not double-quoted ones. Underscores in labels are kept, so tip ids equal the text in the file.

## Annotations

BEAST / FigTree `[&key=value,...]` comments and NHX `[&&NHX:key=value:...]` comments are skipped by default, which costs nothing. Pass `{ annotations: true }` to `parseNewick` or `parseNexus` to keep them in `tree.annotations` (`null` otherwise):

```ts
const tree = parseNexus(text, { annotations: true }).tree;
tree.annotations.get(nodeIndex, 'posterior'); // 0.98
tree.annotations.get(nodeIndex, 'height_95%_HPD'); // [3.2, 13.0]   ({a,b} ranges and sets are arrays)
tree.annotations.get(nodeIndex, 'rate', 'edge'); // BEAST's annotation after the ':' belongs to the edge above the node
tree.annotations.keys(); // every key in use
tree.annotations.column('posterior'); // Float64Array by node index, NaN where absent or not a single number
```

* A value is a number, a string (quoted or not in the file) or an array. The store is sparse: `annotations.node` and `annotations.edge` are `Map`s from node index to a record, holding only the nodes that have annotations. BEAST comments before the `:` are the node's and after it the edge's; NHX comments are always the node's. Flags without a value (`[&R]`) are not annotations.
* **Support from an annotation.** `tree.support` is not changed by annotations (it is the numeric internal label). `supportFrom(tree, 'posterior')` returns a new `Float64Array` in the same layout (NaN for tips and nodes without the key). To use it where `tree.support` is read, copy it in on purpose: `tree.support.set(supportFrom(tree, 'posterior'))`. Chosen over a `supportKey` parse option so that the parse never decides what support means.
* **Writing.** `toNewick(tree, { annotations: true })` and `toNexus` write the annotations back as `name[&k=v]:[&k=v]length`, strings in double quotes, ranges as `{a,b}`; NHX input comes back in BEAST syntax. Reading that output with `annotations: true` gives the same table.
* **Tree operations.** Annotations are keyed by node index, and tree-ops results carry a `map` (old index to new, -1 removed). `tree.annotations.remap(result.map, newTree.nodeCount)` carries them over: node annotations follow their node. Edge annotations follow the node below the edge, which is wrong after `reroot` for the nodes between the new and the old root, whose edges now point the other way; pass `{ stripEdges: true }` to drop them there. The new root that `reroot` adds, and nodes a collapse adds, have none. tree-ops does not do this itself, so it stays free of the annotation types.
