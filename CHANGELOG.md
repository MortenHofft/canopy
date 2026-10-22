# Changelog

## Unreleased (2026-10-21: the library replaces the research on `main`; the research is on the `research` branch)

These changes made the spike's custom renderer into the first library form. Nothing is published yet, and the package names are placeholders.

- **Packages.** npm workspaces: `@gbif-phylo/viewer`, `@gbif-phylo/react`, `@gbif-phylo/tree-ops` and `@gbif-phylo/io` (moved out of the spike's shared code). Each is ES modules with declarations and source maps, built per file, and has no side effects except the viewer's CSS.
- **`TreeViewer`.** It replaces `TreeRenderer` and takes one object: `new TreeViewer({ target, tree | source, options, theme, columns, controls })`.
- **Events.** `on` / `once` / `off` replace the callbacks object. There are default actions with `preventDefault()`, and new events for options, theme, clades, highlights, resize, source changes, ready and destroy.
- **Controls.** A control layer, and `BaseControl` for your own. Built in: `Zoom`, `Fit`, `LayoutToggle`, `Search`, `Legend`, `OverviewControl` and `defaultControls()`. The `overview` option is removed; the overview is now a control.
- **Overlays.** `Overlay` pins an element to a node. `Tooltip` and `NodeMenu` moved from React into the core.
- **Custom columns.** `kind: 'custom'` with a `ColumnRenderer`.
- **Theme.** Canvas sizes and opacities are now tokens. The theme can come from `--phylo-*` CSS custom properties (`themeFromCss`, `refreshTheme`). There is `viewer.css` for the DOM and an optional `gbif.css`.
- **`<TreeView>`.** New `controls` prop. `theme` holds overrides only. `TreeNodeEvent` is the viewer's `TreeEvent`, so `tipRange` is now `tipStart` / `tipEnd`.
- **No build step.** Single-file browser builds `@gbif-phylo/viewer/browser` and `@gbif-phylo/io/browser`, and `examples/no-build`, a plain HTML page with an import map, plus its browser check.
- **Examples and checks.** A framework-free example. Browser checks for the test page and both examples. A package check covering publint, the tarball contents, tree shaking and sizes.
- **Review fixes.** These come from an adversarial review of the branch.
  - The browser checks fall back to Playwright's own Chromium, as on a CI runner (`tests/browser/scripts/chromium.mjs`).
  - A control has one viewer: adding it to a second viewer removes it from the first.
  - The wheel over a control or the overview zooms the tree instead of scrolling the page, except inside lists marked `data-phylo-scroll`.
  - `<TreeView>` applies only the options whose prop changed, so a layout chosen with `LayoutToggle` is no longer reverted.
  - The viewer's element holds the `role="tree"` element and the control layer as siblings, so controls and popups are no longer inside the tree role. New `treeElement` and `focus()`.
  - A listener removed during an emit is no longer called by it.
  - `TreeTheme.dark` is documented as informational.
  - Builds clean `dist/` first, and the package check fails on output without a source.
  - `<TreeView>`'s default controls no longer bundle every control: 31.4 kB gzip instead of 34.3 kB.
- **Demo site** (2026-10-22). A hub page (`site/`) linking a playground with every option, theme token and control
  (`examples/playground`, which also shows only a clade, collapses clades and collapses by support with tree-ops) and the Reactree look-alike, built with their data by `npm run build:site` for Vercel (`vercel.json`), and
  checked as served (`check-site.mjs`). The large OTL trees come from the `data/otl-large` branch at build time.
- **Annotations in `@gbif-phylo/io`** (#17, 2026-10-22). `parseNewick` / `parseNexus` take `{ annotations: true }` and keep BEAST `[&k=v]` and NHX `[&&NHX:k=v]` comments in `tree.annotations`, a sparse side table (node and edge) with numbers, strings and `{a,b}` arrays, `column(key)` and `remap(map, before, after)` for tree-ops results (edge annotations follow their edge through `reroot`). Off by default: parse time is unchanged (gtdb-190k 9.4 MB: median 213 to 228 ms before, 209 to 223 ms after; a 1.2 MB BEAST tree 18 ms before and after; with annotations on 44 ms). `supportFrom(tree, 'posterior', pick?)` gives support from an annotation without changing `tree.support`; showing it as node labels is #16. `parseNewick` alone grows by about 2.7 kB minified (6.3 to 9.0 kB) because the reader is part of the parser. `toNewick` / `toNexus` accept `annotations: true`.
- **Found by the Reactree look-alike** (`examples/reactree`, 2026-10-22).
  - A transparent or translucent `--phylo-background` works: the page shows through. The canvas has an alpha channel only while the background is not opaque (an opaque one keeps the faster opaque canvas; a theme change swaps the canvas), and is cleared before each frame. Before, frames were drawn over each other.
  - `addControl` keeps a `pointer-events` the control's element already has inline, so a control laid over the whole tree can let clicks through.
  - Nested clade colours: the innermost clade wins, whatever the order of `setClades` / the `clades` prop (it was the later entry).
  - `@gbif-phylo/io` has `toNexus`: a NEXUS file with a taxa block and the tree.

