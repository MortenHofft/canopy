# Changelog

## Unreleased (lib branch, 2026-10-21)

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
