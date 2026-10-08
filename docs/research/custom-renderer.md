# Custom React renderer: feasibility, architecture and effort

Part A of the "build it ourselves" assessment. Judged against [goal.md](../goal.md) criteria 1 to 16. Companion document: [data-layer.md](data-layer.md).

Evidence conventions: **verified** = read in source or docs fetched during this research (URL or file given); **measured** = run by us (own prototype, Node 22, 4 vCPU sandbox, no browser available, so no frame-rate numbers); **UNVERIFIED** = general knowledge or not confirmed. Repos were cloned read-only into the scratchpad and nothing from them was executed.

## 1. Summary

- A custom renderer is feasible and is the only route that satisfies criteria 11 to 14 and 16 by construction (React callbacks, aligned React-rendered columns, semantic zoom, theming). Nothing in the existing-library field was found to do all of these.
- The heavy parts are not the drawing but (a) a typed-array data core with O(n) layout, (b) viewport-driven level of detail (LOD), and (c) the column/summary system. These are the same ideas ETE uses ([ete-ideas.md](../ete-ideas.md)); the open-source implementations that show them (Taxonium, Empress, Phylo.io, OneZoom) are either GPL, source-available, or only partly reusable (section 9).
- Own prototype (measured): a 1M-tip tree parses to struct-of-arrays in about 1.5 s, lays out in 0.3 s, and the per-frame LOD cut costs well under 1 ms of CPU on balanced trees. The data side is not the bottleneck at 1M tips. Drawing and labels are.
- Caterpillar-like (ladderised, deeply nested) trees defeat a pure "clade pixel height" LOD rule (measured, section 6.3). Real GBIF trees may be ladderised, so the LOD rule needs a second criterion.

| Scope | Estimate (engineer-weeks, 1 senior front-end engineer familiar with React and canvas) |
|-------|------|
| MVP: rectangular, Canvas2D, pan/zoom, click/hover/highlight/focus, collapse, 1 custom column, 100k tips | **9 (range 7 to 12)** |
| Full: MVP plus circular, WebGL, summaries at low zoom, multiple columns, export, full accessibility | **+22 (range 18 to 30)**, so about **31 total (25 to 42)** |
| Data layer (see data-layer.md): Newick/Nexus parser, phyloXML, NeXML, tip matching service | 8 to 11, partly shared with any other option |

Breakdown and assumptions in section 11.

## 2. Layout algorithms at 100k to 1M tips

### 2.1 What d3 gives us (verified from source)

- `d3-hierarchy` 3.1.2, licence ISC (`package.json`, cloned repo). `hierarchy()` builds nodes with an explicit stack (`src/hierarchy/index.js`), and `eachAfter` uses two explicit arrays, not recursion (`src/hierarchy/eachAfter.js`). So it does not overflow the call stack on a caterpillar tree.
- `d3.cluster` (`src/cluster.js`) is a dendrogram: leaves get evenly spaced `x`, internal nodes the mean of their children, and `y` is derived from node *height* (levels), not branch length. This is a cladogram. A phylogram needs `y` (our depth axis) replaced by cumulative branch length, which is trivial, one extra pass.
- Cost: d3 allocates one JS object per node (`Node` with `data`, `depth`, `height`, `parent`, `children`). At 2M nodes (1M tips, binary) that is hundreds of MB and GC pressure. UNVERIFIED as a number; we did not run d3. The design consequence is what matters: keep d3 for small trees or for reference tests, not for the 1M path.
- `d3-flextree` 2.1.2 is licence **WTFPL** (`LICENSE` in the clone), a Reingold-Tilford variant for variable node sizes. Not needed: phylogenies do not need Reingold-Tilford, because rectangular layout is fully determined (leaf index gives one axis, cumulative length the other). Reingold-Tilford only matters for generic trees (cladograms drawn compactly, or varying row heights). If variable row heights are wanted later (expanded rows showing thumbnails), do it as a prefix-sum over leaf heights, not a new tree algorithm.

### 2.2 Own O(n) layout (design, measured)

Rectangular phylogram and cladogram:

1. Parse to struct-of-arrays in post-order (children before parents, root last). Both the knhx-style parsers (jstreeview, PhyloJS) and our prototype produce this order naturally.
2. One forward pass computes `y`: leaf `y` = running leaf counter; internal `y` = midpoint of first and last child (the "midpoint" convention) or the mean of children (what `d3.cluster` does). Track `firstChildY`, `lastChildY` per parent while scanning. Also track `leafLo`/`leafHi` (leaf index range per node) in the same pass.
3. One reverse pass computes `x` = parent `x` + own branch length (phylogram) or by depth (cladogram, "aligned tips" variant: ultrametric-style where tips are right-aligned, `x_tip = max`).
4. Branch-length scaling is a single linear transform from the data range to pixels, applied at draw time (not stored), so zoom costs nothing. Missing branch lengths: substitute 1 (and flag the tree "no lengths" so the UI offers cladogram only), since the layout must not produce NaN.

Circular layout: same `y` becomes angle `theta = 2*pi*y/nLeaves`, `x` becomes radius. Branches are an arc at the parent's radius spanning the children's angles plus a radial line. No new tree algorithm, but LOD, hit-testing and labels are harder (section 6, 7). Unrooted (equal-angle or daylight): needs a different O(n) pass (equal-angle is O(n); daylight is iterative and not O(n)). Goal.md lists unrooted as "(unrooted)", i.e. optional. Treat as phase 3.

Measured (own prototype, 1M tips balanced random binary tree, 2M nodes, Node 22, one thread):

| Step | 1M tips | 100k tips | 200k-tip caterpillar |
|------|---------|-----------|----------------------|
| Parse 40.6 MB Newick to typed arrays | 1520 ms | 148 ms | 101 ms |
| Layout (x from lengths, y midpoint-mean) | 309 ms | 9 ms | 41 ms |
| Child CSR index build | 187 ms | 11 ms | 46 ms |

Caveats: wall time in Node, JIT-warm only partly; the browser will differ by maybe 1.5x either way (UNVERIFIED). Parsing should run in a Worker (section 5.3) so 1.5 s does not block the UI.

### 2.3 Memory layout for 1M nodes (struct of arrays)

Per node in the prototype: `parent` Int32 (4 B), `len` Float64 (8; Float32 is enough, 4), `nameStart`/`nameEnd` Int32 offsets into the source string (8), `nChildren` Int32 (4), `x` and `y` Float32 (8), `leafLo`/`leafHi` Int32 (8), CSR `childStart` and `children` Int32 (8). That is about 52 B per node, so a 2M-node tree is about 104 MB of typed arrays, plus the source text (about 41 MB for the 1M-tip test file; one byte per char if the engine stores it as Latin-1, two otherwise, UNVERIFIED). Labels are never materialised as JS strings until needed (search index, hover, visible rows): slice from the source string or a `TextDecoder` over the original bytes.

Hit-test and viewport queries over these arrays need no object graph. A `Flatbush` 4.6.2 index (ISC; "static spatial index ... single array buffer ... transferable between threads", README in clone) could index node bounding boxes in about 8 B x 4 per node; but because rectangular layout is monotonic in `y` (leaves sorted), a binary search over `leafLo`/`y` is enough for most queries (section 7).

## 3. Rendering stacks

All candidates are MIT/ISC/BSD/Apache-compatible with Apache-2.0 gbif.org (licences read from `LICENSE`/`package.json` in the clones):

| Stack | Licence (verified) | Notes |
|-------|--------------------|-------|
| Canvas2D | browser API | `moveTo/lineTo/stroke` batches; no dependency. Practical ceiling UNVERIFIED by us (no browser here); common experience is tens of thousands of segments at 60 fps, which is why LOD must cap the draw list. Our LOD cut (section 6) keeps draw lists to a few thousand to a few hundred thousand primitives. |
| deck.gl 9.x | MIT (`LICENSE`, vis.gl contributors) | Docs state basic layers "render fluidly at 60 FPS ... up to about 1M data items", dropping to 10 to 20 FPS near 10M items, on 2015 MacBook Pros (`docs/developer-guide/performance.md`). `OrthographicView` supports independent `zoomX`/`zoomY` (`docs/api-reference/core/orthographic-view.md`). `TextLayer` builds a font atlas with optional SDF (`text-layer.md`). Picking by colour-encoded offscreen pass; limit 255*255*255-1 objects per layer, and "picking does not work for objects that are offscreen" (`interactivity.md`). Large dependency footprint (luma.gl, loaders.gl, math.gl): bundle size UNVERIFIED. Taxonium (GPL) uses it, so it is proven for trees. |
| PixiJS 8.22 | MIT (`LICENSE`, `package.json`) | WebGL and WebGPU renderers, scene-graph oriented. Good for sprites and text, less natural for 100k line segments; no phylo precedent found. UNVERIFIED for throughput. |
| regl 2.1.1 | MIT | Thin functional WebGL wrapper; benchmarks in repo (`bench/`) not inspected. Smaller than deck.gl, but we write shaders for lines, picking and text. |
| Raw WebGL | n/a | Maximum control (Empress draws with hand-written WebGL: `empress/support_files/js/drawer.js` uses `canvas.getContext("webgl")`, BSD-3-Clause), maximum effort. |
| OffscreenCanvas + Worker | MDN: "Baseline: Widely available ... since March 2023" (fetched) | `transferControlToOffscreen()` moves a canvas into a worker, with `requestAnimationFrame` available there. Frees the main thread for React. Costs: events must be forwarded; fonts and `measureText` work in workers but have been a compatibility risk (UNVERIFIED). |

Recommendation: **Canvas2D first** behind a small `Renderer` interface (draw list in, pixels out), then a WebGL implementation (deck.gl OrthographicView or regl) only if profiling on real GBIF trees shows the LOD-bounded draw list is still too heavy. The LOD design (section 6) is what bounds the cost, not the API. If WebGL is needed, deck.gl is the lowest-risk pick (MIT, maintained as of the clone, `zoomX/zoomY` built in, picking built in, React component `DeckGL`), at the price of a large bundle. UNVERIFIED: whether deck.gl can render crisp labels with SDF at the sizes phylo trees need; the `TextLayer` options exist (`fontSettings.sdf`, `characterSet`) and `CollisionFilterExtension` exists in the clone for decluttering, but we did not test.

## 4. Text rendering for labels at scale

- Labels are the first thing LOD must drop: a label needs about 10 to 12 px of row height. Rule: draw tip labels only when `pxPerLeaf >= ~12` (tunable); between 4 and 12 px show every k-th label or only highlighted/selected ones; below that show clade labels only (section 6.4).
- Canvas2D `fillText` is fine for a few hundred labels per frame. At that scale the visible rows number at most `viewportHeight / 12` (about 80 on a 1000 px canvas), so cost is bounded regardless of tree size. This is the key insight: with correct LOD the label count is bounded by screen height, not by tip count.
- Label measurement: cache `measureText` widths by string; for aligned columns, measure only visible rows.
- WebGL text (SDF atlas, deck.gl `TextLayer`, `troika-three-text` UNVERIFIED) is only needed if a clade-label overlay with thousands of labels is wanted. Not needed for MVP.
- Rotated labels for circular layout: `ctx.rotate` per label; same bound applies.

## 5. React integration

### 5.1 Pattern: headless core + imperative canvas + thin React layer

Following the React docs for external stores (`useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot?)`: "repeated calls to getSnapshot must return the same value", snapshot "must be immutable"; https://react.dev/reference/react/useSyncExternalStore, fetched):

- The `TreeViewModel` (headless) owns the typed arrays, viewport transform, selection, highlight and collapse state. It exposes `subscribe(listener)` and immutable snapshots (`getViewport()`, `getSelection()`), so hooks like `useTreeSelection(model)` use `useSyncExternalStore` without re-rendering on every pan frame. Pan/zoom must **not** go through React state at 60 Hz: the canvas redraws from the model in `requestAnimationFrame`; React only hears about coarse changes (selection, focus, viewport settled).
- A `<PhyloTree>` component mounts a canvas in a ref, creates the renderer in an effect, and disposes it on unmount (criterion 12 "clean mount/unmount"). Strict-mode double-invocation safe: create in `useEffect`, return cleanup.
- Controlled vs uncontrolled: follow the React convention: `highlightedTips`/`onHighlightedTipsChange`, `selection`/`onSelectionChange`, `viewport`/`onViewportChange` as controlled props with `defaultX` for uncontrolled. `viewport` changes are throttled to "settled" (150 ms idle) to avoid feedback loops.
- Events as callbacks: `onTipClick(tip, event)`, `onTipHover(tip | null)`, `onNodeClick`, with `tip`/`node` being a lightweight handle `{id, label, isLeaf, depth, ...metadata}` created on demand (never for all nodes).

### 5.2 Per-tip React content for visible rows only (criterion 13)

The "rows" are known analytically from the layout: visible leaf range `[leafLo, leafHi]` from the viewport (binary search), and `y` per row. So:

- **Canvas layer** draws tree, markers, and cheap columns (bars, heat cells, colour swatches) from typed arrays.
- **DOM overlay layer** (absolutely positioned, `transform: translateY` updated per frame, or re-rendered only when the visible row range changes) renders React cells for the visible rows only, through a render prop: `renderTipColumn={(tip, rowRect) => <Badge .../>}`. With `pxPerLeaf >= ~14` there are at most about 70 visible rows, so this is classic windowing (same idea as `react-window` UNVERIFIED as a dependency choice; ~60 lines to write ourselves).
- Below the readable threshold the overlay is replaced by **summary canvas columns** (section 6.5). This implements the "collapse to summaries" requirement of criterion 14 and avoids the failure mode in the third screenshot.
- Alignment: all columns share the row `y` from the same viewport transform, so canvas and DOM stay registered. Independent x/y zoom affects only the tree area's x scale; columns have fixed pixel widths and are x-pinned (sticky) so only `y` pans/zooms them.

### 5.3 Workers

Parse and layout in a Worker, return transferable typed arrays (zero-copy `postMessage(..., [buffer])`). Taxonium does the equivalent for static files (`taxonium_component/src/webworkers/localBackendWorker.js`; GPL, read for approach only). Rendering stays on the main thread until proven necessary; OffscreenCanvas is an optimisation, not a dependency.

## 6. Semantic zoom and level of detail

### 6.1 How the references do it (sources)

| Project | Technique | Source / licence |
|---------|-----------|------------------|
| Taxonium | Nodes are held sorted by `y`; the viewport `[min_y,max_y]` is found by binary search; "reduce over-plotting" rounds node coordinates to a grid whose precision is `2000/(max_y-min_y)` and keeps one node per grid cell; parents of kept leaves are added back. Runs in a worker (static mode) or a Node backend. | Read in `taxonium_data_handling/filtering.js` (`reduceOverPlotting`, `getPrecision`, `filter` with `binary_search_for_insertion_point`). **GPL-3.0**: ideas only, do not copy. Method paper (eLife 82392) could not be fetched here. |
| Phylo.io | Estimates an optimal collapsing depth from number of leaves and viewing area, folds deeper subtrees into triangle glyphs; rendering stops descending at collapsed nodes; all data stays available. | Paper summary (PMC4948708 via search results; full text not read). Library ISC (`package.json` in `DessimozLab/phylo-io` clone, v2.2.5). |
| OneZoom | Fractal layout, the entire topology stored locally in compressed form, metadata loaded on demand as the user zooms; drawn on a canvas. | Search summary of the project pages (onezoom.org/developer, Zenodo). Code is under a "non-profit source available" licence, not open source; ideas only. Not verified in code. |
| Empress | WebGL tree with collapsible clades, multi-layer barplots on tips; stores structure as a balanced-parentheses succinct tree (`bp-tree.js`). | BSD-3-Clause (`LICENSE`). Its README says "fast and scalable"; no figures. Taxonium authors report a failure on a very large tree (second hand, in comparison.md). |
| ETE | Collapse nodes below a minimum pixel height; hide content below a content-height threshold. | ete-ideas.md (not code-inspected). |

Common pattern: **the draw list is a function of the viewport, with a pixel-size threshold per node**.

### 6.2 Proposed LOD algorithm (for the custom renderer)

Given viewport `V` (visible leaf range `[l0,l1]`, x range, pixel size), with `pxPerLeaf = H / (l1 - l0)`:

1. Top-down iterative traversal from the root with an explicit stack and the CSR child index.
2. **Cull**: skip a node if `leafHi < l0` or `leafLo > l1` (no need to visit its subtree).
3. **Collapse rule A (vertical)**: if the node is internal and `(leafHi - leafLo + 1) * pxPerLeaf < minPx` (default 3), emit one summary glyph for the whole clade (a filled wedge or a stub with density colour) and do not descend.
4. **Collapse rule B (horizontal/size)**: also collapse when the clade's total horizontal extent (max descendant `x` minus own `x`, stored as `maxX[node]`, one more typed array) times x-scale is `< minPx`. Needed for ladderised trees (6.3).
5. Otherwise emit the node's branch segment and (if `pxPerLeaf >= labelPx`) its label, then push children.
6. **Orthogonal elbows**: draw one vertical line per internal node from first to last child and a horizontal line per child, as in standard rectangular trees. Batch into one `Path2D` per colour class.

Measured on the prototype (balanced trees, minPx = 3, 900 px canvas, best of 5):

| Tree | View | Drawn nodes | Collapsed glyphs | CPU time |
|------|------|-------------|------------------|----------|
| 1M tips | fit-all | 588 | 589 | 0.2 ms |
| 1M tips | 1% window | 638 | 582 | 0.2 ms |
| 1M tips | 0.01% window (100 tips) | 228 | 0 | 0.1 ms |
| 100k tips | fit-all | 604 | 603 | 0.3 ms |
| 100k tips | 1% window | 671 | 330 | 0.6 ms |

So the draw list is bounded by the viewport pixel budget (hundreds to thousands of primitives) independent of tree size, as long as the tree is "bushy". The top of a 1M-tip tree contains only about 600 visible clades at fit-all, which is also the right number for a legible overview.

### 6.3 Failure case found: caterpillar trees (measured)

A 200k-tip caterpillar (fully ladderised, depth 200k): fit-all draws 398,668 nodes and collapses 1, in 12.5 ms CPU, and the zoomed-in views still draw 120k nodes. Rule A cannot collapse the spine because every spine clade spans many leaves; only a clade near the bottom is short. In a real picture most of those 200k spine nodes are sub-pixel in `x` (branch lengths), so rule B (horizontal extent) or "merge consecutive sub-pixel segments" is required. This is an open design item; acceptance test for the spike: a 200k-tip ladderised tree with realistic branch lengths must keep the draw list under about 20k primitives at fit-all. The case is realistic (many published trees are ladderised for display; Newick files from ML tools often put the biggest clade first).

### 6.4 Clade labels and collapsed triangles

For readable overviews, emit text for the highest-ranked collapsed clades (rank by leaf count) into non-overlapping bands: sort clades by pixel height, place labels greedily with a simple 1-D interval packing (rows cannot overlap vertically in a rectangular layout, so a label fits if its clade's pixel height is `>= 12 px`). The label source is, in order: node label (if not a support value, see data-layer.md), a metadata field (taxonomic rank from the GBIF match), or the most frequent genus among descendant tips (precomputed). This answers the "eukaryota, opisthokonta, metazoa ... as one label spanning each clade" point in goal.md.

### 6.5 Column summaries at low zoom

Per column, precompute aggregates per node bottom-up in typed arrays (one pass in the Worker): `count`, `sum`, `min`, `max`, `categorical histogram` (small fixed number of categories), `% matched`. At draw time a collapsed clade's column cell uses the aggregate of its subtree: a bar with mean length, a stacked category bar, a heat cell with density colour. Per-leaf cell drawing only when `pxPerLeaf >= 4` for simple cells and `>= 14` for React-rendered cells. Result: column cost is also bounded by the number of visible drawn nodes.

## 7. Hit-testing and picking

- **Rectangular, Canvas2D**: no spatial index needed for tips and rows. Row under cursor = binary search of cursor `y` (inverse viewport transform) over the monotonic leaf `y`. For internal-node markers and branches use the LOD draw list: store its primitives (node id, rect/segment) in a small array each frame and test linearly (hundreds to thousands of items is cheap), or build a `Flatbush` index per frame if the list is large. Packed Hilbert R-tree builds are fast and the index is a single ArrayBuffer (README), but per-frame rebuild for 100k items is unnecessary.
- **Circular**: invert the polar transform (cursor to angle and radius) and map angle to leaf index, then radius to the node along that leaf's ancestor path (walk up `parent`).
- **GPU picking** (deck.gl): colour-encoded pick pass, built in, but with the offscreen limitation quoted above and extra cost per pick. Only relevant if we adopt deck.gl.
- Touch: use pointer events; hit slop of 12 to 16 px for tips/markers on coarse pointers.

## 8. Pan and zoom, independent axes

- `d3-zoom` (verified from https://d3js.org/d3-zoom): the transform is `k tx ty` with **one scale `k`**; the docs describe `rescaleX/rescaleY` but nothing about independent axis zoom. So independent x/y zoom is not a built-in feature. Options: (a) own wheel/pointer handler (about 150 lines: wheel zooms y by default, shift or ctrl+wheel zooms x, pinch uses both, drag pans; clamp to extents); (b) two d3-zoom instances with `zoom.filter` splitting by modifier keys, which is fiddly; (c) deck.gl `OrthographicView` `zoomX/zoomY` if on deck.gl. Recommendation: (a) own controller in the headless core, which also gives deterministic programmatic `focusTip(id)` and `fitClade(id)` animations.
- Natural mapping (matches ETE idea 3): dense trees are tall, so vertical zoom (rows) is the primary axis; horizontal zoom (branch length) secondary; "zoom to tip" sets `pxPerLeaf` to about 24 and centres on the tip, which is the occurrence-page use case (goal story 4).
- Minimap: render the LOD draw list at fit-all into a small second canvas, with the viewport rectangle on top. Cheap because LOD at fit-all is a few hundred primitives (measured above).

## 9. Reference implementations to learn from

| Project | Licence | Use for us |
|---------|---------|-----------|
| Taxonium (`theosanderson/taxonium`) | **GPL-3.0** (`LICENSE`) | Study only: deck.gl + worker + y-sorted binary search + over-plot reduction. Parser `jstree.js` inside is Heng Li's MIT jstreeview ("heavily based on JStree ... https://github.com/lh3/jstreeview"), header read in the clone, so the MIT original can be reused with attribution. |
| Empress (`biocore/empress`) | BSD-3-Clause | Hand-written WebGL drawer, barplot layers, BP-tree. Reusable with attribution; but built on AMD modules and Python/QIIME integration, so we would port ideas, not drop it in. No embedding API documented. |
| Phylo.io (`DessimozLab/phylo-io`) | ISC | SVG; collapse-by-depth algorithm worth reading. |
| phylotree.js (`veg/phylotree.js`) | MIT (LICENSE file; `package.json` has no `license` field, note for SBOM tools) | SVG/D3 layout, selection, collapse. v2.6.0, last commit 2026-04-15. |
| Archaeopteryx.js | LGPL-3.0-or-later | SVG; tip thinning; its forester.js has the most complete Nexus/BEAST parsing found (see data-layer.md). LGPL: link, don't copy into Apache-2.0 source. |
| OneZoom (OZtree) | source-available non-profit licence (per search summary, not read) | Ideas only. |
| Published benchmarks | none found | The Taxonium and OneZoom papers make scale claims (million-tip), but we found no reproducible benchmark. Plan our own (section 10). |

## 10. Accessibility, theming, export

### 10.1 Accessibility

A canvas is opaque to assistive technology. Plan (all UNVERIFIED as to real screen-reader behaviour; needs testing):

- A parallel, visually-hidden **DOM tree** limited to the focus neighbourhood, using the WAI-ARIA APG tree pattern (https://www.w3.org/WAI/ARIA/apg/patterns/treeview/, fetched): `role="tree"`, `treeitem`, `group`, `aria-expanded` on internal nodes, `aria-selected`, and since "the full set of nodes is not in the DOM", `aria-level`, `aria-setsize`, `aria-posinset` on each rendered item. Keyboard: Up/Down move to previous/next visible node, Right opens or moves to first child, Left closes or moves to parent, Home/End, Enter activates, type-ahead moves to next node whose name starts with the character, `*` expands siblings (all per APG). Use `aria-activedescendant` on the canvas wrapper so the real focus stays in one element.
- **Text/table fallback**: an alternative "List" view (sortable table of tips: label, match status, count, link) reachable by a toggle; this is also the answer to goal story 3 "unmatched tips are visible". Reuses the GBIF `.table` tokens.
- Respect `prefers-reduced-motion` for animated focus/zoom transitions; ensure highlight is not colour-only (add a marker shape).

### 10.2 Theming with GBIF design tokens

The renderer takes colours from CSS custom properties read once per theme change with `getComputedStyle(el).getPropertyValue('--...')` and cached in a `Theme` object used by the canvas (canvas cannot use CSS variables directly). Mapping (tokens from the `gbif-design-tokens` skill):

| Use | Token |
|-----|-------|
| Branches | `--slate-500` (UI chrome) or `--fg3` |
| Tip labels | `--fg1`, body font `--font-body`, size `--text-sm`/`--text-base` |
| Highlighted row band | `--color-primary-light`; focus marker `--color-primary` |
| Hover / selection ring | `--color-accent-blue` (the tokens' focus-ring colour) |
| Unmatched tips | `--text-subtle` with a hollow marker |
| Support values / small labels | `--text-xs`, `--text-subtle` |
| Categorical column colours | `--purple-100`, `--periwinkle-100`, `--fuchsia-100`, `--peach-100` (tokens file: categorical/data-viz accents) |
| Density (matched counts) | tokens file grades cool to hot `--purple-100`, `--orange-100`, `--yellow-100` on a log scale |

Note: the tokens file states **dark mode is not covered**, so the `Theme` object must be re-read on a `data-theme`/media change and we should flag the gap upstream. Per-node and per-branch style are callbacks: `getNodeStyle(node) => {color, radius, marker}`, `getBranchStyle`, evaluated only for drawn nodes (criterion 16).

### 10.3 Export

- PNG: `canvas.toBlob`, re-render at 2x offscreen for a clean export of the current view.
- SVG: re-run the LOD draw list into an SVG writer (the draw list is already a primitive list). Whole-tree SVG of 100k tips is huge; export "current view" or "collapsed to N clades". Taxonium has a `deckglToSvg.ts` util (GPL, not read).
- Newick: serialize from the arrays iteratively (avoid recursion, see data-layer.md).

## 11. Architecture sketch

```
@gbif/phylo-core  (no DOM, no React; runs in Worker or Node; testable)
  parse/          Newick, Nexus, phyloXML, NeXML  -> TreeData      (see data-layer.md)
  TreeData        typed arrays: parent, len, nChildren, labelOffsets, flags, CSR children
  layout/         rectangular(), circular(), cladogram/phylogram; outputs x,y (or r,theta), leafLo/leafHi, maxX
  index/          labelIndex (search), tipKey->nodeId map, optional Flatbush
  aggregates/     bottom-up column summaries (typed arrays per column)
  lod/            cut(viewport, theme, columns) -> DrawList (segments, glyphs, labels, markers)
  model/          TreeViewModel: viewport, selection, highlight, collapse set, focus; subscribe/getSnapshot
  controller/     pointer/wheel/keyboard -> model actions; independent x/y zoom; animations

@gbif/phylo-render-canvas   Canvas2D renderer(DrawList, Theme) ; later render-webgl (same interface)

@gbif/phylo-react
  <PhyloTree/>        canvas + DOM overlay + a11y layer
  hooks               useTreeModel, useTreeSelection, useViewport, useTipHighlight
  <TipColumn/>        declarative column definitions
```

Component API proposal:

```tsx
<PhyloTree
  tree={treeData}                         // parsed in worker; or `source={{url, format}}`
  layout="rectangular" | "circular"
  branchLengths="phylogram" | "cladogram"
  highlightedTips={['occ:123']}           // controlled; ids = tip keys
  focusTip={{ id: 'occ:123', context: 'clade' }}   // pan/zoom to tip with siblings/parent clade
  collapsed={collapsedIds} onCollapsedChange={...}
  selection={sel} onSelectionChange={...}
  viewport={vp} onViewportChange={...}    // settled-only
  onTipClick={(tip, e) => ...}  onTipHover={(tip|null) => ...}  onNodeClick={...}
  getTipMetadata={(tipKey) => ...}        // or `metadata` map; unmatched tips => status 'unmatched'
  nodeStyle={(node) => ({color, markerRadius, markerShape})}
  columns={[
    { id:'count', width:80, kind:'bar',   value:(tip)=>n, summary:'sum' },
    { id:'status', width:24, kind:'swatch', value:(tip)=>cat, summary:'histogram' },
    { id:'detail', width:240, kind:'react', render:(tip)=> <TipCard/>, minRowPx:14 },
  ]}
  internalMarkers={{ show:'support', radius:(n)=>..., color:(n)=>... }}
  labels={{ tip:['genus','species'], minRowPx:12 }}
  theme="gbif"  /* reads CSS variables */
  renderer="canvas"
/>
```

Imperative handle (ref): `fitAll()`, `focusTip(id)`, `fitClade(id)`, `exportPng()`, `exportSvg()`, `exportNewick()`.

## 12. Effort estimate (engineer-weeks)

Assumptions: one senior front-end engineer, familiar with React, TypeScript, canvas; parser and tip-matching effort counted in data-layer.md (not here); no designer time; weekly reviews; tests and docs included; "week" = 5 productive days.

**MVP (100k tips, rectangular, Canvas2D)**

| Item | Weeks |
|------|-------|
| Headless core: TreeData, layout, label index, viewport model, pan/zoom controller (independent axes) | 2.0 |
| Canvas renderer with LOD rules A and B, labels, theme object | 2.0 |
| Hit-testing, hover, click, highlight, focus/centre-on-tip, collapse/expand | 1.5 |
| React layer: component, hooks, controlled props, DOM overlay with 1 custom column (React cell + simple canvas bar) | 1.5 |
| Basic a11y (tree pattern for focus neighbourhood, list fallback), tokens theming | 1.0 |
| Test tree set, perf harness (load time, frame time), docs, polish | 1.0 |
| **Total** | **9** (7 if the LOD ladderised-tree problem turns out easy and a11y is thin; 12 if cross-browser/touch issues bite) |

**Full**

| Item | Weeks |
|------|-------|
| Circular layout (draw, labels, hit-test, LOD) | 3 |
| WebGL renderer (deck.gl or regl), SDF text, picking | 5 to 7 |
| Summaries at low zoom: bottom-up aggregates, clade labels, wedges, density columns | 3 |
| Multiple columns, column types, tooltips on custom graphics, column resize/pinning | 3 |
| Export (PNG, SVG from draw list, Newick) | 2 |
| Full a11y (screen-reader testing, keyboard maps, reduced motion), dark mode, mobile/touch | 3 |
| Worker/OffscreenCanvas and memory tuning for 1M tips | 2 |
| Unrooted layout (optional) | 2 |
| Hardening, browser matrix, docs | 2 |
| **Total** | **~22** (18 to 30) |

Skipping WebGL (if LOD keeps Canvas2D fast enough, which is plausible given the measured draw-list sizes) saves 5 to 7 weeks. This is the biggest decision for the spike.

## 13. Risks

1. **Canvas2D frame time is unmeasured**: no browser was available in this research. Draw-list sizes are measured; frame times are not. Mitigation: first spike task is a Canvas2D harness drawing synthetic lists of 5k, 20k, 100k segments plus 100 labels, on a mid-range laptop and a phone.
2. **Ladderised trees** defeat rule A (section 6.3). Mitigation: rule B plus segment merging; test with real GBIF trees.
3. **Unknown real tree sizes and shapes** (goal.md open question). All estimates scale with that.
4. **Accessibility on canvas** is real work and easy to under-deliver.
5. **Scope creep** from ETE-style "faces" (alignment columns, domain shapes): keep column types as an extension point, not core.
6. **Licence traps**: do not reuse Taxonium (GPL-3.0), OneZoom (source-available), Archaeopteryx (LGPL, only linkable), or PhyloJS (see data-layer.md). Reusable with attribution: d3-hierarchy (ISC), Flatbush (ISC), Empress (BSD-3), Phylo.io (ISC), jstreeview (MIT), deck.gl/PixiJS/regl (MIT).
7. **Bus factor**: we own a renderer for years. Weigh against wrapping a library (comparison.md), none of which meets 11 to 13 cleanly.
8. **React 19 / StrictMode** double-mount and `useSyncExternalStore` snapshot discipline: classic source of tearing bugs; needs tests.

## 14. Not verified

- Any frame-rate or memory number in a browser (no browser available).
- deck.gl bundle size and text quality for this use; PixiJS and regl throughput for tree line segments.
- OneZoom, Phylo.io and Taxonium algorithm details beyond what is quoted (papers not fully read; Taxonium eLife page and PMC copy could not be fetched).
- Screen-reader behaviour of the proposed ARIA structure.
- OffscreenCanvas font and text behaviour across browsers.
- Real GBIF tree sizes.

## 15. Tiled storage and capability tiers

Added scope: should very large trees (1M+ nodes) be re-encoded server-side into a tiled/columnar format so the browser loads a coarse overview first and fetches detail on zoom? Evidence conventions as above.

### 15.1 Recommendation (short)

- **Default: parse client-side (option e) for everything up to roughly 250k tips or 8 MB gzipped.** Our own prototype parsed a 1M-tip Newick in 1.5 s and laid it out in 0.3 s (measured, section 2.2), so CPU is not the limiting factor; download size, memory on phones and main-thread blocking are. Move parsing to a Worker and this tier is simple, has no preprocessing pipeline, and matches goal.md criterion 1.
- **Large tier (above that): a build-time "LOD pyramid" in a static, range-readable archive or a set of chunk files with a manifest (options c/d), read-only.** Do not adopt DuckDB-WASM (35 MB uncompressed wasm) for this. Use **Parquet via hyparquet only for per-tip metadata columns** if columnar metadata is wanted; it is not a good fit for the tree skeleton itself.
- **Confidence**: high (about 85%) that client-side loading is right below the threshold and that DuckDB-WASM is the wrong tool; medium (about 55%) on the exact large-tier container (PMTiles-style single archive vs plain chunk files), because it depends on facts we do not have: real GBIF tree sizes, where the files are hosted, and whether that host serves `Range` with CORS. Decide after the open questions in goal.md are answered. A large tier may not be needed at all for launch.

### 15.2 Options compared

| Option | Evidence | Licence | Client cost | Verdict |
|--------|----------|---------|-------------|---------|
| (a1) Parquet + hyparquet over HTTP range | hyparquet README: "designed to read parquet files efficiently over http ... without needing a server"; "Minimizes data fetching using HTTP range requests"; zero dependencies, pure JS (clone `hyparquet/README.md`). Reading is `asyncBufferFromUrl` + `parquetReadObjects({rowStart,...})`. | MIT (`package.json` 1.31.3, last commit 2026-10-07) | 62.7 KB min, 19 KB gzip (bundlephobia API response for 1.31.2) | Good for **tip metadata columns** and tip-label lookup. Granularity is a row group (typically tens of thousands of rows, UNVERIFIED for our data), so it is coarse for tree tiles. Row-group min/max statistics allow skipping by a sorted key, which fits "preorder index range" reads. Writing needs a build step (hyparquet-writer is JS, or Python/DuckDB). |
| (a2) Parquet + DuckDB-WASM | DuckDB-Wasm README: "reads Parquet, CSV and JSON files backed by Filesystem APIs or HTTP requests". Package files (jsDelivr listing, v1.29.0): `duckdb-eh.wasm` 35.7 MB, `duckdb-coi.wasm` 35.3 MB, `duckdb-mvp.wasm` 40.6 MB uncompressed, plus a 0.76 MB worker. Compressed transfer size not confirmed. Remote reads need CORS and `Range` allowed; range support can fail on Firefox and some pre-signed S3 URLs (DuckDB troubleshoot page, via search results; not fetched directly). | MIT (`duckdb-wasm/LICENSE`, "Stichting DuckDB Foundation") | Tens of MB of wasm (even if brotli compresses well) | Rejected for a tree viewer: SQL power we do not need, large payload, extra worker/threads concerns. Fine for a separate analytics page. |
| (a3) DuckDB on a server | n/a | MIT | none | Violates criterion 1 (no per-user backend) and goal non-goals; keep only as an **offline** preprocessing tool. |
| (b) Arrow IPC / Feather chunks | `apache-arrow` 21.2.0 npm, Apache-2.0, 5.8 MB unpacked (registry). Zero-copy typed-array views, matches our struct-of-arrays model, no range reading built in (you fetch whole files or slices yourself). | Apache-2.0 | Library is large for what we need (UNVERIFIED gzip size). | Technically attractive as a chunk body format, but a hand-rolled header plus raw typed arrays (little-endian Int32/Float32 columns, gzip or brotli) is simpler and has no dependency. |
| (c) PMTiles-style single archive | Spec v3: "single-file archive format for tiled data"; header 127 bytes at start; root directory within the first 16 KiB; leaf directories; tile data; "Clustered" flag means tile data is ordered by TileID (`PMTiles/spec/v3/spec.md`). JS reader `pmtiles` 4.5.0: 19.6 KB min, 7.7 KB gzip, one dependency (`fflate`). Spec is public domain/CC0, reference code BSD-3-Clause. | BSD-3-Clause / CC0 | About 8 KB gzip | Best match for "one static file + range requests + CDN friendly". But PMTiles tile IDs are Z/X/Y (Hilbert) map tiles; a tree LOD pyramid is (level, leaf-range chunk). Possible by mapping to `z = level, x = chunk, y = 0` (UNVERIFIED that the Hilbert ID scheme tolerates degenerate y without waste), or by adopting only the **container idea** (header + directory + offsets) in our own format. |
| (d) Plain chunked binary/JSON files with manifest | Taxonium's own static mode and its optional backend are the closest precedent (15.5). | n/a | none | Simplest and works on any static host with plain GET and simple CORS (no `Range` preflight). Cost: file count (a 256-leaf-row pyramid on 1M tips is about 8,191 tiles, measured by simple count in our script; use larger chunks, e.g. 4,096 leaves, to get about 500 files). |
| (e) Client-side parse | Measured (section 2.2): 1M-tip, 40.6 MB Newick: 1.5 s parse, 0.3 s layout, about 104 MB typed arrays; gzip of that synthetic file is 10.6 MB (our generated labels and 5-decimal lengths; real files vary, UNVERIFIED). Taxonium's docs: processing the full tree in the browser "can mean a lot of memory and that the initial loading process is quite slow" (`taxonium/docs/advanced.md` line 146). No third-party Newick parse benchmarks were found; PhyloJS claims parsing to "10^6" tips (comparison.md, possible typo). | n/a | Whole file download | Default up to the break-even below. |

### 15.3 Encoding a tree so subtrees and viewports are contiguous ranges

Arrays in pre-order (computed offline by an iterative DFS; our prototype built it in the same script that measured sizes):

| Column | Meaning |
|--------|---------|
| `subtreeSize` (or `subtreeEnd = i + size`) | Subtree of node `i` = contiguous interval `[i, i+size)`. Collapsing, "show this clade", and "tip plus its clade" (goal story 4) are range reads. |
| `leafLo` (prefix count of leaves) | `y` = leaf order (rank among leaves). Leaf-count of a subtree = `leafHi - leafLo + 1`. |
| `x` | Cumulative branch length from the root, Float32, precomputed so no parent lookup is needed. |
| `parent` (optional) | Derivable from sizes by a stack scan; store only if random access is needed. |
| `labelOffset` + label heap | Tip labels in leaf order so label chunks align with row ranges. |
| per-column payloads | e.g. occurrence count per tip. |

Viewport query: leaf range `[l0,l1]` maps to a set of consecutive tiles, but the nodes in that leaf range are *not* one preorder interval because their ancestors lie outside it. Two standard fixes:

1. **Pyramid tiles with clipped ancestors** (recommended): tile `(level, j)` holds the LOD-cut nodes for leaf rows `[j*R_l, (j+1)*R_l)` plus a stub for each ancestor edge entering the tile (node id, x at entry, y span). The client assembles the viewport from the needed tiles and never walks outside them.
2. Take the lowest common ancestor of `l0` and `l1` and read its whole preorder interval: simple, but unbounded near the root (reads the whole tree when the viewport straddles it).

Taxonium solves the same problem differently (its server keeps all nodes in memory sorted by `y`, binary-searches the viewport and then re-adds parents; `taxonium_data_handling/filtering.js`, GPL, ideas only).

### 15.4 Building the LOD pyramid (offline)

1. Parse and lay out (reuse the headless core in a Node build script; same code path as the browser, so no divergence).
2. For each level `L = 0..Lmax`, choose `pxPerLeaf_L` = (canvas height budget) / (leaves visible at that level); apply the same collapse rules A and B as the client (section 6.2) to emit the cut: surviving nodes, plus collapsed-clade summary records `{clade id, leafLo, leafHi, nTips, depth, maxX, label?}`.
3. Per-clade aggregates for each column (tip counts, sum/mean of occurrence counts, categorical histogram, matched/unmatched counts), computed bottom-up in one pass over post-order and stored in the summary records. The browser then draws collapsed wedges and column summaries (section 6.5) from tile data alone.
4. Split each level by leaf range into chunks; write a header/manifest with level geometry, then the chunks gzip- or brotli-compressed.
5. Search: sharded sorted label index (prefix shards) or a small client-side label list only for tiers that fit; for the large tier, a precomputed `tipKey -> leafRank` hash table sharded by key prefix lets the occurrence page ask "where is tip X?" with one small request and then fetch the tiles around that leaf rank.

Size guide (measured on the synthetic 1M-tip tree, 2M nodes): `subtreeSize` column 0.8 MB gzipped (small integers delta-friendly), `x` Float32 6.7 MB gzipped (8.0 MB raw; reduce by quantising or by storing branch length instead of cumulative x), tip labels 20.7 MB raw / 2.0 MB gzipped (our labels are artificially repetitive; real labels compress far worse, UNVERIFIED). Whole-tree binary is therefore comparable to the gzipped Newick (10.6 MB): the tiling benefit is **loading only the overview first** (a few hundred KB), not total size.

### 15.5 How existing systems do it

| System | Approach | Source / licence |
|--------|----------|------------------|
| Taxonium | Input is a gzipped JSON-lines file (`*.jsonl.gz`) with one header line then node records (`taxonium_backend/tfci.jsonl` starts with a `{"version":..., "mutations":[...]}` line; `taxonium/docs/advanced.md` lines 18, 151). **Static mode**: the browser downloads, decompresses (pako) and processes the whole tree in a Worker. **Backend mode**: a Node server loads the whole file into RAM (`MAXMEM` option, up to 12 GB in the docs example) and returns only the part for the requested `min_y/max_y`, with over-plotting reduction. So Taxonium has no static tiled format; its large-tree answer is a stateful server. | GPL-3.0; read for approach only |
| OneZoom | Whole topology kept locally "in a highly compressed form", metadata fetched as the user explores (project summary pages; code and data format not read). | Source-available licence; UNVERIFIED details |
| Empress | Standalone HTML generated by a Python plugin; topology as a balanced-parentheses succinct tree (`bp-tree.js`) embedded in the page; all in memory in the browser. | BSD-3-Clause |
| Map tile systems / PMTiles | Pyramid of tiles by zoom level, single-file archive with directory and range requests, CDN-friendly (spec above). | BSD-3 / CC0 |
| ETE 4 SmartView | Server computes graphics for the current viewport (ete-ideas.md idea 10, not code-inspected). | GPL; not an option |

None publishes a static, tiled phylogeny format we could adopt; a GBIF format would be new (cost in 15.9).

### 15.6 Hosting requirements (CORS, CDN, range)

- Range reads are not a CORS-safelisted header, so the browser sends a preflight. Protomaps docs (https://docs.protomaps.com/pmtiles/cloud-storage): "Proper support for Cross-Origin Resource Sharing is required"; allowed methods GET and HEAD; allowed headers `range` and `if-match`; exposed header `etag` (R2, S3); billing counts each Range request as a GET; S3 and DigitalOcean Spaces serve HTTP/1.1 only, R2 and GCS HTTP/2.
- CDN caching of range requests is not covered in that page; behaviour depends on the CDN (UNVERIFIED for GBIF's infrastructure).
- Plain chunk files (option d) need only ordinary GET + `Access-Control-Allow-Origin`. If GBIF's archive host cannot be configured for Range/preflight, option (d) is the safe choice. This is one of the open questions in goal.md (is the supplementary file CORS-accessible?).
- GBIF API note (relevant to hosting): `api.gbif.org` returned `access-control-allow-origin: *` on a tested match call (our test); the static archive host is a different matter and was not tested.

### 15.7 Preprocessing pipeline when a publisher uploads or updates a tree

1. Ingest: detect format (Newick/Nexus/phyloXML/NeXML) and parse with the shared parser (data-layer.md); reject or flag malformed files with an error report to the publisher.
2. Normalise: choose tree (multi-tree Nexus), apply TRANSLATE, resolve label rules, record rootedness, store original file unchanged plus a canonical Newick.
3. Compute stats: tip count, max depth, ladderised-ness, whether branch lengths exist, tip label match report (data-layer.md matching); **choose the tier** and write `capabilities`.
4. If tier is S or M: publish canonical gzipped Newick only (or the typed-array binary).
5. If tier is L: run the pyramid builder (15.4) and write the archive/chunks and manifest; version them by content hash so CDNs can cache forever.
6. Trigger: on dataset registration/update (the existing crawl/ingestion hook; GBIF's actual hook is not known to us, UNVERIFIED), idempotent by file hash.
7. Failure handling: keep the previous artefact until the new one validates.

### 15.8 Break-even size

Our measurements for the synthetic balanced tree: 100k tips parse in 0.15 s and need about 10 MB of typed arrays, 3.9 MB of Newick (about 1 MB gzipped, estimated from the 1M ratio 10.6/40.6, UNVERIFIED for real files); 1M tips parse in 1.5 s, need about 104 MB of arrays and a 10.6 MB gzipped download. Suggested break-even: **above about 250,000 tips, or above 8 MB gzipped, or when the target device is a phone**, a tiled pack starts to pay off. Below that, the preprocessing pipeline, new format and extra failure modes cost more than they save. The threshold should be re-set once we have (i) real GBIF tree sizes, (ii) a measured time-to-first-paint on a mid-range phone.

### 15.9 Added effort for the large tier (if built)

| Item | Weeks |
|------|-------|
| Pyramid builder (Node, reuses headless core), manifest/chunk format spec and reader | 3 to 4 |
| Client tile loader/cache, prefetch, overview-first rendering, request cancellation | 2 |
| Search/lookup index shards, `tipKey -> leafRank` | 1 |
| Pipeline integration, tests, hosting config (CORS/Range) | 2 to 3 |
| **Total** | **8 to 10** (UNVERIFIED; depends on GBIF ingestion infrastructure) |

### 15.10 Capability tiers and `capabilities` object

Thresholds are proposals; the numbers need to be re-tuned with real trees. Tier is chosen once at load from tip count and encoded size and exposed on the model as `tree.capabilities`.

| Tier | Tips (proposed) | Source | Features |
|------|-----------------|--------|----------|
| **S small** | up to 5,000 | whole tree in memory | Everything: rerooting, ladderise/rotate, move/prune/extract subtree, branch-length transforms, export Newick, all layouts. Rerooting via an existing logic library **loaded lazily** (dynamic `import()` on first use) or our own O(n) reroot on the arrays. Candidate library: phylotree.js (MIT) has `rooting.js` (205 lines) and a tested reroot; but its dependencies listed in `package.json` include `jquery`, `lodash`, `moment`, `underscore` (clone), so a lazy chunk is mandatory, and an own array-based reroot is probably smaller (UNVERIFIED which is cheaper to maintain). Caution: phylotree.js `getNewick` is recursive (read in `src/formats/newick.js`). |
| **M medium** | 5,000 to about 250,000 (or 8 MB gz) | whole tree in memory, Worker parse | Navigation (pan/zoom/fit), collapse/expand, search, highlight/focus, selection, callbacks, columns, export view. No topology edits; reroot only via "view as rooted at" if cheap (UNVERIFIED), otherwise disabled. |
| **L large** | above that | tiled pack | Read-only: overview, zoom fetches tiles, search through shard index, highlight/focus by tip key, clade summaries, columns from summaries and tile data. Collapse state is client-side only (no topology change). No reroot, no edit, no full-tree export (offer the original file download instead). |

```ts
interface TreeCapabilities {
  tier: 'S' | 'M' | 'L';
  tipCount: number;
  nodeCount: number;
  source: 'memory' | 'tiled';
  // navigation
  panZoom: true;
  independentAxes: boolean;
  fitClade: boolean;
  // interaction
  collapse: boolean;           // true in S, M, L (view-only collapse)
  search: 'full-text' | 'prefix-shards' | 'none';
  highlightFocus: boolean;
  callbacks: boolean;          // onTipClick/onTipHover ...
  // structure-changing
  reroot: boolean;             // S only (lazy-loaded logic)
  edit: boolean;               // S only
  ladderise: boolean;          // S, M
  // data
  columns: { perTip: boolean; summaries: boolean };
  branchLengths: boolean;
  supportValues: boolean;
  layouts: Array<'rectangular' | 'circular' | 'unrooted'>;
  // output
  export: { png: boolean; svg: 'view' | 'full' | false; newick: 'full' | 'download-original' | false };
  // diagnostics for the UI
  reasons?: Partial<Record<keyof TreeCapabilities, string>>; // why a feature is off, for tooltips
}
```

The UI reads `capabilities` to hide or disable controls and show an explanatory tooltip ("Rerooting is only available for trees up to 5,000 tips"), and the same flags guard the imperative handle (calls that need a missing capability reject with a typed error). Because the headless core exposes the same `TreeViewModel` for in-memory and tiled sources (the tiled one fills the same draw-list interface from tiles), the React layer does not branch on tier except via these flags.

### 15.11 Not verified in this section

- Compressed transfer size of DuckDB-WASM and `apache-arrow` bundles; behaviour of DuckDB-WASM range reads on GBIF hosting.
- Whether PMTiles' Hilbert TileID scheme can carry a 1-D tile axis efficiently.
- CDN behaviour for range requests on GBIF's infrastructure; where the supplementary files live.
- OneZoom's data file formats; Taxonium's eLife paper statements on its pipeline (only repo docs and code read).
- Real-file compression ratios (our test file is synthetic).
- The Newick parse benchmark of any third-party library (no published benchmarks found; we did not execute third-party code).
