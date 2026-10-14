# archaeopteryx 3.24.0 (2026-10-14)

Spike: `spikes/archaeopteryx-js/` (React 18.3.1 + Vite 5.4.11, `archaeopteryx` 3.24.0, `d3` 7.9.0, `phyloxml` 1.1.7, all exact). Measured in headless Chromium 141.0.7390.37 on a 4-CPU, 16 GB, no-GPU sandbox that was shared with five other agents running Chromium: the load average was 6 to 18 during every run, so absolute frame rates are pessimistic and noisy (calibration below). Evidence letters follow [../evaluation-framework.md](../evaluation-framework.md): M measured by us, S source or registry, D project docs, N looked for and not found, U not looked at. Earlier source-level notes: [../research/archaeopteryx-js.md](../research/archaeopteryx-js.md); corrections to them are at the end.

Run ids (all in `spikes/results/archaeopteryx-js/`, runner `spikes/runner/run.mjs`):

| Id | What |
|----|------|
| **R-smoke** `20261014-155537` | S1 to S15 on the smoke trees, final adapter (an earlier run of the same adapter, `20261014-153308`, is also kept) |
| **R-ladder** `20261014-153658` | S1 and S10 on syn-yule-10000, otl-1k, otl-10k, gtdb-10k |
| **R-worst** `20261014-153824` | S1 and S10 on the worst-case shapes (caterpillars, balanced, bushy) |
| **R-cad** `20261014-153946` | S1, S10, S11 on the cols, align and dated groups |
| **R-91k** `20261014-154244`, **R-100k** `20261014-154335` | S1 on otl-91k and syn-yule-100000, one at a time (gtdb-190k was not run) |
| **P-scale** `probes/scale-yule-*.json` | my own probe for generated 5k, 25k and 50k trees (the catalogue has none), same measures as S1 plus renderer CPU seconds and long tasks |
| **P-facts** `probes/library-facts.json`, `probes/calibration-stub.json` | one-off checks (key capture, resize, hidden mount, style properties, singleton, leaks, depth limit) and a stub run for calibration; scripts are next to them |

Screenshots: `spikes/results/archaeopteryx-js/screens/demo-01..05-*.png` (bare tree with clades and highlight, full control panel, heat map plus alignment, dark theme, radial) and the runner's own S-numbered shots.

Gates: **G1 licence: flag** (LGPL-3.0-or-later; `phyloxml` LGPL-2.1-or-later; d3 ISC, sax BlueOak-1.0.0; packaging observation below), **G2 browser-only: pass** (no network requests at all; the runner blocks every non-local request and everything ran), **G3 React-embeddable: pass with caveats** (launch in an effect and destroy on unmount is clean, but one viewer per page and page-wide key handlers), **G4 not abandoned: pass** (37 npm releases, 3.28.0 on 2026-10-11, four releases after the pinned 3.24.0 within four days; single maintainer).

## Scenario results (R-smoke unless stated)

| Scenario | Status | What happened |
|----------|--------|---------------|
| S1 load and fit | timeout (all trees except otl-1k) | Loads fast (see scale table); the p5 FPS threshold fails from 5 to 12 fps on trees of 5 to 1,000 tips. The stub renderer under the same load got p5 4.0 fps at 1,000 tips (it had 20 on a quiet machine), so the failure is mostly the machine; see Calibration |
| S2 click a tip | pass | Click latency 5 to 10 ms. Events are `source: adapter-derived` (DOM hit test), not library events |
| S3 click internal node | partial | Right node and right tip set, but tip sets come from the shared TreeModel (adapter-derived), the library has no payload |
| S4 colour clades | pass | `node.color` on the live tree plus a redraw; no layout change; colour removed on clear |
| S5 highlight and focus | pass (syn-yule-10000) | Tip bold with halo, centred within 0.000004 px; focus on 10k tips costs about 4 s (P-facts, `zoomfocus.mjs`) |
| S6 tip as link | pass | Real `<a href data-tip-id>` overlay on the visible labels, keyboard focusable |
| S7 bar column | partial | Fit view: 300 of 300 cells aligned (max dy 0.5 px). After 8 wheel notches the heat map slides past the right edge (the wheel zooms the x axis too), so no cell is visible until the user pans. A single bar column needs a labelled mirror column because the heat map needs two |
| S8 alignment | pass | Rows aligned; windowed residue track with conservation bar |
| S9 theming | pass | Dark theme through the library's own switch; background and branch tokens through CSS overrides |
| S10 zoom out | partial | Works (overview miniature), p5 4 to 12 fps while zooming (R-smoke, R-ladder, R-cad) |
| S11 phylogram/cladogram | pass | Scale bar and an axis on a dated tree are self-reported plus screenshot (`probes/`) |
| S12 radial | partial | Clicks, node clicks, tip sets and layout work; the clade-colour pixel check fails by a hair (0.17% against 0.2%) because branches are 1 px hairlines; the demo option "Branch width" 2 px was not re-measured |
| S13 two instances | partial | Skipped by the runner (`multipleInstances: no`); verified by hand: a second launch empties the first container and it is not restored. Five mount/unmount cycles: DOM nodes 370 to 371 and heap growth 1.2 MB over the cycles (R-smoke) |
| S14 keyboard and reader | pass (lenient) | 5 focusable elements (4 of 5 named) are the control-panel buttons; tips are not keyboard focusable (SVG text, no roles), only the optional link overlay is |
| S15 linked view | partial | Click to React commit 38 ms; click to paint 58 to 336 ms, median 201 ms (R-smoke); the earlier run `20261014-153308` gave 76 ms (and `20261014-155232`, removed, 191 ms): the spread is machine load. The redraw of 969 coloured clade tips on a 10k-tip tree is the cost |

## Scale (S1, plus P-scale)

Production build, no GPU, load average 6 to 18. "Render" is mount to two animation frames after `viewer.ready`. "Zoom step" is the median long main-thread task during the scripted wheel zoom (P-scale); the library re-lays-out and redraws on every zoom step. p5 FPS is the runner's time-weighted figure and is dominated by those steps.

| Tips | Tree (run) | Library parse ms | Render ms | Click ms | Zoom step (long-task median) | p5 FPS | Heap MB | Status |
|-----:|------------|-----------------:|----------:|---------:|-----------------------------:|-------:|--------:|--------|
| 888 | otl-1k (R-ladder) | 23 | 248 | 7 | n/a | 20.0 | 8 | pass |
| 1,000 | syn-yule-1000 (R-smoke) | 19 | 369 | 10 | 67 ms (P-scale) | 6.7 | 10 | timeout (fps) |
| 5,000 | generated (P-scale) | 32 | 784 | 12 to 27 | 129 ms | 6.7 | 13.5 | not run through the runner |
| 10,000 | syn-yule-10000 (R-ladder) | 82 | 1,304 | 15 | 271 ms (P-scale) | 3.3 | 26 | timeout (fps) |
| 25,000 (about 50k nodes) | generated (P-scale) | 246 | 3,661 | 75 to 116 | 768 ms | 1.1 | 36 | not run through the runner |
| 50,000 | generated (P-scale) | 307 | 6,400 | 171 to 282 | 1,565 ms | 0.5 | 66 | not run through the runner |
| 90,938 | otl-91k (R-91k) | 352 | 7,464 | 100 | n/a | 0.4 | 122 | timeout (fps) |
| 100,000 | syn-yule-100000 (R-100k) | 714 | 13,862 | 231 | n/a | 0.2 | 181 | timeout (load 14.6 s, fps) |
| 10,000 deep | syn-caterpillar-10000, edge-caterpillar-20000 (R-worst) | n/a | n/a | n/a | n/a | n/a | n/a | **fail: RangeError, stack overflow in the recursive `addParents` at parse/launch** |

Observations. (1) The DOM stays small at the fit view whatever the tree size: 456 DOM nodes and 241 SVG elements for 5,000, 25,000 and 50,000 tips (branches are one path, about 47 label elements, `labelElements` in P-scale): the batching claim in the research is true. (2) Pan-only (drag) is cheap for the main thread (5,000 tips: 4 tasks of about 67 ms in 8 s) but the software raster limits it to about 25 fps here; zoom is the expensive operation. (3) The changelog's "a 50,000-node tree opens in a third of a second and pans at 60 fps" is **not reproduced**: a 25,000-tip tree (about 50,000 nodes) took 3.7 s to first render and 4.5 renderer-CPU seconds, about ten times the claim; their machine and what they time are unknown, and ours has no GPU. (4) Making a tip readable (the occurrence-page case) draws one label element per tip: after `focusTip` the DOM holds 20,365 nodes at 10,000 tips, 50,365 at 25,000 and 100,365 at 50,000, and the first implementation (Ctrl+Shift+E) took 5.4 s, 11.7 s and 39 s; the shipped one (Ctrl+G plus zoom steps) takes about 3.8 s at 10k and is capped at about 2 px rows above 12,000 tips. (5) Memory is modest: 181 MB at 100,000 tips.

### Calibration

The same runner S1 on the naive SVG stub at 15:47 (load about 11.6) gave p5 4.0 fps at 1,000 tips and 0.9 at 10,000, against 20.0 and 2.4 on the quiet machine earlier (`probes/calibration-stub.json`, `results/stub/`). Archaeopteryx's 5.5 to 12 and 2.5 to 3.3 under the same conditions are therefore not worse than the stub's. No number here is a laptop number.

## Dimensions

| Dimension | Item | Capability+evidence | Notes and evidence link |
|-----------|------|---------------------|-------------------------|
| A | last release | Y-S | 3.28.0 on 2026-10-11 (`npm view archaeopteryx time`); pinned 3.24.0 (2026-10-07) |
| A | cadence and churn | P-S | 37 versions since 2019; 3.0.0 on 2026-09-04, then 28 releases in 37 days; four more after our pin |
| A | bus factor | N-S | one npm maintainer, recent commits co-authored with Claude (research, 2026-10-08) |
| A | adoption | P-S | about 4.7k npm downloads a month (research); BV-BRC named as consumer (research, not re-checked) |
| A | API stability | P-M | the adapter had to rely on undocumented internals (d3 datum on `g.node`, `node.x/y/collapsed`, DOM class names, `--p-*` variables, stylesheet value matching): each is a breakage risk on a release cadence of one per 1.3 days |
| B | integration shape | P-M | imperative `launch(container, tree, config)` and `destroy()`; no React component; the adapter is about 1,025 lines; `viewer.ready` is not in the .d.ts |
| B | controlled and uncontrolled state | P-M | view state both ways (`applyViewState`, `onViewChange` wired into React state as `data-view`); every `applyViewState` ends in `zoomToFit()` and clears collapsed clades unless they are passed back, so every change goes through `{...getViewState(), ...patch}` and still loses zoom and pan |
| B | several instances on a page | N-M | S13 by hand (P-facts): second launch empties the first and nothing restores it |
| B | SSR safety | Y-M | `parseTree` runs in plain Node without d3; `launch` needs a browser (`probes/depth.cjs`) |
| B | clean unmount | Y-M | 5 mount/unmount cycles: DOM nodes flat, heap flat (P-facts); left behind: `<style id="aptx-panel-styles">`, localStorage `aptx-panel-theme` and the overview corner; a StrictMode-style launch, destroy, launch on a 5,000-tip tree gave one viewer and no error |
| B | global side effects | N-M | while mounted, document-level handlers call `preventDefault` for Ctrl+F, Ctrl+G, Ctrl+0, Ctrl++, Ctrl+/, Ctrl+Shift+L and shift+wheel anywhere on the page (browser find is hijacked); a body-level tooltip; an alignment navigation bar that is `position:fixed` to the viewport and lies outside the container (P-facts, screenshot 03) |
| B | bundle size | P-M | total 1,023,710 B minified, 336,706 B gzip including React, the shell and 17,766 B of CSS; library parts 769 KB min / 256 KB gz: archaeopteryx+forester 449,417 / 146,374 B, full d3 280,957 / 95,562 B, phyloxml+sax 38,827 / 13,739 B (R-smoke bundle; the app chunk with React and the adapter is 236,087 B, the stub's 221,745 B); one UMD file, nothing tree-shakes |
| B | bundler (Vite) | P-M | builds without error but **fails at run time** ("forester.js must be loaded before this call") unless `d3`, `phyloXml` and `forester` are put on `globalThis` first: the UMD file resolves its dependencies with `require(variable)`, which no bundler follows. Also needs `define: { global: 'globalThis' }` for the dev server (phyloxml.js:91) and an ambient type shim for `archaeopteryx/forester` and `d3` (P-facts, `src/globals.ts`, `src/shims.d.ts`) |
| B | TypeScript, ESM, CSP | P-S / U | `.d.ts` for the main entry only; CommonJS/UMD only; CSP not tested (injects `<style>`, uses inline styles) |
| C | tip click | P-M | no callback; DOM click mapped to the node: adapter-derived; S2 pass |
| C | internal node and branch click with tip set | P-M | same workaround and S3 partial; branches are not elements, so no branch click (N-M) |
| C | hover | P-M | library tooltip, no callback; adapter-derived hover events from a throttled hit test |
| C | tip label as link | P-M | overlay anchors; S6 pass |
| C | programmatic highlight | P-M | search A via `applyViewState`; bold, halo, dot; everything else fades (coloured clades too); S5 pass |
| C | focus and zoom to node | P-M | no API: Ctrl+G and zoom keys dispatched on `document`; cost is O(tips) in DOM (see scale) |
| C | viewport control | N-D | zoom and pan are not part of the view state; only fit |
| C | selection model | P-M | `enableManualNodeSelection`, node menu "Select/Deselect Node" gives a payload-less `selected_nodes_changed_event`, the adapter reads `getSelectedNodes()`; "Select/Deselect All Ext Nodes" is reported as one clade event; read-only (P-facts) |
| C | context menu | Y-M | built-in node menu opens on every click (Collapse, Switch to subtree, Swap, Ladderize, Reroot, Select, Download); cannot be removed; Reroot changes the topology under the adapter's mapping, so events are derived from the node's current tip set and dropped when it is no longer a clade |
| C | keyboard | P-M | many documented shortcuts; tips are not focusable (S14 lenient pass) |
| C | shareable state | Y-D | `encodeViewState`/`decodeViewState` hash |
| D | hide features | P-M | `collapseControlPanel`, `enableDownloads`, `enableSubtreeDeletion`, `enableAccessToDatabases`, `panelDensity` are official; the panel header bar, the overview miniature and the alignment navigation bar cannot be removed by config |
| D | plugins, slots, React content | N-S | none |
| D | per-node style callbacks | N-S | only `style:*` properties read once at launch; honoured: node_color, node_shape, font_color, font_size, font_style; not honoured: node_size, font name, node_transparency (P-facts, M) |
| D | programmatic clade colouring | P-M | S4 pass via `node.color` and a redraw |
| D | CSS tokens, dark mode, fonts | P-M | no config; CSS overrides; see `spike.json` for what could and could not be styled; S9 pass |
| D | aligned per-tip columns | P-M | built-in heat map (2+ numeric columns), alignment, logo, domains, gene arrows; no custom cells; domain and gene tracks need phyloXML data that the shared catalogue does not have (U) |
| D | tooltips | P-D | fixed templates |
| E | rectangular, circular, unrooted | Y-M | rectangular and circular tested, unrooted exists (D) |
| E | phylogram and cladogram toggle | Y-M | S11 pass; scale bar drawn; axis checked on rich-corvoid-680 |
| E | collapse | Y-M | node menu entry seen; `applyViewState({collapsed})` (S); not exercised from the adapter |
| E | overview or minimap | Y-M | S10; always on |
| E | semantic zoom and summaries | P-M | label thinning only (about 47 label elements at fit view whatever the size); heat map merges runs; no clade summaries, auto-collapse was removed in 3.0 |
| E | search and export | Y-M / Y-D | search used for highlight; SVG, PNG, PDF, Newick, FASTA, TSV downloads are in the panel (D, not exercised) |
| F | 1k to 100k tips | M | see scale table (R-smoke, R-ladder, R-91k, R-100k, P-scale) |
| F | 3 custom columns | P-M | syn-yule-1000 with heat map, text and alignment drew fine (screenshot 03); no scale run with columns |
| G | Newick | Y-M | all catalogue Newick; quoted labels and underscores preserved (edge-quoted-labels) |
| G | Nexus TRANSLATE, phyloXML, NHX, BEAST | Y-S | read natively (README, forester.js); not exercised because the shell hands over clean Newick |
| G | NeXML | N-S | not supported |
| G | robustness | P-M | deep trees fail: recursion in `addParents` overflows the stack between about 9,000 and 12,000 levels (Node), and at 10,000 in Chromium (R-worst, `probes/depth.cjs`) |
| G | loading big files | P-M | parse 714 ms at 100k tips on the main thread, no worker |
| G | tree operations | Y-M | reroot, ladderize, swap, subtree in the node menu; `forester.*` is exported |
| H | keyboard, ARIA, text fallback | P-M | panel is keyboard operable and named; the tree has no roles; the adapter added `role=group` with a label; link overlay is focusable |
| H | touch, contrast, reduced motion | U | not tested; the pulsing halo animation was not checked against `prefers-reduced-motion` |
| I | licence detail | P-S | package.json `LGPL-3.0-or-later`, LICENSE is the LGPL v3 text, `phyloxml` `LGPL-2.1-or-later`; observed packaging: Vite folds everything into one chunk by default; with `manualChunks` the library gets its own file (`assets/archaeopteryx-*.js`) but it is minified and wrapped by the bundler, so it is not the byte-identical npm file; the byte-identical route (serve the npm `archaeopteryx.js`, `forester.js` as static files and load with script tags, d3 and phyloXML on `window`) is the README's "classic path" and was not built |
| J | cost to adapt | see below | |

Cost to adapt (wrapper means our code on the public API plus the workarounds; fork means a patch to the library, which must be released under LGPL):

| Gap | Route | Effort | Licence ok? |
|-----|-------|--------|-------------|
| Click and hover callbacks with tip sets (11, 19) | wrapper today (about 250 lines: datum and coordinate hit tests, circular polar fit, mapping by tip ranges); upstream `onNodeClick` would remove it | wrapper done; upstream patch days | yes; fork patches LGPL |
| Highlight, focus, viewport (5) | wrapper over search and shortcut keys, done; zoom and pan reset on every `applyViewState` and focus is O(tips): needs a fork (focus/zoom-to API, label culling) | fork, 1 to 3 weeks | LGPL |
| Clade colouring (20) | wrapper on `node.color`; a redraw method would be cleaner | wrapper done | yes |
| One instance, global key and wheel handlers (12) | no wrapper fix; container-scoped handlers and per-viewer state need a refactor of a 20,000-line closure | fork, weeks, constant merge conflicts | LGPL |
| Hide panel header, overview, nav bar (2) | CSS hiding is a hack; a config key would be small | fork, days | LGPL |
| Custom columns with our own cells and React content (13) | no hook; heat map and alignment can be fed through properties and `mol_seq` | fork, weeks to months | LGPL |
| Deep trees, scale beyond 25k tips (3, 15) | iterative `addParents`; label culling; incremental layout | fork, weeks | LGPL |
| Styling to design tokens (16) | CSS overrides (done, fragile) | wrapper, re-test on each release | yes |

Verdict.
1. Archaeopteryx.js is a full viewer application, not an embeddable component: with about 1,000 lines of adapter it can be launched from React, driven (layout, lengths, search highlight, clade colour, built-in heat map and alignment tracks) and made to report clicks, but every outbound event is adapter-derived and reaches into undocumented internals.
2. It meets the "explore this tree with aligned tracks" story on trees up to a few thousand tips and fails the interaction and scale story: no callbacks, one instance, page-wide key capture, 4 to 12 fps zoom at 1,000 to 10,000 tips on this machine (stub-relative: not worse), first render 3.7 s at 25,000 tips and 6.4 s at 50,000 (12.8 s under heavier load), stack overflow on 10,000-deep trees.
3. Realistic roles: a read-only "Phylogeny" tab with its own panel (LGPL-packaged as a separate file), or a source of ideas; as the component behind occurrence-page highlighting it needs a fork.

## What surprised us

- `applyViewState` always calls `zoomToFit()` and drops collapsed clades unless the whole state is passed back, so even a highlight or a layout toggle resets the viewport; a colour change had to be forced with the PageUp/PageDown font keys to avoid that.
- Reading `node.x`, `node.y` and the d3 datum on `g.node` turns a library with "no click callback" into one with clicks in about 150 lines, and the library draws from the live tree object, so setting `node.color` recolours a clade; both are accidents of the implementation, not API.
- The DOM is tiny at the fit view (456 nodes at 50,000 tips) and enormous as soon as labels are readable (100,365 nodes after focusing a tip in a 50,000-tip tree, 39 s).
- A 10,000-level caterpillar crashes the parser: the "no recursion" rule in our own notes applies to the library too.
- The page-wide key capture includes Ctrl+F; browser find stops working while a viewer is mounted.
- The heat map refuses a single numeric column (`HEATMAP_MIN_COLUMNS = 2`, source), and a tip without a value is drawn as an outlined "not assessed" cell (source, not looked at in a screenshot), which would suit "unmatched tips must be visible".
- Four releases appeared within four days of pinning 3.24.0.

## Corrections to docs/research/archaeopteryx-js.md

- "Bundlers: probable problem ... inferred, UNVERIFIED": confirmed. The Vite build succeeds and the three dependencies are bundled when we import them, but the library does not find them (`require(variable)` is not resolved); the first call then throws "forester.js must be loaded before this call". Setting `globalThis.d3`, `phyloXml` and `forester` before use fixes it (checked with and without, M). The dev server also needs `define: { global: 'globalThis' }`.
- "Mitigation: dispatch `window.dispatchEvent(new Event('resize'))`: UNVERIFIED" and "A hidden tab with display:none at launch would measure zero: UNVERIFIED": both verified. A container resize alone is not followed (stays 834 x 549), a window resize event fixes it (500 x 300); a hidden launch gives a 0 x 0 SVG and recovers after show plus a resize event (600 x 400).
- "UNVERIFIED how far the wheel handler is limited to the tree area": a plain wheel is limited to the tree, a shifted wheel is captured anywhere; Ctrl+F, Ctrl+G, Ctrl+0, Ctrl++, Ctrl+/ and Ctrl+Shift+L are `preventDefault`ed page-wide.
- "Whether the viewport is centred on the first hit automatically is UNVERIFIED": it is not; `applyViewState` with a search resets to fit. Centring needs the documented Ctrl+G ("next search hit") on `document`, which also works as a focus primitive.
- The d.ts says a key left out of a view "keeps its current value": not true for zoom and pan (always reset), nor for `collapsed` and `subtree` (cleared unless given); `searchA/searchB` absent clears, as stated.
- "There is no key that removes the panel; hiding with CSS is conceivable ... UNVERIFIED": `collapseControlPanel` works and `rootOffset` can be reduced (36 px worked); the panel header bar, the overview miniature and the alignment navigation bar (fixed to the viewport) remain.
- "Node menu Select path": verified. The menu has "Select/Deselect Node" and "Select/Deselect All Ext Nodes" (one event for many nodes); it also has Reroot, which changes the topology under any id mapping.
- "Not honoured: font name, node_size, node_transparency": confirmed; honoured ones also confirmed (node_color, node_shape, font_color, font_size, font_style).
- "A 50,000-node tree opens in a third of a second" (changelog) is not reproduced: about 3.7 s for about 50,000 nodes (25,000 tips) here and 6.4 s for 50,000 tips (12.8 s in an earlier unsaved run at load 18) (P-scale, M, with the no-GPU caveat).
- "Heat map from numeric per-tip properties (two or more)": confirmed and sharper: a single numeric column is never drawn.
- "Labels are the remaining per-node element cost": confirmed at the fit view (about 47 label elements) but at readable zoom every tip gets a `g.node` and `text` pair, with no viewport culling.
- Missing from the research: recursion limit on deep trees (about 10,000 levels), Ctrl+F capture, the selection menu including Reroot, `position:fixed` alignment navigation bar, the single-column heat map rule, and that 3.28.0 is already out.
- Licence analysis: the packaging observation is new: by default a bundler merges the library into the app chunk; `manualChunks` can isolate it but the file is minified and wrapped, so "replaceable library" is only approximated; the unmodified-file route needs a different loading path that was not built.
