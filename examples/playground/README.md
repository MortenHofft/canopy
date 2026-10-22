# Example: the playground

`@gbif-phylo/viewer` without a framework, with every option, theme token and built-in control in a side panel. Use it to see what a
setting does, to compare trees from 6 tips to 2.39 million, or to try a tree file of your own (Newick or NEXUS, gzipped or not).

```
npm run dev -w examples/playground    # http://127.0.0.1:5310 (?tree=<id> from src/catalogue.json)
```

- [`src/settings.ts`](src/settings.ts) is the list of settings. It generates the panel and is stored in the URL (`?s.<id>=<value>`, only
  values that differ from the library default). Each setting says how it is applied: a viewer option, a theme token, a built-in control,
  or the page's own (presets, transparent background, tip links, the click action, highlighting by text). To expose a new option or
  token, add one line there.
- [`src/catalogue.json`](src/catalogue.json) lists the trees, with their per-tip data (a TSV whose first column is the tip label) and
  alignments. The site build copies exactly these files. The two largest Open Tree of Life trees are not on `main`. They come from the
  `data/otl-large` branch: the site build downloads them, and the dev server falls back to the branch's raw URL.
- **Tree operations** from `@gbif-phylo/tree-ops`, as views of the loaded tree (as in `examples/react`), not edits:
  - **Show only this clade** (node menu, or the click action) with **← Back** and **↑ Up one level** above the tree, and in the
    shown root's menu (tree-ops' focus functions).
  - **Collapse** a clade into a triangle and **Expand** it again (the viewer's `setCollapsed` on the shown tree), and **Expand all**.
  - **Collapse branches with low support** (`collapseBySupport`), with the threshold in % of the tree's scale, because files use 0–1
    or 0–100. The panel shows the tree's range.

  Colours, collapsed clades and the focus are kept in node ids of the loaded tree and mapped to the shown one, so they survive going
  in and out. The focus and the collapsed clades are in the URL (`?focus=…&collapsed=…`). A change of focus or of the low-support
  threshold re-creates the viewer, so the zoom resets ([#27](https://github.com/MortenHofft/gbif-phylo/issues/27)); collapsing and expanding
  does not (the clades are collapsed in the viewer, on the tree it shows).
- Per-tip data become columns: numbers as bars, short text as text. The panel says how many tips have data. Tips without data get an
  empty cell rather than being dropped.
- The readout under the tree shows the last frame's stats (`getStats()`); **Benchmark** draws 30 full frames (`benchmark(30)`). The event
  log lists the viewer's events. `window.viewer` is the `TreeViewer`, for the console.

The browser check is `tests/browser/scripts/check-playground.mjs`. It runs in `npm run test:browser`, against the dev build and against
the built site.
