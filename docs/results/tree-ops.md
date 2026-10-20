# Tree operations in the browser (reroot, midpoint, ladderise, collapse, prune)

Date: 2026-10-20. Code: the separate package [packages/tree-ops](../../packages/tree-ops/README.md) (operations, tests, benchmark). The UI integration is a node menu slot on `<TreeView>` (`spikes/custom/src/react/TreeView.tsx`, prop `nodeMenu`), filled with actions on the custom candidate's dev page `spikes/custom/demo.html`. Library survey: [../research/tree-ops-libraries.md](../research/tree-ops-libraries.md).

## Question

Viewers like phylotree.js bundle a few operations that change the tree rather than how it is drawn: rerooting, midpoint rooting, ladderising, collapsing weakly supported branches. Should gbif.org offer them, how expensive are they in a browser, and is WebAssembly needed?

Position taken (from the project owner): if offered, these are **operations a user chooses to apply to a tree**, not something GBIF does to a published tree. They run client-side and never change the archived file.

## Where it lives

The operations are data work and live outside the viewer in `packages/tree-ops`. They have no React, DOM or rendering imports and typecheck against ES2022 alone. They read any model with the right arrays (`TreeInput`; the spikes' `TreeModel` fits) and return plain arrays. The viewer has only a generic slot: `<TreeView nodeMenu={(e) => items}>` shows a menu at the clicked tip or clade (keyboard: Enter on the cursor, arrows, Escape) and calls the chosen item. The page decides what the items are and swaps in the tree that comes back. That page-level wiring is the only overlap.

On the demo page, per-node actions are in the menu (Rotate, Reroot here, Show only this clade, Remove this tip/clade, Colour) and whole-tree actions in a toolbar (Midpoint root, Ladderise ↑/↓, Collapse support below x, Keep coloured, Undo, Reset). A status line says when the tree shown is "changed by you, not as published". Driven end to end in headless Chromium: menu opens on a tip and on a clade, focus moves into it, arrows and Escape work (focus returns to the canvas), an outside click closes it, and each action updates the tree.

## What was built

Pure functions on typed arrays with preorder ids. Each returns a **new** tree plus `map` (old node index to new, -1 if removed), so the page can keep the original for undo and reset and carry clade colours and the selection across. All passes are iterative (no recursion), O(n); ladderise is O(n log k) for k children.

| Function | What it does | Notes |
|---|---|---|
| `reroot(t, node, {at})` | New root splits the edge above `node` at fraction `at` (default 0.5); the path to the old root is reversed | Old root removed if left with one child (its two edges merge). Supports move with their edges, names stay with nodes; GTDB-style `98.0:c__X` labels are split and recomposed |
| `midpointRoot(t)` | Root halfway along the longest tip-to-tip path | Two O(n) distance passes find the path. Missing and negative lengths count as 0 (as in the layout). Throws without lengths. An ultrametric tree is already midpoint-rooted and is returned unchanged |
| `ladderise(t, {order})` | Sort children by tip count, `increasing` (default, smaller clades on top, as FigTree) or `decreasing` | Display only |
| `rotate(t, node)` | Reverse the children of one node | Display only |
| `collapseBySupport(t, x)`, `collapseShortBranches(t, x)` | Contract internal edges with support < x (or length < x) into polytomies | The contracted edge's length is dropped, as ape `di2multi` and ETE `delete` do (**unverified** for ETE's default; from memory). Nodes without support are kept. Support scales differ between files (0.95 versus 95); the threshold is taken as given |
| `prune(t, keepTipRank)` | Keep a subset of tips | Unary nodes removed with lengths summed, edges above the new root dropped |
| `subtree(t, node)` | A clade as its own tree | |

Tests (13, all passing, `npm test` in `packages/tree-ops`): exact Newick for small cases, and invariants on real trees. After any reroot, all tip-to-tip distances and the set of unrooted splits are unchanged. After midpoint rooting, the two farthest tips are on different sides of the root and the deepest tip on each side is at most half the diameter. Pruning keeps the distances between kept tips. A sweep reroots the edge-case trees (polytomies, missing lengths, trifurcating root, quoted labels) on every node. A 100k-deep caterpillar (pattern from patristic's deep test) goes through reroot, midpoint, ladderise and prune.

## Cost (measured, M)

Node 22.22 (same V8 as Chromium) in the cloud sandbox, 4 vCPU, no rendering. Median of 5 runs. Each time **includes building the new `TreeModel`**. Parse time is shown for scale. Reroot is on the deepest tip (longest path to reverse). Run: `npm run bench -- <files>` in `packages/tree-ops`.

| Tree | Tips | Max depth | Parse | Reroot | Midpoint | Ladderise | Collapse < 70 | Prune to 10% |
|---|---|---|---|---|---|---|---|---|
| gtdb-10k-archaea | 10,122 | 60 | 30 ms | 5 ms | 4 ms | 4 ms | 3 ms | 2 ms |
| otl-100k-vertebrata (no lengths) | 90,938 | 76 | 59 ms | 24 ms | n/a | 28 ms | n/a | 6 ms |
| gtdb-190k-bacteria | 189,801 | 103 | 212 ms | 48 ms | 65 ms | 73 ms | 42 ms | 18 ms |
| yule_100000_support (synthetic) | 100,000 | 40 | 90 ms | 33 ms | 38 ms | 37 ms | 14 ms | 9 ms |
| caterpillar_100000 (synthetic) | 100,000 | 99,999 | 48 ms | 37 ms | 26 ms | 28 ms | n/a | 6 ms |
| yule_1000000_support (synthetic) | 1,000,000 | 50 | 1,141 ms | 640 ms | 650 ms | 626 ms | 225 ms | 252 ms |
| caterpillar_1000000 (synthetic) | 1,000,000 | 999,999 | 734 ms | 911 ms | 811 ms | 707 ms | n/a | 283 ms |

The synthetic 100k and 1M trees are git-ignored; `make large` in `data/synthetic` regenerates them.

Reading:

- **Up to about 200k tips every operation is under 75 ms**, below parse time, so it can run on the main thread without a visible freeze. At 1M tips it takes 0.2 to 0.9 s, still less than parsing the file. That is acceptable for an explicit button press, but it should run in a Web Worker so the page stays responsive.
- **Deep (caterpillar) trees are fine.** Being iterative, these functions avoid the stack overflows the library spikes hit at 5k to 10k depth.
- An earlier stripped-down prototype (parent arrays only, no labels or model rebuild) was about 2 to 4 times faster. The difference is building the full `TreeModel` and copying labels, not the algorithms.
- **Not measured: what the renderer does after an operation.** A new tree remounts the renderer (layout, LOD index, first frame). For the custom candidate that cost is in [custom.md](custom.md) (first render) and is of the same order as the operation itself or larger.

## Existing implementations

Surveyed from primary sources on 2026-10-20 ([../research/tree-ops-libraries.md](../research/tree-ops-libraries.md)): 11 JS packages, 6 Rust crates, gotree (Go) and TreeSwift (Python). Verdict: keep our own.

- **JS:** no permissively licensed library covers edge reroot with support moved, threshold collapse and prune-to-set. phylotree.js (MIT) has reroot and midpoint, but on d3 objects with heavy dependencies, and supports stay on the nodes. PhyloJS's licence conflicts (MIT in package.json, GPL-3.0 in the LICENSE file). phylocanvas.gl's reroot recurses and its midpoint compares all pairs of leaves. patristic (CDC, Apache-2.0, 0.7.1) is the closest: a typed-array store, deep-tree tests, rotate and simplify. But it reroots on nodes only, has no midpoint, threshold collapse or prune-to-set, and leaves supports on nodes.
- **Rust:** the crates that have the operations are copyleft (`phylotree` GPL-3.0, `newick`/`sorbus` LGPL-3.0, `light_phylogeny` CeCILL). The permissive ones lack them: `phylo` (MIT) declares a `Reroot` trait with no implementation found, and `bio` (MIT) only parses. A port would cost more than the module it replaces.
- **Borrowed:** the deep-tree test idea (patristic), and the rule that support lives on edges, which gotree builds into its data model and TreeSwift exposes as `branch_support=True`.

## WebAssembly

Not needed for these. They are linear, so time is dominated by memory traffic and rebuilding the model, where typed-array JavaScript is already close to native. WebAssembly's speed-up for this kind of code is commonly put at under about 2× (**unverified**, no WebAssembly version was measured). It would add a toolchain and copies across the JS/WebAssembly boundary. A Worker matters more than WebAssembly.

WebAssembly becomes worth considering in two cases: to **reuse an existing native library** (check its licence), or for **heavier statistics** (likelihood ancestral states, comparative methods), which are out of scope here. Quadratic operations (all-pairs distance matrix, 10¹⁰ cells at 100k tips) are infeasible in any language. Offer them as queries instead, for example the distance between two chosen tips.

## Partially loaded trees

The operations work on an in-memory `TreeModel` only. A `ParquetSource` (src/parquet) holds only the loaded clades, so there is no whole tree to rewrite. Supporting it would mean either loading the whole tree first, or precomputing alternative orderings server-side, and that would make it a GBIF-side operation. That is acceptable for now. If large partially loaded trees become the main case, those trees simply would not offer the operations, or would offer only the display ones (rotate a loaded node).

## Open points

- **Where the result lives:** an operation produces a view state, not a new published tree. A shareable URL needs the operations encoded (for example `reroot=<tip label>` or `<MRCA of two tip labels>`, which survive renumbering, plus `ladderise=inc`) and replayed on load. Not built.
- **Wording in the UI:** after a reroot, say so clearly ("rooted by you on …, not as published") with a reset next to it.
- **Comparison site:** the operations are on the dev page `demo.html` only. The harness shell (`app-shell.tsx`) has no slot for actions that replace the tree, so the deployed comparison site does not show them yet.
- **Cross-check against an independent implementation:** run TreeSwift or gotree (GPL, so outside this repo) on the test trees and compare splits and lengths after reroot, midpoint, collapse and prune.
- **Worker:** move the operations into a Worker. The model is typed arrays plus a label array, so it can be transferred without copying the arrays.
