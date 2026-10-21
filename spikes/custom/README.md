# spikes/custom: our own phylogenetic tree renderer

A prototype candidate from the tree-viewer spike: tree on typed arrays, viewport level of detail with a draw budget, Canvas2D, a grid hit
index, a DOM overlay for labels and links, and a React `<TreeView>` on top. The core (`src/core`) has no React import and reads the tree
through a structural `TreeData` interface, so it could become a package. It is not production code: see "Known limits" below.

* What was measured and decided: [docs/results/custom.md](../../docs/results/custom.md) (benchmarks, scenario results, the radial work,
  polytomies, the hardening pass) and [docs/recommendation.md](../../docs/recommendation.md) (where it stands against the libraries).
* API reference: [docs/api.md](docs/api.md).
* The comparison harness contract (`spikes/shared/types.ts`) is not ours to change; `src/adapter.tsx` maps it to `<TreeView>`.

Status, as of the hardening pass of 2026-10-21 (commit log of branch `claude/custom-renderer-hardening`): lint, Prettier and a
`node:test` suite exist; the cut has one implementation per layout behind a layout projection for draw and hit; `renderer.ts` is split into
modules. Everything was measured headless, without a GPU.

## How to run

Node >= 22.7 is needed (the tests and check scripts import the TypeScript sources directly with `--experimental-transform-types`; CI uses
Node 22). Install with `npm ci` in this folder.

| Command | What it does | Needs |
|---|---|---|
| `npm run dev` | Vite dev server on port 5306 (`--strictPort`). Pages: `/` (the comparison harness app, `src/main.tsx` + `src/adapter.tsx`), `/demo.html` (`<TreeView>` used the way a gbif.org page would, `src/demo.tsx`), `/parquet.html` (dev only, `<TreeView>` over a `ParquetSource`, see below) | |
| `npm run build` | `vite build` into `dist/` (the harness page only; `demo.html` and `parquet.html` are not build inputs) | |
| `npm run preview -- --port 5306` | serves `dist/`; the browser scripts below expect it on 5306 | a build |
| `npm run typecheck` | `tsc --noEmit`; includes `../shared/*.ts(x)` and, through `src/parquet/`, the Parquet reader in `spikes/parquet-experiment/web` | |
| `npm run lint` | ESLint 9 flat config (typescript-eslint recommended, react-hooks, unused locals are errors), `--max-warnings 0`, over `src`, `scripts`, `bench`, `test` | |
| `npm run format` / `format:check` | Prettier (`.prettierrc`: width 150, single quotes) | |
| `npm test` | `node --test "test/**/*.test.mjs"` with `--experimental-transform-types`: unit tests of the core modules, the golden test of the cut, and `test/radial-cut.test.mjs`, which runs `scripts/check-radial-cut.mjs` as a child process | |
| `npm run check` | `typecheck && lint && format:check && test`, what CI runs (`.github/workflows/custom-renderer.yml`, then `npm run build`) | |

The test and CI commands above are being changed by the test work in flight (a `test:browser` script and a CI browser job); see the commit
log for what exists when you read this. At commit e122a53 `npm test` covers the pure core modules, the cut goldens and the React prop helpers
(`test/react-props.test.mjs`); it does not run a browser, `<TreeView>`, the label overlay or `ParquetSource`, and drawing has no direct test
(the golden test checks what `draw.ts` and `hit.ts` derive from a summary's extent, not canvas output). Coverage was not measured.

Standalone scripts (not part of `npm test` unless stated):

| Script | What it checks or measures | Needs |
|---|---|---|
| `node --experimental-transform-types scripts/check-radial-cut.mjs [--tips N] [--budget N]` | Regression of the cut, budget, culling, summaries, runs and hit-testing on the committed 10k Yule tree (sections 1 to 12, listed in its header). Prints `OK` and exits 0. About 2 s here (1.8 s wall, run on 2026-10-21); the OTL 91k sections are skipped when the git-ignored OTL file is absent | no browser; `data/synthetic` (committed), optionally the OTL file under `data/real-ladder/fetched/` |
| `node --experimental-transform-types scripts/capture-cut-golden.mjs [out.json]` | Rewrites `test/cut-golden.json` (the golden draw lists of `test/cut-golden.test.mjs`) from the current code, one case per line. See "Recapturing the cut goldens" | |
| `node scripts/check-radial-ui.mjs [--port 5306]` | Browser check on a 10k tree, radial: hover and click on summaries, clade colouring, highlight and focus inside a summary, no redraw on hover, reduced frames while wheeling and a full frame after, progressive detail | the production build served on 5306; Playwright (`playwright-core`, resolved from `spikes/runner/package.json`, i.e. `spikes/node_modules`) and Chromium at `/opt/pw-browsers/chromium-1194` |
| `node --experimental-transform-types scripts/check-parquet-source.mjs [--name ..] [--tree ..] [--app ..] [--pq ..]` | `ParquetSource` against the full tree parsed from the Newick: first view request count, rollups equal `computeLayout`, stub clicks, loading by zooming, radial | three things running: the Range server (`spikes/parquet-experiment/server.mjs`), the Vite dev server on 5307, and the git-ignored Parquet files and Newick. Regeneration: `docs/results/treesource-slice.md` |

Benchmarks (`bench/`, all headless Chromium without a GPU, one browser at a time, all need the production build served; the raw numbers
and what they showed are in `docs/results/custom.md`):

| Script | What it does |
|---|---|
| `bench/bench.mjs --tree FILE --label NAME [--layouts rectangular,radial] [--frames N] [--out f.json]` | mounts a tree through `window.__spike.mount`, forces N synchronous frames at fit, a 3% window and a 0.03% window, reports JS ms per frame (cut and draw; raster is not included) and the draw-list statistics. Chromium path from `CHROMIUM_PATH` or the default above |
| `bench/radial-perf.mjs --port .. --tag .. --trees DIR --sizes .. --shapes ..` | before/after benchmark of the radial work: JS ms, primitives, canvas call counts, optional end-to-end rAF interval |
| `bench/interaction.mjs --port .. --tag .. --tree FILE --layout radial` | frame cost during a scripted wheel and drag gesture, with and without interaction LOD |
| `bench/budget.mjs FILE LABEL [layout]` | where the draw budget bites: LOD off and budgets 500, 2000, 20000 at fit |
| `bench/screens.mjs` | takes the small screenshots in `spikes/results/custom/screens/` |

Test trees are under `data/` (see `data/README.md`); large ones are git-ignored and fetched or generated by script.

## The frame pipeline

```
TreeSource.snapshot()            source.ts   TreeSnapshot: typed arrays over the rows that are loaded (+ stub, globalId, rollup
   |                                         for a partial tree). A new source.version -> syncSource() rebuilds what depends on rows.
computeLayout(snapshot, lengths) layout.ts   Layout: X, ROW, XMAX, LAST (cached per branchLengths flag); COS/SIN/BC/BS for radial,
   |                                         built on first use (ensureTrig)
makeTransform(kind, W, H, view,  geom.ts     Transform: the viewport window mapped to CSS px (rect: ox, oy, kx, ky; radial: centre,
   area, tips)                               scale k, angle step da) and the clip rectangle
   |
projectionFor(snapshot, L, T)    projection.ts  RectProjection | RadialProjection, built per frame: node and branch positions, clade
   |                                         extents, summary/run geometry, and the per-frame values the cut precomputes
searchCut(proj, ...) -> cut      lod.ts      DrawList (node, kind, cls, last, xmax): which nodes are drawn and how (expanded node,
   |                                         tip, summary triangle/fan/slice, stub)
   +-- drawBody, drawMarkers, drawHighlights, drawLabels, columns, axis / scale bar        draw.ts, columns.ts  (Canvas2D)
   +-- HitIndex: uniform grid over the draw list, built on the first pointer query         hit.ts
   +-- LabelOverlay: DOM anchors over the canvas text, hidden tip list, live region        overlay.ts  (full-quality frames only)
   +-- Overview: the whole tree in a corner, its own cut and small canvas, window box      overview.ts
   +-- DetailLoader: stubs in the draw list that are big on screen -> source.ensureClade   detail-loader.ts (partial sources only)
```

`TreeRenderer.render()` (`renderer.ts`) runs the left column once per frame; frames are scheduled with `requestAnimationFrame` only when
something changed.

Where the three adaptive mechanisms sit:

* **Budget ladder** (`searchCut` in `lod.ts`). The cut collapses clades smaller than `minPx` (option `minCladePx`, default 3). If the draw list
  would exceed the budget (`drawBudget`, default 20,000; radial: the smaller of that and `radialMaxNodes`, default 2,000), `minPx` is raised on
  a fixed ladder `base * 1.15^n` and the cut is redone; the aborted pass stops as soon as the budget is exceeded. The level is sticky: it rises
  only on overflow and falls only when the next level down fits with room to spare, and the previous full frame's level is the starting
  point. Above 80,000 visited nodes (caterpillar-like walks) there is no search, `minPx` just doubles until the list fits.
* **Interaction LOD** (`renderer.ts`: `noteInput`, `refineMs`). The input controller calls `noteInput()` before it moves the view. While the user
  wheels, pinches, drags or an animation runs, frames are reduced: a quarter of the budget (at least 500), and the threshold x1.6 when the last
  full frame had more than 1,000 primitives. `refineMs` (default 120) after the last input one full-quality frame is drawn. The label overlay,
  the corner notice and the stub loader run after full-quality frames only.
* **Settle** (`settle()` in `renderer.ts`). Anything that reads the draw list for a decision (`hitTest`, click, hover, `locateNode`, `nodeBounds`,
  `columnCell`, `renderNow`) first draws a full-quality frame if the last one was reduced, so a click always hits what a settled frame shows.

## Invariants the core relies on

From the header of `spikes/shared/tree.ts` and from `src/core/types.ts`. (The header of `tree.ts` names `shared/test/tree.test.mjs` as the check; that file does not exist, only `parser.test.mjs` does, so these are not verified by a test of the shared model. `layout.test.mjs` and the cut tests exercise them on the core side.)

* Nodes are numbered in preorder, so `parent[i] < i` for `i > 0`, and the subtree of `i` is the index range `[i, subtreeEnd[i])`.
* Tips are ranked in preorder, and the tips below `i` are the rank range `[leafStart[i], leafEnd[i])`. A click event carries that range at no
  cost; labels are sliced from `tipLabels`.
* The cut is one forward scan over the preorder arrays and skips a culled or collapsed subtree by jumping to `subtreeEnd[i]`.
* `X` never decreases from parent to child (negative or missing lengths count as 0); `layout.ts` notes that culling relies on it.
* In a partial snapshot `nodeCount` is the number of rows, ids in the arrays are row indexes, while `tipCount`, `leafStart`, `leafEnd` and
  `tipRank` are ranks of the FULL tree; a stub row has `subtreeEnd[i] = i + 1` and `childCount[i] > 0`. The public API and `NodeEvent.node` speak
  the preorder id of the full tree (`globalId`), not the row.

The coding rule that goes with them: **no recursion** (ladder trees are 1M deep, a recursive walk overflows the stack) and **no per-node
allocation** in the cut, draw or hit code (typed arrays, scratch fields, caller-supplied output objects). Both are conventions of this code;
no lint rule enforces them. Per-frame allocation of a few objects (a projection, a result per search pass) is accepted; per-node is not.

Related, from the measured work: the two cut loops in `lod.ts` are separate on purpose (see below), and several helpers there (`cell`, the
`K_*` kinds) are defined in the loops' module because an import binding measured slower.

## Module map

Line counts are `wc -l` of the committed files at the commit named in the heading; they include comments. `renderer.ts` is still about a
thousand lines by design: it keeps the public API, `render()`, `drawTop`, hover, the notice and the interaction-LOD state, because those are
tied to the frame loop; only the parts with one job were moved out. It is a facade, not a fully decomposed class.

As of commit e122a53 (`wc -l` of the committed files, 2026-10-21):

| File | Lines | Job |
|---|---|---|
| `src/core/types.ts` | 232 | public types: `TreeData`, `TreeSnapshot`, `RendererOptions` and defaults, `NodeEvent`, `FrameStats`, theme |
| `src/core/source.ts` | 97 | `TreeSource` interface, `InMemorySource` |
| `src/core/layout.ts` | 159 | `computeLayout`: X, ROW, XMAX, LAST in linear passes (or from rollups for a partial snapshot); cos/sin cache |
| `src/core/geom.ts` | 95 | `makeTransform` (viewport to px), sector bounding boxes |
| `src/core/projection.ts` | 316 | `LayoutProjection` (`RectProjection`, `RadialProjection`): positions, clade extents, summary/run geometry, per-frame cut values |
| `src/core/lod.ts` | 654 | the cut (`cutRect`, `cutRadial`, `searchCut`), `DrawList`, `Seen` (pixel-cell dedupe), rules A to D and R |
| `src/core/draw.ts` | 561 | Canvas2D drawing of a draw list: branches, summaries, markers, highlights, labels, axis, scale bar; `TextMeasurer` |
| `src/core/hit.ts` | 314 | `HitIndex`: uniform grid over the draw list, candidate scoring |
| `src/core/columns.ts` | 326 | bar / text / alignment columns: compile by tip rank, draw, `cellRect`, `updateColumns` |
| `src/core/renderer.ts` | 1,076 | `TreeRenderer` facade: DOM, frame loop, `render()`, source sync, hover, notice, interaction-LOD state, public API |
| `src/core/view-state.ts` | 384 | `ViewState`: viewport, area, fit, limits, zoom, target windows, animation (no DOM) |
| `src/core/input.ts` | 298 | `InputController`: wheel, pointer, pinch, click, key events to calls on a host |
| `src/core/keyboard.ts` | 70 | keyboard cursor: start node and navigation keys (pure functions) |
| `src/core/overlay.ts` | 158 | `LabelOverlay`: label anchors and links, hidden tip list, live region |
| `src/core/overview.ts` | 259 | `Overview`: strip/disc with the window box, its geometry as pure functions |
| `src/core/detail-loader.ts` | 87 | `DetailLoader`: opens stubs of a partial source through `ensureClade` |
| `src/core/node-event.ts` | 48 | `makeNodeEvent`: `Hit` to public `NodeEvent` |
| `src/core/live.ts` | 13 | `live()`: builds the getter objects modules read the renderer through |
| `src/core/dom.ts` | 11 | `mk`, `SR_ONLY` |
| `src/core/constants.ts` | 85 | tuning constants and numeric limits |
| `src/core/index.ts` | 8 | public exports of the core |
| `src/react/TreeView.tsx` | 357 | `<TreeView>` component, `TreeViewHandle`, `TreeNodeEvent` |
| `src/react/props.ts` | 38 | `useShallowStable` and the equality helpers behind the prop identity rules |
| `src/parquet/ParquetSource.ts` | 384 | `ParquetSource`: a partial `TreeSource` over Parquet files (proof of concept) |
| `src/parquet/page.tsx` | 103 | dev page `parquet.html` |
| `src/parquet/reader-shim.d.ts` | 27 | type declarations for the Parquet reader import |
| `src/adapter.tsx` | 478 | harness adapter (the `spikes/shared` contract) over `<TreeView>` |
| `src/demo.tsx` | 91 | dev page `demo.html`: two linked instances |
| `src/main.tsx` | 5 | entry of the harness page |
| **Total, `src/`** | **6,734** | |

## How to extend

### Add a renderer option

1. `src/core/types.ts`: add the field to `RendererOptions` (with a comment on its meaning) and its default to `DEFAULT_OPTIONS`.
2. Read it where it acts, from `this.opts` in `renderer.ts`, or through the narrow interface of the module that needs it (`ViewEnv` in
   `view-state.ts`, `OverlayOptions` in `overlay.ts`, `OverviewHost`, `InputHost`; the facade builds these with `live()` so they read current values).
3. If changing it must do more than redraw (refit, rebuild the layout, reset the threshold hint, clear the overlay), add that to `setOptions` in
   `renderer.ts`. A numeric tuning value that is not an option goes in `src/core/constants.ts`.
4. React: nothing, if it is a field of `RendererOptions`. `<TreeView>` passes every field of its `options` prop (except `layout`, `branchLengths`
   and `tipHref`, which are props) to `setOptions`, so adding an option touches `types.ts` and the code that reads it (commit e122a53; before it,
   `TreeView.tsx` listed each option twice). The harness adapter (`src/adapter.tsx`) lists its own library options separately.
5. Document it in [docs/api.md](docs/api.md) and add a test if it changes geometry (`test/` has the pattern: import the module, build a tree
   from `spikes/shared/newick.ts`, assert).

### Add a layout kind

A layout is a `LayoutKind` string plus a `LayoutProjection` (`src/core/projection.ts`). Draw and hit are written once against the projection;
the cut is not (see below).

1. `types.ts`: extend `LayoutKind`; `geom.ts`: `makeTransform` builds the `Transform` for it (the window, scale, clip rectangle) and `projectionFor`
   (`projection.ts`) picks the projection class from `T.kind`.
2. Implement the `ProjectionCore` members: `dedupeRun` (the dedupe key of a run of small siblings; used by the cut once per run), `tipPitch`,
   `nodeXY`, `parentXY`, `depth`, `tip`, `tipSpan`, `cladeSize`, `summaryExtent` (+ the fields `d0 d1 t0 t1`). The consumers: `draw.ts` (positions,
   `summaryExtent`, `cladeSize` for marker size, `tipSpan`), `hit.ts` (positions and extents of candidates, `tipPitch`), `renderer.ts`
   (`nodeXY` for `locateNode`).
3. Write the cut loop. `lod.ts` has `cutRect` and `cutRadial` as two inline loops with the cull, the collapse rules (A/B), the dedupe key (rule C)
   and the run accumulator (rule R) written as locals; `cut()` dispatches on `proj.kind`. A third layout means a third copy of that loop, and the
   golden tests (`test/cut-golden*.mjs`) are the model for guarding it. Why not one loop through the projection: see the next section.
4. Layout-specific drawing (strokes, arcs, axis) stays in `draw.ts` per layout; `view-state.ts` has the fit, limits and target windows per kind;
   `overview.ts` has the geometry of the corner view; `keyboard.ts` has the navigation per layout. Grep for `'radial'` to find them all.

### Add a column kind

`ColumnKind` and `Column` are in `types.ts`. In `columns.ts`: `compileColumn` turns a spec into arrays by tip rank once (values are looked up by
tip label there), `drawColumns` draws the visible rows, `cellRect` returns the cell of a tip rank for `columnCell`, `columnsWidth` /
`layoutColumns` place them to the right of the plot, `updateColumns` / `columnSpecEquals` decide what `setColumns` recompiles (a column is compared by
`id`, `kind`, `header`, `width` and `values` by reference). Columns are drawn in the rectangular layout only. `renderer.ts` calls `compileColumns` /
`drawColumns` from `setColumns` and `render()`; the header and the width come from the spec, so a new kind usually touches only `columns.ts`.

### Add a TreeSource

Implement `TreeSource` (`src/core/source.ts`); `InMemorySource` is the trivial one, `src/parquet/ParquetSource.ts` the partial one.

* `snapshot()` must be always renderable, synchronous, and return the same object while `version` is unchanged. It returns a `TreeSnapshot`: all
  the `TreeData` arrays over the loaded rows (preorder, the invariants above), plus `stub` (1 = a row standing for a clade whose rows are not
  loaded), `globalId` (row to preorder id of the full tree; null = identity), `rollup` (per row `cumLength`, `maxCum`, `depth`, `maxDepth`, `row`,
  the numbers the layout cannot derive for a stub) and `toLocal(globalId)` (row or -1).
* Stub contract: a stub row is drawn as a summary from its rollups and `leafStart` / `leafEnd`, never descended into (`subtreeEnd[i] = i + 1`,
  `childCount[i] > 0` so it is not taken for a tip), and never part of a run. A source with no stubs sets all three extra fields to null.
* When rows arrive or are dropped, bump `version` and call the listeners given to `subscribe()`. `ensureClade(globalId, {signal, priority})`
  resolves after the version bump; `DetailLoader` calls it for big stubs after full-quality frames and cancels through the signal. `openCost` is
  optional. `tipLabels(r0, r1)` is async because a partial source may not have the labels; `nodeCount`, `tipCount`, `hasLengths` describe the full tree.
* Tests of the contract: `test/detail-loader.test.mjs` has a fake partial source; `scripts/check-parquet-source.mjs` is the end-to-end check.

## The cut: why two loops, and the golden tests

Phase 2 of the hardening first unified the two cut loops behind a `LayoutProjection` (`f9a61f6`). On ladder (caterpillar) trees that made the
cut slower: asking the projection per node was measured 20-30% slower (200k tips: rectangular 20 -> 26 ms, radial 25 -> 30 ms; 1M: rectangular
100 -> 123 ms, radial 121 -> 158 ms, medians of fresh processes), not because of polymorphism but because of V8's cumulative inlining budget
(`--max-inlined-bytecode-size-cumulative=920`): the per-node projection methods stayed real calls and the loop's many live locals spilled
around each. `90f1671` went back to two inline loops (`cutRect`, `cutRadial`) that share only per-frame precomputation (the dedupe anchors, the
radial window, computed once per projection) and the run's dedupe key (`proj.dedupeRun`, once per run); the projection kept the draw and hit
work, where the calls are per drawn primitive. Cost of the two-loop result against the loops before the refactor (e2897fb), quoted from the doc
comment of `cut` in `lod.ts` as of 0cc394f: "+3% to +17% at fit views (worst: 1M radial, +6% to +17% over four batches), equal or faster zoomed"
(searchCut on 200k and 1M caterpillars, one layout per fresh Node 22 process, interleaved batches, medians; the machine's run-to-run noise is
about 5-10%). A later profiling pass (literal PAD, inline epilogue, anchors computed locally or read from a Float64Array) did not recover it.
`projection.ts` has the header with the reasoning. Both copies of rule R's accumulator are duplicated on purpose and must be changed together.

Guard: `test/cut-golden.test.mjs` runs 168 cases (`test/cut-golden-cases.mjs`: a comb, balanced trees with thin cherries, random trees, polytomies
with runs, class and parent changes inside a run, a snapshot with stubs, right-edge cuts, zooms, sub-pixel pans, budgets that raise the threshold,
in both layouts) and compares the full draw list and `CutResult` with `test/cut-golden.json`, which was captured from the code before the
projection refactor (e2897fb). `check-radial-cut.mjs` is the second guard (invariants on real trees).

### Recapturing the cut goldens

After a deliberate change of the cut's output: `node --experimental-transform-types scripts/capture-cut-golden.mjs` (writes
`test/cut-golden.json` from the current code, one case per line, or to a path given as argument). On an unchanged cut it reproduces the committed
file byte for byte, so `git diff test/cut-golden.json` shows exactly which cases moved; review that diff like any behaviour change, and say in
the commit why the output moved.

## React identity (landed in e122a53; being changed by the React-layer / test work in flight, see the commit log)

The rules are written in the JSDoc of `TreeViewProps` in `src/react/TreeView.tsx`; read them there. In short: `options` and `theme` are compared
field by field (`src/react/props.ts`, `useShallowStable`), so an inline object with the same values is no change, but a function-valued option
(`formatLabel`) or `tipHref` is compared by identity and an inline arrow counts as a change on every render. `highlighted` is compared
element-wise, `clades` by content, `viewport` by its four numbers, `Column.values` BY REFERENCE (pass the same object while the data is unchanged,
never mutate it in place). The renderer's own setters (`setOptions`, `setTheme`, `setHighlighted`, `setColumns`, `setClades`) are no-ops for equal
input, so a direct user of the core gets the same behaviour. A new `tree` / `source`, or a changed `options.softwareCanvas`, re-creates the
renderer and so resets the view.

## Known limits and open work

The list of what is missing for production is in [docs/results/custom.md](../../docs/results/custom.md), section "Cost" ("What is missing for
production"), with the unmeasured items restated at the end of that file under "Hardening (2026-10-21)". Not repeated here. In short, nothing
here was measured on a real GPU, on a low-end device, in a browser other than headless Chromium, or with a screen reader; the Parquet source is a
proof of concept (no tip labels in snapshots, no search, no eviction); columns are drawn in the rectangular layout only.
