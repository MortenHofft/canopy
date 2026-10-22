# Example: a Reactree look-alike

[Reactree](https://github.com/vaaloo/reactreejs) (reactreejs 1.0.3) rebuilt on `@gbif-phylo`, as a test of the library's public API: the same
two toolbar rows, icons, buttons, palette, search panel, inspector and export menu, with the drawing, the events and the edits coming from
`<TreeView>`, a control of our own and `@gbif-phylo/tree-ops`. Three of the gaps it found were fixed in the packages (below).

```
npm run dev -w examples/reactree    # http://127.0.0.1:5309 (?tree=<id> from src/trees.ts, ?theme=dark)
```

The browser check is `tests/browser/scripts/check-reactree.mjs` (56 checks, all pass in headless Chromium, 2026-10-22). It drives every
control and reads the result back from the viewer.

| File | What |
|---|---|
| [`src/Reactree.tsx`](src/Reactree.tsx) | the component: toolbars, modes, panels, `<TreeView>` |
| [`src/node-labels.ts`](src/node-labels.ts) | `NodeLabels`, a `BaseControl` that writes support values or branch lengths next to the nodes |
| [`src/reactree.css`](src/reactree.css) | Reactree's look as `--rt-*` custom properties, mapped onto the viewer's `--phylo-*` theme (light and dark) |
| [`src/icons.tsx`](src/icons.tsx) | Reactree's SVG icons, copied under its MIT licence (notice in the file) |
| [`src/trees.ts`](src/trees.ts) | trees from `data/`, two with the alignment they were inferred from |

## What maps to what

| Reactree | Here |
|---|---|
| Width, Height (Size in circular) | `setViewport` on the handle's `renderer()`: the window is the fitted one divided by the scale |
| Font size, branch width | the `theme` prop (`labelSize`, `branchWidth`) |
| Rectangular / circular, phylogram / cladogram | the `layout` and `branchLengths` props |
| Truncate / Full names | `options.formatLabel` (28 characters and an ellipsis above 30, Reactree's rule) |
| Search (⌘F, count, ↑ ↓, Enter) | the `highlighted` prop for the matches with `highlightStyle: 'dim'` (what does not match fades to `--phylo-dim-opacity`; the columns stay at full strength) and `focus` to centre the current one |
| Export | PNG from `viewer.toBlob({ background })` (labels are drawn on it) over the pane colour; Newick and NEXUS with `toNewick` / `toNexus` from `@gbif-phylo/io`. Reactree's SVG and PDF are left out |
| Undo (and ⌘Z) | a history of trees; every edit is a tree-ops function returning a new tree |
| Fit | `fit()`; `fitViewport()` gives the fitted window for the Width / Height sliders |
| Reroot, Flip, Swap modes | `onTipClick` / `onNodeClick` and tree-ops `reroot`, `rotate` and `swap` (two siblings, also inside a polytomy) |
| Midpoint, Ladderize ↑ ↓ | tree-ops `midpointRoot`, `ladderise` |
| Color mode, 12 swatches, Erase, Clear all | the `clades` prop (the innermost clade's colour wins, as in Reactree); colours are carried to the new tree after an edit by their tips |
| Click a clade: collapse into a triangle; Expand all | the `collapsed` prop (the viewer collapses the clade on the tree it shows, one row, ids unchanged; its label is the clade's name or "N tips" where Reactree says "N taxa"); the tooltip says "N taxa" |
| Tip click: inspector (branch length, root distance, depth, support, copy name) | `onTipClick` and the `TreeModel` arrays |
| Mode tooltips ("Set as root", "Paint Red", "1/2 Select first branch") | the `tooltip` prop rendering our own content, with `tooltipBare` so the viewer's box adds no chrome |
| Bootstrap / Length / No labels cycle | `NodeLabels`, placed after every `frame` event with `nodePosition` |
| Align (leaf labels in one column, with leader lines) | `options.alignLabels`; the leaders are the `--phylo-leader-*` theme tokens |
| Alignment track and legend | an `alignment` column (`columns` prop); the legend says how many tips have a sequence (exact label match) and draws its swatches from `residueColours` / `residueGroups`, so it matches the canvas (protein or nucleotide, light or dark) |
| Dark mode (`data-theme="dark"` on `<html>`) | the `--phylo-*` properties change with it; the option `themeObserver: 'document'` watches `class` and `data-theme` on `<html>` |
| Dotted background | `--phylo-background: transparent`: the pane's CSS grid shows under the tree |
| Resize handle | the pane's height; the viewer follows its container |

## What could not be matched, and what testing found

Fixed in the packages after building this (2026-10-22; see the CHANGELOG):

- **A transparent background smeared**: every frame was drawn over the last one, because the frame filled the background colour without
  clearing the canvas. Each frame now clears first, so the pane's dotted grid shows under the tree.
- **`addControl` forced `pointer-events: auto`** on every control's element, so a control over the whole tree (as `NodeLabels`) swallowed
  every click. It now keeps a `pointer-events` the element already has; `NodeLabels` sets `none` in its constructor.
- **Nested clade colours: the later entry won.** Now the innermost clade wins whatever the order, which is Reactree's behaviour.
- **No NEXUS writer.** `@gbif-phylo/io` now has `toNexus` (a TAXA block, a TRANSLATE table and the tree), and the export menu offers it.

Still open, found in the library:

- **No node or branch labels** ([#16](https://github.com/MortenHofft/gbif-phylo/issues/16); posterior values need [#17](https://github.com/MortenHofft/gbif-phylo/issues/17)). Support values and branch lengths had to be a control of our own (`NodeLabels`); it walks every node on each
  frame, which is fine for hundreds of nodes, not for large trees, and in the radial layout puts a length at the node rather than on the
  branch.
- **No vector export.** The viewer draws on a canvas, so the menu has PNG (the current view at the canvas resolution), Newick and NEXUS,
  not Reactree's SVG and PDF.

Differences that follow from the design, not defects:

- Reactree scales the drawing to fit and shows tiny labels on every tip; the viewer shows labels only where they fit (`labelDensity`), so a
  135-tip tree at the fitted view has none until you zoom in or raise Height ([#24](https://github.com/MortenHofft/gbif-phylo/issues/24)).
- Collapsing a clade of a dated tree ([#19](https://github.com/MortenHofft/gbif-phylo/issues/19)): the viewer ends the triangle at the clade's tips, so the axis stays "time before tips" and no tip is made up (this was `collapseClades` with `{ extend: true }` and a changed tip length before, [#29](https://github.com/MortenHofft/gbif-phylo/issues/29)).
- Reactree's palette and export menu are portalled to `<body>` and the palette can be dragged; here they are positioned inside the
  component.
- Reactree's look is kept as its own tokens (`--rt-*`), not GBIF's: the point is the comparison. The viewer still takes every colour from
  CSS custom properties.

Other follow-ups: API ergonomics [#23](https://github.com/MortenHofft/gbif-phylo/issues/23) (mostly done: `updateTheme`, `themeObserver`, `fitViewport`, `toBlob`, `tooltipBare`; stretch sliders and a draw-list iterator remain), duplicate tip labels [#18](https://github.com/MortenHofft/gbif-phylo/issues/18), TreeViewer unit tests and the alpha canvas cost
[#25](https://github.com/MortenHofft/gbif-phylo/issues/25), this example's own open questions [#26](https://github.com/MortenHofft/gbif-phylo/issues/26).
