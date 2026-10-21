# The viewer as a library: design and what it took

Written 2026-10-21, when the custom renderer of the spike was turned into the `lib` branch. Sizes are measured by
`scripts/check-packages.mjs` (esbuild, minified, gzip level 9) on that date. Everything else follows from the code on this branch.

## The question

Can the viewer be a library that anyone integrates, with React or without, and that they can style and extend: custom columns, custom popups
on a node, default controls that can be moved or hidden, an API to drive and read the view, and events to build their own controls? Or does
that add a lot of complexity?

## The answer

It is feasible, and the extra complexity is moderate. Most of what was needed already existed: the spike's renderer core never imported React
(`TreeRenderer` was an imperative class; `<TreeView>` only forwarded props), and it already had the introspection that popups and controls need
(`locateNode`, `nodeBounds`, `columnCell`, `hitTest`, `getViewport` / `setViewport`). The added code:

| Piece | Added | Cost |
|---|---|---|
| Event emitter with default actions | `events.ts`, about 120 lines | small |
| Control layer and `BaseControl` | `control.ts`, about 40 lines in `viewer.ts` | small |
| Built-in controls (zoom, fit, layout, search, legend, overview) | `controls/`, about 470 lines | moderate; the overview needed an internal hook |
| `Overlay`, `Tooltip`, `NodeMenu` | `overlays/`, about 380 lines, moved out of React | moderate (the menu's keyboard and focus behaviour) |
| Custom columns | about 50 lines in `columns.ts` | small |
| Theme from CSS, tokens, stylesheet | `theme.ts`, about 330 lines of CSS | small |

The ongoing cost is the public API that now has to stay stable and documented, not runtime cost. The core's rules held: the cut, draw and
hit code are unchanged, the 168 cut goldens are unchanged, there is no per-node allocation, and custom columns get one draw call per frame.

## Design decisions

* **Framework-free core, thin wrappers.** `@gbif-phylo/viewer` has no runtime dependencies. `@gbif-phylo/react` adds props, identity rules and
  React content for the tooltip. Another framework's wrapper would be the same thin layer, or none: a page can use the viewer directly, as
  `examples/vanilla` does.
* **Everything on the viewer is a control.** Controls, popups and overlays share one protocol (`element` and `setViewer`). The built-ins use
  only the public API, except the overview, which reuses the viewer's cut machinery through `viewerInternals` (marked as not stable). So an app's
  own control can do anything a built-in does. Controls live in a layer whose events never reach the tree's input handling, and they can also
  live outside the viewer (`target`).
* **Default actions instead of switches.** The tooltip and the node menu listen as default actions. An app replaces them for one event with
  `preventDefault()`, or for all by not adding them. That removed the need for options such as "disable menu for tips".
* **One theme for canvas and DOM.** The canvas cannot read CSS, so the viewer reads the `--phylo-*` custom properties into its theme when it is
  created, on `refreshTheme()` and when the colour scheme preference changes. It writes the theme in force back on its root, so the DOM matches
  even when the theme comes from JavaScript. Every visual constant of the drawing code is now a token (line widths, marker sizes, opacities,
  label and axis sizes), with the old constants as defaults. Further style changes are token edits.
* **Tree shaking by construction.** The packages are emitted as one ES module per source file (`tsc`, `.ts` imports rewritten), and
  `sideEffects` covers only the CSS. Each built-in control and popup is its own module, and the overview moved out of the viewer into a
  control. Measured: `TreeViewer` alone is 27.3 kB gzip and bundles no control or popup; with `Zoom` it is 28.1 kB; with `defaultControls` (all
  controls) 31.4 kB; `<TreeView>` is 34.3 kB without React. `parseNewick` alone is 2.4 kB, and `ladderise` alone 1.1 kB.
* **Custom columns draw once per frame.** A `ColumnRenderer` prepares its data when the values change and draws the visible rows in one call.
  That keeps a column of a million tips as cheap as the built-in kinds, and an app is free to summarise rows thinner than a pixel. Columns of
  DOM cells, for example a React component per cell, are not supported. `columnCell()` plus an `Overlay` covers the occasional DOM need.

## What is not done

* **Built-in column kinds are not tree-shakeable.** `columns.ts` holds bar, text and alignment together, so the alignment's bitmap code is
  always bundled. It is small, but splitting the kinds into renderer modules would fix it. Doing that changes `columns.test.mjs` and the `kind`
  strings of the API.
* **Style iterations.** Background, radius, shadows, node styling, selection animations, default clade colours, line thickness and icons are
  all reachable through tokens or CSS now. Choosing the new defaults is the next round of work.
* **No selection model.** "Selected" is the app's state (`setHighlighted`, `setClades`). An animated selection would need a `select` event and
  a drawing state; neither exists.
* **Not published.** The package names (`@gbif-phylo/*`) are placeholders, all packages are `private`, and there is no release process or
  changelog policy yet.
* **No web component.** A `<phylo-tree>` custom element would let pages with no build step use the viewer from HTML. It would be a thin
  wrapper like the React one, and it was not written.
* **Only partly tested.** As in the spike, the browser tests ran in headless Chromium without a GPU. Other browsers, touch devices and screen
  readers were not tested with the new controls and popups (**unverified**).
