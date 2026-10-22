# @gbif-phylo/io

Parsers for phylogenetic tree files and the tree model they produce.

* `parseNewick(text)`: an iterative, quote-aware Newick parser. There is no recursion, so a 1,000,000-deep caterpillar tree parses. It handles comments (BEAST `[&...]`, NHX), internal labels (names, support values, `support:name`), and missing, zero and negative lengths.
* `parseNexus(text, treeIndex?)`: reads a NEXUS `TREES` block, including a `TRANSLATE` table and files with several trees.
* `toNewick(tree, options?)`: writes a tree back to Newick.
* `toNexus(tree, options?)`: writes a NEXUS file (a TAXA block and the tree, through a TRANSLATE table unless `translate: false`; `treeName`).
* `TreeModel`: a rooted tree on typed arrays in preorder. The descendant tips of every node are a contiguous rank range, and every query is iterative. It satisfies the `TreeData` interface of `@gbif-phylo/viewer`, so it can be passed to the viewer as it is.

Only single-quoted labels are handled, not double-quoted ones. Underscores in labels are kept, so tip ids equal the text in the file.
