# @canopy/viewer internals

How the viewer core works and how to change it safely: the frame pipeline, the invariants, the module map, how to extend it, the cut and its
golden tests. For using the viewer, see the [README](../README.md) and the [API reference](api.md).

The core started as the custom candidate of the tree-viewer spike (the comparison lives on the `research` branch). It has a tree on typed arrays,
viewport level of detail with a draw budget, Canvas2D, a grid hit index and a DOM overlay for labels and links. What was measured, and the
decisions behind the current design, are in [docs/design/custom.md](../../../docs/design/custom.md). Everything was measured headless, without a
GPU.

## How to run

Node >= 22.7 is needed (the tests and scripts import the TypeScript sources directly with `--experimental-transform-types`; CI uses Node 22).
Install once at the repository root with `npm ci`. From the repository root, `npm run check` runs typecheck, lint, format check and every
workspace's tests. From `packages/viewer`:

| Command                                                                                    | What it does                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm test`                                                                                 | `node --test --test-concurrency=4 "test/**/*.test.mjs"` with `--experimental-transform-types` and the `@canopy/source` export condition: unit tests of the core modules (fake canvas context and fake document where needed, no DOM package), the golden test of the cut, and `test/radial-cut.test.mjs`, which runs `scripts/check-radial-cut.mjs` as a child process |
| `npm run typecheck`                                                                        | `tsc` with no emit                                                                                                                                                                                                                                                                                                                                                         |
| `npm run build`                                                                            | `tsc -p tsconfig.build.json` into `dist/`: one ES module per source file plus declarations and source maps                                                                                                                                                                                                                                                                 |
| `node --experimental-transform-types scripts/check-radial-cut.mjs [--tips N] [--budget N]` | regression of the cut, budget, culling, summaries, runs and hit-testing on the committed 10k Yule tree, and on the committed OTL 91k tree (`data/real-ladder/trees/otl-100k-vertebrata.nwk.gz`; prints `SKIP ...` when missing). Prints `OK`. About 2 s                                                                                                                    |
| `node --experimental-transform-types scripts/capture-cut-golden.mjs [out.json]`            | rewrites `test/cut-golden.json` from the current code. See "Recapturing the cut goldens"                                                                                                                                                                                                                                                                                   |

Browser checks and benchmarks live in [`tests/browser`](../../../tests/browser): a test page that mounts `<TreeView>` in two instances and
exposes `window.__spike` / `__spike2` (mount, colour, highlight, focus, locate, events, stats) and `window.__customTree` (the first
instance's handle). `npm run test:browser` there builds the page, serves it with `vite preview` on a free port, runs
`scripts/check-radial-ui.mjs` and stops the server by PID. It needs `playwright-core` (a dev dependency of that workspace) and a
Chromium: `$CHROMIUM_PATH`, else the newest `/opt/pw-browsers/chromium-*` if present, else the one `npx playwright-core install chromium` fetched.
`scripts/check-node-menu.mjs` there checks the node menu and tree operations on the React example (`examples/react`, `npm run dev`, port
5307). The benchmarks in `tests/browser/bench/` need the test page built and served (`npm run build && npx vite preview --port 5306`);
their numbers and what they showed are in `docs/design/custom.md`.

What the tests do not cover: real raster output (pixels), a real GPU, other browsers and touch devices; line coverage was not measured. Most
of `draw.ts` has no unit test: `cut-golden.test.mjs` calls `drawBody` with a recording context for the summary sliver and minimum-size rules,
and `overlay.test.mjs` and `projection.test.mjs` import helpers from it; labels, markers, highlights, axis and the radial arcs are exercised
only by the browser check. `columns.ts` is tested against a fake context.

Test trees are under `data/` (see `data/README.md`); large ones are git-ignored and fetched or generated by script.

## The frame pipeline

```
TreeSource.snapshot()            source.ts   TreeSnapshot: typed arrays over the rows that are loaded (+ stub, globalId, rollup
   |                                         for a partial tree). A new source.version -> syncSource() rebuilds what depends on rows.
computeLayout(snapshot, lengths, layout.ts   Layout: X, ROW, XMAX, LAST, the rows (rowStart/rowEnd, and the rank <-> row tables with
   collapsedMask)                            collapsed clades); cached per branchLengths flag; COS/SIN/BC/BS for radial, built on first use
   |                                         (ensureTrig)
makeTransform(kind, W, H, view,  geom.ts     Transform: the viewport window mapped to CSS px (rect: ox, oy, kx, ky; radial: centre,
   area, rows)                               scale k, angle step da) and the clip rectangle
   |
projectionFor(snapshot, L, T)    projection.ts  RectProjection | RadialProjection, built per frame: node and branch positions, clade
   |                                         extents, summary/run geometry, and the per-frame values the cut precomputes
searchCut(proj, ...) -> cut      lod.ts      DrawList (node, kind, cls, last, xmax): which nodes are drawn and how (expanded node,
   |                                         tip, summary triangle/fan/slice, stub)
   +-- drawBody, drawLeaders, drawMarkers, drawHighlights, drawLabels, columns, axis / scale bar        draw.ts, columns.ts  (Canvas2D)
   +-- HitIndex: uniform grid over the draw list, built on the first pointer query         hit.ts
   +-- LabelOverlay: DOM anchors over the canvas text, hidden tip list, live region        overlay.ts  (full-quality frames only)
   +-- DOM in the control layer: controls and popups, driven by events after the frame     control.ts, controls/, overlays/
       (the overview control draws the whole tree with its own cut; OverviewControl -> overview.ts, through viewerInternals)
   +-- DetailLoader: stubs in the draw list that are big on screen -> source.ensureClade   detail-loader.ts (partial sources only)
```

`TreeViewer.render()` (`viewer.ts`) runs from the transform down once per drawn frame. The snapshot is re-read only when `source.version` changed, and
the layout is cached per `branchLengths` flag and recomputed only then (or on a new snapshot, or when `setCollapsed` changes the collapsed clades). Frames are scheduled with `requestAnimationFrame` only when
something changed.

Where the three adaptive mechanisms sit:

- **Budget ladder** (`searchCut` in `lod.ts`). The cut collapses clades of three or more tips less than `minPx` tall (radial: arc at the farthest tip; option `minCladePx`, `'auto'` by default: 1 px (`MIN_THRESHOLD_PX`) where the budget follows the frame rate (radial with `radialMaxNodes: 'auto'`, #122; rectangular with `drawBudget: 'auto'`), so only the budget raises it, and 3 px (`AUTO_MIN_CLADE_PX`) with a fixed budget; `minCladeFor` in `viewer.ts`, after `resolveBudget`); a clade of one or two tips is never collapsed by size, at any `minPx` and so under the ladder too (#112), and may still be a member of a run of 16 or more small siblings. If the draw list
  would exceed the budget (`drawBudget`; radial: the smaller of that and `radialMaxNodes`; each a number or `'auto'`, the default, see the next item), `minPx` is raised on
  a fixed ladder `base * 1.15^n` and the cut is redone; the aborted pass stops as soon as the budget is exceeded. The level is sticky: it rises
  only on overflow and falls only when the next level down fits with room to spare, and the previous full frame's level is the starting point (a reduced frame's, while the view moves, is the previous reduced frame's, #93, scaled by the zoom since then, #150).
  Once the tip pitch reaches `RECT_CAP_MIN_PX` (1 px, rectangular, #113) or `TIP_DOT_PX` (6 px, the size of tip dots; radial) the base threshold is capped at the pitch (`collapseCap(pitch, lod, rect)` in `sizes.ts`, computed once per frame, passed to `searchCut` as `cap`), so nothing next to a drawn tip is folded. In the radial layout that is decided per clade (#110): tips have the angle `da`, so a tip's room to its neighbour is `da` times its own radius, and `dotR = TIP_DOT_PX / da` (`tipDotRadius(proj)`, passed as `dotR`) is the radius from which a tip gets a dot. A clade whose deepest tip reaches it (`XMAX[i] * k >= dotR`, one comparison on the `r1` the loop already has) is not folded by rule A, rule R or the polytomy rule while the threshold is at or under the cap; the budget alone folds it, past the cap (`forced` counts those). Drawing and hit-testing use the same measure per tip (`proj.minTipDepth(need)`: -Infinity when every tip in view has the room, Infinity when none has, else the depth a tip must reach; the radii are the view's nearest (`rMin`) and the outer ring's), for dots (`drawMarkers`, `hit.ts`) and tip labels (`drawLabels`, whose font size also follows the tip's own arc); aligned labels keep the one circle's pitch. Rectangular is untouched. The cap is a rung of the ladder (the first rung at or above it is replaced by it) and holds only while the list fits: on overflow the climb goes on past it, folding instead of truncating (#109). Above 80,000 visited nodes (caterpillar-like walks) there is no search, `minPx` just doubles until the list fits.
- **Adaptive budget** (`budget.ts`; `viewer.ts`: `resolveBudget`, `adaptBudget`; #114). With `drawBudget: 'auto'` (rectangular) or `radialMaxNodes: 'auto'` (radial) the budget is a state object, one per layout kind, moved by pure functions: nothing in the cut loops, which get a number as before. A number in either option is fixed and takes none of this path.
  - **Measured**: the JS time of full-quality frames (`observeFrame`, smoothed with weight 1/2 on the newest, the first full frame skipped as for `fullMs`), and the time between animation frames while an animation runs (`observeInterval`: on a weak device drawing the pixels dominates, and only this shows it). The interval is capped by the display's refresh, so it can lower the budget but never raise it. Drags and wheel ticks are not animations and contribute their JS time only.
  - **Applied on settle** (`stepBudget`): only on a settled full frame (no gesture in progress, so clades do not fold and unfold during a pan), and after `MIN_SAMPLES` (2) measurements. Over the target (`TARGET_MS`, 25): `budget * target / time`, at most halved. Under `RAISE_BELOW` (60%) of it: `budget * 0.85 * target / time`, at most doubled. Between: unchanged, so it does not bounce around 25 ms. Limits: floor 500 (rectangular) or 100 (radial), ceiling `CEILING` (200,000), or a fixed `drawBudget` beside `radialMaxNodes: 'auto'`, or a fixed `radialMaxNodes` beside `drawBudget: 'auto'`. Starts at today's fixed values (20,000; 2,000).
  - **Levels off at what the canvas can show**: a raise needs the last cut to have been limited by the budget (`overflow`, or `forced` > 0). A cut that fits at the base threshold shows everything the pixel-cell dedupe (rule C) and the collapse threshold leave, so a larger budget changes nothing and the budget stays, however fast the frames. The budget waits for the view to stop (`moving`, set by every input and ended `refineMs` later, whatever `interactionLOD` is). `pressed` is cleared by a fast measurement only once the budget has passed the list length the limit needed (`BudgetState.need`), so the limit does not flap on and off. A new tree (`setTree`) skips its first frame for the controller and for `fullMs`. The finest threshold is `MIN_THRESHOLD_PX` (1 CSS px, the floor of `minCladePx` and of the ladder; CSS px, not device px, like the dedupe grid and every threshold).
  - **After a change**, `adaptBudget` asks for further frames (a timer, `BUDGET_FRAME_MS`, at most `CHAIN_FRAMES` without any input) to measure the new value, so it settles without a gesture. A new input ends that, and a tree, layout or option change starts it again.
  - **Radial wedge limit** (`MAX_WEDGE_DEG`, 4 degrees; `radialMaxNodes: 'auto'` only). The ladder stops at the threshold that folds nothing wider than 4 degrees at the outermost ring, `wedgeLimitPx(L.XMAX[0] * k)`, passed to `searchCut` as `limit` (with `hardBudget`, the ceiling): at the highest rung at or under the limit, where the list still overflows the budget, the cut is made at that rung with the hard budget, so the list may be longer than the budget. The limit is also per clade (#110): `searchCut` passes `wedge` (4 degrees in rad) on to the cut as `CutParams.wedge`, and rule A does not fold a clade whose wedge, `a1 - a0`, is at least that, whatever its radius (a clade's arc at its own radius is its wedge times `XMAX[i] * k`, so `4 degrees * XMAX[i] * k` is the same test). It holds with the limit and goes with it where the budget gives way. The limit holds while frames are on target and gives way once a step has lowered the budget (`BudgetState.pressed`, cleared when frames are fast again): then the ladder goes on past it, folding rather than slowing down. A reduced frame has no limit. `FrameStats.minPxLimit` is the limit in force (Infinity: none); `minPxUsed` above it with `forced` > 0 shows the budget winning. 
  - **Rectangular block limit** (`MAX_BLOCK_PX`, 20 CSS px, #119; `drawBudget: 'auto'` only). The same `limit` mechanism, with the threshold itself as the limit: rule A folds a clade shorter than the threshold, so no block it folds is taller than 20 px while frames are on target. It gives way to slow frames and has no effect in a reduced frame, exactly as the radial limit. Runs of small siblings (rule R) are not bounded by it.
- **Interaction LOD** (`viewer.ts`: `noteInput`, `refineMs`). The input controller calls `noteInput()` before it moves the view. While the user
  wheels, pinches, drags or an animation runs, frames are reduced: a quarter of the budget (at least 500), and the threshold x1.6 when the last
  full frame had more than 1,000 primitives. With `interactionLOD: 'auto'` (the default) that happens only while the full-quality frames are
  slow: `fullMs`, the JS time of the full frames averaged with weight 1/2 on the newest (the first full frame, with its one-off costs, is skipped), above `AUTO_LOD_MS` (12 ms). A reduced frame does
  not update it, so a gesture that started reduced stays reduced until the frame after `refineMs` measures the full cost again. JS time
  leaves out the GPU and compositing, so it is a lower bound of the real frame time. `refineMs` (default 120) after the last input one full-quality frame is drawn. The label overlay,
  the corner notice and the stub loader run after full-quality frames only.
- **Settle** (`settle()` in `viewer.ts`). Anything that reads the draw list for a decision (`hitTest`, click, hover, `locateNode`, `nodeBounds`,
  `columnCell`, `renderNow`) first draws a full-quality frame if the last one was reduced, so a click always hits what a settled frame shows.

## Invariants the core relies on

From the header of `packages/io/src/tree.ts` and from `src/types.ts`. (`packages/io/test/parser.test.mjs`, test 'structural invariants on a real tree', checks them on the TreeModel; `layout.test.mjs` and the cut tests exercise them on the core side.)

- Nodes are numbered in preorder, so `parent[i] < i` for `i > 0`, and the subtree of `i` is the index range `[i, subtreeEnd[i])`.
- Tips are ranked in preorder, and the tips below `i` are the rank range `[leafStart[i], leafEnd[i])`. A click event carries that range at no
  cost; labels are sliced from `tipLabels`.
- The cut is one forward scan over the preorder arrays and skips a culled or collapsed subtree by jumping to `subtreeEnd[i]`.
- `X` never decreases from parent to child (negative or missing lengths count as 0); `layout.ts` notes that culling relies on it.
- In a partial snapshot `nodeCount` is the number of rows, ids in the arrays are row indexes, while `tipCount`, `leafStart`, `leafEnd` and
  `tipRank` are ranks of the FULL tree; a stub row has `subtreeEnd[i] = i + 1` and `childCount[i] > 0`. The public API and `NodeEvent.node` speak
  the preorder id of the full tree (`globalId`), not the row.

The coding rule that goes with them: **no recursion** (ladder trees are 1M deep, a recursive walk overflows the stack) and **no per-node
allocation** in the cut, draw or hit code (typed arrays, scratch fields, caller-supplied output objects). Both are conventions of this code;
no lint rule enforces them. Per-frame allocation of a few objects (a projection, a result per search pass) is accepted; per-node is not.

The radial dedupe key of a primitive with an end beyond the cells (a deep zoom, #111) is made by `clipRay` in `lod.ts`, which leaves it in the
module-level `CLIP` array (4 cells, shared and overwritten by every call: read it right after the call, never keep it) instead of allocating;
only summaries get it in the cut (`seenSummary`: a summary whose ray misses the cells is never merged), while connectors and tips keep their
clamped key inline, as clipping them, or even a call per node, cost 15-60% of a radial cut zoomed into a 200k comb (measured with the cut
benchmark against `fa1f511`). `RadialProjection.dedupeRun` calls `clipRay` too and does not merge a run that misses.

A summary at the 1 px threshold is drawn and hit as a branch to its deepest tip (`Scene.summaryLines`, `lineTip` in `lod.ts`, the
layout's `DEEPEST`, #126): the cut is unchanged, only `drawBody` and `HitIndex.build` read it.

A summary and a run are keyed by how far they reach (their XMAX, in both layouts), not by their node: keyed by the node, a clade with a long
branch was merged into a shorter one in the same cells, and the long branch was only drawn at other zooms.

Related, from the measured work: the two cut loops in `lod.ts` are separate on purpose (see below), and several helpers there (`cell`, the
`K_*` kinds) are defined in the loops' module because an import binding measured slower (the comment on `cell` in `lod.ts` gives 10-25% slower on a polytomy; `90f1671`).

## Collapsed clades

`setCollapsed(nodeIds)` makes a clade one row and one summary, on the full tree (issue #29: the app no longer collapses a copy of the tree and
translates ids). The tree arrays are not touched. What changes is the **layout**, and with it the meaning of "row". These are the invariants:

- **Rows and ranks.** A _row_ is a place across the tips (rect: y in rows, radial: angle = fan.start + row * fan.span / rows, see `RadialFan` in `layout.ts`). A _rank_ is a tip's index in the
  tree. Without collapsed clades they are the same number and `Layout.rowOfRank`, `rankOfRow`, `rowNode`, `collapsed` and `hidden` are all `null`;
  `rowStart` / `rowEnd` are then the very arrays `tree.leafStart` / `leafEnd`, `rows === tips`, so nothing is copied and the cut reads the same
  memory as before (the cut goldens did not change). `computeLayout(tree, lengths, mask)` builds the tables in O(n) (one preorder scan that jumps
  over the collapsed clades, one scan over the tips, one reverse pass for the node rows), no recursion; `setCollapsed` recomputes the layout.
- **Tables.** `rowOfRank[r]`: the row of tip `r` (the clade's row for a hidden tip). `rankOfRow[row]`: the first rank of the row, length
  `rows + 1`, ending with `tips`; a row holds the ranks `[rankOfRow[row], rankOfRow[row + 1])`: one for a tip, more for a collapsed clade (so
  "this row is a collapsed clade" is `rankOfRow[row + 1] - rankOfRow[row] !== 1`). `rowNode[row]`: the node that stands for the row, the tip
  or the clade. Every node has `rowStart` / `rowEnd` in rows, and `ROW` is the middle of its children's: a hidden node has its clade's one row
  (`rowStart = row`, `rowEnd = row + 1`, `ROW = row + 0.5`), which is what lets `focusTip`, the highlight bands and the view-keeping treat a
  hidden tip as "on the clade's row" without a special case.
- **What is in rows and what in ranks.** Geometry is in rows: the viewport `y`, `ROW`, `rowStart` / `rowEnd` (cut, hit, projections),
  `makeTransform`'s last argument, `tipPitch`, the fit and limits of `ViewState`, the overview. Identity and counting are in ranks: highlights
  and the dim prefix (`hlRanks`, `hl`, `hlPrefix`: a collapsed clade is dimmed only when none of its tip RANGE `[leafStart, leafEnd)` is
  highlighted, which is exactly the rule for any summary), the columns' data (by rank; `drawColumns` reads it through `rankOfRow`), tip counts
  in events and the label list's `rank`. Code that mixes the two is the bug to look for: a loop over `0..tipCount` that draws or positions
  something must go through `rowOfRank`.
- **The cut.** A node with `Layout.collapsed[i] === 1` is a `K_SUMMARY` and is never descended into; it is one `Uint8Array` read per visited
  node, in both loops (`cutRect`, `cutRadial`, changed together), only when the layout has a mask (`collapsed !== null`). It is not taken into
  a run of small siblings (rule R), and is never a slice (`isSlice(tree, i, collapsed)` is false for it): it is a triangle or fan whatever its
  children are. `forced` does not count it. Only the _outermost_ of nested collapsed clades is marked; the rest is `hidden`, which is also what
  `nodePosition`, `locateNode` and `nodeBounds` use to answer `null`.
- **The axis** does not depend on collapsing: `X` and `XMAX` are those of the full tree, so the triangle ends at the clade's deepest tip and a
  dated tree stays dated (`ultrametric`, the "time before tips" axis).
- **The window.** `ViewState` keeps `y` in rows. When the set changes, `viewer.relayoutCollapsed()` carries the window across with
  `remapRow(y, oldLayout, newLayout)` (through the rank: the row of a tip in the old layout is the row of that tip in the new): same height in
  rows (the scale), same place of the centre; a fitted window is fitted again; the radial window turns with its centre. `keptViewport`
  (`setTree` with a map) converts rows to ranks on the old layout and back on the new one the same way.
- **Keyboard.** The cursor moves over rows (`keyboard.ts`, with `Layout.rowNode`), so a collapsed clade is one stop; its children are hidden
  and Right does not enter it. The cursor and the hover are dropped when the set changes.
- **Label.** A collapsed clade's label is drawn with the tip labels (`drawLabels`, `Scene.cladeText`), anchored at the end of its triangle, with
  `LabelList.rank = -(node + 1)`; the DOM overlay skips such entries.
- **Events.** `NodeEvent.collapsed` is true for a node with `Layout.collapsed[node] === 1` (`makeNodeEvent`).
- **Not supported:** a snapshot with stubs or rollups (partial source). `applyCollapsed` leaves the mask empty there.

## Module map

Line counts are `wc -l` of the files at the date below; they include comments. `viewer.ts` is over a
thousand lines by design: it keeps the public API, `render()`, `drawTop`, hover, the notice and the interaction-LOD state, because those are
tied to the frame loop; only the parts with one job were moved out. It is a facade, not a fully decomposed class.

As of the library restructure (`wc -l`, 2026-10-21; a folder counts all its files):

| File                              | Lines     | Job                                                                                                                                                  |
| --------------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/types.ts`                    | 298       | public types: `TreeData`, `TreeSnapshot`, `ViewerOptions` and defaults, `TreeTheme` and `FALLBACK_THEME`, `NodeEvent`, columns, `FrameStats`         |
| `src/viewer.ts`                   | 1,323     | `TreeViewer` facade: DOM, control layer, frame loop, `render()`, source sync, hover, notice, interaction-LOD state, theme layers, events, public API |
| `src/clade-name.ts`               | 42        | `cladeName`, `internalName`: the one rule that names a clade (legend, node menu title, tooltip, announcement)                                        |
| `src/events.ts`                   | 124       | `Emitter`, the event map and `TreeEvent` (default actions, `preventDefault`)                                                                         |
| `src/node-event.ts`               | 69        | `makeNodeEvent`: `Hit` to public `NodeEvent`; `toTreeEvent` adds ids, tip helpers and `preventDefault`                                               |
| `src/theme.ts`                    | 99        | `themeFromCss`, `THEME_CSS_VARS`: the theme from `--phylo-*` custom properties                                                                       |
| `src/control.ts`                  | 84        | `Control`, `BaseControl` (listener bookkeeping), `makeButton`                                                                                        |
| `src/controls/`                   | 471       | built-in controls, one module each: zoom, fit, layout toggle, search, legend, overview (+ `defaults.ts`, `icons.ts`)                                 |
| `src/overlays/`                   | 379       | `Overlay` (pinned to a node), `Tooltip`, `NodeMenu`                                                                                                  |
| `src/source.ts`                   | 97        | `TreeSource` interface, `InMemorySource`                                                                                                             |
| `src/layout.ts` | 280 | `computeLayout`: X, ROW, XMAX, LAST in linear passes (or from rollups for a partial snapshot); the rows and rank <-> row tables of collapsed clades; `remapRow`; cos/sin cache |
| `src/geom.ts`                     | 95        | `makeTransform` (viewport to px), sector bounding boxes                                                                                              |
| `src/projection.ts`               | 316       | `LayoutProjection` (`RectProjection`, `RadialProjection`): positions, clade extents, summary/run geometry, per-frame cut values                      |
| `src/lod.ts`                      | 655       | the cut (`cutRect`, `cutRadial`, `searchCut`), `DrawList`, `Seen` (pixel-cell dedupe), rules A to D and R                                            |
| `src/budget.ts`                   | 150       | the adaptive draw budget (`'auto'`): the controller as pure functions over a state object, its constants, `wedgeLimitPx` |
| `src/draw.ts`                     | 643       | Canvas2D drawing of a draw list: branches, summaries, markers, highlights, labels, axis, scale bar; `TextMeasurer`                                   |
| `src/hit.ts`                      | 314       | `HitIndex`: uniform grid over the draw list, candidate scoring                                                                                       |
| `src/columns.ts`                  | 379       | bar / text / alignment / custom columns: compile by tip rank, draw, `cellRect`, `updateColumns`                                                      |
| `src/tip-row.ts`                  | 42        | `tipRow`: a tip named by label or node id (`TipRef`) to its snapshot row, with the warnings; behind `focusTip`, `columnCell` and `<TreeView>`'s handle (no DOM) |
| `src/view-keep.ts`                | 92        | `keptViewport`: where the window goes when `setTree` replaces the tree (the tips in view sent through a tip map); `viewContent` / `placeContent`: where it goes on a switch of layout or branch lengths (#56; the rows in view at the same tip pitch). No DOM |
| `src/view-state.ts`               | 384       | `ViewState`: viewport, area, fit, limits, zoom, target windows, animation (no DOM)                                                                   |
| `src/input.ts`                    | 306       | `InputController`: wheel, pointer, pinch, click, key events to calls on a host (ignores the control layer)                                           |
| `src/keyboard.ts`                 | 70        | keyboard cursor: start node and navigation keys (pure functions)                                                                                     |
| `src/ring-anim.ts` | 60 | `RingAnim`, `easeOut`: the hover and cursor rings growing in and fading out (`hoverAnimation`), on frame timestamps |
| `src/overlay.ts`                  | 158       | `LabelOverlay`: label anchors and links, hidden tip list, live region                                                                                |
| `src/overview.ts`                 | 269       | `Overview`: strip/disc with the window box, its geometry as pure functions (used by `controls/overview.ts`)                                          |
| `src/detail-loader.ts`            | 87        | `DetailLoader`: opens stubs of a partial source through `ensureClade`                                                                                |
| `src/live.ts`                     | 13        | `live()`: builds the getter objects modules read the viewer through                                                                                  |
| `src/dom.ts`                      | 11        | `mk`, `SR_ONLY`                                                                                                                                      |
| `src/constants.ts`                | 85        | tuning constants and numeric limits                                                                                                                  |
| `src/index.ts`                    | 14        | public exports                                                                                                                                       |
| `css/viewer.css`                  | 326       | styles of the DOM (controls, popups, legend, search, notice), `--phylo-*` properties with fallbacks                                                  |
| `css/gbif.css`                    | 22        | GBIF design tokens mapped to `--phylo-*`                                                                                                             |
| `../react/src/TreeView.tsx`       | 324       | `<TreeView>` component, `TreeViewHandle`, `TreeNodeEvent`                                                                                            |
| `../react/src/props.ts`           | 38        | `useShallowStable` and the equality helpers behind the prop identity rules                                                                           |
| **Total, `src/` of this package** | **6,864** |                                                                                                                                                      |

Scripts and tests:

| File                                                              | Lines     | Job                                                                                                                                                                                                            |
| ----------------------------------------------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/check-radial-cut.mjs`                                    | 583       | regression of the cut on real trees (also run by `npm test`)                                                                                                                                                   |
| `../../tests/browser/scripts/check-radial-ui.mjs`                 | 667       | browser check of the renderer on the built test page                                                                                                                                                           |
| `../../tests/browser/scripts/test-browser.mjs`                    | 141       | `npm run test:browser`: per page (test page, vanilla example, React example) build, serve, run its check, stop the server                                                                                      |
| `../../tests/browser/scripts/check-vanilla-example.mjs`           | 240       | browser check of the framework-free example: controls, search, custom popup, node menu, legend, custom column, dark theme                                                                                      |
| `../../tests/browser/scripts/check-node-menu.mjs`                 | 333       | browser check of the node menu and tree operations on the React example                                                                                                                                        |
| `scripts/capture-cut-golden.mjs`                                  | 57        | rewrites the cut goldens from the current code                                                                                                                                                                 |
| `test/layout.test.mjs`                                            | 66        | layout invariants (X, ROW, XMAX, LAST) on a tiny tree; the template for core unit tests                                                                                                                        |
| `test/projection.test.mjs`                                        | 139       | projections, the cut written once on top of them, per-renderer text measurer                                                                                                                                   |
| `test/cut-golden.test.mjs, cut-golden-cases.mjs, cut-golden.json` | 3,984     | 168 golden cases of the cut (draw list and `CutResult`), captured at e2897fb; recapture: `scripts/capture-cut-golden.mjs`                                                                                      |
| `test/lod.test.mjs`, `seen-memo.test.mjs`                         | 205       | `Seen` (and its memo of the last two keys against a plain set, #5), `DrawList` growth, the `searchCut` ladder                                                                                                                                                            |
| `test/budget.test.mjs, budget-auto.test.mjs`                       | 450       | the adaptive budget (#114): the controller with a fake clock (halves at twice the target, lowers a little when slightly slow, raises when fast, limits, settle only, level off when nothing is left to show) and in the viewer (`'auto'` moves across frames, a number never does), and `searchCut`'s limit (no wedge past 4 degrees unless the budget must win) |
| `test/radial-per-tip.test.mjs`                                    | 249       | radial dots, labels and folding decided per tip from the arc at its own radius, the per-clade wedge limit (#110)                                                                                               |
| `test/radial-branch-width.test.mjs`                               | 47        | radial branch width: the theme width under 500 primitives, one device pixel from 900, faded in between; rectangular unchanged                                                                                  |
| `test/summary-lines.test.mjs`                                     | 82        | summaries as branches at the 1 px threshold (#126): `Layout.DEEPEST`, the line to the deepest tip, the tip hovered at its end                                                                                  |
| `test/lod-cap.test.mjs`                                           | 134       | the collapse threshold capped at the tip pitch once tips have dots, and the budget climbing past it (#109)                                                                                                     |
| `test/cut-stub.test.mjs, partial-snapshot.mjs`                    | 306       | the partial-source path (stubs, `globalId`, rollups) through layout, cut and hit; `partial-snapshot.mjs` is a helper, a miniature of `ParquetSource.build()`                                                   |
| `test/geom.test.mjs`                                              | 140       | transforms of both layouts, sector bounding boxes against a brute-force sample, `viewportEquals`                                                                                                               |
| `test/hit-rect.test.mjs`                                          | 189       | rectangular hit-testing: tip, marker, branch, connector, collapsed clade, run                                                                                                                                  |
| `test/columns.test.mjs`                                           | 542       | column compile, bar scale, `cellRect`, `drawColumns` on a fake context                                                                                                                                         |
| `test/set-tree.test.mjs`                                          | 208       | `setTree`: the view kept through a map (identity, prune, flip), fitted when nothing survives, `treechange`, controls and listeners kept, clades and highlights with the new tree, the Search index and Legend  |
| `test/view-state.test.mjs`                                        | 329       | viewport arithmetic: area, fit, limits, zoom, target windows, animation                                                                                                                                        |
| `test/input.test.mjs, input-gestures.test.mjs`                    | 478       | `InputController`: wheel, drag, click, pinch, keys, with a fake element and host                                                                                                                               |
| `test/keyboard.test.mjs`                                          | 87        | keyboard cursor and `makeNodeEvent`                                                                                                                                                                            |
| `test/overlay.test.mjs`                                           | 285       | `LabelOverlay` with a fake document: pool, transforms, links, screen reader list                                                                                                                               |
| `test/overview.test.mjs`                                          | 79        | overview geometry                                                                                                                                                                                              |
| `test/detail-loader.test.mjs`                                     | 162       | `DetailLoader` with a fake partial source                                                                                                                                                                      |
| `test/live.test.mjs`                                              | 59        | `live()`                                                                                                                                                                                                       |
| `../react/test/props.test.mjs`                                    | 118       | (React package) prop helpers (`props.ts`), theme comparison, column reuse in `updateColumns`                                                                                                                   |
| `test/radial-cut.test.mjs`                                        | 19        | runs `scripts/check-radial-cut.mjs` as a child process                                                                                                                                                         |
| `test/events.test.mjs`                                            | 121       | the emitter (order, removal during an emit, once, default actions, errors) and `TreeEvent`                                                                                                                     |
| `test/controls.test.mjs`                                          | 206       | `BaseControl` bookkeeping and the built-in controls against a fake viewer                                                                                                                                      |
| `test/overlays.test.mjs`                                          | 195       | `Overlay` placement, the tooltip and the node menu as default actions, menu keyboard                                                                                                                           |
| `test/theme.test.mjs`                                             | 74        | `themeFromCss`, list splitting, luminance, `themeEquals`                                                                                                                                                       |
| `test/viewer.test.mjs`                                            | 366       | the `TreeViewer` facade built for real: `setClades`, `addControl`, the frame order on an opaque and an alpha canvas, the canvas swap on a theme change, `setTheme` / `refreshTheme`                            |
| `test/viewer-harness.mjs`                                         | 269       | `makeViewer(tree, init)`: a real viewer over the fake DOM, with a recording 2D context, a rAF queue, ResizeObserver, matchMedia and getComputedStyle under the test's control (build later viewer tests on it) |
| `test/fake-dom.mjs`                                               | 263       | the minimal fake DOM the control, overlay and viewer tests run on                                                                                                                                              |
| **Total, `test/`**                                                | **7,869** |                                                                                                                                                                                                                |

## How to extend

### Add a viewer option

1. `src/types.ts`: add the field to `ViewerOptions` (with a comment on its meaning) and its default to `DEFAULT_OPTIONS`.
2. Read it where it acts, from `this.opts` in `viewer.ts`, or through the narrow interface of the module that needs it (`ViewEnv` in
   `view-state.ts`, `OverlayOptions` in `overlay.ts`, `OverviewHost`, `InputHost`; the facade builds these with `live()` so they read current values).
3. If changing it must do more than redraw (refit, rebuild the layout, reset the threshold hint, clear the overlay), add that to `setOptions` in
   `viewer.ts`. A numeric tuning value that is not an option goes in `src/constants.ts`.
4. React: nothing, if it is a field of `ViewerOptions`. `<TreeView>` passes every field of its `options` prop (except `layout`, `branchLengths`
   and `tipHref`, which are props) to `setOptions`, so adding an option touches `types.ts` and the code that reads it (commits e122a53 and 3317ca7; before them,
   `TreeView.tsx` listed each option twice). A key absent from `options` is the default from `DEFAULT_OPTIONS`.
5. Document it in [docs/api.md](docs/api.md) and add a test if it changes geometry (`test/` has the pattern: import the module, build a tree
   from `packages/io/src/newick.ts`, assert).

### Add a layout kind

A layout is a `LayoutKind` string plus a projection class (`src/projection.ts`). `LayoutProjection` is the union `RectProjection | RadialProjection`,
so a third layout extends that union and `projectionFor`. Draw and hit are written once against the projection; the cut is not (see below).

1. `types.ts`: extend `LayoutKind`; `geom.ts`: `makeTransform` builds the `Transform` for it (the window, scale, clip rectangle) and `projectionFor`
   (`projection.ts`) picks the projection class from `T.kind`.
2. Implement the `ProjectionCore` members (`projection.ts`): `kind`, `tree`, `L`, `T`; `dedupeRun` (the dedupe key of a run of small siblings; used
   by the cut once per run); `tipPitch`; `minTipDepth(need)` (the depth from which a tip has the room, per tip in radial, #110); `nodeXY`, `parentXY`, `depth`, `tip`, `cladeSize`, `summaryExtent` (+ the fields `d0 d1 t0 t1`). The consumers:
   `draw.ts` (positions, `summaryExtent`, `cladeSize` for the marker threshold, `tipPitch`, `minTipDepth`), `hit.ts` (positions and extents of candidates,
   `cladeSize`, `minTipDepth` for the dot targets), `viewer.ts` (`nodeXY` for `locateNode`). `tipSpan` is not part of `ProjectionCore`: it exists only on
   `RadialProjection`, where `drawBodyRadial` uses it for arc lengths.
3. Write the cut loop. `lod.ts` has `cutRect` and `cutRadial` as two inline loops with the cull, the collapse rule (A), the dedupe key (rule C)
   and the run accumulator (rule R) written as locals; `cut()` dispatches on `proj.kind`. A third layout means a third copy of that loop, and the
   golden tests (`test/cut-golden*.mjs`) are the model for guarding it. Why not one loop through the projection: see the next section.
4. Layout-specific drawing (strokes, arcs, axis) stays in `draw.ts` per layout; `view-state.ts` has the fit, limits and target windows per kind;
   `overview.ts` has the geometry of the corner view; `keyboard.ts` has the navigation per layout. Grep for `'radial'` to find them all.

### Add a column kind

An app adds its own column without touching the core: a `CustomColumn` (`kind: 'custom'`) with a `ColumnRenderer` (`prepare` when the values
change, `draw` once per frame with the visible ranks; see `types.ts` and the heat strip in `examples/vanilla`). A new BUILT-IN kind goes in
`columns.ts`: `compileColumn` turns a spec into arrays by tip rank once (values are looked up by tip label there), `drawColumns` draws the
visible rows, `cellRect` returns the cell of a tip rank for `columnCell`, `columnsWidth` / `layoutColumns` place them to the right of the plot,
`updateColumns` / `columnSpecEquals` decide what `setColumns` recompiles (a column is compared by `id`, `kind`, `header`, `width`, `values` by
reference and, for a custom column, `renderer` by reference). Column ids must be unique: a duplicate id is recompiled on every call. Columns are
drawn in the rectangular layout only. `viewer.ts` calls `updateColumns` from `setColumns` and `drawColumns` from `paint()` (the drawing half of `render()`, also used by `toBlob`); the header and the
width come from the spec, so a new kind usually touches only `columns.ts` and `types.ts`.

### Add a control or a popup

Controls and popups live in the control layer (`data-phylo-ui`: the input controller ignores events from inside it) and use the public API
only. Subclass `BaseControl` (`control.ts`): give it a name (class `phylo-<name>`) and a position, build the element in the constructor, and
register listeners in `attach(viewer)` with `this.listen(viewer.on(...))` and `this.domListen(...)`, so `setViewer(null)` removes them. Read the
state from getters (`options`, `getViewport`, `getClades`, `getTree`) and follow it through events (`optionschange`, `viewchange`,
`cladeschange`, ...); act through the setters. A popup that reacts to a click or hover listens with `{ asDefault: true }`, so an app can
`preventDefault()` it; one pinned to a node uses `nodePosition` after each `frame` (see `overlays/overlay.ts`). Style it in `css/viewer.css`
through `--phylo-*` properties with fallbacks. A built-in goes in `controls/` or `overlays/`, its own module, exported from their `index.ts`;
`scripts/check-packages.mjs` asserts that `TreeViewer` alone does not bundle it. Only the overview needs the viewer's internals
(`viewerInternals`: its cut machinery and the strip reservation); keep everything else on the public API.

### Add a theme token

Add the field to `TreeTheme` and `FALLBACK_THEME` (`types.ts`; `themeEquals` compares every field), read it where it is drawn (from the
`Scene`'s theme, once per frame, never per node), and add it to the lists in `theme.ts` (`COLOURS` or `NUMBERS`): its CSS property,
`--phylo-<kebab-case name>`, follows from the field name. Mention it in the header of `css/viewer.css` and in the API reference.

### Add a TreeSource

Implement `TreeSource` (`src/source.ts`); `InMemorySource` is the trivial one; a partial one over Parquet files (`ParquetSource`) is on the `research` branch, `spikes/custom/src/parquet/`.

- `snapshot()` must be always renderable, synchronous, and return the same object while `version` is unchanged. It returns a `TreeSnapshot`: all
  the `TreeData` arrays over the loaded rows (preorder, the invariants above), plus `stub` (1 = a row standing for a clade whose rows are not
  loaded), `globalId` (row to preorder id of the full tree; null = identity), `rollup` (per row `cumLength`, `maxCum`, `depth`, `maxDepth`, `row`,
  the numbers the layout cannot derive for a stub) and `toLocal(globalId)` (row or -1).
- Stub contract: a stub row is drawn as a summary from its rollups and `leafStart` / `leafEnd`, never descended into (`subtreeEnd[i] = i + 1`,
  `childCount[i] > 0` so it is not taken for a tip), and never part of a run. A source with no stubs sets all three extra fields to null.
- When rows arrive or are dropped, bump `version` and call the listeners given to `subscribe()`. `ensureClade(globalId, {signal, priority})`
  resolves after the version bump; `DetailLoader` calls it for big stubs after full-quality frames and cancels through the signal. `openCost` is
  optional. `tipLabels(r0, r1)` is async because a partial source may not have the labels; `nodeCount`, `tipCount`, `hasLengths` describe the full tree.
- Tests of the contract: `test/detail-loader.test.mjs` has a fake partial source; `scripts/check-parquet-source.mjs` on the `research` branch is the end-to-end check of `ParquetSource`.

## The cut: why two loops, and the golden tests

Commit `f9a61f6` first unified the two cut loops behind a `LayoutProjection`. On ladder (caterpillar) trees that made the
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

## React identity

The rules are written in the JSDoc of `TreeViewProps` in `packages/react/src/TreeView.tsx`; read them there. In short:

- `options` is compared field by field (`useShallowStable` in `packages/react/src/props.ts`) and `theme` with `useStable(..., themeEquals)`, so an inline object with the same values is no change. A
  function-valued option (`formatLabel`) or `tipHref` is compared by identity, so an inline arrow counts as a change on every render: hoist it or
  wrap it in `useCallback`.
- The viewer's options are built as `{...DEFAULT_OPTIONS, ...stripUndefined(options), layout, branchLengths, tipHref}`: a key removed from
  `options` (or set to `undefined`) reverts to its default; it does not keep the old value.
- `highlighted` is compared element-wise, `clades` by content, `viewport` by its four numbers, `focus` acts when `seq` changes (and is applied again when the renderer is re-created).
- `columns`: compared per column by `id`, `kind`, `header`, `width` and `values` BY REFERENCE, and column objects by reference first. Replace a
  column object (and its `values`) when the data changed; never mutate either in place. Ids must be unique.
- `theme` holds overrides only: they go over the theme the viewer read from the `--phylo-*` custom properties (and `FALLBACK_THEME`).
- `controls` is compared element by element by identity; the component adds and removes controls to match, plus its own `Tooltip` (when
  `tooltip` is not false) and `NodeMenu` (when `nodeMenu` is given), each created once per component.
- The viewer's own setters (`setOptions`, `setTheme`, `setHighlighted`, `setColumns`, `setClades`) are no-ops for equal input, so a direct user of
  the core gets the same behaviour.
- The prop-sync effects act only on the live renderer (`liveRenderer` in `TreeView.tsx`), so no setter runs on an instance that was destroyed by a
  strict-mode remount. A new `tree` / `source` of the same kind goes to the live renderer's `setTree` (in an effect before the clade, highlight and collapsed effects, with those props passed in the same call, so the next frame never shows the old colours); `treeMap` keeps the view. Only a switch between `tree` and `source`, or a changed `options.softwareCanvas`, re-creates the renderer.

Introduced in `e122a53`, corrected in `3317ca7`.

## Known limits and open work

The list of what is missing for production is in [docs/design/custom.md](../../../docs/design/custom.md), section "Cost" ("What is missing for
production"), with the unmeasured items restated at the end of that file under "Hardening (2026-10-21)". Not repeated here. In short, nothing
here was measured on a real GPU, on a low-end device, in a browser other than headless Chromium, or with a screen reader; the Parquet source is a
proof of concept (no tip labels in snapshots, no search, no eviction); columns are drawn in the rectangular layout only.

The script also writes `test/cut-golden-cap.json` (`cappedCases()`): the cut with the real `collapseCap` at rectangular rows of 0.9, 1, 2 and 6 px and radial pitches under and over 6 px (#109, #113), and radial phylograms where clades with a dotted tip stay open (#110). The first file passes no cap.
