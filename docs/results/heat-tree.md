# Heat-tree 0.3.1 with our own React wrapper (2026-10-19)

Spike: `spikes/heat-tree/` (adapter and test API in `src/adapter.tsx`, metadata and styling facts in `spike.json`, probe scripts in `measure/`). Runs: `spikes/results/heat-tree/` (ids below), screenshots in `spikes/results/heat-tree/screens/` (`demo-*` and `phone-390` from the dev server on port 5309; the rest are runner output). Pinned: `@grunwaldlab/heat-tree` 0.3.1 (d3 7.9.0, vanilla-picker 2.12.3 through the lockfile), React 18.3.1, Vite 5.4.11. Chromium 141.0.7390.37, headless, **no GPU**, 4 CPUs shared with two other agents (**load average 5.6 to 9.2 during every run, all runs are marked noisy by the runner**). The library source was read from the shipped source map of the npm tarball (`dist/heat-tree.es.min.js.map` carries `sourcesContent` for all 16 modules, so this is the code that runs, not a repo checkout); repository facts were read from `raw.githubusercontent.com` on 2026-10-19. Everything is evidence **M** unless marked otherwise. Frame-rate numbers are not used for conclusions (load); main-thread CPU per interaction step, load time and heap are.

## Gates

- **G1 Licence: flag (MIT declared, no licence file in the package or the JS repo).** `package.json` `"license": "MIT"` (registry and tarball), README "## License MIT". The 0.3.1 tarball contains only `dist/`, `package.json` and `README.md` (M, `ls node_modules/@grunwaldlab/heat-tree`). The JS repo `grunwaldlab/heat-tree` on `main` has **no LICENSE or LICENSE.md** (HTTP 404 for both, `README.md` and `package.json` return 200; 2026-10-19). The R package `grunwaldlab/heattree` declares `License: MIT + file LICENSE` and its `LICENSE` file is the CRAN stub (`YEAR: 2026`, `COPYRIGHT HOLDER: Zachary Stephen Longiaru Foster, Niklaus Grunwald`), so the intent is MIT with those holders. Production dependencies: d3 7.9.0 (ISC), vanilla-picker 2.12.3 (ISC); the lockfile's production licences are BSD-3-Clause, ISC, MIT, Unlicense; `npm audit --omit=dev`: 0 vulnerabilities. For GBIF legal review: ask the authors for a LICENSE file in the JS repo and the tarball (a one-line issue).
- **G2 Browser-only: pass.** Static files, no server.
- **G3 React-embeddable: pass with a flag.** Imperative `heatTree(el, trees, options)` only; no component, no `destroy()`, no types, options read once at creation. A naive wrapper throws an uncaught `NotSupportedError: Failed to read the 'value' property from 'SVGLength'` when unmounted within a pending d3 transition (found in S13, fixed in the adapter, see Integration).
- **G4 Not abandoned: pass with a flag.** npm: created 2026-01-06, six versions, last 0.3.1 on 2026-04-16 (six months ago); 63 downloads in the last month (2026-09-17 to 2026-10-16, npm API); one lab (Oregon State), one main author. The earlier research found the last commit on 2026-05-08 (not re-verified, no GitHub API access).

## Scenario results (runner)

| S | Scenario | Result | Run | Notes |
|---|----------|--------|-----|-------|
| S1 | Load and fit | pass at 200 tips; **sluggish at 1k** (CPU 53 to 56 ms per step); **unusable at 10k (load 273 s)** | smoke `20261019-102729`, `-101306`; real and dated `-102102`; 10k `-100909` | 200: load 448 to 463 ms, CPU 14.5 to 16 ms/step, click 6 to 7 ms, heap 5.7 MB. 1,000: load 1.9 to 2.6 s, CPU 53 to 56 ms/step, click 8 to 17 ms, heap 9.5 MB. 10,000: 273 s load (135 s of it inside `heatTree()` before the first paint rest), under load 5.7. `edge-quoted-labels`: **fails** (library parse error) |
| S2 | Click a tip | **pass** | `-102729` | 4 of 4 tips, via a capture listener on the open shadow root |
| S3 | Click internal node, tip set | **partial** | `-102729` | 4 of 4 nodes right, tip sets right, but `adapter-derived` (the library emits nothing) |
| S4 | Colour clades from React | **pass** | `-102729` | 38,894 pixels moved towards the colour in a 193-tip clade, no layout change (DOM delta 0) |
| S5 | Highlight and focus | **pass** at 10k (`-101306`, took about 124 s), **timeout at 10k** in the final run (`-102729`, over 150 s: the 10k mount plus load), **pass at 1k** (`-103540`, ad hoc) | see left | 1k: off centre dx 29%, dy 2.6% (uniform zoom keeps the whole tree width visible, so the tip is not horizontally centred); 953 highlight pixels |
| S6 | Tip as link | **pass** | `-102729` | real `<a href data-tip-id target=_blank tabindex=0>` overlay, new tab opened (reported partial: overlay) |
| S7 | Custom column | **partial** | `-102729` | no aligned columns; the **text** column (country) drives the label colour: 17 of 17 labels aligned at the fit view (max dy 0.78 px), 17 of 18 after zoom and pan; tips without a TSV row get no cell (18 unmatched tips) |
| S8 | Alignment column | **unsupported** | `-102729` | no sequence rendering |
| S9 | Theming | **pass** | `-102729` | luminance 245 to 42, background token on 88% of pixels, branch token on 9,395 pixels |
| S10 | Zoom out to whole tree | **n/a** | `-102729` | the runner needs the middle tip or both end tips on screen at the fit view; Heat-tree's default `autoZoom` ('X') fits the width only, so a 1,000-tip tree does not fit the height (labels have a 12 px minimum). Zooming out by wheel does work (probe: scale 1 to 0.136 shows the whole 1,000-tip tree; `measure/`) |
| S11 | Phylogram / cladogram | **pass** | `-102729` | phylogram Pearson 0.9999; cladogram tips aligned by rewriting branch lengths (workaround) |
| S12 | Radial | **pass** | `-102729` | real polar layout; scale bar drawn at the lower left |
| S13 | Two instances, 5 cycles | **pass** | `-102729` | DOM back to the baseline of 312 nodes, heap growth 2.2 MB over the 5 cycles, no page errors (after the unmount fix; the first run of the unfixed wrapper `-095548` had four uncaught errors per cycle, deleted with its screenshots) |
| S14 | Keyboard | **partial** | `-102729` | the runner sees one focusable element (the shadow host `div`, labelled `group`); the toolbar buttons are focusable inside the shadow root but retargeted to the host; tips are not focusable |
| S15 | Linked view | **timeout at 10k**, **pass at 1k** (305-tip clade: 29 ms to React commit, 110 ms to paint, median of 5) | `-102729`; ad hoc `-102448` | the 1k run used a copy of `run.mjs` with the S15 tree set to `syn-yule-1000` (the runner has no option; `runner/` was not edited) |

Not run by the runner because the shell hands the library clean Newick: Nexus input. I ran the library's own parser (extracted from the source map) on the real files in Node, see G.

## Results table

Capability: Y yes, P partial, N no. Evidence: M measured, S source, D docs, C claimed, N not found, U not looked at.

| Dim | Item | Cap+ev | Notes and evidence |
|---|---|---|---|
| A | releases and cadence | P-M | npm `time`: 0.1.0 2026-01-06, 0.1.1 and 0.1.2 2026-01-09, 0.2.0 2026-01-15, 0.3.0 2026-04-14, 0.3.1 2026-04-16; nothing since |
| A | adoption | N-M | 63 downloads last month |
| A | docs accuracy | N-M | README on `main` and in the tarball still says `npm install heat-tree` (that unscoped package was unpublished on 2026-01-06) and documents `newick:` per tree; the code requires `tree:` and throws `Tree at index 0 is missing tree string` (`src/index.js`). The `docs/guide` pages use `tree:` (research). `dist/` does contain an `.iife.min.js` (research said only umd/es) |
| B | React integration | P-M | no component; wrapper is one `useEffect` (create), effects per prop. About 700 non-comment lines for the adapter including the test API and the workarounds |
| B | controlled state | P-M | only `layout` is a supported setter (`TreeState.setLayout`). Colour, highlight, lengths, columns and focus go through adapter workarounds on library internals (see C, D, E); options are read once at `heatTree()` |
| B | several instances | Y-M | S13 pass; each call has its own shadow root; each call also appends a hidden 5000x5000 `div` (text measurement) to `document.body`, which the adapter removes |
| B | clean unmount | P-M | no `destroy()`. A pending d3 `zoom` transition or the debounced `ResizeObserver` `fitToView` runs on the detached SVG and throws uncaught `NotSupportedError ... Could not resolve relative length` (d3-zoom `defaultExtent`). Adapter sets `autoZoom`/`autoPan` to `None`, interrupts the transitions and calls `TreeView.destroy()` before removing the host: 0 errors, DOM baseline restored. The `ResizeObserver` is not exposed and is left to garbage collection |
| B | SSR | U | not tested |
| B | bundle | P-M | +186 KB minified, **+54 KB gzip** over the stub (409,224 B / 125,877 B gz versus 223,615 B / 71,752 B gz, both with React and the shell; run `-102729`). d3 is bundled; the package is 343 KB minified in `dist/heat-tree.es.min.js` |
| B | ESM and types | P-S | ESM and UMD builds; no `types` field and no `.d.ts` (adapter declares the module as `any`) |
| C | tip click | P-M | no callback. Capture listener on the open shadow root reads the d3 datum (`__data__`) of the library's `.tip-hit` path; `source: adapter-derived`. The library also opens its selection box and action buttons (collapse, hide, rotate) |
| C | internal node click with tip set | P-M | no callback and no node markers. The library draws one transparent hit region per clade (a clade-sized box or wedge, deeper clades on top); clicking anywhere inside selects the deepest one. The adapter finds a click point in the strip between a node and its nearest child. The tip set is computed from the shared TreeModel (S3 partial) |
| C | branch click | N-M | not clickable; a click on a branch selects the enclosing clade region |
| C | hover | P-M | `mouseover` on `.hit`/`.tip-hit` through the shadow root; tooltip drawn by the shell (probe: `tipHover n201 source=adapter-derived`, tooltip shows the tip name) |
| C | tip label as real link | P-M | S6 pass with an HTML `<a>` overlay over up to 400 visible labels, repositioned on every zoom event through a namespaced d3-zoom listener (`treeZoom.on('zoom.adapter')`) |
| C | programmatic highlight | P-M | class on the library's tip-label `<text>` (bold, primary colour, halo by `paint-order: stroke`); no marker or row band possible without more DOM work |
| C | focus / zoom to node | P-M | no API. Adapter builds a d3-zoom transform and applies it through `TreeView.treeZoom` (public field, undocumented). Zoom is uniform, so the transform keeps the whole tree width visible and only centres the row vertically |
| C | built-in selection, search | P-S/N | selection of one node or clade with action buttons: yes (S). **Search: not found** (the word does not occur in any of the 16 source modules) |
| C | keyboard | N-M | none in the library; S14 partial |
| D | hide built-in UI | **N-S** | **No option hides or omits the control panel.** `src/index.js` always creates `.ht-toolbar` and `createToolbar(...)`; the only option related to it is `buttonSize`. The demo's "Show Heat-tree control panel" option is listed in Library options as unsupported with this reason. Hiding it with CSS in the shadow root would work technically but the contract does not allow it as a pass. The panel starts collapsed to a tab row (Data, Controls, Tree, Tip Labels, Export) |
| D | clade colouring | P-M | S4 pass through inline `stroke` on the library's branch paths and `fill` (important) on tip-label text; re-applied after `TreeState` `coordinateChange`. There is no per-node style callback |
| D | per-field visual mapping | Y-M | the library's strongest feature. `TreeData.addTable(tsv)` plus `TreeState.setAesthetics({tipLabelColor, tipLabelSize, tipLabelText, tipLabelFont, tipLabelStyle})`: our TSV text column mapped to label colour with the GBIF categorical palette (`Aesthetic.updateState({colorPalette})`), a numeric column to label size, with legends. Tip columns, shapes and node symbols cannot be mapped (labels only). Unmatched TSV rows are ignored silently; tips without a row get the null grey and a legend entry (S) |
| D | aligned columns | N-M | none. S7 is partial only because a column can be shown as label colour; S8 unsupported |
| D | CSS tokens, dark mode | P-M | page CSS cannot reach the default shadow root. Values from `gbifTheme()` are set as custom properties on the host and consumed by a `<style>` appended to the open shadow root, which overrides the library's `--color-*` variables and hard-coded rules (the toolbar colours are hex values, not variables: tabs, panels, buttons and toggles are overridden one by one). `isolation: 'none'` avoids the shadow root but injects the library's global stylesheet into the page. The adapter hard-codes class names of an undocumented DOM |
| D | fonts | P-M | tip label font is a metadata mapping in the library; the adapter forces the GBIF body font and italic by CSS, so the library's text-size estimator (which measures with `sans-serif`) is slightly off. A single category cannot be mapped to italic (`CategoricalTextScale` assigns the first output value, `normal`, to the first category) |
| E | layouts | P-M | rectangular and circular (S12 pass); no unrooted |
| E | phylogram / cladogram | P-M | no cladogram mode. Adapter rewrites `node.data.length` on the d3 hierarchy (height difference, tips aligned) and calls `TreeState.update()`; restores the original lengths. Trees without lengths get these synthetic lengths automatically. S11 pass |
| E | scale bar | Y-M | a branch-length legend is always drawn under the tree |
| E | collapse, hide, rotate | Y-S/M | built-in buttons per selected clade (collapse, collapse root, hide, rotate); no semantic zoom or level of detail |
| E | overview or minimap | N-S | none |
| E | export | P-S | SVG and PNG (`exporter.js`); **no Newick export** in the exporter (the research marked it unverified: not found). Not clicked through in the browser |
| F | scale (see S1) | M | load grows quadratically: random trees 500 tips 0.44 s, 1,000 0.70 s, 2,000 2.8 s, 4,000 11.6 s, 5,000 16.6 s (+1.9 s to first paint), 10,000 about 135 s inside `heatTree()` (273 s to load, `-100909`), all under load 5 to 7. CPU profile at 2,000 tips (`measure/profile-mount.mjs`): about 42% in `leaves()` called inside the per-node loop of `TreeState.updateCoordinates` (`d.yPx = d.y * this.displayedRoot.leaves().length * ...`, `src/treeState.js:591`), 18% in `getBoundingClientRect` (text measurement). Per-step CPU: 135 tips 13 ms, 200 tips 14.5 to 16, 380 tips 29, 680 tips 43, 888 real tips 76, 1,000 tips 53 to 56. Heap 5.3 MB (135) to 9.5 MB (1,000). Not run: 100k and above (skipped by the rule, the 10k rung was 27 times over the load threshold) |
| F | custom columns at scale | U | not measured above 1k (S7 at 1k only) |
| G | formats | P-M | Newick, Nexus (`#NEXUS` first line); no phyloXML, NeXML, NHX. The library's own parser, run in Node on the repo's files: BirdTree multi-tree NEXUS **100 trees parsed, 380 tips each**; `edge-multi-tree-nexus` 3 trees, TRANSLATE applied, **but quoted names keep their quotes** (`'Puma concolor'`, `'O''Brien''s fox'`); **Carangaria and corvoid BEAST MCC Nexus fail** (`Unexpected character at position 102516: ','`, the `[&...]` annotations); translate keys must be numeric. For Newick `'A b':1` or `'C,d'` gives wrong labels and `edge-quoted-labels` fails in the runner. Tip labels from quoted names therefore cannot be joined to GBIF |
| G | depth | P-M | `parseNewick` and `applyTranslate` are recursive: a 5,000-deep caterpillar parses, **10,000 deep throws `RangeError: Maximum call stack size exceeded`** (M, Node) |
| G | metadata join | P-S | exact string match, ID column auto-detected as the column with most matches; unmatched rows and tips are not reported as such |
| H | accessibility | N-M | no ARIA or keyboard in the library; S14 partial; at 390 px width the toolbar's hamburger overlaps the last tab (`screens/phone-390.png`) |
| I | licence detail | P-M | see G1 |
| J | cost to adapt | see below | |

## Cost to adapt

| Gap | Route | Effort | Licence ok? |
|---|---|---|---|
| Click, hover, select callbacks with tip sets | patch (emit from the hit-area handlers and the selection method in `treeView.js`); today the shadow-root workaround works but is adapter-derived | small patch, but the project's selection model is single-node with built-in buttons | MIT as declared, confirm file first |
| Highlight, focus, programmatic clade colour | patch (state fields and a zoom helper) or keep the DOM workarounds | small to medium | same |
| Hide the control panel | patch (an option in `index.js`) | small | same |
| Scale: the `leaves()` call inside the per-node loop | patch (compute once, hoist out of the loop); would remove the quadratic term but not the SVG count | small for the loop, large for 10k+ (SVG with a group per node, no level of detail) | same |
| Quoted labels, BEAST annotations in Nexus, deep trees | replace `parsers.js` and `nexusParser.js` by our own iterative parser (the shared `newick.ts` exists) | small | yes |
| Aligned columns, 100k tips, semantic zoom | rewrite of `TreeView` | large | n/a |

## Verdict

1. Heat-tree is a good-looking, self-contained report widget whose own control panel and metadata-to-colour/size mapping work, but it gives the host page no events, no highlight and no focus; every demo control except layout is an adapter workaround on its shadow DOM, and the control panel cannot be hidden.
2. It does not scale: first render is quadratic (1k tips 2 s, 5k tips 17 s, 10k tips minutes), 1k tips is already sluggish to pan, and its parsers fail on quoted labels, BEAST annotations and 10,000-deep trees.
3. Not a candidate for the embedded gbif.org viewer; useful as a UX reference (per-field legends, collapse and hide of clades) and for its colour-by-metadata mapping.

## What surprised us

- The quadratic cost is a single `leaves()` call inside a per-node loop, not rendering.
- Everything the library keeps in a shadow root is still reachable: clicks, hover and the d3 datum of every hit area (`__data__`) can be read from outside, which is why S2 to S4 pass at all; the runner sees only 5 light-DOM nodes (`getStats`), I added the shadow counts to `custom`.
- A click selects a clade-sized region, not a node: there are no node markers, so "click this node" is a point in the gap between a node and its first child, which is sub-pixel at the fit view of deep nodes.
- Uniform zoom and the 12 px minimum label size: the fit view of a 1k tree shows only about 40 tips, so the runner's whole-tree checks (S10) cannot be applied.
- A naive React unmount throws uncaught errors from d3-zoom on the detached SVG.

## Corrections to docs/research/heat-tree.md

- "Nothing was executed": now executed. Confirmed: SVG with d3, Shadow DOM, rectangular and circular only, no callbacks, no highlight/focus API, no destroy, README errors.
- **Rendering and scale:** "no numbers published" is replaced by measurements above. The research said "small to medium tree tool"; it is quadratic in the layout step and unusable at 10k tips.
- **Newick parser:** confirmed naive, and additionally **recursive** (stack overflow at 10,000 depth). The research expected comment text to leak only for a single token; in fact BEAST-annotated Nexus files fail outright.
- **Nexus:** "best Nexus handling" holds only for plain multi-tree and TRANSLATE files (100-tree BirdTree file parsed); quoted names keep their quotes and annotated MCC trees fail.
- **Export:** SVG and PNG only; no Newick export found in `exporter.js` (the notes-based claim stays unverified).
- **Licence:** confirmed as "MIT declared, no LICENSE file in the JS repo", and additionally **not in the npm tarball**; the R package's LICENSE is the CRAN stub naming Foster and Grunwald.
- **Unscoped package and CDN:** `dist/` does have `heat-tree.iife.min.js`; only the README's package name and CDN path are wrong.
- **React usage:** the research flagged `document` listeners from the colour picker (`aesthetic.js:633-634`). They are added when the toolbar builds a continuous-colour range slider and are never removed; none are added at mount or by our mappings, and I did not open that editor (so unverified in use). The unmount problems actually measured are the hidden `div` appended to `document.body` per instance and the pending d3 transition and `ResizeObserver`.
- **New:** the control panel cannot be hidden; toolbar colours are hard-coded hex values; downloads 63 per month.

## Reproduction

`cd spikes/heat-tree && npm ci --ignore-scripts && npm run build`, then `node spikes/runner/run.mjs --candidate heat-tree --trees smoke --port 5209`. `measure/probe.mjs` plus `measure/scale-probe.js` repeat the load-time scaling on random trees against the dev server; `measure/profile-mount.mjs` is the CPU profile; `measure/nexus-parse-test.mjs` runs the library's parser files (copied out of the source map into a scratch directory with a stub `utils.js`) on the Nexus files.
