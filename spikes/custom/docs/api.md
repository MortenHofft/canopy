# API reference: custom renderer core and `<TreeView>`

One or two lines per entry; the detail is in the source comments, linked per section. Types are in
[`src/core/types.ts`](../src/core/types.ts) unless said otherwise. Defaults are `DEFAULT_OPTIONS` in that file. The identity rules of the `<TreeView>` props
(what counts as changed) are in the JSDoc of `TreeViewProps` in [`src/react/TreeView.tsx`](../src/react/TreeView.tsx) and summarised in the
[README](../README.md).

Everything is imported from `src/core/index.ts` (core, no React) or `src/react/TreeView.tsx`.

## TreeRenderer ([`src/core/renderer.ts`](../src/core/renderer.ts))

```ts
new TreeRenderer(host: HTMLElement, tree: TreeData | TreeSource, cb?: RendererCallbacks, opts?: Partial<RendererOptions>, theme?: TreeTheme)
```

Creates its DOM (canvases, label layer, overview, notice, screen-reader list) inside `host`, sizes itself to `host` with a ResizeObserver and
draws on demand with `requestAnimationFrame`. A `TreeData` is wrapped in an `InMemorySource`; a `TreeSource` is used as it is. `opts` is merged over
`DEFAULT_OPTIONS`; `theme` defaults to `FALLBACK_THEME`. Options other than `softwareCanvas` can be changed later with `setOptions`.

Properties

| Member | Meaning |
|---|---|
| `root: HTMLDivElement` | the element the renderer added to `host` |
| `layout: Layout` | the current layout arrays (`X`, `ROW`, `XMAX`, `LAST`, `layoutMs`, ...), `layout.ts` |
| `options: Readonly<RendererOptions>` | the options in force |
| `size: {width, height}` | container size in CSS px |
| `stats: FrameStats` | the stats object of the last frame, mutated in place (see `getStats` for a copy) |

State setters

| Method | Meaning |
|---|---|
| `setOptions(patch)` | change options (undefined and unchanged values are ignored, a call that changes nothing does not redraw); refits when `layout`, `branchLengths`, `overview`, `axis` or `rowHeight` changed |
| `setTheme(theme)` | new colours and font (no-op when every field is equal); redraws (and clears the label overlay so fonts are re-measured) |
| `setClades(clades: CladeColour[])` | colour clades; `node` is the preorder id (full tree), later entries win; nodes not in the snapshot are skipped |
| `setHighlighted(tipIds: string[])` | highlight tips by label (row band, ring, bold label, overview ticks); unknown labels are ignored; no-op for the same ids in the same order |
| `setColumns(columns: Column[])` | aligned per-tip columns (rectangular layout only); only changed columns are recompiled (`values` compared by reference, ids must be unique); refits when the total width changes |

Navigation and view

| Method | Meaning |
|---|---|
| `getViewport()` / `setViewport(v, animate = false)` | the visible window in layout coordinates (`Viewport`); `setViewport` clamps it to the limits and ignores an empty window |
| `fit(animate = true)` | fit the whole tree and columns into the container |
| `zoomBy(fx, fy, px, py)` | zoom by factors (>1 zooms in) keeping container point (px, py) fixed |
| `focusTip(rank, animate = false)` | bring the tip of leaf rank `rank` into view; ignored when its row is not loaded |
| `zoomToNode(id, animate = false)` | show the clade below node `id` (preorder id of the full tree); ignored when not loaded |

Introspection (each draws a settled full-quality frame first)

| Method | Meaning |
|---|---|
| `locateNode(id)` | client-px position of node `id` as a click would hit it, or `null` when not drawn or out of view |
| `nodeBounds(id)` | client-px box of the clade below `id`, clipped to the plot area, or `null` |
| `columnCell(colId, rank)` | client-px box of a column cell, or `null` |
| `hitTest(x, y)` | what a click at container-px (x, y) would target: a `Hit` or `null` |

Stats, frame control and lifetime

| Method | Meaning |
|---|---|
| `getStats()` | copy of `stats` plus `layoutMs, hitBuildMs, avgFrameMs, maxFrameMs, listLength, hitItems, hitEntries, kx, ky` (does not draw) |
| `resetFrameTimes()` | reset the average and maximum frame time counters |
| `renderNow()` | draw synchronously if something changed (introspection, benchmarks) |
| `invalidate(fonts = false)` | schedule a redraw; `fonts = true` also clears the label overlay |
| `benchmark(n)` | force `n` full redraws; returns mean, min and max JS ms per frame and mean cut and draw ms |
| `destroy()` | cancel the frame loop, remove listeners, observers and DOM; the instance is dead afterwards |

## RendererOptions

`RendererOptions` in `types.ts`; default in the second column.

| Option | Default | Meaning |
|---|---|---|
| `layout` | `'rectangular'` | `'rectangular'` or `'radial'` |
| `branchLengths` | `true` | phylogram (true) or cladogram; a tree without lengths is drawn as a cladogram either way |
| `lod` | `true` | viewport level of detail: collapse small clades into summaries, dedupe sub-pixel primitives |
| `drawBudget` | `20000` | most primitives per frame; the collapse threshold is raised until the cut fits (min 500; LOD off: 600,000) |
| `showSummaries` | `true` | draw collapsed clades as triangles (otherwise only their branch) |
| `overview` | `true` | overview strip (rectangular) or disc (radial) with the window box |
| `labelDensity` | `'normal'` | `'sparse'`, `'normal'` or `'dense'`: minimum tip pitch for a label (`LABEL_MIN_PX` in `draw.ts`: 16, 11, 8 px) |
| `rowHeight` | `null` | fixed px per tip row at fit (rectangular); `null` fits all tips into the height |
| `axis` | `true` | scale bar (radial) or time/length axis (rectangular) |
| `italicLabels` | `true` | italic tip labels |
| `minCladePx` | `3` | collapse clades smaller than this many px (the base threshold of the cut) |
| `alignStyle` | `'residues'` | alignment columns: coloured cells, or `'blocks'` (grey gap-free stretches joined by a line) |
| `alignRowGap` | `0` | alignment columns: empty px between sequences (rows at least 4 px tall) |
| `formatLabel` | underscores to spaces | `(tipId) => string`, the displayed tip label |
| `tipHref` | `null` | `(tipId) => url`; makes visible labels real links (`<a href data-tip-id>`) |
| `ariaLabel` | `'Phylogenetic tree'` | label of the root element |
| `softwareCanvas` | `false` | create the 2D contexts with `willReadFrequently` (CPU-backed canvas); read at construction only |
| `dprCap` | `2` | cap on canvas pixels per CSS px (`Infinity` = native); hit-testing and events use CSS px |
| `radialMaxNodes` | `2000` | radial only: most primitives per frame; small clades become fans (`Infinity` = only `drawBudget`) |
| `interactionLOD` | `true` | draw reduced frames while wheeling, pinching or dragging |
| `refineMs` | `120` | ms without input before the full-quality frame after a gesture |
| `summaryNotice` | `true` | radial: corner notice when the cut-off summarises clades the normal threshold would show |

## RendererCallbacks, NodeEvent, Hit

`RendererCallbacks` (all optional): `onClick(e: NodeEvent)`, `onHover(e: NodeEvent | null)`, `onViewportChange(v: Viewport)` (when the window
changed, after a frame), `onFrame(s: FrameStats)` (after every frame; the object is reused).

`NodeEvent`

| Field | Meaning |
|---|---|
| `node` | node id; with a partial source the preorder id in the FULL tree |
| `isTip`, `tipId` | tip or not; the tip's label when it is loaded |
| `kind` | `'tip'`, `'node'` (internal node marker), `'summary'` (collapsed clade, or a run) or `'branch'` |
| `tipStart`, `tipEnd` | descendant tips are the leaf-rank range `[tipStart, tipEnd)` |
| `clientX`, `clientY` | position for tooltips |
| `via` | `'pointer'` or `'keyboard'` |
| `run?` | set for a run of small siblings drawn as one slice: `node` is their parent, the range is only the run's, `{clades, single}` counts what it holds |

`Hit` (`hitTest`): `{ node (a row; for a run, the parent), kind, run?: {first, last} }`.

`FrameStats` (all numbers unless noted): `frameMs` JS time of the frame (cut and draw, not raster), `cutMs`, `drawMs`, `visited` nodes looked at by the cut,
`drawn` primitives in the draw list, `summaries`, `tips`, `labels`, `minPxUsed` effective collapse threshold, `budgetRetries` passes beyond the
first, `budgetHit` / `truncated` (booleans: the threshold was raised / even the highest one overflowed), `frames` total, `budget` in force this frame,
`forced` summary fans the base threshold would have expanded, `summaryTips` tips inside drawn summaries, `mergedTips` tips of primitives not emitted
because they share pixel cells, `reduced` (boolean: an interaction frame), `scale` canvas pixels per CSS px.

Other types: `Viewport {x0, x1, y0, y1}` (rectangular: x in 0..1 root to tips, y in tip rows; radial: world units, root at the origin, outermost
tip circle radius 1), `TreeTheme` (`dark, background, foreground, muted, branch, highlight, summary, fontFamily, categorical`), `CladeColour {node,
colour}`, `Column {id, kind: 'bar' | 'text' | 'alignment', header, width, values: Record<tipLabel, number | string>}`.

## TreeData, TreeSnapshot, TreeSource

Detail and the invariants: [`types.ts`](../src/core/types.ts), [`source.ts`](../src/core/source.ts), and "Invariants" and "Add a TreeSource" in
the [README](../README.md).

* `TreeData`: the tree as typed arrays in preorder: `nodeCount, tipCount, parent, firstChild, nextSibling, childCount, subtreeEnd, length` (NaN when
  missing), `leafStart, leafEnd` (tip rank range), `tipNode, tipRank, tipLabels, labels, hasLengths`, `heights()`, `tipIndex(label)`. The shared
  `TreeModel` (`spikes/shared/tree.ts`) satisfies it.
* `TreeSnapshot extends TreeData`: what the renderer reads each frame, over the rows currently loaded. Adds `stub` (1 = a clade whose rows are
  not loaded), `globalId` (row to preorder id of the full tree), `rollup` (`cumLength, maxCum, depth, maxDepth, row` per row), `toLocal(globalId)`.
  All three are null for an in-memory tree.
* `TreeSource`: `nodeCount`, `tipCount`, `hasLengths` (of the full tree), `version`, `subscribe(listener)` returning an unsubscribe,
  `snapshot()`, `ensureClade(globalId, {signal, priority})`, optional `openCost(globalId)`, `tipLabels(r0, r1)` (async), `destroy()`.
  `InMemorySource` is the version-0 implementation; `isTreeSource(x)` tells the two apart.

## `<TreeView>` ([`src/react/TreeView.tsx`](../src/react/TreeView.tsx))

Props (all optional, but one of `tree` / `source` is needed):

| Prop | Meaning |
|---|---|
| `tree`, `source` | one of the two: a `TreeData` (wrapped in an `InMemorySource`) or a `TreeSource`; `source` wins. Changing either re-creates the renderer |
| `layout`, `branchLengths` | as the options of the same name (defaults `'rectangular'`, `true`) |
| `clades` | `{nodeId: 'n<preorder id>', colour}[]` |
| `highlighted` | tip labels to highlight |
| `columns` | `Column[]`; replace a column and its `values` when the data changes, never mutate them; ids unique |
| `viewport` | controlled `Viewport`; omit for uncontrolled |
| `theme` | `Partial<TreeTheme>` over `FALLBACK_THEME` |
| `tipHref` | `(tipId) => url` or `null` |
| `focus` | `{tipId, seq}`: centre that tip; acts when `seq` changes |
| `options` | any `RendererOptions` field except `layout`, `branchLengths`, `tipHref`; a key that is absent or `undefined` is the default (removing a key reverts it); `softwareCanvas` re-creates the renderer |
| `tooltip` | `true` (default tooltip), `false`, or `(e: TreeNodeEvent) => ReactNode` |
| `width`, `height`, `className`, `style` | the wrapper's size (default 100%) and styling |
| `onNodeClick`, `onTipClick`, `onHover`, `onViewportChange`, `onFrame`, `onReady` | callbacks; `onReady({layoutMs, tips})` fires two animation frames after creation |

`TreeNodeEvent`: `nodeId` (`'n<id>'`), `node`, `isTip`, `kind`, `tipId`, `tipCount`, `tipRange: [start, end)`, `tipIds()` (the loaded labels in the
range), `tipLabels()` (promise, through the source, also for unloaded clades), `via`, `clientX`, `clientY`, `run?`.

`TreeViewHandle` (via `ref`): `fit()`, `focusTip(tipId)`, `zoomToNode(nodeId)`, `getViewport()`, `setViewport(v)`, `locateTip(tipId)`,
`locateNode(nodeId)`, `nodeBounds(nodeId)`, `columnCell(colId, tipId)`, `getStats()`, `benchmark(n)`, `renderer()` (the underlying `TreeRenderer`
or `null`). Methods that take ids translate them to node indexes and leaf ranks; unknown ids are ignored or return `null`.
