# tree-ops

Operations a user applies to a phylogenetic tree: reroot, midpoint root, ladderise, rotate, swap, reorder, collapse, prune, show one clade. Pure TypeScript on typed arrays. No rendering, React, DOM or dependencies (it typechecks against the ES2022 library alone).

This package is the **data side**. The viewer (`@gbif-phylo/viewer`, `<TreeView>`) knows nothing about these operations. The two meet only in a page, which offers the operations as actions (a node menu, a toolbar) and swaps in the tree that comes back. See `examples/react/src/main.tsx`.

```
viewer (draws, reports clicks)          page (integration)                     tree-ops (data)
<TreeView nodeMenu={...}>  -- click --> nodeMenu(e) -> [Rotate, Reroot here, ...]
                                        onSelect -> ops.reroot(tree, e.node) --> new arrays + node map
<TreeView tree={new}>      <-- tree --- new TreeModel(result.tree), remap colours
```

## Operations

| Function | User-facing name | What it does |
|---|---|---|
| `reroot(t, node, {at})` | Reroot here | New root on the edge above `node`, at fraction `at` (default 0.5) from the node; `at` 0 roots at the node itself (if internal), 1 at its parent. The path to the old root is reversed. The old root is removed if it is left with one child; a one-child chain above it is dropped |
| `midpointRoot(t)` | Midpoint root | Root halfway along the longest tip-to-tip path (two O(n) passes). Needs lengths. A midpoint on a node (within 1e-6 of the diameter, which absorbs lengths rounded in the file) roots at that node, so a dated tree comes back unchanged. The tolerance is relative: a tree whose diameter is far below 1 with lengths rounded to 6 decimals can still move by the rounding |
| `rotate(t, node)` | Rotate | Reverse the order of a node's children ("flip"). Display only |
| `swap(t, a, b)` | Swap two branches | Exchange two sibling branches, the others stay. Throws `RangeError` if they are not siblings. Display only |
| `reorder(t, node, order)` | Reorder children | The children of `node` in the order given, a permutation of its current children (`rotate` and `swap` are special cases). Throws `RangeError` otherwise; `changed` is false for the current order. Display only |
| `ladderise(t, {order, by})` | Ladderise / sort clades | Children by `by`: `'tips'` (default, descendant tips), `'depth'` (most nested path to a tip, in nodes) or `'height'` (longest path below the child to a tip in branch length, its own edge not counted, as crown height or age; missing or negative count as 0; heights within 1e-6 of the greatest are equal; every edge counts 1 without lengths, so it equals depth). `increasing` (smaller first, FigTree's term) or `decreasing`. Ties: the other measures (depth: tips, height; height: tips, depth), then input order; `'tips'` goes straight to input order. Display only |
| `collapseBySupport(t, x, { keep?, extend? })`, `collapseShortBranches(t, x, { keep?, extend? })` | Collapse weak branches | Contract internal edges with support (or length) below `x` into polytomies. The contracted length is dropped, or with `extend: true` added to each child's own length (a chain accumulates), so every tip keeps its distance from the root and a dated tree stays ultrametric. `keep` (a set or array of node indexes, or a predicate) names nodes that are not contracted whatever their value, e.g. the clades a viewer shows collapsed. The two edges below a binary root are one unrooted edge, but each is judged by its own value, so one can collapse while the other stays (`((A,B)90,(C,D)60)` at 70 gives `((A,B)90,C,D)`): right for the rooted view shown, not for the unrooted tree. Support scales differ between files (0.95 versus 95); the threshold is taken as given |
| `prune(t, keepTipRank)` | Remove tip / clade, keep selection | Keep a subset of tips; nodes the pruning leaves with one child are removed and their lengths summed. The new root is the MRCA of the kept tips (everything above it goes, one-child nodes included); below it, one-child nodes already in the input (Open Tree monotypic taxa) are kept |
| `subtree(t, node)` | (Show only this clade) | The clade as its own tree; for navigation use the focus functions below |
| `collapseClades(t, nodes, label?, { extend? })` | Collapse / Expand | Each listed clade becomes one tip that stands for it (its descendants removed), labelled with the clade's name and size, or its first tip and how many more (a `label` function of your own need not give unique labels: the viewer tells tips apart by node id). To collapse clades only for display, the viewer does it on the full tree (`viewer.setCollapsed`, `<TreeView collapsed>`), with no new tree and no id translation; use `collapseClades` when the collapsed tree itself is wanted (export, further operations). Keeping the input, expanding is collapsing fewer. The tip's length is the node's own edge, so on a dated tree it ends at the clade's node and the shown tree is no longer ultrametric. `extend: true` (or `'max'`, `'mean'`, `'min'`) adds the clade's height (its longest depth to its tips, the mean over its tips, or its shortest; negative and missing lengths count as 0, also in the node's own edge) to the edge, so a collapsed clade of a dated tree still ends at the present. The tip's length is then not the original edge: the original is the length minus the height, and on an ultrametric clade the tip's root distance is the depth of the clade's tips. Use it only when the tree is ultrametric (`isUltrametric()`; any other `extend` value throws a `RangeError`); the edge of a tree without lengths is left as it is. `collapseBySupport` and `collapseShortBranches` drop the contracted edge by default, which makes a dated tree non-ultrametric; their `extend` is a different fix (give the length to the children) |
| `followClade(before, after, map, node, {onSplit})`, `followClades(..., nodes)` (`follow.ts`) | (carry colours, collapsed clades, selections) | Where clade `node` of `before` is in `after`: the clade its surviving tips form. `{ node, split, tipsBefore, tipsAfter }`. `node` is -1 when no tip survives, or when the tips no longer form one clade (`split`, a reroot inside it); `{ onSplit: 'keep' }` gives `map[node]` for a split instead. Takes an operation's `tree` as it is (`TreeArrays`) or a `TreeInput`. Tips are counted as `after` has them, so a clade `collapseClades` turned into a tip follows to itself. The MRCA is found by walking up from the first surviving tip until the tip range covers the last. `followClades` does many in one pass over `before`, however nested |
| `invertMap(map, newNodeCount)`, `composeMaps(a, b)` | (the shown tree's ids, chained operations) | `invertMap`: new node to old node, -1 for nodes the operation added. `composeMaps`: old node to newer node through both maps, -1 when either removed it. Both throw `RangeError` on an entry beyond the other side's size |
| `focusOn`, `focusUp`, `focusBack`, `showFocus`, `canGoUp`, `canGoBack`, `remapFocus` (`focus.ts`) | Show only this clade, Up one level, Back | Navigation, not an edit: a `Focus` is the stack of views visited (clade ids of the tree, -1 = whole tree). `focusOn` shows a clade alone, `focusUp` the clade that contains it (the whole tree after the root's children), `focusBack` the view before, like a browser's back button. `showFocus(t, f)` gives the tree to show and its node map. `remapFocus` carries a focus over an edit of the tree, by a callback or by `(f, before, after, map)` (followed with `followClade`); views that are gone are dropped |

The names follow common viewer usage: FigTree uses Reroot, Midpoint root, Rotate, Increasing/Decreasing node order; iTOL uses Re-root here, Rotate and Collapse (from memory, **unverified**). "Flip" means rotate; `swap` exchanges two chosen siblings.

## Contract

- **In:** a `TreeInput` (see `src/types.ts`): preorder arrays (`parent`, `firstChild`, `nextSibling`, `childCount`, `length`, `support`, `labels`, tip ranges). `@gbif-phylo/io`'s `TreeModel` satisfies it structurally.
- **Out:** `{ tree: TreeArrays, map, changed }`. `tree` holds the arrays a model is built from (`new TreeModel(result.tree)`). `map` maps old node index to new (-1 if removed), for carrying selections and colours across. For `@gbif-phylo/io` annotations use `tree.annotations.remap(result.map, tree, result.tree)`: node annotations follow `map`, edge annotations follow their undirected edge through a `reroot` (see the io README). `changed` is false when there was nothing to do; `tree` is then the input.
- **Never mutates the input.** Undo and "reset to the published tree" mean keeping the old object.

## Conventions

- A **support value belongs to the edge** above a node and a **name belongs to the node**. Rerooting reverses edges, so supports move with their edges and names stay with their nodes. The edge's support is `support[i]`; the label's number is read only where `support[i]` is NaN (array first). A moved edge takes the label's number text as written (`98.0`, `.95`) with it; a label number that disagrees with the array stays on its own split. GTDB-style labels like `98.0:c__X` are split and recomposed. Of the libraries surveyed, phylotree.js, PhyloJS and patristic leave supports on the nodes, which puts them on the wrong split after a reroot. gotree, TreeSwift (`branch_support=True`) and phylocanvas.gl move them. Survey: [../../docs/design/tree-ops-libraries.md](../../docs/design/tree-ops-libraries.md).
- Missing lengths stay missing (NaN). When two edges merge, a missing length counts as 0 unless both are missing. Distances (midpoint) count missing and negative lengths as 0, as the layout does.
- Iterative throughout: a 100k-deep caterpillar is in the tests. Everything is O(n), except ladderise at O(n log k) for k children.
- **In-memory trees only.** A partially loaded `TreeSource` has no whole tree to rewrite.

## Run

```
npm test                                  # 34 tests; needs Node >= 22.7 (--experimental-transform-types runs the .ts sources directly)
npm run bench -- file.nwk[.gz] ...        # median times per operation; big synthetic trees: `make large` in data/synthetic
npm run typecheck                         # tsc, ES2022 lib only (no DOM)
```

The tests and benchmark use `@gbif-phylo/io`'s Newick parser and `TreeModel` as **fixtures** (text in, tree queries out). `src/` imports nothing outside itself.

Results and numbers: [../../docs/design/tree-ops.md](../../docs/design/tree-ops.md).

## Why our own and not a library

Checked on 2026-10-20 ([../../docs/design/tree-ops-libraries.md](../../docs/design/tree-ops-libraries.md)). No permissively licensed JS or Rust library has edge reroot with supports moved, threshold collapse and prune-to-set together. The ones that do are GPL, LGPL or CeCILL (gotree, TreeSwift, the Rust `phylotree`, `newick`/`sorbus` and `light_phylogeny` crates). Several JS ones recurse, or are quadratic: phylocanvas.gl's midpoint compares all pairs of leaves, and PhyloJS sorts with a tip walk inside the comparator. The closest match, patristic (CDC, Apache-2.0, typed arrays), lacks four of the operations and would add a second tree model. Rust via WebAssembly offers nothing permissive that has these operations, and would add a copy across the boundary for an operation that already takes about a second at 1M tips (about as long as parsing the file).

Worth borrowing: TreeSwift and gotree as **external oracles** (run outside this repo, because they are GPL) to cross-check results on the test trees, and patristic's deep-tree test pattern (adopted).
