# API reference: `@gbif-phylo/viewer` and `<TreeView>`

One or two lines per entry; the detail is in the source comments, linked per section. Types are in [`src/types.ts`](../src/types.ts) unless
said otherwise.

| Import | What |
|---|---|
| `@gbif-phylo/viewer` | everything below: `TreeViewer`, controls, overlays, column and theme types. One ES module per source file and no side effects, so a bundler keeps only what you import (`scripts/check-packages.mjs` checks this) |
| `@gbif-phylo/viewer/browser` | the same as one self-contained, minified ES module (`dist/browser/viewer.js`) for pages without a build step: load it with an import map or by URL. It includes every control |
| `@gbif-phylo/viewer/viewer.css` | styles of the viewer's DOM: controls, popups, legend, search, notice. Load it once |
| `@gbif-phylo/viewer/gbif.css` | optional: GBIF design tokens mapped to the `--phylo-*` properties |
| `@gbif-phylo/react` | `<TreeView>` ([below](#treeview)) |
| `@gbif-phylo/io` | `parseNewick`, `parseNexus`, `toNewick`, `toNexus`, `TreeModel` (a `TreeData`), and for BEAST / NHX annotations (`{ annotations: true }`, `tree.annotations`) `Annotations` and `supportFrom`; `@gbif-phylo/io/browser` as one file |

## Quick start

```ts
import '@gbif-phylo/viewer/viewer.css';
import { parseNewick } from '@gbif-phylo/io';
import { TreeViewer, defaultControls, Tooltip } from '@gbif-phylo/viewer';

const viewer = new TreeViewer({
  target: document.getElementById('tree')!, // give it a size; the viewer fills it and follows its size
  tree: parseNewick(text),
  controls: [...defaultControls({ search: true, overview: true }), new Tooltip()],
});
viewer.on('click', (e) => console.log(e.isTip ? e.tipId : `${e.tipCount} tips`));
```

Without a bundler, map the two packages to their single-file builds in an import map and load `viewer.css` with a `<link>`; the code is
the same (see [`examples/no-build`](../../../examples/no-build)). The framework-free example ([`examples/vanilla`](../../../examples/vanilla)) shows every part: controls in corners and outside the
viewer, a control of its own, a custom popup, the node menu, a custom column, a dark theme and an event log.

## TreeViewer ([`src/viewer.ts`](../src/viewer.ts))

```ts
new TreeViewer({ target, tree | source, options?, theme?, columns?, controls? }: TreeViewerInit)
```

Creates its DOM (canvases, label layer, control layer, notice, screen-reader list) inside `target`, sizes itself to `target` with a
ResizeObserver and draws on demand with `requestAnimationFrame`. A `tree` (`TreeData`) is wrapped in an `InMemorySource`; a `source` is used
as it is. `options` go over `DEFAULT_OPTIONS`; `theme` over the CSS theme ([Theme](#theme)); `controls` are added in order (none by default).

Properties

| Member | Meaning |
|---|---|
| `element` | what the viewer added to `target` (class `phylo-viewer`): the tree element and, beside it, the control layer |
| `treeElement` / `root` | the tree element: `role="tree"`, focusable, the canvases, labels and screen-reader list. Controls and popups are not inside it |
| `options: Readonly<ViewerOptions>` | the options in force |
| `size: {width, height}` | container size in CSS px |
| `layout: Layout` | the current layout arrays (`X`, `ROW`, `XMAX`, `LAST`, `layoutMs`, ...), `layout.ts` |
| `stats: FrameStats` | the stats of the last frame, mutated in place (see `getStats` for a copy) |

State: setters (each is a no-op for input equal to the current one) and getters

| Method | Meaning |
|---|---|
| `setOptions(patch)` | change options (undefined and unchanged values are ignored). Refits for `layout`, `branchLengths` or `rowHeight`; for `axis` only while the view is still fitted. A change of `tipHref` or `formatLabel` rebuilds the DOM label anchors. Emits `optionschange` |
| `setTheme(overrides)` | theme fields over the CSS theme; replaces the overrides of an earlier call. Emits `themechange` |
| `refreshTheme()` | read the `--phylo-*` custom properties again (the viewer does this itself when created and when the colour scheme preference changes) |
| `getTheme()` | the theme in force |
| `setClades(clades: CladeColour[])` / `getClades()` | colour clades: `{node, colour, label?}`, `node` is the preorder id (full tree); where clades nest the innermost wins (for the same node, the later entry); nodes not loaded are skipped. Emits `cladeschange` |
| `setHighlighted(tipIds)` / `getHighlighted()` | highlight tips by label (row band, ring, bold label, overview ticks); unknown labels are ignored. Emits `highlightchange` |
| `setCollapsed(nodeIds)` | tips that stand for collapsed clades (drawn as triangles); the collapsing itself is done in the data, e.g. with tree-ops' `collapseClades` |
| `setColumns(columns: Column[])` | aligned per-tip columns (rectangular layout only); only changed columns are recompiled (`values` and `renderer` by reference, ids unique) |
| `getSource()` / `getTree()` | the tree source, and the rows loaded now (a `TreeSnapshot`; for an in-memory tree the whole tree) |
| `tipNode(tipId)` | node id of the tip with this label, -1 when unknown or not loaded |

Navigation and view

| Method | Meaning |
|---|---|
| `getViewport()` / `setViewport(v, animate = false)` | the visible window in layout coordinates (`Viewport`); `setViewport` clamps it to the limits |
| `fit(animate = true)` | fit the whole tree and columns into the container |
| `zoomBy(fx, fy, px, py)` | zoom by factors (>1 zooms in) keeping container point (px, py) fixed |
| `focusTip(rank, animate = false)` | bring the tip of leaf rank `rank` into view (rows at least 26 px); ignored when its row is not loaded |
| `zoomToNode(id, animate = false)` | show the clade below node `id` (preorder id of the full tree) |

Where things are

| Method | Meaning |
|---|---|
| `nodePosition(id)` | position of node `id` in px relative to the viewer element under the current view, or `null` outside the plot. Draws nothing, so it is cheap enough for a `frame` listener (what `Overlay` uses) |
| `locateNode(id)` | client-px position where a click on node `id` lands, or `null`. Draws a settled full-quality frame first; an internal node must be drawn (not inside a summary) |
| `nodeBounds(id)` | client-px box of the clade below `id`, clipped to the plot area, or `null` |
| `columnCell(colId, rank)` | client-px box of a column cell, or `null` |
| `hitTest(x, y)` | what a click at container-px (x, y) would target: a `Hit` or `null` |

Controls ([below](#controls))

| Method | Meaning |
|---|---|
| `addControl(c)` | place `c.element` in its corner of the control layer (or in `c.target`), then call `c.setViewer(viewer)`; adding twice does nothing. A control has one viewer: one that another viewer holds is removed from it first |
| `removeControl(c)` | `c.setViewer(null)`, then remove its element |
| `getControls()` | the controls added, in order |

Events: `on`, `once`, `off` ([below](#events)).

Stats, frame control and lifetime

| Method | Meaning |
|---|---|
| `getStats()` | copy of `stats` plus `layoutMs, hitBuildMs, avgFrameMs, maxFrameMs, listLength, hitItems, hitEntries, kx, ky` (does not draw) |
| `resetFrameTimes()` | reset the average and maximum frame time counters |
| `renderNow()` | draw synchronously if something changed |
| `invalidate(fonts = false)` | schedule a redraw; `fonts = true` also clears the label overlay |
| `benchmark(n)` | force `n` full redraws; returns mean, min and max JS ms per frame and mean cut and draw ms |
| `focus()` | give keyboard focus to the tree |
| `destroy()` / `isDestroyed()` | emit `destroy`, remove the controls, cancel the frame loop, remove listeners, observers and DOM |

## Events ([`src/events.ts`](../src/events.ts))

`viewer.on(type, listener, { asDefault?, once? })` returns the function that removes the listener; `once(type, listener)` and
`off(type, listener)` as usual. Listeners run in the order they were added; one that throws is reported (`reportError`) and the rest run.

| Event | Payload | When |
|---|---|---|
| `click` | `TreeEvent` | a click (pointer) or Enter (keyboard) on a tip, a node marker, a collapsed clade or a branch |
| `hover` | `TreeEvent \| null` | the pointer moved onto another target; `null` when it left every target |
| `viewchange` | `Viewport` | the visible window changed (pan, zoom, fit, resize, animation step); equality-guarded |
| `frame` | `FrameStats` | after every drawn frame (the viewer's own object, reused) |
| `optionschange` | `{options, changed}` | `setOptions` changed something |
| `themechange` | `TreeTheme` | the theme in force changed |
| `cladeschange` | `CladeColour[]` | `setClades` changed the colours |
| `highlightchange` | `string[]` | `setHighlighted` changed the tips |
| `resize` | `{width, height}` | the container was resized |
| `sourcechange` | `{version}` | the rows of a partial source changed |
| `ready` | `{layoutMs, tips}` | the first frame was drawn |
| `destroy` | none | `destroy()` ran |

**Default actions.** A listener added with `{ asDefault: true }` runs after the ordinary listeners, and only when none of them called
`e.preventDefault()`. The built-in `Tooltip` (hover) and `NodeMenu` (click) listen this way, so an app replaces them for one event by
preventing the default:

```ts
viewer.on('click', (e) => {
  if (!e.isTip) return;
  e.preventDefault(); // no node menu for tips: show our own popup instead
  card.setPosition({ node: e.node });
});
```

`TreeEvent` (`NodeEvent` plus ids and helpers)

| Field | Meaning |
|---|---|
| `node`, `nodeId` | node id (preorder id in the FULL tree for a partial source) and its string form `'n<id>'` |
| `isTip`, `tipId` | tip or not; the tip's label when it is loaded |
| `kind` | `'tip'`, `'node'` (internal node marker), `'summary'` (collapsed clade, or a run) or `'branch'` |
| `tipStart`, `tipEnd`, `tipCount` | descendant tips are the leaf-rank range `[tipStart, tipEnd)` |
| `tipIds()` | the loaded tip labels in the range (a slice, allocated per call) |
| `tipLabels()` | the same through the source (a promise), also for clades whose labels are not loaded |
| `clientX`, `clientY` | pointer position (for the keyboard: the node's position) |
| `via` | `'pointer'` or `'keyboard'` |
| `run?` | set for a run of small siblings drawn as one slice: `node` is their parent, the range is only the run's, `{clades, single}` counts what it holds |
| `preventDefault()`, `defaultPrevented` | skip the default actions for this event |

## Controls ([`src/control.ts`](../src/control.ts), [`src/controls/`](../src/controls))

A control is any object with `element: HTMLElement`, optional `position` (`'top-left'` default, `'top-right'`, `'bottom-left'`,
`'bottom-right'`, or `'custom'`: put in the control layer as it is, positioned by itself), optional `target` (an element of the page: the
control lives there instead of on the viewer) and `setViewer(viewer | null)`. `addControl` gives a control's element `pointer-events:
auto` unless the element already has an inline `pointer-events`: a control that lays something over the whole tree (labels, say) sets
`none` so clicks reach the tree. Pointer and key events inside the control layer never reach the tree; the wheel over a control zooms the tree, and over the overview zooms about the tree point under the pointer (the overview handles its own wheel), except inside an element marked `data-phylo-scroll` (a list that
scrolls itself, as the legend and the search suggestions are).

`BaseControl` is the base class of the built-ins: `new BaseControl(name, { position, target, className }, element?)` gives the element the
classes `phylo-control phylo-<name>` (and `phylo-control--external` with a target); override `attach(viewer)` and `detach()`, and register
listeners with `this.listen(viewer.on(...))` and `this.domListen(el, type, fn)` so they are removed with the control. `makeButton(label,
icon)` makes a `.phylo-button`.

```ts
class TipsInView extends BaseControl {
  constructor() {
    super('in-view', { position: 'bottom-left' });
  }
  protected attach(v: TreeViewer) {
    const update = () => {
      const { y0, y1 } = v.getViewport();
      this.element.textContent = `${Math.round(y1 - y0)} tips in view`;
    };
    this.listen(v.on('viewchange', update));
    update();
  }
}
viewer.addControl(new TipsInView());
```

Built-in controls (each in its own module; options extend `{ position, target, className }`)

| Control | Default position | Options | What it does |
|---|---|---|---|
| `Zoom` | top-left | `factor` (1.6), `zoomInIcon`, `zoomOutIcon` | zoom about the centre: rows only in the rectangular layout, both axes in the radial one |
| `Fit` | top-left | `icon`, `label` | `fit(true)` |
| `LayoutToggle` | top-left | `icons`, `labels` (per layout) | one pressed button per layout; follows `optionschange` |
| `Search` | top-right | `placeholder`, `maxResults` (8), `highlight` (false), `onSelect(tipId, viewer)`, `icon` | find tips by label (prefix matches first, case-insensitive on the displayed label), keyboard list; focuses the chosen tip |
| `Legend` | bottom-right | `title`, `items` (`{colour, label, detail?, node?}[]` instead of the clade colours), `cladeLabel` (overrides the viewer option) | the clade colours with their names; click to zoom to a clade; hidden while empty; follows `formatLabel` and `cladeLabel` changes. A clade is named by its `setClades` label, else by its node's name and tip count (`Chelodina ott1 (12 tips)`; see Naming clades), else `Clade of 12 tips` (`Unnamed tip` for a tip with no label) |
| `OverviewControl` | custom | | the whole tree in small with the window box (a strip right of the rectangular plot, which leaves room for it; a disc in radial) |

`defaultControls({ zoom, fit, layoutToggle, search, legend, overview })` returns the usual set: zoom and fit on, the others off; each key is
`true`, `false` or that control's options. `ICONS` holds the default icons (16 px SVG in `currentColor`).

## Overlays and popups ([`src/overlays/`](../src/overlays))

All three are controls with position `'custom'`: add them with `addControl`.

| Class | Options | What it does |
|---|---|---|
| `Overlay` | `element`, `positioning` (`'top-left'`; vertical-horizontal, e.g. `'bottom-center'`), `offset` (`[x, y]`), `keepInside` (true), `anchor` | an element of yours pinned to `{node}`, `{tipId}` or `{x, y}` (`setPosition(anchor)`, `null` hides it); placed after every frame through `nodePosition`, hidden while the anchor is out of view. `setPositioning`, `getPosition`, `update()` |
| `Tooltip` | `render(e, viewer)` returning a node, a string or null; `offset` (`[14, 14]`) | hover box near the pointer (default content: `defaultTooltip`); a default action of `hover` |
| `NodeMenu` | `items(e, viewer)` returning `NodeMenuItem[]` or null; `title(e, viewer)` | actions for the clicked tip or clade at the click; keyboard (focus on the first item when opened by Enter, arrows, Escape, Tab out), closes on a press outside, a view change or a choice; a default action of `click`. `setItems`, `isOpen`, `close(refocusTree)` |

`NodeMenuItem`: `{ id, label, hint?, disabled?, onSelect(e) }`.

## Columns

```ts
type Column = BuiltinColumn | CustomColumn;
BuiltinColumn: { id, kind: 'bar' | 'text' | 'alignment', header, width, values: Record<tipLabel, number | string> }
CustomColumn:  { id, kind: 'custom', header, width, values: Record<tipLabel, V>, renderer: ColumnRenderer<V, D> }
```

`values` (and `renderer`) are compared by reference when columns are set again: pass the same object while the data is unchanged and a new
one when it changed; never mutate in place. Built-in kinds: log-scaled bars (binned per pixel row below 1.5 px per row), text (tinted bands
below 9 px), alignments (residue colours or ETE-style blocks, see `alignStyle` and `alignRowGap`).

A `ColumnRenderer` draws a custom column:

| Member | Meaning |
|---|---|
| `prepare({ values, tipLabels, tipCount })` | runs when the values or the renderer change; return whatever is fast to draw, typically arrays by tip rank |
| `draw(ctx, frame, data)` | runs once per frame, the canvas clipped to the column, transform in CSS px. `frame`: `x, width, top, bottom`, visible ranks `r0..r1` (inclusive), row r at `y = oy + r * rowHeight`, `theme`. Draw all visible rows in this one call; below 1 px per row draw a summary |
| `hasCell?(data, rank)` | which ranks have a cell (for `columnCell`); default: a value exists for the tip |

The viewer draws the header. A renderer that throws is reported once and the frame goes on. See the heat strip in
[`examples/vanilla/src/main.ts`](../../../examples/vanilla/src/main.ts).

## Theme ([`src/theme.ts`](../src/theme.ts))

The theme in force is `FALLBACK_THEME`, then the `--phylo-*` custom properties set on the target or any ancestor, then `setTheme`'s
overrides. The viewer writes the colours and font in force back on its root, so the controls and popups (styled by `viewer.css` with the same
properties) follow a theme from JavaScript too. A dark mode is a set of custom properties:

```css
.dark {
  --phylo-background: #0f172a; --phylo-foreground: #e2e8f0; --phylo-muted: #94a3b8;
  --phylo-branch: #cbd5e1; --phylo-summary: #64748b; --phylo-highlight: #7dd87f; --phylo-surface: #1e293b;
}
```

`TreeTheme` (canvas). The CSS property is `--phylo-` plus the field in kebab case (`THEME_CSS_VARS`); numbers may carry `px`.

| Field | CSS property | Default | Meaning |
|---|---|---|---|
| `background`, `foreground`, `muted` | `--phylo-background`, ... | `#ffffff`, `#162d3d`, `#6b7c8a` | canvas (may be `transparent` or translucent: the page shows through; the canvas is opaque, which is faster, whenever this colour is), labels and axis text, axis lines and headers |
| `branch`, `highlight`, `summary` | `--phylo-branch`, ... | `#44576a`, `#4c9b45`, `#9aa7b3` | branches, selection and focus, collapsed clades |
| `fontFamily` | `--phylo-font-family` | `system-ui, sans-serif` | labels and axis |
| `categorical` | `--phylo-categorical` (comma list) | 5 colours | palette for categories; the second colours bar columns |
| `branchWidth`, `cladeBranchWidth` | `--phylo-branch-width`, ... | 1.3, 2 | line widths (px) |
| `tipRadius`, `nodeMarkerSize` | `--phylo-tip-radius`, ... | 3.2, 4 | largest tip dot radius, node marker side (px) |
| `summaryOpacity`, `markerOpacity`, `highlightOpacity` | `--phylo-summary-opacity`, ... | 0.6, 0.85, 0.16 | collapsed clades, markers, highlight band |
| `labelSize`, `axisFontSize` | `--phylo-label-size`, ... | 13, 10 | largest label size (labels shrink with the rows, down to 8), axis text (px) |
| `dark` | `--phylo-dark` | from the background's luminance | the background is dark: informational, for apps and custom controls (the drawing code does not read it) |

DOM only (`viewer.css`): `--phylo-surface` (control and popup background), `--phylo-surface-hover`, `--phylo-border`, `--phylo-radius`,
`--phylo-control-radius`, `--phylo-control-size`, `--phylo-shadow`, `--phylo-popup-shadow`, `--phylo-gap`, `--phylo-font-size`,
`--phylo-transition`. Class names to style: `.phylo-viewer`, `.phylo-controls--<corner>`, `.phylo-control`, `.phylo-<control name>`,
`.phylo-button`, `.phylo-bar`, `.phylo-tooltip`, `.phylo-node-menu`, `.phylo-legend`, `.phylo-search`, `.phylo-overview`, `.phylo-notice`.

`themeFromCss(element)` returns the fields set as custom properties there; `themeEquals(a, b)` compares two themes.

## ViewerOptions

`ViewerOptions` in `types.ts`; default in the second column.

| Option | Default | Meaning |
|---|---|---|
| `layout` | `'rectangular'` | `'rectangular'` or `'radial'` |
| `branchLengths` | `true` | phylogram (true) or cladogram; a tree without lengths is drawn as a cladogram either way |
| `lod` | `true` | viewport level of detail: collapse small clades into summaries, dedupe sub-pixel primitives |
| `drawBudget` | `20000` | most primitives per frame; the collapse threshold is raised until the cut fits (min 500; LOD off: 600,000) |
| `showSummaries` | `true` | draw collapsed clades as triangles (otherwise only their branch) |
| `labelDensity` | `'normal'` | `'sparse'`, `'normal'` or `'dense'`: minimum tip pitch for a label (`LABEL_MIN_PX` in `draw.ts`: 16, 11, 8 px) |
| `rowHeight` | `null` | fixed px per tip row at fit (rectangular); `null` fits all tips into the height |
| `axis` | `true` | scale bar (radial) or time/length axis (rectangular) |
| `italicLabels` | `true` | italic tip labels |
| `minCladePx` | `3` | collapse clades smaller than this many px (the base threshold of the cut) |
| `alignStyle` | `'residues'` | alignment columns: coloured cells, or `'blocks'` (grey gap-free stretches joined by a line) |
| `alignRowGap` | `0` | alignment columns: empty px between sequences (rows at least 4 px tall) |
| `formatLabel` | underscores to spaces | `(tipId) => string`, the displayed tip label |
| `cladeLabel` | `null` | `(node, tree) => string \| null`, the name of an internal node (`node`: preorder id in the full tree; `tree`: the snapshot, label at `tree.labels[tree.toLocal(node)]`); null = none. See Naming clades |
| `tipHref` | `null` | `(tipId) => url`; makes visible labels real links (`<a href data-tip-id>`) |
| `ariaLabel` | `'Phylogenetic tree'` | label of the root element |
| `softwareCanvas` | `false` | create the 2D contexts with `willReadFrequently` (CPU-backed canvas); read at construction only |
| `dprCap` | `2` | cap on canvas pixels per CSS px (`Infinity` = native); hit-testing and events use CSS px |
| `radialMaxNodes` | `2000` | radial only: most primitives per frame; small clades become fans (`Infinity` = only `drawBudget`) |
| `interactionLOD` | `true` | draw reduced frames while wheeling, pinching or dragging |
| `refineMs` | `120` | ms without input before the full-quality frame after a gesture |
| `summaryNotice` | `true` | radial: corner notice when the cut-off summarises clades the normal threshold would show |

The overview is a control (`OverviewControl`), not an option.

## Other types

`Hit` (`hitTest`): `{ node (a row; for a run, the parent), kind, run?: {first, last} }`.

`FrameStats` (all numbers unless noted): `frameMs` JS time of the frame (cut and draw, not raster), `cutMs`, `drawMs`, `visited` nodes looked at by the cut,
`drawn` primitives in the draw list, `summaries`, `tips`, `labels`, `minPxUsed` effective collapse threshold, `budgetRetries` passes beyond the
first, `budgetHit` / `truncated` (booleans: the threshold was raised / even the highest one overflowed), `frames` total, `budget` in force this frame,
`forced` summary fans the base threshold would have expanded, `summaryTips` tips inside drawn summaries, `mergedTips` tips of primitives not emitted
because they share pixel cells, `reduced` (boolean: an interaction frame), `scale` canvas pixels per CSS px.

`Viewport {x0, x1, y0, y1}`: rectangular: x in 0..1 root to tips, y in tip rows; radial: world units, root at the origin, outermost tip circle
radius 1. `CladeColour {node, colour, label?}`.

### TreeData, TreeSnapshot, TreeSource

Detail and the invariants: [`types.ts`](../src/types.ts), [`source.ts`](../src/source.ts), and "Invariants" and "Add a TreeSource" in
[internals.md](internals.md).

* `TreeData`: the tree as typed arrays in preorder: `nodeCount, tipCount, parent, firstChild, nextSibling, childCount, subtreeEnd, length` (NaN when
  missing), `leafStart, leafEnd` (tip rank range), `tipNode, tipRank, tipLabels, labels, hasLengths`, `heights()`, `tipIndex(label)`. `@gbif-phylo/io`'s
  `TreeModel` satisfies it.
* `TreeSnapshot extends TreeData`: what the viewer reads each frame, over the rows currently loaded. Adds `stub` (1 = a clade whose rows are
  not loaded), `globalId` (row to preorder id of the full tree), `rollup` (`cumLength, maxCum, depth, maxDepth, row` per row), `toLocal(globalId)`.
  All three are null for an in-memory tree.
* `TreeSource`: `nodeCount`, `tipCount`, `hasLengths` (of the full tree), `version`, `subscribe(listener)` returning an unsubscribe,
  `snapshot()`, `ensureClade(globalId, {signal, priority})`, optional `openCost(globalId)`, `tipLabels(r0, r1)` (async), `destroy()`.
  `InMemorySource` is the version-0 implementation; `isTreeSource(x)` tells the two apart.

## `<TreeView>`

`@gbif-phylo/react` ([`TreeView.tsx`](../../react/src/TreeView.tsx)); load `@gbif-phylo/viewer/viewer.css` as well. The identity rules of the
props (what counts as changed) are in the JSDoc of `TreeViewProps` and in [internals.md](internals.md#react-identity).

Props (all optional, but one of `tree` / `source` is needed):

| Prop | Meaning |
|---|---|
| `tree`, `source` | one of the two: a `TreeData` or a `TreeSource`; `source` wins. Changing either re-creates the viewer |
| `layout`, `branchLengths` | as the options of the same name (defaults `'rectangular'`, `true`). Like the `options` fields, applied when the prop changes: a layout chosen with the `LayoutToggle` control stays until the prop changes |
| `clades` | `{nodeId: 'n<preorder id>', colour, label?}[]` |
| `highlighted` | tip labels to highlight |
| `collapsed` | node ids (`'n<id>'`) of tips that stand for collapsed clades |
| `columns` | `Column[]`, built-in or custom; replace a column and its `values` when the data changes, never mutate them; ids unique |
| `controls` | `Control[]` (default `defaultControls()`: zoom and fit; `[]` for none); compared by identity, so create them once (`useMemo`) |
| `viewport` | controlled `Viewport`; omit for uncontrolled |
| `theme` | `Partial<TreeTheme>` over the CSS theme |
| `tipHref` | `(tipId) => url` or `null` |
| `focus` | `{tipId, seq}`: centre that tip; acts when `seq` changes |
| `options` | any `ViewerOptions` field except `layout`, `branchLengths`, `tipHref`; a key that is absent or `undefined` is the default; `softwareCanvas` re-creates the viewer |
| `tooltip` | `true` (default tooltip), `false`, or `(e) => ReactNode` (rendered into the viewer's tooltip box) |
| `nodeMenu` | `(e) => NodeMenuItem[] \| null`: the actions of the node menu for the clicked tip or clade |
| `width`, `height`, `className`, `style` | the wrapper's size (default 100%) and styling |
| `onNodeClick`, `onTipClick`, `onHover`, `onViewportChange`, `onFrame`, `onReady` | callbacks; `onReady({layoutMs, tips})` fires two animation frames after creation |

`TreeNodeEvent` is `TreeEvent`. `TreeViewHandle` (via `ref`): `fit()`, `focusTip(tipId)`, `zoomToNode(nodeId)`, `getViewport()`,
`setViewport(v)`, `locateTip(tipId)`, `locateNode(nodeId)`, `nodeBounds(nodeId)`, `columnCell(colId, tipId)`, `getStats()`, `benchmark(n)`,
`renderer()` (the underlying `TreeViewer` or `null`, for everything else: events, controls). Methods that take ids translate them to node
indexes and leaf ranks; unknown ids are ignored or return `null`.

## Naming clades

One rule names an internal node in the legend, the node menu's default title, the default tooltip's detail line and the keyboard cursor's announcement:
the name is the `cladeLabel` option's result, or by default the node's label without its support value (`95:Chelodina_ott1` gives `Chelodina_ott1`,
`98.0:c__Nitrososphaeria` gives `c__Nitrososphaeria`, `95` gives no name); it goes through `formatLabel`; with no name the places say `Clade of N tips`.
A tip is named by its own label through `formatLabel`. Return null from `cladeLabel` to hide a synthetic name (OTL's `mrcaott…`) or return a name looked up elsewhere.

Exported helpers:

| Export | Signature |
|---|---|
| `internalName` | `(label: string) => string`: the label without its support value, `''` if it was only a support. The same rule as `splitInternalLabel(label).name` in `@gbif-phylo/io` (a test compares them) |
| `cladeName` | `(tree: TreeSnapshot, row: number, opts: { formatLabel, cladeLabel? }) => string \| null`: the display name of the snapshot row `row`; passes `cladeLabel` the full-tree id of the node |
| `CladeLabelFn` | `(node: number, tree: TreeSnapshot) => string \| null \| undefined` |
