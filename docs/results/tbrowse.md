# tbrowse 2.10.0 (2026-10-14)

Spike: `spikes/tbrowse/` (adapter `src/adapter.tsx`, metadata `spike.json`). Runs: `spikes/results/tbrowse/`. Machine: 4 CPU Xeon 2.8 GHz, 16 GB, headless Chromium 141 without GPU, shared with five other agents (**load average 10 to 17 during most runs**). Source read from the npm package (minified `dist/` only, types in `dist/index.d.ts`) and from github.com/warelab/tbrowse at tag 2.10.0 (cloned, 222 commits); line references below are to that clone, `src/`.

**How to read the numbers.** The runner's FPS rule is unreliable under that load: a 5-tip tree already shows p5 15 fps in run `20261014-152849`. So S1 statuses for 5 to 1,000 tips are noise; the least loaded run (`20261014-144813`, 24 px rows) gave p5 30 fps for 200 and 1,000 tips. Scale is therefore judged mainly on main-thread CPU time per interaction (Chrome DevTools `TaskDuration`, load independent), measured by my own scripts (labelled "manual"). Where the runner failed on probe visibility, not on the library, the runner outcome is kept and the hand-verified outcome is added (evidence M, "verified by hand with scrolling").

Gates: **G1 pass** (MIT, `LICENSE` Copyright 2019-2026 Andrew Olson; only runtime dependency zustand 5, MIT). **G2 pass** (static files, no fetching of its own). **G3 flag**: React 18 component, but `peerDependencies` is `react ^18.0.0` (no React 19 range; untested on 19). **G4 pass with bus-factor flag**: npm 2.10.0 on 2026-09-02, last commit 2026-10-02, 102 commits since 2026-01-01; but 219 of 222 commits are by one person.

## Results table

Capability: Y yes, P partial, N no. Evidence: M measured, S source, D docs, C claimed, N not found, U not looked at.

| Dim | Item | Cap+ev | Notes and evidence |
|---|---|---|---|
| A | last release / cadence | Y-S | npm time: 2.10.0 on 2026-09-02; 36 versions since 2019-03-14; 2.3.0 to 2.4.0 on 2026-05-07/08, 2.9.0 to 2.9.2 on 2026-08-04 (burst releases) |
| A | bus factor | P-S | `git log`: 219 commits Andrew Olson, 2 ajo2995 (same person), 1 dependabot. One maintainer (`olson@cshl.edu`, Gramene/CSHL lineage, U for funding) |
| A | adoption | P-M | npm downloads last month: 430 (api.npmjs.org, 2026-09-13..10-12) |
| A | docs accuracy | P-S | README says `computeTreeLayout` is an exported helper: **not exported** in 2.10.0 (`src/index.ts`, `dist/index.d.ts`). README bundle claim "~14 kB gzipped (CJS)" does not hold: +43 KB gzip over the stub in our build (stub 71.3 KB, tbrowse 114.1 KB gzip, both with React and the shell; adapter included), run `20261014-152849` |
| A | breaking changes | P-D | 1.x to 2.0 was a full rewrite, "not backwards-compatible" (README Status) |
| B | React component, controlled state | Y-M | `<TBrowse viewState onViewStateChange>`; adapter holds `viewState` in React state; S13 pass |
| B | several instances | Y-M | zustand store per component (`TBrowse.tsx`); S13 two instances plus 5 mount/unmount cycles pass, heap growth -2.8 MB (`20261014-152849`). Only global: one injected `<style id=tbrowse-theme-style>` at module load |
| B | side effects, SSR | P-S | `ensureThemeStylesInjected()` runs at import (no `sideEffects:false`, no tree-shaking); SSR guarded (`typeof document`); `/` and Ctrl/Cmd-F hotkeys are captured while the cursor is inside (`Toolbar.tsx`), opt out with `hotkeys={{search:false}}` (used here) |
| B | bundle | P-M | +139 KB minified / +43 KB gzip over the stub (see A). ESM and CJS, TypeScript types shipped |
| B | input format | P-S | flat node table `{id,parentId,distance,isLeaf,geneId,bootstrap}`; no Newick/Nexus parser; adapters only for Ensembl and Gramene JSON. Conversion from TreeModel: 2.2 ms (1k tips), 55 ms (10k) (`parseMs`, runs `20261014-152849`, `20261014-150226`) |
| C | tip click with metadata | Y-M | click sets `ViewState.selectedNodeId`; adapter emits tipClick. S2 pass (4/4 tips; tip metadata row shown in React, unmatched tip reported unmatched). Same id re-clicked is detected by view-state identity (adapter heuristic) |
| C | internal node / branch click with tip set | P-M | library reports only a node id; tip set computed from TreeModel, flagged `adapter-derived` (S3 `partial` by rule, 4/4 nodes right and sets equal to ground truth, run `20261014-152849`). Branch hit path and node click are the same event |
| C | node reachable by mouse | P-M | the hit target is the node's whole L-shaped branch (`Tree.tsx` hit paths, 12 px stroke), so a node is clickable on its vertical connector; there is no zoom-out so a big clade's node is only reachable by scrolling. In the runner at fit view locate needs the connector (adapter falls back to it) |
| C | hover with payload | P-S/M | `hoveredNodeId` / `hoveredSubtreeIds` exist only in `ZoneRenderProps`, not as a prop callback. Adapter reads them inside its own zone; works while that zone is visible. Hover costs a full re-render (see F) |
| C | tip label as real link | P-M | built-in labels zone has none; our own `ZoneDefinition` renders `<a href data-tip-id target=_blank rel>` (S6 pass, new tab opened, focusable) |
| C | programmatic highlight | P-M | library search state with a host `SearchField` draws a ring on the leaf dot and a count on collapsed triangles; our zones add a row band. S5 pass. Side effect: the library search box shows "highlighted: n tips"; typing there replaces it |
| C | focus / centre | P-M | no API. Adapter sets `scrollTop` on `.tbrowse-outer` after removing collapsed/pruned ancestors from `ViewState`. S5 pass (dx 5%, dy 7% off centre, 10k tips) |
| C | viewport control, URL state | Y-D | `ViewState` (selection, collapse, prune, swap, compress, zone widths/states, row height, search) is serialisable by design (README) |
| C | keyboard | P-S | tree SVG has no roles or focusable nodes (`grep` of `Tree.tsx`); toolbar/search/tooltip (Escape) have some. Our label zone adds focusable items (S14 pass is thanks to it) |
| D | per-tip aligned columns | Y-M | one `ZoneDefinition` per column, React-rendered, data via `hostData` prop; S7 pass at 16 px rows (8/8 cells aligned, dy 0.0 px before and after scroll, Spearman 1.0, unmatched tip has no cell). At the library default 24 px the runner sample gave 5 cells (< 8) and failed on count only (`20261014-144813`, alignment itself dy 0.0) |
| D | collapsed-clade summaries in columns | P-S | `createTableZone` aggregates a column over a collapsed clade (mean, count, ...) and has heatmap display (`zones/table/Table.tsx`, `aggregators.ts`): read in source, **not demoed** (it bakes its data in at creation). Our bar zone does a mean on collapsed rows (adapter code) |
| D | alignment column | P-M | built-in `msaZone` (canvas, minimap, 4 colour schemes) from `{alphabet,length,sequences}`; S8 pass (35/35 cells aligned, 3+ residue colours). Canvas is as tall as all rows (`MSA.tsx` sets `canvas.height = totalHeight`), so it blanks beyond the browser canvas limit (about 1,365 rows at 24 px, derived, not measured) |
| D | clade colouring | P-M | no prop. Inline-style patch on SVG branches and leaf dots (path `d` parsed back to node by mirrored y geometry; MutationObserver re-patches on virtualised rows) plus React colour in our zones. S4: 4% of the clade box turns red, control clade unchanged, clear restores; runner result `partial` only because of the layout probe check, see below. Internal-node glyphs and dashed leaders stay grey |
| D | styling hooks | P-M | all colours are `--tbrowse-*` CSS variables, overridden by one rule with GBIF tokens, `theme="dark"` works (S9 pass: light 246 vs dark 45 luminance, token background 92%, branch pixels take the token). Constants (selection amber, glyphs, branch widths 1-3 px by clade size, residue colours) are not configurable. Details in `spike.json` |
| D | hide features | Y-S | `showHeader`, per-zone visibility, `showLeafExtensions`, `rowHeight`, `fontSize`, `autoHeight` props |
| E | rectangular phylogram / cladogram | Y-M | `TreeZoneState.layoutMode`; S11 phylogram Pearson 0.99999 with root-to-tip length (protein tree), toggle moves tips by 122 px |
| E | branch-length fidelity | P-M/S | **every branch is floored at an absolute 0.01** (`zones/tree/layout.ts` MIN_BRANCH_DISTANCE) and by default branches over 5x the median are shortened with a `//` mark. Trees with small units need a host-side rescale (adapter: x10^k to depth >= 100, library tooltip then shows scaled numbers). Demo toggle "Rescale" shows the difference on the protein tree. Negative and missing lengths: clamped to 0.01, edge-polytomy-missing renders |
| E | circular, unrooted | N-S | none (`zoneState.layoutMode` has two values); S12 unsupported |
| E | scale bar, time axis | N-N | not found in README, source or UI; S11 notes |
| E | collapse, prune, swap, reroot, search | Y-M | tooltip actions on any node (`Tooltip.tsx`), all in `ViewState`; search box with regex/case, "show matches only". Overview / larger-clade-first options in the demo drive `collapsedNodeIds` and `swappedNodeIds` (checked by hand) |
| E | whole-tree zoom-out / fit | N-M | no zoom. Rows are a fixed `rowHeight` (24 px default, Display slider 8 to 64) in a native scroll container. `ViewState.rowHeight` can be set below 1 px so that all rows fit ("fit all rows" option) but then every row is drawn: 1k tips = 12,075 DOM nodes and 127 ms CPU per hover; labels overlap (adapter hides text below 9 px). S10 `fail` (run `20261014-152849`) |
| E | semantic zoom / minimap | P-S | collapsing to triangles is the only level of detail (user driven; demo "overview" automates it); MSA has its own coverage minimap |
| E | export | N-N | not found |
| F | load, 1k tips | Y-M | firstRenderMs 0.4 to 1.1 s (varies with load) |
| F | scroll cost per wheel step (main-thread CPU, manual, load independent) | M | 200 tips 38 ms; 1,000: 41 ms; 2,000: 56 ms; 3,000: 135 ms; 5,000: 347 ms; 10,000: 690 ms; 20,000: 5,034 ms. Hover per move: 13, 13, 23, 47, 191, 528, 4,190 ms |
| F | first render | M | 2k 0.8 s; 3k 1.6 s; 5k 2.3 s; 10k 4.6 to 7.3 s (yule, OTL, GTDB, balanced, bushy: 4.6, 7.3, 5.9, 6.5, 5.7 s); 20k 19.6 s; **100k: mount never finished in 240 s** (run `20261014-151814`). 91k and 190k real trees not run (100k synthetic already exceeds the limit) |
| F | interaction at the unusable thresholds | M | click latency 8 to 13 ms at 1k; 10k: 32 to 509 ms to callback and 362 to 1,126 ms to paint. Scrolling at 10k is about 1.4 fps (profile below) |
| F | max practical tip count | M | smooth (< 50 ms per step) to about 2k; usable (< 350 ms) to about 5k; unusable from 10k (load > 10 s only at 20k+). Deep trees: **stack overflow on caterpillars at 5,000 tips** (3,000 works, 3.5 s first render; 10k and 20k fail, runs `20261014-151519`, `-151525`): `computeVisibleRows` and `computeTreeLayout` recurse |
| F | why slow | M+S | CPU profile (10k, scrolling): 56% in the arrow function with `visibleRows.find(row => row.nodeId === n.nodeId)` inside a map over every node (`Tree.tsx` about lines 1119 and 1365, the culling test `yInRange` comes after the `find`, so cost is O(rows squared)), 34% in `TreeBody` itself (all `compressedNodes.map` passes over all nodes on every render, before the virtualisation test). Virtualisation only limits the DOM. First render draws every row because `computeRowRange` returns the full range until the ResizeObserver reports a height (`rowRange.ts`). Every scroll event and every hover re-renders all zones |
| F | memory | M | JS heap 10 MB (1k), 47 MB (10k), 73 MB (20k) |
| G | formats | N-S | no Newick, Nexus, phyloXML, NeXML parser; host converts. Node-table input only (plus Ensembl and Gramene adapters) |
| G | tree operations | P-S | collapse, prune, swap, reroot (prune others), pivot to a node (`computePivotState`, `nodeOfInterest`); all view-only, separable (pure helpers exported) |
| G | deep trees | N-M | see F |
| H | accessibility | P-S | see C keyboard; no ARIA on the tree, no text fallback, animations (260 ms) ignore reduced motion (not found); touch works through native scroll |
| I | licence detail | Y-S | MIT, zustand MIT; no bundled data |
| J | cost to adapt | see below | |

## Scenarios (runner outcome, then hand-verified outcome)

Runner results: `spikes/results/tbrowse/20261014-152849.json` (smoke, final build), `-144813` (first run, 24 px rows), ladder and worst: `-150226` (yule 10k), `-150352` (otl 1k), `-150410` (otl 10k), `-150438` (gtdb 10k), `-151310` (dated, edge, align, caterpillar 1k), `-151519`, `-151525` (caterpillar 10k, 20k), `-151814` (yule 100k), `-153443`, `-153509` (balanced, bushy 10k). Screens: `screens/` (runner PNGs, plus `demo-1k-rectangular.png`, `demo-columns.png`, `demo-clades.png`, `demo-dark.png` taken by me).

| Scenario | Runner | Hand-verified (M, by hand with scrolling) |
|---|---|---|
| S1 load and fit | smoke: timeout (FPS, load 17); 10k, otl-10k, gtdb-10k, balanced, bushy: timeout (p5 0.6 to 1.0 fps); caterpillar 10k and 20k: fail (stack overflow); 100k: timeout (mount > 240 s). In `-144813`: 5 and 200 tips pass, 1k partial (no internal node reachable at fit view) | 1k fine (41 ms per step, 0.4 to 1.1 s load); unusable from 10k |
| S2 tip click | pass | same |
| S3 node click | partial (4/4 right, tip sets adapter-derived) | same; the library gives no tip set |
| S4 colour clades | partial: red fraction 4.0% up, control 0, clear restores; fails only "no layout change" because runner probes were off-screen (null) | visible tips do not move on colour or clear (`movedOnColour false, movedOnClear false`, probes in view) |
| S5 highlight and focus | pass | |
| S6 link | pass | |
| S7 bar column | pass (16 px rows); fail at the 24 px default in `-144813` (5 cells, needs 8; dy 0.0) | alignment perfect in both |
| S8 alignment | pass | |
| S9 theme | pass | |
| S10 whole tree | fail (no zoom-out) | "fit all rows" is possible in the API only at about 1k tips, unreadable (see E) |
| S11 branch lengths | partial: only 5 visible tips of 80 (needs 20) so the ultrametric check was not scored, scale bar absent | the 5 visible tips of the dated tree end at the same x (spread 0.00%) |
| S12 radial | unsupported | |
| S13 two instances | pass | |
| S14 keyboard | pass (our label zone); library tree itself is not focusable | |
| S15 linked view | fail: clade node not locatable at fit view (10k tips, 969-tip clade) | 1k tree, 305-tip clade, scrolled to the node (62 scroll steps): click to React commit 21 to 29 ms, to paint 30 to 78 ms, 5/5 map counts right (load 16). At 10k the same click would cost 0.2 to 1.1 s |

## Verified user observations

- "Slow on large trees": **confirmed and explained** (F). Cost grows with the square of the row count in the tree zone; first render draws all rows; usable to about 5k tips, practical to 2k.
- "No whole-tree zoom-out": **confirmed**. Fixed row height in a scroll container, no wheel zoom or fit button (S10). Only `rowHeight` below 1 px approximates it, and that removes the virtualisation benefit.
- Table-like layout is real and good: zones share one row grid, so columns stay aligned by construction (dy 0.0 px).

## Cost to adapt

- Newick/Nexus/phyloXML to node table: wrapper, small (about 40 lines, 2 ms per 1k tips); keep the shared parser.
- Tip set on node events, hover, clade colouring, highlight, focus, links: wrapper plus DOM patch, medium (the adapter is about 900 lines); fragile against library releases (parses SVG path strings, selectors on `.tbrowse-outer`).
- Scale (quadratic `find`, per-render all-nodes passes, full first render, canvas height, recursion): **patch or fork** in `Tree.tsx`, `Layout.tsx`, `visibleRows.ts`, `layout.ts`, `MSA.tsx`; MIT allows it; effort days for the O(n squared) and recursion, more for real level-of-detail and zoom. Single maintainer.
- Radial layout, scale bar, time axis, export: not present; rewrite of the tree zone.

## Verdict

1. Best "tree plus aligned columns" model of the candidates: ZoneDefinition columns, controlled serialisable view state, collapse and prune UI, theming through CSS variables; it works as a React component with 1k tips.
2. Not viable for 10k tips (0.7 s per scroll step, 100k never loads), no zoom-out, no circular layout, scale bar or tip sets in events; deep trees overflow the stack at 5k.
3. Reasonable as a design to copy or a base to fork (zones, view state), not as an unmodified dependency for large trees.

## What surprised us

- The cost is not the SVG node count (the DOM stays at about 650 nodes) but a `.find` over all rows inside a map over all nodes, run on every scroll and hover.
- The README's exported `computeTreeLayout` does not exist in the package, and the "14 kB" bundle is about 43 KB gzip.
- The 0.01 absolute branch floor silently turns small-unit trees into cladograms.
- The library's search state turned out to be a usable highlight channel, and `createTableZone` aggregates collapsed clades, a semantic-zoom feature we did not expect (not demoed).
- The first render ignores virtualisation until the ResizeObserver fires, so mount time already contains the whole-tree cost.
