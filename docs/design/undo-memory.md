# Undo and memory

What one more tree costs in memory, measured for #44, and the bounded undo the examples built on it.

## Measured

Measured with `packages/tree-ops/bench/tree-bytes.mjs` (`npm run bench:bytes -- <files>` in `packages/tree-ops`), Node 22.22.0, one
process per file, heap after two forced garbage collections (`heapUsed + arrayBuffers`), two runs that agreed to within 0.5 bytes per
node. Node runs V8 without pointer compression (Node's default builds, from memory, **unverified** here), so a plain array costs 8 bytes per
element there; Chrome compresses pointers to 4 bytes (from V8's documentation, from memory, **unverified** here), so Chrome should need a little less for the label arrays.

- **parsed**: the heap a `TreeModel` from `parseNewick` keeps once the file text is dropped, label strings included.
- **step**: the heap each further tree keeps (`ladderise`, wrapped in `new TreeModel`, three kept). This is what one Undo step costs.
- **estimate**: tree-ops `treeBytes` of that `TreeModel`.

| Tree (`data/real-ladder`) | Nodes | Tips | Parsed, B/node | Step, B/node | Estimate, B/node | Estimate per tree |
|---|---:|---:|---:|---:|---:|---:|
| `otl-10k-amphibia` (committed) | 14,874 | 10,018 | 142.9 | 67.2–67.6 | 76.1 | 1.1 MB |
| `gtdb-10k-archaea` (committed) | 20,243 | 10,122 | 130.5–131.0 | 67.4–67.6 | 74.0 | 1.5 MB |
| `otl-100k-vertebrata` (committed) | 138,646 | 90,938 | 140.0 | 66.1 | 75.9 | 10.5 MB |
| `gtdb-190k-bacteria` (committed) | 379,601 | 189,801 | 127.5 | 65.8 | 74.0 | 28.1 MB |
| `otl-1m-metazoa` (fetched, sha256 checked against the manifest) | 1,717,413 | 1,490,245 | 142.5 | 67.3 | 78.4 | 134.7 MB |
| `otl-2m-full`, the 2.39M OTL tree | 2,725,682 | 2,385,875 | not measured | about 67 (**unverified**) | about 76 (**unverified**) | about 207 MB (**unverified**) |

The 2.39M tree could not be fetched here: `files.opentreeoflife.org` is refused by this environment's network policy (2026-10-22). Its row
is the per-node figures above applied to its node count (from [treesource-slice.md](research/treesource-slice.md)); measure it with
`./fetch.sh otl` in `data/real-ladder` and `npm run bench:bytes -- ../../data/real-ladder/fetched/otl-2m-full.nwk.gz`.

**Reading it.**

- **A step costs 66 to 68 bytes per node** on every tree, whatever its labels. This is the typed arrays of a `TreeModel`, 60 bytes
  per node plus 4 per tip: `parent`, `firstChild`, `nextSibling`, `childCount`, `subtreeEnd`, `depth`, `leafStart`, `leafEnd` and
  `tipRank` are `Int32Array`, `length`, `support` and `cumLength` are `Float64Array`, and `tipNode` is per tip. On top of that come the
  `labels` and `tipLabels` arrays, which hold references only: an operation's result reuses the strings of the tree it came from.
- **The tree as parsed costs about twice a step** (128 to 143 bytes per node). The extra is the label strings. They are slices of the
  file text, so they may keep that text alive (V8 sliced strings; **unverified** which labels are slices). That cost is paid once,
  by the tree as published, which is always kept.
- The issue's estimate of "roughly 40 to 60 bytes per node plus the strings" was low: it is 60 to 64 for the typed arrays alone.
- **`treeBytes` errs high by 10 to 15%** (74 to 78 against 66 to 68), mostly from counting 8 bytes per array element. A budget built
  on it holds.

## Bounded undo in the examples

`examples/explorer` and `examples/react` keep the tree as published (for Reset) and the current tree, and between them the trees Undo
goes back to, within a budget of 64 MiB (67.1 MB) of `treeBytes`:

- **Oldest first.** After an edit, while the trees between the published one and the current one take more than the budget, the oldest
  is dropped. The step after it gets the composed map from the tree as published (`composeMaps`), so Reset still keeps the view, and
  Undo stops there.
- **Reset only for a large tree.** When the tree as published is larger than the budget, even one more tree does not fit: Undo is
  off and only Reset is offered, with a short note saying why.
- **Views are not in the history**: Show only this clade (focus), collapsing a clade and collapse by support are recomputed from the
  current tree, as the playground does.

With the measured estimates that is about 59 steps of `otl-10k-amphibia`, 44 of `gtdb-10k-archaea`, 6 of `otl-100k-vertebrata`, 2 of
`gtdb-190k-bacteria`, and Reset only for `otl-1m-metazoa` and the 2.39M tree.

`?undo-budget=<bytes>` on either page sets the budget; their browser checks use it to drop steps and to switch Undo off on a small
tree.

Not counted: the tree that was current before the last change, which the page holds until the viewer has moved to the new one (for the
view's node map), and the views (the clade shown alone, collapse by support), each a tree of its own while shown. Phone tab limits were
not measured.
