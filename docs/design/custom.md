# Custom baseline 0.1.0 (2026-10-14)

Own renderer in `spikes/custom/` (typed arrays from `shared/tree.ts`, Canvas2D, viewport level of detail, React `<TreeView>`), no tree or rendering library, only `react` and `react-dom` 18.3.1 at runtime. Licence of our code: Apache-2.0. Built to set the performance ceiling and the API shape the libraries are judged against. Chromium 141 headless (`/opt/pw-browsers/chromium-1194`), 4 vCPU, no GPU, runner flags as in CONTRACT.md (`--disable-gpu-rasterization`), **machine shared with five other agents (load average 10 to 17 on 4 cores during most runs)**.

Run ids (all in `spikes/results/custom/`, the JSON of each run carries the Chromium version, flags, machine and caveat): smoke S1 to S15 `20261014-151607`, `20261014-151840` and the final one after the last code change `20261014-152801`; ladder (S1, 10 trees up to 190k) `20261014-150924` and `20261014-152029`; worst (S1) `20261014-152308`, earlier `20261014-151248` (its S10 `fail` on the 20k caterpillar was a real bug, fixed: after a drag, zoom-out left the x window a hair under 1.0 so the clamp let the tree stay shifted; re-run `20261014-152604` passes functionally); rich, dated and edge trees (S1) `20261014-151410`; S10 on the 100k Yule tree `20261014-151744`; benchmark JSON in `spikes/results/custom/bench/` (scripts `spikes/custom/bench/`); screenshots in `spikes/results/custom/screens/` (the seven `custom-*.png` were taken by `bench/screens.mjs`, the others by the runner).

Gates: G1 pass (own code, Apache-2.0; no third-party runtime dependency besides React), G2 pass (static files only), G3 pass (React component with controlled props, clean unmount, several instances; also usable without React through the core), G4 pass (we own it; see "Cost").

## Result in one paragraph

All of S2 to S15 pass on the smoke trees; S3 is `partial` by the runner's rule only because the tip sets are `adapter-derived` (they are an O(1) range of the shared preorder model, correct and checked against ground truth). S1 is `timeout` in every run because the runner's p5 frame-rate rule (20 fps) is dominated by main-thread stalls of 100 to 400 ms that are **independent of tree size and also hit the naive stub at 200 tips** under the same load (stub, 200 tips: p5 7.5 fps; custom, 200 tips: 7.5 fps; the stub at 1,000 tips: 5.5 fps), so the p5 number measures the contended sandbox, not the renderer. What the renderer controls is measured separately below: JS time per frame is 1 to 3 ms at fit for 1,000 to 1,000,000 balanced or Yule tips (rectangular) and 9 to 22 ms radial; the weak spot is a caterpillar, where the cut must visit every node (151 ms per frame rectangular and 384 ms radial at 1M tips, 30 and 45 ms at 100k).

## Measured numbers (benchmark, production build, `bench/bench.mjs`)

JS time per frame = cut + draw into the Canvas2D context (`TreeRenderer.benchmark`, mean of 20 forced frames; 5 at 1M). Raster and compositing come after and are not included; there is no GPU here, so the browser-side cost is pessimistic and unmeasured by this table. "Layout" is the O(n) typed-array layout; "shared parse" is the shared Newick parser (not our code). Fit view, 1100 x 640 px container, branch lengths on, minimum clade 3 px, budget 20,000. "drawn" = primitives in the draw list (expanded nodes + tips + collapsed-clade triangles).

| Tree | Layout | Shared parse ms | Layout ms | First render ms (mount to painted) | Frame ms at fit | drawn at fit (of which clade triangles) | Frame ms, 3% window | Frame ms, 0.03% window | JS heap MB |
|---|---|---|---|---|---|---|---|---|---|
| yule 1k | rect | 18 | 25 | 98 | 1.5 | 651 (269) | 0.2 | 0.3 | 12 |
| yule 1k | radial | 19 | 5 | 337 | 3.5 | 1,869 (62) | 0.1 | 0.1 | 12 |
| yule 10k | rect | 44 | 10 | 78 | 1.7 | 797 (390) | 0.3 | 0.1 | 14 |
| yule 10k | radial | 44 | 14 | 183 | 8.5 | 2,347 (1,103) | 0.1 | 0.1 | 14 |
| yule 100k | rect | 294 | 141 | 276 | 3.0 | 817 (406) | 0.4 | 0.1 | 39 |
| yule 100k | radial | 160 | 78 | 288 | 22.0 | 2,429 (1,207) | 0.03 | 0.05 | 39 |
| yule 1M | rect | 1,141 | 270 | 411 | 2.9 | 779 (390) | 0.4 | 0.1 | 288 |
| yule 1M | radial | 781 | 234 | 523 | 13.8 | 2,474 (1,236) | 0.1 | 0.2 | 288 |
| balanced 1k / 10k / 100k / 1M | rect | 7 / 41 / 134 / 791 | 4 / 14 / 80 / 192 | 144 / 89 / 207 / 296 | 1.4 / 1.4 / 2.5 / 3.0 | 511 (256) at every size | <= 1.0 | <= 0.25 | 12 / 14 / 39 / 288 |
| balanced 1k / 10k / 100k / 1M | radial | 5 / 62 / 146 / 1,063 | 7 / 13 / 81 / 287 | 165 / 289 / 255 / 504 | 1.8 / 7.9 / 9.2 / 9.4 | 1,999 to 2,047 | <= 0.1 | <= 0.1 | same |
| caterpillar 1k | rect / radial | 7 / 11 | 7 / 3 | 108 / 467 | 1.8 / 3.1 | 1,828 / 1,849 | 0.7 / 1.0 | 0.4 / 0.7 | 12 |
| caterpillar 10k | rect / radial | 38 / 43 | 12 / 19 | 130 / 312 | 6.3 / 13.5 | 4,516 / 4,690 | 5.5 / 9.9 | 1.2 / 3.1 | 15 |
| caterpillar 100k | rect / radial | 126 / 142 | 51 / 36 | 273 / 244 | **30.3 / 44.6** | 4,836 / 5,074 | 21 / 48 | 4.9 / 18.6 | 40 |
| caterpillar 1M | rect / radial | 1,071 / 860 | 204 / 154 | 842 / 1,011 | **151 / 384** | 4,869 / 5,136 | 54 / 256 | 41 / 140 | 291 |

190k tips: the real GTDB 190k tree was run through the runner (S1), not the benchmark script; see the ladder run. Mount times in the ladder (`loadMs`, parse by the shared code plus first paint) are 114 to 444 ms for 1k to 190k tips; click latency is 3 to 10 ms for every tree (median over the clicks at the fit view); JS heap after interaction is 12 MB (1k) to 62 MB (190k).

Reading the table:

* **Bushy trees are bounded by the viewport, not by the tree**: the cut visits 500 to 2,500 nodes at fit whatever the size, so 1M tips cost the same 3 ms as 1,000. What grows with size is the one-off layout (0.27 s at 1M) and the parse done by the shared code (0.8 to 1.1 s at 1M, which would belong in a worker).
* **Radial costs more** (arcs and trigonometry): 9 to 22 ms at fit for 10k to 1M tips, because far more clades are 3 px or larger around a circle than along a row; still well inside a frame.
* **Caterpillar is the weak spot**: the draw list stays under 5.2k primitives at every size (the draw budget never has to act, see below), but the cut has to walk about 2 x tips nodes to find them (visited 1,989,935 at 1M), which costs 151 ms (rect) and 384 ms (radial) per frame at 1M, 30 and 45 ms at 100k. The earlier research prototype drew 398k nodes for a 200k caterpillar; here the rule that skips primitives landing on the same pixel cells fixes the drawing but not the walking. Mitigation, not built: a precomputed spine skip pointer (next node whose clade is at least k tips), or running the cut in a worker.

### Where the draw budget kicks in (`bench/budget.mjs`, 100k tips, fit view, rectangular unless noted)

| Tree | LOD off | budget 500 | budget 2,000 | budget 20,000 (default) |
|---|---|---|---|---|
| yule 100k | 199,999 primitives, 51 ms JS | 391 drawn, collapse threshold raised 3 -> 6 px (1 retry), 0.7 ms | 817 drawn, no retry | 817 drawn, no retry |
| caterpillar 100k | 199,999, 74 ms | 500 drawn and **truncated**, threshold 384 px (7 retries), 17 ms | 1,735 drawn, threshold 384 px, 40 ms | 4,836 drawn, no retry, 15 ms |
| yule 100k, radial | 199,999, 73 ms | 301 drawn, threshold 24 px (3 retries) | 1,275 drawn, threshold 6 px (1 retry) | 2,429 drawn, no retry |

So with the default 20,000 the budget is never reached on any test tree: the minimum clade size (3 px) and the pixel-cell de-duplication keep the list at 0.5k to 5k. The budget is a safety net for larger windows or smaller budgets; below about 800 (yule) or 4,800 (caterpillar) primitives it starts raising the collapse threshold, and below the primitives a pixel-deduplicated caterpillar needs it truncates.

## Scenario results (CONTRACT.md S1 to S15, runner `node runner/run.mjs --candidate custom`)

Summary over the smoke runs (final run `20261014-152801`; where a status moved between runs it is said):

| # | Status | Evidence |
|---|---|---|
| S1 | timeout (frame-rate rule, environmental) | load 114 to 444 ms, click latency 3 to 10 ms, median 30 to 60 fps (30 only for otl-1k, 60 elsewhere) on the 10 ladder trees; p5 2.5 to 15 fps is the contended sandbox (the stub at 200 tips gets the same 7.5) |
| S2 click a tip | pass | tipClick with `tipIds=[tip]`, React state and metadata row, unmatched tip reported UNMATCHED |
| S3 click internal node | partial (rule) | correct tip sets for 4 clades; `source=adapter-derived` is by design |
| S4 colour clades | pass | red pixel fraction rises in the clade only, two clades, clear restores, no layout change |
| S5 highlight and focus | pass | row band + ring, tip centred with 26 px rows, parent clade bounds in view |
| S6 tip as link | pass | `a[href][data-tip-id][target=_blank]`, focusable, real click opens a tab, `setTipLinks(null)` removes them |
| S7 bar column | pass | cells aligned within 2 px at fit and after wheel zoom + drag, bar width follows value, unmatched tip has no cell |
| S8 alignment column | pass | rows line up, several residue colours painted |
| S9 theming | pass | dark theme, runner tokens (background, branch, font) applied |
| S10 zoom out whole tree | pass / partial (frame-rate rule only) | whole tree in view after wheel zoom-out on 1k and 100k Yule and on the 20k caterpillar; p5 ranged 6.7 to 59.9 fps between runs of the same build depending on machine load |
| S11 phylogram/cladogram | pass | tip x follows root-to-tip length (Pearson >= 0.97), ultrametric tips aligned, negative/missing lengths render; scale bar / time axis seen in screenshots |
| S12 radial | pass | S2, S3, S4 repeated in radial |
| S13 two instances, 5 mounts | pass | no cross-talk, DOM and canvas counts return to baseline |
| S14 keyboard | pass | Tab reaches labels after `focusTip`, accessible names, Enter fires `tipClick` |
| S15 linked view | pass or partial by load | 969-tip clade: click to React commit 6 to 24 ms, to paint 33 to 160 ms over five runs (median of 5 clicks each; the runner passes up to 120 ms; the slow run was at load average 14) |

## Evaluation table (template of docs/evaluation-framework.md)

Capability letters: Y yes, P partial, N no. Evidence: M measured by us in a browser (this spike), S read in source (our own source).

| Dim | Item | Cap+ev | Notes and evidence |
|---|---|---|---|
| A | last release / activity | Y-S | new code, 2026-10-14; no history, no bus factor beyond whoever maintains it |
| A | adoption, ecosystem | N-S | none (internal); that is the cost of this option |
| B | React component with controlled props | Y-M | `<TreeView>`: clades, highlighted, columns, layout, branchLengths, theme, optional viewport, focus request; S4, S5, S9, S12 |
| B | several instances, clean unmount | Y-M | S13, `destroy()` cancels rAF, observers and listeners, releases canvases |
| B | SSR safety | P-S | the component touches `document` only in effects; not tested under SSR |
| B | bundle size | Y-M | app bundle 267 kB minified, 88 kB gzipped including React, the shell and the GBIF CSS; the renderer itself is about 55 kB minified (estimate from module sizes; not measured separately) |
| C | tip and node click, descendant tips | Y-M | S2, S3 (range of the preorder model, `source=adapter-derived`) |
| C | branch click, hover | Y-M | branchClick and hover events through the grid index; informal check in S3 |
| C | tip label as real link | Y-M | S6, anchors for visible rows only (rows >= label threshold) |
| C | programmatic highlight, focus, zoom-to-node | Y-M | S5; `zoomToNode`, `fit`, `setViewport`, animated variants from the handle |
| C | keyboard | Y-M | arrows (tips), Left/Right (parent/child), PageUp/Down, Home/End, Enter/Space, + - 0; S14 |
| C | shareable state (URL round-trip) | P-S | the viewport is a plain serialisable window (`x0,x1,y0,y1`); the round trip itself is not built |
| D | hide/replace features, slots | Y-S | everything is an option (`lod`, `overview`, `axis`, `showSummaries`, label density, tooltip render prop); no internal UI to fight |
| D | per-clade colour from state | Y-M | S4, multiple clades, nested (later wins) |
| D | tokens, dark mode, fonts | Y-M | S9; theme object from `gbifTheme()`, canvas redrawn on theme/font change |
| D | aligned columns (bar, text, alignment), headers | Y-M | S7, S8; React-rendered per-row cells are not built (only the link/label overlay is DOM) |
| E | rectangular, radial | Y-M | S12 |
| E | phylogram, cladogram, scale bar, time axis | Y-M | S11, screenshots |
| E | unrooted layout | N-S | not built (equal-angle would be a new layout pass; the arrays and LOD do not need to change) |
| E | collapse by user, search | N-S | automatic collapse only (clade summaries); no user collapse/expand, no search |
| E | overview strip, semantic zoom | Y-M | overview with viewport box; collapsed clades as triangles (screenshots); no clade labels on the triangles |
| E | export (SVG/PNG/Newick) | N-S | not built |
| F | 1k to 1M tips fit view | Y-M | table above: 1.4 to 3 ms per frame JS at 1M balanced/Yule, rect |
| F | caterpillar 100k / 1M | P-M | 30 / 151 ms per frame rect, 45 / 384 ms radial: usable at 100k, not smooth at 1M |
| F | pan/zoom fps in a real browser | ?-U | not measured (no GPU here; the runner p5 numbers are dominated by sandbox contention) |
| F | custom columns at scale | P-M | bars/text/alignment per visible row or per pixel row; checked at 1k and 197 tips (S7, S8), not timed at 100k |
| G | Newick, Nexus | Y-S | the shared parser (not part of this spike); the renderer takes a `TreeData` |
| G | tree operations (reroot, ladderize, prune) | N-S | none; the preorder arrays make subtree extraction and ladderise O(n) but they are not written |
| H | keyboard, ARIA, text fallback | Y-M | S14; `role=tree`, treeitems/anchors for visible rows, hidden list of tips in view, live region |
| H | screen reader testing, reduced motion, touch | ?-U | not tested with a screen reader; pinch implemented but untested on a device; animation is 220 ms and does not honour `prefers-reduced-motion` yet |
| I | licence | Y-S | Apache-2.0, nothing third-party in the renderer; shared harness code is ours |
| J | cost to adapt | see below | |

## Styling (S9, criterion 16)

Applied from the GBIF tokens (details in `spikes/custom/spike.json`): background, labels, branches, summaries, selection and highlight colours through `gbifTheme()` (canvas cannot read CSS variables, so the theme is resolved to an object), Rubik for canvas and overlay text, scientific names italic, highlight/selection/focus/hover rings and the overview box in `--color-primary`, bar columns in the periwinkle categorical colour, dark theme from `gbifDarkTheme()`, tooltip chrome from the theme, canvas redrawn when web fonts finish loading. Not possible or not done: residue colours of the alignment (no token), branch width and marker sizes (constants), CSS-only text effects on canvas text. This is nearly all of it, which says little about libraries because we own the pixels.

## Cost: what was built versus the 9 engineer-week MVP estimate

Effort: about two hours of agent time end to end (design, write, debug against the runner, benchmark, document), including about one hour of waiting for runs on a contended machine. **This is not comparable to an engineer's weeks**: no browser matrix, no review, no design iteration, no real-user testing, one agent that had the research document's design in front of it. It does show that the MVP core is a few days of work for an experienced engineer, not nine weeks, and that the hard parts were exactly the ones the research named.

Size (TypeScript, `wc -l` of the files committed at 4337e97, 2026-10-21, including comments; the first version of this table, from 2026-10-14, had 3,170 lines in total):

| Module | Lines | Contents |
|---|---|---|
| `src/core/layout.ts` | 159 | O(n) layout into typed arrays (x, row, subtree max x, last child), cos/sin cache, layout from rollups for a partial tree |
| `src/core/lod.ts` | 655 | viewport cut (one loop per layout), budget search, draw list, pixel-cell de-duplication, runs of small siblings |
| `src/core/projection.ts` | 316 | layout projections: node positions, clade extents, summary geometry for draw and hit |
| `src/core/hit.ts` | 314 | uniform-grid spatial index over the draw list, hit scoring |
| `src/core/draw.ts` | 561 | branches, triangles, fans, markers, labels, highlights, axis, scale bar |
| `src/core/columns.ts` | 328 | bar/text/alignment columns, bitmap blit, incremental recompile |
| `src/core/geom.ts` | 95 | transform, sector bounding boxes |
| `src/core/renderer.ts` | 1,077 | the facade: DOM, rAF loop, render(), source sync, hover, notice, interaction LOD, public API |
| `src/core/view-state.ts`, `input.ts`, `keyboard.ts`, `overlay.ts`, `overview.ts`, `detail-loader.ts`, `node-event.ts`, `live.ts`, `dom.ts` | 1,328 | what was split out of the renderer in phase 3: viewport arithmetic and animation, wheel/pointer/touch/keyboard input, label overlay and a11y, overview, opening stubs |
| `src/core/types.ts`, `source.ts`, `constants.ts`, `index.ts` | 423 | public types and options, `TreeSource`, tuning constants |
| `src/react/TreeView.tsx`, `props.ts` | 409 | the component and its prop-identity helpers |
| `src/parquet/*` | 514 | `ParquetSource` proof of concept and its dev page |
| `src/adapter.tsx`, `demo.tsx`, `main.tsx` | 574 | harness adapter, dev demo, entry |
| `bench/*.mjs` | 639 | benchmark scripts |
| `scripts/*.mjs` | 1,668 | regression and check scripts, the browser test runner |
| `test/*` | 3,578 | unit tests, golden test and its data (`cut-golden.json` is 170 lines, one case per line) |
| **Total `src/`** | 6,753 | core 5,256, React layer 409, Parquet 514, harness 574 |

What was hard: (1) the caterpillar (the walk, not the drawing; the de-duplication by pixel cell fixed the draw list, the visit count needs a precomputed skip structure); (2) keeping hit-testing consistent with what LOD drew (a tip inside a collapsed clade must not be a click target; tip targets only exist when rows are at least 6 px; a node must win against a tip 8 px away; the first version hit the wrong tip because focusing the root with the mouse scrolled the view); (3) labels and links on a canvas (a DOM overlay for visible rows that tracks the canvas text, focus not lost when a row scrolls out, drags must not open links); (4) a headless-GPU artefact: an accelerated canvas runs through SwiftShader and was 3 to 10 times slower than a CPU-backed one, so the harness build uses `willReadFrequently` (option `softwareCanvas`, toggle "CPU-backed canvas" in the demo; since 2026-10 it defaults to on only under automation, see the section at the end).

What is missing for production: worker for parse and cut (1M tips: 0.8 to 1.1 s parse on the main thread), spine skip pointers for caterpillars at 1M, user collapse/expand and search, clade labels on collapsed triangles (research section 6.4), React-rendered cells in columns (research 5.2), column summaries for collapsed clades (research 6.5; bars use the pixel-bin mean, not a per-clade aggregate), multi-resolution rows (variable row heights), unrooted layout, export (PNG/SVG/Newick), URL round trip, `prefers-reduced-motion`, touch and screen-reader testing on real devices, browser matrix (only headless Chromium 141 tested), numbers on a real GPU, more tests (`npm test` covers the pure core modules, the cut goldens, fake-canvas and fake-document tests of columns and the label overlay, and the React prop helpers; `npm run test:browser` runs the built demo in Chromium, see "Hardening (2026-10-21)" at the end; nothing exercises real raster output, a real GPU, other browsers, touch devices or `ParquetSource` against data in CI, and coverage was not measured), hit-test slop for coarse pointers, radial columns, node/branch labels (support values), tooltip customisation beyond a render prop, SSR check, a package boundary and docs. Rough estimate for these: 12 to 18 engineer-weeks on top of this baseline, close to the research's "full" scope minus WebGL, which looks unnecessary (Canvas2D at 1M tips costs 3 ms of JS per frame for bushy trees).

## Findings that matter for the decision

1. **Canvas2D with a viewport cut is enough for bushy trees up to 1M tips**: 1.5 to 3 ms of JS per frame in the rectangular layout (including the 100k whole-tree zoom-out), 9 to 22 ms radial. WebGL is not needed for the drawing; the cost is in what you choose to draw (the cut), not in the API. Real-GPU frame rates are unmeasured.
2. **The ladderised tree is the only shape that hurts**, and it hurts in the traversal (151 ms per frame at 1M, 30 ms at 100k), not in the drawing. If published GBIF trees are often ladderised, budget for a precomputed skip structure or a worker; real trees in the ladder (OTL 91k, GTDB 190k) were fine because they are not caterpillars.
3. **The API shape that worked**: the tree as typed arrays with preorder ids (descendant tips are a range, so every click event can carry the tip set at no cost), state as props (clades, highlight, columns, layout, lengths, theme, viewport), events as callbacks with an O(1) `tipRange`, a handle for imperative focus/zoom, and everything canvas-drawn except the label/link overlay for visible rows. That is the shape the libraries are judged against.

## Component API proposal (as implemented, `spikes/custom/src/react/TreeView.tsx`)

```tsx
<TreeView
  tree={treeModel}                    // TreeData: preorder typed arrays (shared/tree.ts TreeModel satisfies it)
  layout="rectangular" | "radial"
  branchLengths={true}                // phylogram / cladogram
  clades={[{ nodeId: 'n123', colour: '#...' }]}      // colour branches, triangles, markers, tip labels
  highlighted={['Genus_species', ...]}               // tip ids: row band, ring, bold label, overview ticks
  columns={[{ id, kind: 'bar'|'text'|'alignment', header, width, values: {tipId: number|string} }]}
  viewport={{ x0, x1, y0, y1 }}       // optional, controlled; omit for uncontrolled
  focus={{ tipId, seq }}              // declarative "centre this tip", acts when seq changes
  tipHref={(tipId) => url}            // makes visible labels real <a href data-tip-id target=_blank>
  theme={{ background, foreground, muted, branch, highlight, summary, fontFamily, categorical }}
  options={{ lod, drawBudget, showSummaries, overview, labelDensity, rowHeight, axis, italicLabels,  // later: italicLabels became the theme token labelFontStyle (#32)
             minCladePx, formatLabel, ariaLabel, softwareCanvas,
             dprCap, radialMaxNodes, interactionLOD, refineMs, summaryNotice }}   // the last five added 2026-10
  tooltip={true | (e) => ReactNode}
  onTipClick={(e) => ...}             // e: { nodeId, node, isTip, kind, tipId, tipCount, tipRange, tipIds(), via, clientX, clientY }
  onNodeClick={(e) => ...}            // internal node marker, collapsed clade or branch (kind tells which)
  onHover={(e | null) => ...}
  onViewportChange={(v) => ...}       // on every change of the window (synchronous, equality-guarded); onFrame is the per-frame one
  onFrame={(stats) => ...}            // frameMs, drawn, summaries, minPxUsed, budgetRetries, ...
  onReady={({ layoutMs, tips }) => ...}
  ref={handle}                        // fit(), focusTip(id), zoomToNode(id), get/setViewport, locateTip/Node, nodeBounds, columnCell, getStats, benchmark
/>
```

Notes for gbif.org: node ids are `n<preorder index>` (stable for one parsed tree, so a page that keeps the model can keep ids; persisting them across tree versions needs the tip set or the MRCA of two tips, `TreeModel.mrcaOf`); tip ids are the tip labels, the join key to occurrences and taxa. Unmatched tips need no special support in the component: `columns` simply have no cell for them, and `formatLabel`/`clades` can mark them (the S7 check confirms no cell is drawn). Nothing is global, the core (`src/core`) has no React import and its only dependency is the structural `TreeData` interface, so it can become a package.

## Caveats

No GPU: the runner uses `--disable-gpu-rasterization`, so Canvas2D is CPU-rasterised (the adapter also turns on `willReadFrequently`, see above); absolute frame rates are pessimistic and the machine was loaded by five other agents' Chromiums (load average 10 to 17 on 4 cores). Numbers marked M were measured in this one environment on 2026-10-14; none were taken on a real laptop with a GPU. The JS-time-per-frame numbers do not include raster and compositing.

## Target hardware (open)

Developer laptops are well above the typical gbif.org visitor's device, especially outside the global north. Budget for a device several times slower: test with Chrome DevTools CPU throttling (4x and 6x) and a mid-range phone, and report numbers from the demo's frame-time readout (JS ms, paint ms, fps; feature `frameReadout`). Still **unmeasured**: no real low-end device has been tried. The draw budget (500 to 400,000 primitives) and the radial max are the knobs to tune for it; a default chosen from measured low-end numbers would be better than the current 20,000.

## Radial performance work, 2026-10

Trigger: on a real laptop (real browser, GPU) the deployed demo "starts to struggle far earlier on radial trees" than on rectangular ones, well under 10k tips. Rectangular trees and the clade-summary triangles were fine. Everything below was measured in headless Chromium 141 on a 4-vCPU sandbox **without a GPU**, so no number here is a real-GPU frame rate (see "What could not be measured"). The machine was not idle: a second agent ran jobs on it, load average 3 to 6 during most benchmarks (every row in the raw JSON carries `load1`); the headline figures are therefore the hardware-independent ones (primitives, path segments, draw calls) plus relative CPU-raster times. The older tables above stay as they were measured on 2026-10-14; note that their "JS time per frame" never included raster, even for the CPU-backed canvas (see point 2).

### What was wrong

1. **`cpuCanvas` defaulted to on.** It was added so headless Chromium without a GPU does not run the canvas through SwiftShader (3 to 10 times slower). On a real browser it forced every canvas into CPU raster (`willReadFrequently`), where cost grows with the number of canvas pixels (DPR 2 is 4 times the pixels of DPR 1) and with path complexity.
2. **The old JS-only numbers hid the real cost.** The report said "for a CPU-backed canvas JS time includes raster". It does not: Chromium records the canvas calls and rasterises after the script returns. Radial yule 10k at fit: 7 ms of JS per frame but 210 ms for JS plus raster (CPU canvas, DPR 1), measured by forcing a flush (`getImageData`) after each frame; the rectangular layout costs 20 ms by the same measure.
3. **Skia's stroker is the slow path for radial.** A micro-benchmark (6,000 short segments, CPU canvas, DPR 1) took 35 ms in one path at 1.3 px line width and 2.7 ms at 1 device pixel or less (hairline fast path); paths of 32 to 256 segments gave 15 to 18 ms at 1.3 px; filling 1,100 small triangles in one path took 12 ms, in chunks of 16 to 64 about 4.5 ms. Rectangular branches are axis-aligned and do not hit this.
4. **Radial culling was a bounding-box test per node with four sin/cos each**, and the budget search doubled the threshold, so a 2,000 budget gave 1,215 primitives instead of about 2,000.

### What changed

| # | Change | Where | Kept? |
|---|---|---|---|
| 1 | GPU canvas by default for real visitors; CPU canvas when `navigator.webdriver` is true (the runner) or `?cpu=1`; `?cpu=0` forces GPU. Toggle kept in Library options with an honest description | `adapter.tsx` | yes |
| 2 | `dprCap` option (1, 1.5, 2, native; default 2): backing store is min(devicePixelRatio, cap) times the CSS size; hit-testing, overlay and events stay in CSS px | `renderer.ts`, adapter | yes (effect depends on the device; only the DPR 1 versus 2 rows measure it) |
| 3 | `radialMaxNodes` cut-off (500 to 20,000, unlimited; default 2,000, radial only): clades below the pixel threshold become fans; the threshold is found by a bracket-and-bisect search (about 5 passes only under pressure, 1 otherwise) that never exceeds the budget and lands within 25% below it [as first built; commit `3925182` replaced it with a sticky threshold ladder, base x 1.15^n, that rises only on overflow and falls only when the next rung down also fits with room to spare, because the bisecting search made the threshold jump between frames at nearly the same zoom (the `searchCut` comment was corrected in `b374b87`)]; corner notice "N clades summarised, raise the limit in Library options" (counts only clades the normal 3 px threshold would have expanded) | `lod.ts` (`searchCut`), `renderer.ts` | yes |
| 4 | True culling: radius range and angle range of the window seen from the root, then the sector's bounding box from cached boundary cos/sin. Per-node cos/sin cached in the layout (`COS`, `SIN` per node, `BC`, `BS` per tip boundary; 16 B each, built on first radial use). The cut and draw functions read only the typed-array fields they already used plus these derived arrays | `lod.ts`, `layout.ts` | yes |
| 5 | Radial drawing: an arc only when it differs from its chord by more than 0.3 px (s^2 > 2.4 r), otherwise a line; far-off long arcs clipped to the visible angles (before, arcs at radius over 30,000 px were drawn as chords); strokes in chunks of 256 segments, fans filled in chunks of 32, per colour class; **hairline (1 device px) branches once the list has 700 or more primitives**; labels: only when the pitch is at least the font size, at most 300, one `setTransform` per label (no save/restore/translate/rotate), font and fill set only on change | `draw.ts` | yes |
| 6 | Interaction-time degradation: during wheel, pinch, drag, overview drag and animation, a quarter of the budget (min 500), threshold x1.6 when the last full frame had more than 1,000 primitives, no DOM overlay or notice update; one full frame 120 ms after the last input (timer reset by every input). Click, hover, locate, bounds and the a11y list call `settle()` first, so hit-testing only ever sees a full-quality frame. Option `interactionLOD`, default on | `renderer.ts` | yes; the ablation below shows most of the gain comes from 5, this adds most at DPR 2 |
| 7 | Reusing the previous bitmap during a gesture | | not built: reduced frames already cost about 1.5 ms of JS |
| 8 | Found while profiling: the cut functions return one shared scratch object that the overview cut overwrote, so `FrameStats` (summaries, tips) described the overview; fixed by copying. Summary hit-test scores the distance outside the fan, so the fan under the pointer beats a neighbour whose 3 px slack reaches the same point (before, 16 of 200 summaries hit themselves, now 200 of 200) | `renderer.ts`, `hit.ts` | yes |

Layers: checked, no change needed. Hover, keyboard cursor and focus draw only on the `top` canvas; the overview is redrawn only when the data changes; 40 pointer moves over the tree caused 0 tree redraws (`scripts/check-radial-ui.mjs`). The tree canvas is redrawn on view change, data change (clades, highlight, columns, theme, options) and resize.

### Method

`bench/radial-perf.mjs` mounts each tree through `window.__spike.mount` (1100 x 640 container), then for the fit view and a 4x zoom (radial: a window a quarter the size centred at 75% of the radius; rectangular: x 0.7 to 0.95, a quarter of the rows) measures: 15 forced frames (JS ms: cut, draw, overlay); 8 frames each followed by a canvas flush (JS + raster; reliable for a CPU-backed canvas, shown for the accelerated canvas only as a relative number); canvas calls per frame by wrapping `CanvasRenderingContext2D` (hardware-independent); and the mean `requestAnimationFrame` interval when every frame is repainted (end to end, vsync limit lifted; meaningless for the accelerated canvas, whose rAF does not wait for the GPU process, so not reported for it). Trees: `data/synthetic` yule, balanced, caterpillar at 1k, 2k, 5k, 10k, 50k, 100k (2k, 5k, 50k generated with `generate.py --sizes`). DPR 1 and 2 by the Playwright device scale factor; CPU canvas by forcing `willReadFrequently` on every 2D context with an init script (identical for both builds), accelerated canvas by forcing it off. "Before" is the build of the committed state before this work (scratch directory), "after" the current build. Raw rows: `spikes/results/custom/bench/radial-perf-<build>-dsf<1|2>-cpu<1|0>.json`.

### Results: radial, before / after

Fit view (each cell before / after). "Accelerated canvas" is GPU raster through SwiftShader here: only the ratio is informative, and not as a prediction for a real GPU.

| tree (radial) | primitives drawn | path segments | draw calls (stroke, fill, text) | JS ms (cut + draw) | JS + raster ms, CPU canvas, DPR 1 | same, DPR 2 | end-to-end frame ms, CPU canvas, DPR 1 | same, DPR 2 | JS + raster ms, accelerated canvas (SwiftShader), DPR 1 |
|---|---|---|---|---|---|---|---|---|---|
| yule 1k | 1869 / 1869 | 6085 / 6085 | 6 / 17 | 4.6 / 2.0 | 93 / 6.0 | 107 / 9.0 | 38 / 6.3 | 50 / 20 | 848 / 584 |
| yule 2k | 2009 / 1591 | 8289 / 6843 | 6 / 33 | 4.6 / 3.2 | 108 / 20 | 190 / 27 | 38 / 12 | 67 / 30 | 791 / 682 |
| yule 5k | 2237 / 1797 | 9918 / 8109 | 6 / 41 | 5.4 / 2.8 | 127 / 27 | 210 / 48 | 48 / 15 | 89 / 33 | 734 / 684 |
| yule 10k | 2347 / 1989 | 10645 / 9094 | 6 / 46 | 6.9 / 2.7 | 210 / 39 | 305 / 68 | 70 / 17 | 110 / 37 | 766 / 695 |
| yule 50k | 2457 / 1951 | 11324 / 9065 | 6 / 47 | 7.3 / 3.4 | 303 / 57 | 492 / 78 | 99 / 22 | 172 / 47 | 936 / 695 |
| balanced 10k | 2047 / 1567 | 9472 / 7312 | 6 / 39 | 7.2 / 2.1 | 197 / 39 | 259 / 55 | 64 / 15 | 91 / 37 | 698 / 604 |
| balanced 100k | 2047 / 1023 | 9472 / 4864 | 6 / 26 | 6.9 / 2.4 | 285 / 29 | 373 / 58 | 98 / 16 | 132 / 29 | 614 / 447 |
| caterpillar 10k | 4690 / 1951 | 13972 / 5503 | 6 / 15 | 7.0 / 7.2 | 111 / 15 | 156 / 32 | 52 / 12 | 65 / 25 | 2685 / 1522 |
| caterpillar 100k | 5074 / 1969 | 14818 / 3139 | 6 / 11 | 38 / 21 | 165 / 26 | 192 / 34 | 74 / 33 | 99 / 36 | 2314 / 1389 |

4x zoom:

| tree (radial) | primitives drawn | path segments | draw calls (stroke, fill, text) | JS ms (cut + draw) | JS + raster ms, CPU canvas, DPR 1 | same, DPR 2 | end-to-end frame ms, CPU canvas, DPR 1 | same, DPR 2 | JS + raster ms, accelerated canvas (SwiftShader), DPR 1 |
|---|---|---|---|---|---|---|---|---|---|
| yule 1k | 242 / 238 | 1118 / 1098 | 5 / 6 | 0.6 / 0.9 | 12 / 11 | 27 / 18 | 14 / 7.3 | 25 / 21 | 783 / 688 |
| yule 2k | 493 / 480 | 1754 / 1689 | 6 / 8 | 0.4 / 0.4 | 21 / 16 | 35 / 39 | 11 / 15 | 29 / 29 | 799 / 815 |
| yule 5k | 743 / 737 | 3037 / 3008 | 6 / 15 | 0.7 / 0.8 | 32 / 7.4 | 72 / 12 | 17 / 7.0 | 34 / 21 | 984 / 829 |
| yule 10k | 1023 / 1007 | 4484 / 4405 | 6 / 22 | 1.3 / 1.2 | 71 / 11 | 103 / 21 | 27 / 10 | 45 / 26 | 1063 / 975 |
| yule 50k | 1409 / 1386 | 6439 / 6324 | 6 / 32 | 2.1 / 1.7 | 92 / 41 | 174 / 56 | 40 / 17 | 62 / 31 | 1268 / 1216 |
| balanced 10k | 1048 / 1040 | 4864 / 4824 | 6 / 26 | 1.9 / 1.0 | 102 / 22 | 147 / 37 | 35 / 13 | 62 / 28 | 968 / 890 |
| balanced 100k | 1359 / 1341 | 6290 / 6200 | 6 / 32 | 2.2 / 1.8 | 108 / 46 | 197 / 78 | 39 / 19 | 76 / 39 | 1222 / 1014 |
| caterpillar 10k | 7537 / 1992 | 31330 / 6857 | 6 / 17 | 9.8 / 2.7 | 71 / 28 | 129 / 52 | 37 / 20 | 65 / 33 | 2244 / 991 |
| caterpillar 100k | 9305 / 1930 | 37443 / 5560 | 6 / 15 | 30 / 14 | 139 / 54 | 178 / 65 | 70 / 34 | 83 / 43 | 2536 / 736 |

Rectangular, same measures (CPU canvas, DPR 1, fit): primitives identical at every size (651, 797, 817 for yule 1k, 10k, 100k; 511 balanced; 1,828 to 4,836 caterpillar); JS plus raster 8 to 37 ms before and after, differences within the noise of a loaded machine (the rectangular drawing path was not touched except labels).

Interaction (24 wheel steps in, 24 out, 16 ms apart, then a 40-move drag; real Playwright input; `bench/interaction.mjs`; mean rAF interval in `meanRafMs`, CPU canvas; `before` is the old build, the others the new one, with the `--set` ablation in the tag):

```
yule_10000 before dsf1 cpu1 radial {"name":"wheel zoom in x24 then out x24","load":"3.4","frames":49,"meanJs":3.15,"maxJs":23,"meanDrawn":876,"reducedFrames":0,"meanRafMs":31.6,"maxRafMs":117,"gestureMs":2867,"afterSettle":{"drawn":2347,"js":7.199999999254942}}
yule_10000 before dsf1 cpu1 radial {"name":"drag 40 moves","load":"3.2","frames":39,"meanJs":6.76,"maxJs":8,"meanDrawn":2347,"reducedFrames":0,"meanRafMs":54.7,"maxRafMs":67,"gestureMs":3630,"afterSettle":{"drawn":2347,"js":6.3999999994412065}}
yule_10000 after dsf1 cpu1 radial {"name":"wheel zoom in x24 then out x24","load":"3.4","frames":48,"meanJs":1.49,"maxJs":11.7,"meanDrawn":213,"reducedFrames":48,"meanRafMs":17.7,"maxRafMs":33,"gestureMs":2435,"afterSettle":{"reduced":false,"drawn":1989,"js":2.699999999254942}}
yule_10000 after dsf1 cpu1 radial {"name":"drag 40 moves","load":"3.4","frames":39,"meanJs":1.46,"maxJs":3.6,"meanDrawn":497,"reducedFrames":39,"meanRafMs":16.7,"maxRafMs":17,"gestureMs":1745,"afterSettle":{"reduced":false,"drawn":1989,"js":2.7000000001862645}}
yule_50000 before dsf1 cpu1 radial {"name":"wheel zoom in x24 then out x24","load":"3.0","frames":48,"meanJs":4.68,"maxJs":25.7,"meanDrawn":1100,"reducedFrames":0,"meanRafMs":44.1,"maxRafMs":167,"gestureMs":3486,"afterSettle":{"drawn":2457,"js":9.200000000186265}}
yule_50000 before dsf1 cpu1 radial {"name":"drag 40 moves","load":"3.4","frames":39,"meanJs":8.87,"maxJs":12.9,"meanDrawn":2457,"reducedFrames":0,"meanRafMs":97.4,"maxRafMs":117,"gestureMs":5370,"afterSettle":{"drawn":2457,"js":7.699999999254942}}
yule_50000 after dsf1 cpu1 radial {"name":"wheel zoom in x24 then out x24","load":"4.1","frames":48,"meanJs":1.7,"maxJs":11.7,"meanDrawn":232,"reducedFrames":48,"meanRafMs":18.1,"maxRafMs":50,"gestureMs":2413,"afterSettle":{"reduced":false,"drawn":1951,"js":5.2000000001862645}}
yule_50000 after dsf1 cpu1 radial {"name":"drag 40 moves","load":"4.1","frames":39,"meanJs":1.48,"maxJs":2.6,"meanDrawn":483,"reducedFrames":39,"meanRafMs":17.1,"maxRafMs":33,"gestureMs":1694,"afterSettle":{"reduced":false,"drawn":1951,"js":4.2000000001862645}}
after {"interactionLOD":false} dsf1 cpu1 radial {"name":"drag 40 moves","load":"3.2","frames":39,"meanJs":3.65,"maxJs":7.5,"meanDrawn":1951,"reducedFrames":0,"meanRafMs":16.7,"maxRafMs":17,"gestureMs":2031,"afterSettle":{"reduced":false,"drawn":1951,"js":4.099999999627471}}
after {"interactionLOD":false,"radialMaxNodes":"Infinity"} dsf1 cpu1 radial {"name":"drag 40 moves","load":"3.1","frames":39,"meanJs":2.97,"maxJs":3.9,"meanDrawn":2457,"reducedFrames":0,"meanRafMs":18,"maxRafMs":34,"gestureMs":2206,"afterSettle":{"reduced":false,"drawn":2457,"js":3.400000000372529}}
yule_50000 after {"interactionLOD":false} dsf2 cpu1 radial {"name":"wheel zoom in x24 then out x24","load":"3.4","frames":47,"meanJs":4.12,"maxJs":14.8,"meanDrawn":1389,"reducedFrames":0,"meanRafMs":26.2,"maxRafMs":50,"gestureMs":2441,"afterSettle":{"reduced":false,"drawn":1951,"js":3.2999999998137355}}
yule_50000 after {"interactionLOD":false} dsf2 cpu1 radial {"name":"drag 40 moves","load":"3.2","frames":39,"meanJs":3.72,"maxJs":9.7,"meanDrawn":1951,"reducedFrames":0,"meanRafMs":35.5,"maxRafMs":50,"gestureMs":2804,"afterSettle":{"reduced":false,"drawn":1951,"js":3.099999999627471}}
yule_50000 after {"interactionLOD":true} dsf2 cpu1 radial {"name":"wheel zoom in x24 then out x24","load":"3.1","frames":48,"meanJs":1.78,"maxJs":11,"meanDrawn":430,"reducedFrames":48,"meanRafMs":18.7,"maxRafMs":50,"gestureMs":2009,"afterSettle":{"reduced":false,"drawn":1951,"js":3.3999999994412065}}
yule_50000 after {"interactionLOD":true} dsf2 cpu1 radial {"name":"drag 40 moves","load":"3.1","frames":39,"meanJs":1.36,"maxJs":1.8,"meanDrawn":483,"reducedFrames":39,"meanRafMs":17.9,"maxRafMs":33,"gestureMs":2270,"afterSettle":{"reduced":false,"drawn":1951,"js":3.2000000001862645}}
caterpillar_50000 after {"interactionLOD":false} dsf2 cpu1 radial {"name":"wheel zoom in x24 then out x24","load":"3.0","frames":48,"meanJs":13.24,"maxJs":28,"meanDrawn":1870,"reducedFrames":0,"meanRafMs":42.7,"maxRafMs":67,"gestureMs":3189,"afterSettle":{"reduced":false,"drawn":1953,"js":25.700000000186265}}
caterpillar_50000 after {"interactionLOD":false} dsf2 cpu1 radial {"name":"drag 40 moves","load":"3.3","frames":39,"meanJs":23.32,"maxJs":46.8,"meanDrawn":1954,"reducedFrames":0,"meanRafMs":38,"maxRafMs":83,"gestureMs":3062,"afterSettle":{"reduced":false,"drawn":1953,"js":20.300000000745058}}
caterpillar_50000 after {"interactionLOD":true} dsf2 cpu1 radial {"name":"wheel zoom in x24 then out x24","load":"3.2","frames":48,"meanJs":15.15,"maxJs":50.2,"meanDrawn":353,"reducedFrames":48,"meanRafMs":29.2,"maxRafMs":83,"gestureMs":2502,"afterSettle":{"reduced":false,"drawn":1953,"js":29.90000000037253}}
caterpillar_50000 after {"interactionLOD":true} dsf2 cpu1 radial {"name":"drag 40 moves","load":"3.4","frames":39,"meanJs":22.08,"maxJs":29.7,"meanDrawn":427,"reducedFrames":39,"meanRafMs":35.9,"maxRafMs":50,"gestureMs":2956,"afterSettle":{"reduced":false,"drawn":1953,"js":18.600000000558794}}
```

Reading: at DPR 1, yule 50k radial, a drag went from a 97 ms frame interval (10 fps) to 17 ms (60 fps); with `interactionLOD` off and everything else new it is already 17 ms, so at DPR 1 the cheaper drawing does the work. At DPR 2 the reduced frames matter (35 ms to 18 ms for the same drag). For the 50k caterpillar the cut itself (about 20 ms of JS per frame, a walk over 100k nodes) dominates and nothing helps: see the limits.

Headlines (radial, yule 10k, CPU canvas, fit): primitives 2,347 to 1,989; path segments 10,645 to 9,094; JS 6.9 to 2.7 ms; JS plus raster 210 to 39 ms at DPR 1 and 305 to 68 ms at DPR 2; end-to-end frame 70 to 17 ms. The cut-off itself removes primitives only where the viewport holds more than the budget: yule 1k to 100k sat at 1,900 to 2,500 primitives before, so the gain there is 15 to 20%; balanced 100k halves (2,047 to 1,023) and caterpillars drop 2.5 times (5,074 to 1,969). Most of the raster gain is the line style (hairline) and the path chunking, which cut the work per primitive, not the number of primitives. The cut-off matters more when users raise the limit and for trees with long ladders.

### Regression and tests

* `cd spikes && node runner/run.mjs --candidate custom --trees smoke --port 5206`: run `20261020-101522`, S1 to S15 as before (S3 partial by rule, the rest pass).
* Ladder up to 190k as the custom run in `spikes/results/FINAL.json` (`--trees smoke,ladder,worst,cols,align,dated --skip-large`): run `20261020-101752`. All of S1 to S15 pass or partial exactly as in the previous custom run (`20261019-122251`): S1 pass on 20 trees up to the 190k GTDB tree, S2, S4 to S15 pass, S3 partial by rule. `FINAL.json` lists the new ids under `custom.runIds` and the old ones under `custom.previousRunIds`.
* `node --experimental-transform-types spikes/custom/scripts/check-radial-cut.mjs` (plain Node, no browser, about 2 s): on the committed 10k yule tree at fit, two 4x views and a 16x view: drawn <= budget (1,989 of 2,000 at fit); tips drawn + tips in summaries + merged tips = 10,000 at fit (51 + 9,949 + 0); summary tip counts equal a brute-force subtree count; no visible tip is dropped by the cull (checked against the LOD-off list); threshold back at 3 px and nothing forced at 16x; the 16x view visits under 5% of the nodes; 200 of 200 summary hit-tests; budgets 500 to 20,000 never exceeded. Exit code 1 on failure. "Merged tips" are tips of primitives skipped because they land on the same pixel cells as an earlier one (rule C); it is 0 on this tree and asserted to stay under 2%.
* `node spikes/custom/scripts/check-radial-ui.mjs` (needs the build served on port 5306): hover and click on a summarised clade carry the right tip set and reach React state, colouring a summarised clade, highlight and focus of a tip inside a summary, no tree redraw on hover, reduced frames during a wheel and a full frame after, progressive detail when zooming.

### Defaults chosen

* `cpuCanvas`: on only under automation or `?cpu=1`. The runner keeps its numbers comparable; visitors get the GPU canvas.
* `dprCap` 2: a DPR 3 phone draws 2.25 times fewer pixels with little visible loss for a line drawing; native stays available.
* `radialMaxNodes` 2,000: the user's suggestion; measured CPU-canvas cost of a full frame at that size is 17 ms end to end at DPR 1 and 37 ms at DPR 2 for yule 10k; 5,000 and 20,000 cost proportionally more; unlimited falls back to the rectangular draw budget (20,000).
* `interactionLOD` on, 120 ms refine, quarter budget (min 500), threshold x1.6 only when the last full frame had more than 1,000 primitives (rectangular trees draw 500 to 900, so they are unaffected).
* Hairline branches from 700 primitives: below that lines stay 1.3 px, so a sparse tree looks as before.

### What could not be measured

A real GPU. The accelerated-canvas column is SwiftShader (CPU emulation of a GPU) and moved little (766 to 695 ms at 10k), which says nothing about a laptop GPU. What should transfer is hardware-independent: fewer primitives where the cut-off acts, 15 to 20% fewer path segments (arc to chord), and fewer pixels with the DPR cap. Hairline strokes are fast in Skia's CPU path (measured) and are expected to help on the GPU path too, but that is **unverified**; the larger number of smaller draw calls (47 instead of 6 for 10k) costs nothing measurable on CPU and is **unverified** on GPU. Not tested: real devices at DPR 3, Safari and Firefox, touch pinch.

### Remaining radial limits

* Caterpillar-like trees: the cut walks every node (about 2 per tip), so radial 100k costs 21 ms of JS per frame, and 1M tips would be as before or worse (the lower cut-off makes the budget search run more passes; the search is skipped above 80,000 visited nodes). A precomputed spine skip pointer or a worker is still the fix.
* Fans carry no label or tip count on the canvas (hover and click report it); the notice counts only clades forced by the budget.
* A reduced frame during a gesture shows a coarser tree for up to 120 ms after the last input.
* Radial columns are still not drawn; hit-testing of connector arcs at huge zoom samples at most 400 segments.
* The notice text mentions "Library options", which exists only in this demo; a component user turns it off with `summaryNotice: false` or replaces it.

## Stress test: whole Open Tree of Life synthetic tree (2.39M tips)

Source: OTL synthesis opentree16.1, the full `labelled_supertree_simplified_ottnames.tre` (86.4 MB, sha256 verified; CC0 with the OTL caveat in data/real-ladder/README.md). 2,385,875 tips, 339,807 internal nodes (very polytomous), no branch lengths. Fetched with `data/real-ladder/fetch.sh otl` as rung `otl-2m-full` (23 MB gzipped, git-ignored). Measured with `spikes/custom/bench/bench.mjs` (raw: `spikes/results/custom/bench/otl-2m-full.json`), headless Chromium, no GPU, CPU-canvas flags; JS time only, raster not included. Single run, 5 frames per view, machine shared with the Parquet agent.

| Layout | Shared parse | Layout | First render | Frame JS at fit | Drawn at fit (triangles) | Heap |
|---|---|---|---|---|---|---|
| Rectangular | 1.10 s | 160 ms | 387 ms | 21.9 ms (cut 8.9, draw 12.9) | 2,581 (1,595) | 569 MB |
| Radial | 1.17 s | 137 ms | 604 ms | 36.8 ms (cut 35.7, 5 budget retries) | 1,940 (1,250) | 647 MB |

Zoomed in (3% and 0.03% windows) frames cost under 1 ms in both layouts. What this shows: it works at 2.4M tips; the costs are the one-off parse (about 1.1 s, belongs in a worker), the heap (about 0.6 GB, a real concern on phones and low-end devices; this is where a TreeSource backed by Parquet or a tiled model would help), and the whole-tree fit view in radial (budget search, 37 ms). Download is 23 MB gzipped (86 MB raw). Not measured: raster, a real GPU, a real device.

## Polytomies and runs (issue 13, 2026-10)

### Problem

A node with thousands of children costs one draw primitive per child once its children are a pixel or two apart, and under budget pressure those primitives push the global collapse threshold up for the whole tree. The first fix (`isSlice` in `src/core/lod.ts`) collapses a node whose children are ALL tips into one slice. The real case is a mixed polytomy: `Polyphaga_ott684689` in `otl-2m-full` (git-ignored local file) has 8,550 children, 912 tips and 7,638 clades (median 2 tips, p90 10, p99 57, one of 198,609 tips, 93 of more than 50 tips). Not all-tips, so the slice did not apply (M, script reading the parsed tree).

### What changed

Rule R in the cut (`cutRadial`, `cutRect`): consecutive siblings (same parent, the next one starts at the previous one's `subtreeEnd`, same colour class) that are each a tip or a collapsed clade smaller than `minPx` (radial: arc at the tips; rectangular: height) form a run. A run of at least `SLICE_MIN_CHILDREN` (16) members is ONE draw-list entry; shorter runs are emitted as before. Large children (expanded, or collapsed but not smaller than `minPx`) break the run and are drawn normally. Stubs (`TreeSnapshot.stub`) and `K_STUB` never join a run.

- Representation: `DrawList` has two more arrays, `last` (the last member of a run, -1 for every other entry) and `xmax` (largest `XMAX` of the members). A run is a `K_SUMMARY` entry with `node` = first member, so every consumer that only reads `node` and `kind` still sees an ordered list. Shape: radial = ring segment from the parent's depth to `xmax` over angles `[leafStart[first], leafEnd[last])`; rectangular = rectangle over the same rows. No branch is drawn for a run (the parent draws its own).
- `isSlice` (whole node, all-tip children) stays. It is the special case "the run is all the children", but it is decided in O(1) without walking thousands of children and without drawing the parent's connector, and the star regression test (section 9) is written against it. Not merged into runs on purpose.
- Cost: runs are only tracked under a parent with at least 16 children (`childCount[parent]`), so binary trees do not touch the run state. The first 15 members of a pending run are emitted as usual and taken back (list length and counters restored) when the 16th arrives, so a run needs no buffer and no second pass; the pixel cells those members marked stay marked in `Seen` (harmless: the slice covers them). A run's slice is deduped like any entry (anchored at the whole-pixel origin, so a sub-pixel pan gives the same cut).
- Budget search: a run is one primitive. It counts as `forced` only under budget pressure and when one of its members is at least the base threshold; its tips go to `summaryTips`, or to `mergedTips` if its pixel cell was already taken.
- Hit-testing and events: a click or hover on a run returns `Hit { node: <parent>, kind: 'summary', run: { first, last } }`. `NodeEvent` / `TreeNodeEvent` then carry the parent as `node`/`nodeId`, `tipRange` = exactly `[leafStart[first], leafEnd[last])` (so `tipCount` and `tipIds()` are only the run's tips) and `run: { clades, single }`. The run is not a clade, so nothing colours or selects the whole parent in the component. Tooltip: `23,634 tips in 5,629 clades and 595 single tips` under `<parent label>`.
- Limit of the shared shell: `spikes/shared/app-shell.tsx` colours and links by `nodeId` (the parent), not by `tipIds`, and the shell is not ours to change here. So `src/adapter.tsx` reports a click on a run as a `nodeHover` (exact `tipIds`, no selection, no colour) instead of `nodeClick`. Colouring or linking just a run needs the shell to act on a tip range (a change to `SpikeEvent`, not made). Double click on a run zooms to the parent; keyboard navigation looks nodes up in the draw list by index, so it may land on a run's first member; neither was tested (U).

### Results

All M unless marked. Headless Chromium 1194, no GPU, `bench/bench.mjs --frames 5`, fit view, medians of 4 alternating old/new runs (old = branch head before this change, with the all-tip slice). Frame = cut + draw JS time.

| tree, layout | old: frame / cut / drawn / minPx | new: frame / cut / drawn / minPx |
| --- | --- | --- |
| otl-2m-full radial | 57.7 / 55.7 ms / 1,940 / 18.2 | 13.7 / 12.0 ms / 1,311 / 11.7 |
| otl-2m-full rectangular | 25.2 / 11.6 ms / 2,581 / 3.0 | 12.7 / 8.4 ms / 1,694 / 3.0 |
| otl-100k-vertebrata radial | 9.9 / 7.4 ms / 1,959 / 8.0 | 11.4 / 9.5 ms / 1,961 / 6.0 |
| otl-100k-vertebrata rectangular | 4.7 / 1.1 ms / 1,542 / 3.0 | 5.2 / 1.9 ms / 1,355 / 3.0 |
| gtdb-190k-bacteria radial | 6.2 / 3.7 ms / 1,970 / 4.6 | 6.0 / 3.8 ms / 1,970 / 4.6 |
| gtdb-190k-bacteria rectangular | 4.9 / 0.6 ms / 1,778 / 3.0 | 5.6 / 0.8 ms / 1,778 / 3.0 |

Reading it: the fit view of the 2.39M-tip tree gets 4x cheaper in radial and half as expensive in rectangular, with the threshold lower (more detail for the same budget). The otl-100k radial rows differ because the final threshold differs (8.0 versus 6.0, so the new cut visits 8,772 nodes instead of 6,803 to draw more detail); not a like-for-like cost. gtdb (no polytomies, same entries) is within noise. Repeats to settle the two rows that looked slower: otl-100k rectangular at 60 frames, 6 alternating runs: frame 3.70 ms old, 3.27 ms new, cut 0.54 versus 0.68 ms (the 0.1 ms timer resolution makes the cut number soft); gtdb radial at 20 frames, 6 runs: frame 4.17 / 4.21 ms, cut 2.74 / 2.81 ms. A first version that tracked runs under every parent measured +20% cut time on gtdb radial in the browser (2.6 to 3.2 ms) although Node showed +2%; restricting tracking to parents with at least 16 children removed it. Node microbenchmark of the cut alone (same minPx, 150 alternating runs): gtdb 0.97 to 1.10 of the old time, otl-100k 0.65 to 0.88.

Polyphaga zoomed in, radial, `otl-2m`, six 3x zooms anchored on its widest run, same viewports for both builds (screenshots in the session scratchpad, `shots/{old,new}-step*.png`):

| zoom step | old: drawn / entries of Polyphaga's children | new: drawn / entries (of them runs) |
| --- | --- | --- |
| 0 | 1,980 / 695 (threshold raised to 3.9, 14 forced) | 374 / 14 (2) |
| 1 | 1,949 / 1,584 | 207 / 56 (12) |
| 2 | 1,658 / 1,621 | 87 / 50 (16) |
| 3 | 1,267 / 1,242 | 120 / 95 (22) |
| 4 | 958 / 470 | 861 / 373 (5) |
| 5 | 571 / 179 | 571 / 179 (0) |

So thousands of siblings now cost a handful of primitives (one run per stretch between large children) while the threshold stays at the base value; once the children are 3 px apart or more they are drawn individually as before.

Tests (`scripts/check-radial-cut.mjs`, all pass): sections 8 (pan stability, now also on the polytomy tree) and 9 unchanged; new section 10 builds a node with 8,000 children (1,000 tips, 6,900 pairs, 100 clades of 60 tips spread through a deterministic shuffle) beside two 1,000-tip clades, radial and rectangular, budgets 500 and 2,000, fit and zoomed. Zoomed radial 8x: 232 primitives, 32 of them children of the polytomy (9 runs of 1,334 tips), both large children in view still their own entry, threshold 3.0, forced 0. With rule R disabled the same checks fail (713 entries for 2 large children at budget 2,000, threshold 3,350 at budget 500). Also checked: no tip covered by two entries, tip sums (fit: drawn + summarised + merged = 22,800), a click on 40 run centres per view returns the parent, `run.first`/`run.last` of that run. `check-radial-ui.mjs` passes. Hover over a run on `otl-2m` in the browser: tooltip `23,634 tips in 5,629 clades and 595 single tips under Polyphaga_ott684689`, click reported as `nodeHover n1321962 tips=23634`, nothing coloured.

Demo tree: `syn-polytomy-mixed-22800` (`data/synthetic/make_polytomy_mixed.py`, 66 KB gzipped, CC0): `?tree=syn-polytomy-mixed-22800&layout=radial`.

### Not verified (U)

- Real GPU and real-device frame rates; all timings are headless CPU, 5 to 60 frames, medians, with a 0.1 ms timer.
- Rectangular layout of `otl-2m` was not inspected visually (the synthetic tree and the fit numbers cover it); a `TreeSource` with stubs (`ParquetSource`) was not run with runs (the code never merges a stub).
- Run boundaries depend on the viewport at its padded edge (a culled sibling ends a run), so a run's extent can change when a pan moves a sibling across that edge; sub-pixel pans gave identical cuts in section 8, larger pans were not compared.
- Colouring or linking only a run in the shared shell (needs a tip-range event in `SpikeEvent`), double click and keyboard on runs.

## Hardening (2026-10-21)

A pass over the code of this candidate, no new features, on branch `claude/custom-renderer-hardening` (docs written in `de10bc0`, refreshed after the React-layer and test work landed). Source of every item: the commit messages named, the code at that commit, and `wc -l` / commands run on 2026-10-21. Where this section says a number, the commit message or code comment it comes from is named.

* **Tooling and CI** (`10f9fe0`, `e2897fb`): ESLint 9 (flat config, typescript-eslint, react-hooks), Prettier (width 150), a `node:test` harness (`npm test`) and `npm run check` (typecheck, lint, format check, tests); `.github/workflows/custom-renderer.yml` runs `npm run check` and `npm run build` on Node 22 for changes under `spikes/custom`, `spikes/shared`, the Parquet reader, `data/synthetic` and the committed OTL 91k tree, with a read-only token; since `3f92982` a second job, `test-browser`, installs Playwright's Chromium and runs `npm run test:browser`. The Prettier reformat and the lint fixes grew `renderer.ts` from 1,450 to 1,785 lines without a change of behaviour (`check-radial-cut.mjs` output identical before and after, per the commit message).
* **Dead code and constants** (`a4a7d96`): unused branches and re-exports removed; the magic numbers that repeat or are tuning knobs (view limits, zoom rates, overview extents, navigation targets, radial arc limits) collected in `src/core/constants.ts` with a comment each; values unchanged. `tsconfig` `baseUrl` dropped.
* **Layout projection and the cut** (`f9a61f6`, `90f1671`, `0cc394f`): the rectangular and radial layouts were duplicated in the cut, the drawing and the hit index, so `f9a61f6` put them behind a `LayoutProjection` with one cut loop. On ladder trees that cut was slower. Measured then (headers of `projection.ts` and `lod.ts`, medians of fresh processes): 200k caterpillar rectangular 20 -> 26 ms, radial 25 -> 30 ms; 1M rectangular 100 -> 123 ms, radial 121 -> 158 ms, that is 20% to 31% from those figures (the `90f1671` message says 20-50% in one place and 20-30% in another; the `f9a61f6` message, searchCut in Node, best of 7 at 1M: rectangular fit 156 -> 235 ms, radial fit 449 -> 610 ms). The cause, found in review with `--trace-turbo-inlining` and `--cpu-prof`, is not polymorphism but V8's cumulative inlining budget (`--max-inlined-bytecode-size-cumulative=920`, which a page cannot change): the per-node projection methods stayed real calls and the loop's roughly 30 live locals spilled around each. `90f1671` went back to one inline loop per layout (`cutRect`, `cutRadial`), sharing only per-frame precomputation and the run's dedupe key, and kept the projection for draw and hit, where it is called per drawn primitive. A run-accumulator object shared between the loops cost another 4-5% and was not kept. Guard: 168 golden draw-list cases captured from the pre-refactor code (`e2897fb`) in `test/cut-golden.json`, regenerated on purpose with `scripts/capture-cut-golden.mjs` (reproduces the committed file byte for byte on an unchanged cut). Cost of the final two-loop form against the loops of `e2897fb`, from the doc comment of `cut` in `lod.ts` (`0cc394f`): +3% to +17% at fit views on 200k and 1M caterpillars (worst: 1M radial), equal or faster zoomed, with 5-10% run-to-run noise. So the single cut was abandoned for performance; the unification survives in draw and hit. This is also why a third layout means a third inline loop (see `spikes/custom/README.md`).
* **Renderer split** (`22e716e`, `5b28fe3`, `68d1746`): `renderer.ts` went from 1,821 to 1,045 lines at `22e716e` (the `wc -l` of the facade today is in the table above) by moving the viewport arithmetic and animation, input, keyboard cursor, label overlay, overview, stub loading and the node event into modules with one job each. The facade keeps the public API, `render()`, hover, the notice and the interaction-LOD state on purpose. A differential Playwright run described in the `22e716e` message (147 snapshots per build, real input events and every public API call, both layouts, canvas and DOM hashes) found no difference to the commit before. Two bugs that predate the split were fixed in `5b28fe3` (double click zoomed to the wrong clade with a partial source; the hover-run state was not reset with the hover); `68d1746` fixed review nits.
* **React identity** (`e122a53`, `3317ca7`, `4337e97`): the renderer's setters ignore input equal to the current one, `options` and `theme` are compared field by field, the component passes every field of `options` through instead of a hand-kept list (a key removed from `options` reverts to its default; a `formatLabel` or `tipHref` change rebuilds the DOM label anchors, `4337e97`), effects act only on the live renderer (no setter runs on a destroyed instance in strict mode or on a source swap), and `Column.values` is compared by reference. Rules: the JSDoc of `TreeViewProps`. Not measured: how much redraw and recompile work this saves in a real page.
* **Tests** (`3f92982`, and what `npm test` ran before it): 333 tests (about 4 s wall with `--test-concurrency=4`). Unit tests of the layout invariants, the projections and the text measurer, geometry (transforms, sector bounding boxes), the cut (the 168 goldens, `Seen`, `DrawList`, the `searchCut` ladder, the stub path on a hand-built partial snapshot), rectangular hit-testing, columns and the label overlay (fake canvas context and fake document, no DOM package), the viewport arithmetic, the keyboard cursor and node events, the overview geometry, the input controller (wheel, drag, click, pinch, keys), the stub opener, `live()` and the React prop helpers; plus `scripts/check-radial-cut.mjs` as a child process. The `3f92982` message reports that mutation spot checks of the `src` modules each new test targets were all caught (not re-run for this document). `npm run test:browser` (`scripts/test-browser.mjs`) builds the bundle, serves it with `vite preview` on a free port, runs `scripts/check-radial-ui.mjs` (radial cut-off behaviour, double click with a source whose ids are not its rows, columns, `tipHref`, 14 `setOptions` combinations, setters that must not redraw on equal input, two instances, mount/unmount cycles) and stops the server by PID. Both are configured to run in CI (the trigger paths include the committed OTL tree, `spikes/runner/package.json` and `spikes/package-lock.json`); the jobs' first run on GitHub is on the pull request of the hardening branch. The committed OTL 91k tree (`data/real-ladder/trees/otl-100k-vertebrata.nwk.gz`) is tracked, so CI runs the OTL sections of `check-radial-cut.mjs`; if the file were missing the script prints a SKIP line. Not covered by any committed test: canvas drawing output (pixels), `<TreeView>` outside the browser check, `ParquetSource` (its own script needs data and servers that CI does not have). Line coverage was not measured.
* **Docs** (`de10bc0`, refreshed in the commit after `3317ca7`): `spikes/custom/README.md` (how to run, pipeline, invariants, module map, extension points) and `spikes/custom/docs/api.md`.

**Still unmeasured, as before** (this pass changed no rendering and re-measured nothing on a GPU): frame rates on a real GPU, on low-end or high-DPR devices and in Safari or Firefox (everything above is headless Chromium without a GPU), touch and pinch on real devices, and use with a screen reader. The hardening work was verified by `npm run check`, `npm run build`, `scripts/check-radial-cut.mjs` (output compared before and after each phase that touched the cut or draw code) and `scripts/check-radial-ui.mjs` (now `npm run test:browser`); none of that is a performance or accessibility measurement on real hardware.
