# @gbif-phylo/io

Parsers for phylogenetic tree files and the tree model they produce.

- `parseNewick(text, options?)`: an iterative, quote-aware Newick parser. There is no recursion, so a 1,000,000-deep caterpillar tree parses. It handles comments (BEAST `[&...]`, NHX), internal labels (names, support values, `support:name`), and missing, zero and negative lengths.
- `parseNexus(text, treeIndex?, options?)` (or `parseNexus(text, options)`): reads a NEXUS `TREES` block, including a `TRANSLATE` table and files with several trees.
- `toNewick(tree, options?)`: writes a tree back to Newick. `{ annotations: true }` writes `tree.annotations` back in BEAST syntax.
- `toNexus(tree, options?)`: writes a NEXUS file (a TAXA block and the tree, through a TRANSLATE table unless `translate: false`; `treeName`; `annotations: true` as for `toNewick`).
- `TreeModel`: a rooted tree on typed arrays in preorder. The descendant tips of every node are a contiguous rank range, and every query is iterative. It satisfies the `TreeData` interface of `@gbif-phylo/viewer`, so it can be passed to the viewer as it is.

Only single-quoted labels are handled, not double-quoted ones. Underscores in labels are kept, so tip ids equal the text in the file.

## Duplicate tip labels

Tip labels are lookup keys, not the identity of a tip: the same label can be on several tips (several sequences of one species, labels
made for display), and every tip is kept. `tree.duplicateTipLabels()` reports them after a parse (a map from each label that more than one
tip carries to those tips' node indexes, in preorder; empty when the labels are unique), so an app can warn. `tipIndex(label)` is the
first tip with a label, and `tipIndices(label)` every one (`mrcaOf` takes node numbers, so pass it `tipIndices(label)` to count every tip of a label). To tell the tips apart, use their node
indexes (the viewer's node ids).

```ts
const tree = parseNewick(text);
const dup = tree.duplicateTipLabels();
if (dup.size) console.warn(`${dup.size} tip labels are on more than one tip, e.g. ${[...dup.keys()][0]}`);
tree.tipIndices('Homo_sapiens'); // [3, 4, 7]
```

## Annotations

BEAST / FigTree `[&key=value,...]` comments and NHX `[&&NHX:key=value:...]` comments are skipped by default, which costs nothing. Pass `{ annotations: true }` to `parseNewick` or `parseNexus` to keep them in `tree.annotations` (`null` otherwise). `parseNexus` takes the options as `parseNexus(text, options)` (with `treeIndex` in them if needed) or `parseNexus(text, treeIndex, options)`.

```ts
const tree = parseNexus(text, { annotations: true }).tree;
tree.annotations.get(nodeIndex, 'posterior'); // 0.98
tree.annotations.get(nodeIndex, 'height_95%_HPD'); // [3.2, 13.0]   ({a,b} ranges and sets are arrays)
tree.annotations.get(nodeIndex, 'rate', 'edge'); // BEAST's annotation after the ':' belongs to the edge above the node
tree.annotations.keys(); // every key in use
tree.annotations.column('posterior'); // Float64Array by node index, NaN where absent or not a single number
```

- **Values.** A number, a string (quoted or not in the file) or an array. Numbers with leading zeros (`007`) stay strings so that identifiers survive. The store is sparse: `annotations.node` and `annotations.edge` are `Map`s from node index to a record, holding only the nodes that have annotations. BEAST comments before the `:` are the node's and after it the edge's; NHX comments are always the node's. Flags without a value (`[&R]`) are not annotations. Quoted values may hold brackets (`[&s="a]b"]`) when annotations are kept; the default skip does not track quotes, because that made parsing a tree full of annotations about 30% slower.
- **Where comments are dropped.** Only comments after a node (after its tip label, after `)` or the internal label, or around the `:`) are annotations. Not read: a comment before a tip's label, a comment in the tree statement before `=` (`tree X [&lnP=-1.2] = ...`), and comments in the TAXA block (`taxlabels` entries such as `name[&!color=#ff0000]`).
- **Support from an annotation.** `tree.support` is not changed by annotations (it is the numeric internal label). `supportFrom(tree, 'posterior')` returns a new `Float64Array` in the same layout (NaN for tips and nodes without the key). For compound values, such as IQ-TREE's `SH-aLRT_UFB="85.5/61"`, pass `pick`: `supportFrom(tree, 'SH-aLRT_UFB', (v) => parseFloat(String(v).split('/')[1]))`. To use the values where tree-ops reads `tree.support`, copy them in on purpose: `tree.support.set(supportFrom(tree, 'posterior'))`. Chosen over a `supportKey` parse option so that the parse never decides what support means. Showing these values as node labels in the viewer is not done here; it moves to #16.
- **Writing.** `toNewick(tree, { annotations: true })` and `toNexus` write the annotations back as `name[&k=v]:[&k=v]length`, ranges as `{a,b}`, strings in double quotes (single quotes if they hold a `"`). NHX input comes back in BEAST syntax. Reading the output with `annotations: true` gives the same table (minus left-out entries). An entry the syntax cannot hold (a key with whitespace or `[ ] { } , = " '`, a string with both kinds of quote) is left out and reported once with `console.warn`; the rest is written. NHX values are never read as quoted. A root length is written when there is one (`(A,B):3;`); it is not an annotation, but a round trip keeps it.
- **Tree operations.** Annotations are keyed by node index. A tree-ops result has a `map` (old index to new, -1 removed); carry the table over with `tree.annotations.remap(result.map, oldTree, result.tree)` and attach it by building the model with it:

  ```ts
  const r = reroot(tree, node);
  const next = new TreeModel({ ...r.tree, annotations: tree.annotations.remap(r.map, tree, r.tree) });
  ```

  (`TreeModel` throws if the table is for a tree of another size.) Node annotations follow their node. Edge annotations follow the undirected edge: after `reroot` the edges between the new and the old root move to the node that is now below them, and the edge that the new root splits is copied to both halves. Dropped: the edge of a removed node, and the edge that `reroot` merges when the old root is suppressed (the surviving child's own annotation wins). The records are copied. tree-ops does not do this itself, so it stays free of the annotation types.

- **Size.** The reader is part of the parser (a plain option, no second import), so `parseNewick` alone is about 2.7 kB minified larger than before (6.3 to 9.0 kB). `scripts/check-packages.mjs` records both sizes.
