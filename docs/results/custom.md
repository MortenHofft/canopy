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

Size (TypeScript, `wc -l`, including comments):

| Module | Lines | Contents |
|---|---|---|
| `src/core/layout.ts` | 63 | O(n) layout into typed arrays (x, row, subtree max x, last child) |
| `src/core/lod.ts` | 200 | viewport cut (rect and radial), draw list, pixel-cell de-duplication |
| `src/core/hit.ts` | 259 | uniform-grid spatial index over the draw list, hit scoring |
| `src/core/draw.ts` | 375 | branches, triangles, markers, labels, highlights, axis, scale bar |
| `src/core/columns.ts` | 213 | bar/text/alignment columns, bitmap blit |
| `src/core/geom.ts` | 106 | transform, sector bounding boxes |
| `src/core/renderer.ts` | 1,251 | DOM, view state, rAF loop, wheel/pointer/touch/keyboard, overlay, overview, a11y, animation |
| `src/core/types.ts`, `index.ts` | 156 | public types and options |
| `src/react/TreeView.tsx` | 210 | the component |
| `src/adapter.tsx` | 164 | harness adapter, 21 capabilities, 9 library options |
| `src/demo.tsx` (dev only) | 48 | two linked controlled instances |
| `bench/*.mjs` | 125 | benchmark scripts |
| **Total** | about 3,170 | core 2,620, React layer 210, harness 164 |

What was hard: (1) the caterpillar (the walk, not the drawing; the de-duplication by pixel cell fixed the draw list, the visit count needs a precomputed skip structure); (2) keeping hit-testing consistent with what LOD drew (a tip inside a collapsed clade must not be a click target; tip targets only exist when rows are at least 6 px; a node must win against a tip 8 px away; the first version hit the wrong tip because focusing the root with the mouse scrolled the view); (3) labels and links on a canvas (a DOM overlay for visible rows that tracks the canvas text, focus not lost when a row scrolls out, drags must not open links); (4) a headless-GPU artefact: an accelerated canvas runs through SwiftShader and was 3 to 10 times slower than a CPU-backed one, so the harness build uses `willReadFrequently` (option `softwareCanvas`, toggle "CPU-backed canvas" in the demo; on a real GPU it should be tried off).

What is missing for production: worker for parse and cut (1M tips: 0.8 to 1.1 s parse on the main thread), spine skip pointers for caterpillars at 1M, user collapse/expand and search, clade labels on collapsed triangles (research section 6.4), React-rendered cells in columns (research 5.2), column summaries for collapsed clades (research 6.5; bars use the pixel-bin mean, not a per-clade aggregate), multi-resolution rows (variable row heights), unrooted layout, export (PNG/SVG/Newick), URL round trip, `prefers-reduced-motion`, touch and screen-reader testing on real devices, browser matrix (only headless Chromium 141 tested), numbers on a real GPU, tests (the runner is the only test), hit-test slop for coarse pointers, radial columns, node/branch labels (support values), tooltip customisation beyond a render prop, SSR check, a package boundary and docs. Rough estimate for these: 12 to 18 engineer-weeks on top of this baseline, close to the research's "full" scope minus WebGL, which looks unnecessary (Canvas2D at 1M tips costs 3 ms of JS per frame for bushy trees).

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
  options={{ lod, drawBudget, showSummaries, overview, labelDensity, rowHeight, axis, italicLabels,
             minCladePx, formatLabel, ariaLabel, softwareCanvas }}
  tooltip={true | (e) => ReactNode}
  onTipClick={(e) => ...}             // e: { nodeId, node, isTip, kind, tipId, tipCount, tipRange, tipIds(), via, clientX, clientY }
  onNodeClick={(e) => ...}            // internal node marker, collapsed clade or branch (kind tells which)
  onHover={(e | null) => ...}
  onViewportChange={(v) => ...}       // once per frame
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
