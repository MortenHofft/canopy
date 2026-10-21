# Example: `<TreeView>` with tree operations

Two `<TreeView>`s share one controlled viewport. The left one has the overview, search and legend controls. Clicking a tip or a clade opens
the node menu with tree operations from `@gbif-phylo/tree-ops` (rotate, reroot, show only this clade, collapse, colour), and a toolbar holds
the whole-tree operations. The viewers take the GBIF look from `@gbif-phylo/viewer/gbif.css`.

```
npm run dev -w examples/react       # http://127.0.0.1:5307 (?tree=<id> from src/trees.ts, ?cpu=1 for a CPU canvas)
```

The browser check is `tests/browser/scripts/check-node-menu.mjs`.
