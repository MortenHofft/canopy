# Taxonium (taxonium-component 2.1.24) (2026-10-19)

**DEMO ONLY, GPL-3.0, not for shipping.** This spike exists to compare Taxonium with the other candidates; nothing here is a recommendation to embed it in gbif.org.

Spike: `spikes/taxonium/` (adapter `src/adapter.tsx`, Newick/TSV writer and layout replica `src/convert.ts`, probes `scripts/`, metadata `spike.json`). Runs and probe output: `spikes/results/taxonium/`. Library: npm `taxonium-component` 2.1.24 (published 2026-02-04), React 19.2.0 exact, deck.gl 9.1.14 bundled inside the package. Library source read at git tag `v2.1.24` and from the package's own source maps (`taxonium_component/src/...`, paths below are relative to that, line numbers omitted because the files are quoted by name).
Machine: 4 CPU Xeon 2.8 GHz, 16 GB, headless Chromium 141 **without GPU (SwiftShader)**, shared with other agents (load average 4 to 9 during most runs below, 1.9 during the `dated` run, so all runs except that one are flagged `noisy` by the runner).

**How to read the numbers.** Software GL makes every WebGL frame slow, so frame rates and everything that waits for frames (click latency measured through the main thread, S10) are pessimistic and say little about a laptop. Usable here: functional results, what the library can and cannot do, load time (mostly worker and CPU work), main-thread JavaScript per interaction step, heap sizes, and relative behaviour. **Could not be judged:** real fps at any size, perceived pan and zoom smoothness at 10k+ tips, click latency on a real GPU. The final sequential run by the main session has to supply those.

Gates: **G1 flag** (GPL-3.0, repo `LICENSE`; the component's `package.json` has no `license` field; 361 packages in the lockfile, all others MIT, Apache-2.0, ISC, BSD, 12 MPL-2.0 from the JBrowse dependency tree, `npm audit --omit=dev`: 0 vulnerabilities), **G2 pass** (static files, worker in the browser, `M`: S1 runs from `vite preview`), **G3 flag** (React **19 only**; the shared shell, written for 18, ran on 19.2.0 unchanged; but it is a whole app in a component with a singleton worker, so "clean mount and unmount" is partial, see B), **G4 pass with caveat** (last commit 2026-10-07, but npm 2.1.24 is 8 months old and `main` differs from the published code, one maintainer; from `docs/research/taxonium.md`, not re-checked).

## Results by dimension

Capability: Y yes, P partial, N no. Evidence: M measured by us, S source, D docs, N not found. Run ids are the files in `spikes/results/taxonium/`; `probeA/B/C` are `probes/probe*.json`.

| Dim | Item | Cap+ev | Notes and evidence |
|---|---|---|---|
| A | Last release, cadence, bus factor | P-S | Unchanged from `docs/research/taxonium.md` (npm 2.1.24 on 2026-02-04, git tag 2026-01-20, ~85% of commits by one person). New: the published 2.1.24 differs from `main` (no `fitToRanges`, different minimap code), so "pin the npm version" and "read main" give different behaviour (S: diff of the package source map against the clone). |
| B | React component | P-M | Default export, props `sourceData`, `query`, `updateQuery`, `configDict`, `sidePanelHiddenByDefault`, `onNodeSelect`, `onNodeDetailsLoaded`. Runs on React 19.2.0 inside the shared shell with no change (M: run 20261019-100606). |
| B | Controlled state | P-M | `query`/`updateQuery` are genuinely controlled (search specs, enabled flags, colour field, x axis): we drive highlight through them (M: S5). Camera, selection, colour mapping and settings are internal `useState` (S: `useView.tsx`, `useSettings.tsx`). |
| B | Several instances | N-M | Module-level worker plus global callbacks (S: `useLocalBackend.ts`). S13: two instances mount, but a click in instance 0 gives 0 events after instance 1 loaded its tree (M: 20261019-100606 S13, fail). |
| B | Clean unmount | P-M | React side clean: DOM back to baseline, canvases 0, main heap +2 MB over 5 cycles (S13). But the **worker is never terminated and keeps the last tree**: worker heap 35 MB after a 100k-tip tree, still 35 MB after unmount, freed only when another tree is uploaded (probeC, with forced GC through CDP). Every mount also leaves one idle extra worker (0.3 MB). The main thread keeps about 62 MB after a 100k tree is unmounted, most likely the module-level `rgb_cache` in `useColor.tsx` (a key per distinct colour value; S: code, M: heap; the attribution is inferred). |
| B | Bundle | M | `dist/` 9.3 MB, gzip 2.9 MB. Entry chunk 2.9 MB (981 kB gzip); the 4.4 MB JBrowse chunk exists but is **not requested** at runtime when Treenome is off (probeA: 1 JS request). |
| B | SSR | U | Not tested; it reads `window` at module load (`getDefaultQuery.ts`, `useView.tsx`). |
| B | Global side effects | N-S | `window.alert` on load errors and for >6M nodes (`useLocalBackend.ts`); the worker and `filtering.js` write several `console.log` lines per query (seen in every run); `window.cc` cache object (`useColorBy.tsx`). |
| C | Tip click | Y-M | `onNodeSelect(node_id)` then `onNodeDetailsLoaded(node_id, details)`; details carry `name`, `is_tip`, `num_tips`. S2 pass (4 of 4 tips), React state and map panel updated (20261019-100606). The event reaches us only after the worker answered the details request. |
| C | Internal node click | P-M | There are **no node markers**; an internal node is selected by clicking its branch line (`pickingRadius` 10 px). S3 partial: right node and right tip set in 4 of 4 clades, but the tip list is **adapter-derived** (details only have `num_tips`, which matched the TreeModel in every payload). The root has no edge, so it cannot be selected. With the library setting "internal node dots" (Library option) the dots are also pickable. |
| C | Branch click vs node click | P-M | Same selection; cannot be told apart (reported as `nodeClick`). |
| C | Hover | N-M | No prop. The library draws its own tooltip and ring (a large serif tooltip showing the node name and metadata columns) but nothing reaches React (probeA: 0 events after hovering a tip). |
| C | Highlight from outside | P-M | `query.srch` with a `text_per_line` search on `name`: red rings appear 542 ms after the call (500 ms debounce plus worker), clear is immediate (`visible:false`, probeA). Fixed colour list, case-insensitive match, 10k result cap. S5 pass. |
| C | Focus / zoom to node | P-M | **No prop.** `query.zoomToSearch` is read only when the component mounts (`useState(query.zoomToSearch)` in `useSearch.tsx`), so it cannot refocus a loaded tree. The adapter calls the library's own `view.setViewState` found through React fiber props of the inner `Deck`: instant, no animation. S5 pass (tip 2% off centre horizontally, 0% vertically; siblings and parent clade visible). |
| C | Tip as link | P-M | WebGL labels cannot be links; DOM overlay of real `a[href][data-tip-id]` on rows at least 8 px tall. S6 pass. |
| C | Keyboard, screen reader | N-M | S14 partial: Tab reaches 2 elements (a div and a button), none named like a tip, 0 of 2 with accessible names. Canvas only. |
| C | Viewport control, URL state | N / P | Viewport: no prop. `query` is a URL-style object (search, colour, axis) so those parts can round-trip. |
| D | Hide features | P-S | Official: `sidePanelHiddenByDefault` (leaves a toggle strip); minimap toggle is a setting. Not hideable by prop: zoom/camera/settings buttons, Taxonium logo link, colour legend. The legend is hidden by a CSS selector (recorded in `spike.json`). |
| D | Clade colouring | P-M | Only **tip dots** change colour (all branches share one colour, `settings.lineColor`; S: `useLayers.tsx`). Route: unique key per tip in a TSV column, and the key-to-RGB map pushed through the library's `setAdditionalColorMapping` (fiber props). `configDict.colorMapping` cannot be used for this: it is merged once at load (`useConfig.tsx`) and then copied by spread. S4 **fail** at the fit view of 1,000 tips: with fewer than 3,000 nodes the library draws a grey 1 px outline on every dot and the dots overlap 4 to 1, so the fill is hidden (0.00% red). Zoomed in the colour is visible (probeA: 0 to 34 red pixels in a 2-tip clade box; screenshot 2) and at the fit view of 1M tips the minimap shows it. S15 pass, but see F. |
| D | Per-node style callbacks | N-S | None. The accessors are internal to `useLayers.tsx`. |
| D | Custom columns, React content per tip | N-S | None (S7, S8 unsupported). Metadata columns appear only in the hover tooltip and as a colour-by field. |
| D | CSS tokens, dark mode, fonts | P-M | Background (host CSS), branch, label and dot colours from the GBIF tokens through the settings setters (fiber). S9 pass (luminance 226 to 74, tokens applied). Not possible: label font (hard-coded Roboto in `TextLayer`), highlight colour, selection and hover rings (fixed black), tooltip, minimap and button chrome (hard-coded Tailwind greys, white). Full list in `spike.json`. |
| E | Layouts | N-S | Rectangular only (S12 unsupported). |
| E | Branch lengths | P-M | Always laid out with lengths (`useDistances = true` is forced in the worker). Cladogram = Newick written without lengths + remount (205 ms for 1k tips, probeA). S11 pass: tip x correlates 1.000 with root-to-tip length, ultrametric tips aligned, missing/negative lengths render. |
| E | Scale bar / time axis | N-S | None for Newick. `x_time` exists only for jsonl and Nextstrain input, so `xType` cannot switch a Newick tree (S: `processNewick.ts`). Dated Newick/Nexus trees therefore get no axis. |
| E | Minimap, overview | Y-M | Built-in minimap of the whole (de-overplotted) tree with a viewport box. S10 at 1k tips: whole tree reachable in 3 wheel notches. It covers the top 36% right 20% of the view, so tips under it cannot be clicked (the adapter's `locate` treats that area as blocked). |
| E | Semantic zoom / LOD | P-M | Pixel-cell de-overplotting by y-range (`filtering.js`): at 1M tips 27,163 of 2M nodes were drawn at the fit view (probeB), but at 190k real GTDB tips **157,854 of 379,601 nodes** (probe via S1, 20261019-102425): non-ultrametric trees reduce poorly. No clade aggregation. |
| E | Export | P-S | PNG and SVG buttons exist (research). Not exercised. |
| F | 1k tips | M | firstRender 2.1 s (this load average), JS per step 20 ms, heap 25 MB (20261019-100606). Runner status `timeout` because of software-GL frames (88 to 95% of the time in frames over 50 ms) and click latency 1.7 s under load. |
| F | 10k tips | M | firstRender 2.2 s (synthetic), 2.4 s (OTL amphibia 10,018), main-thread JS per step 36 ms, heap 34 to 40 MB, click-to-event 4.0 to 5.3 s (software GL), 20261019-101530. |
| F | 100k tips | M | firstRender 7.2 s (adapter writing the Newick and TSV 0.19 s, shared parse 0.28 s), JS per step 140 ms, heap 117 MB; S10 timeout (longest frame gap 3.4 s while zooming out); worker holds 35 MB (probeC); 20261019-101917. |
| F | 190k tips (GTDB) | M | **Loads**: firstRender 26.0 s (above the 10 s threshold), main heap 265 MB, Newick 9.4 MB; the scripted interaction did not finish within 600 s in software GL, 20261019-102425. |
| F | 1M tips (synthetic yule, 41 MB Newick) | M | **Loads**: firstRender 19.9 s (first data 13.4 s; adapter writing Newick and TSV 2.3 s, shared parse 1.3 s), main heap 582 MB, 27k nodes drawn at the fit view, click on a focused tip reached React in 985 ms, probeB. Recolouring a clade costs 0.46 s to build the colour map plus about 3 s until committed, and blocks the main thread for 2.5 s (the map has one entry per tip). Single run, no repetition. |
| F | With 3 custom columns | N | Not applicable (no columns). |
| G | Formats read | P-M | Newick yes; Nexus **poor** (see below); phyloXML, NeXML no; also jsonl, Nextstrain JSON. Quoted labels are not understood by `kn_parse`, so the adapter writes sanitised Newick and maps names back. |
| G | Nexus, ran on the library's own code | M | `parse-probe.jsonl` (library `nexusToNewick.ts` and `kn_parse` from tag v2.1.24 run on `data/rich` files): the `TRANSLATE` table was **not applied** to the Carangaria MCC and corvoid MCC trees (tips stay `1`, `361`, ...), a hand-made file with quoted labels and a 3-tree block gave a parse error and 3 of 7 tips, the 100-tree BirdTree file gave 5 tips with a parse error. First tree only by design. |
| G | Newick, same probe | M | Quoted-label file: parse error (`'Puma concolor'` kept with quotes, 5 tips found but error flag 3); polytomy/missing lengths, internal support labels and trifurcating root parsed correctly. The root node's name keeps the Newick terminator (`n0;`). |
| G | Tip labels as join key | P-S | Metadata joins by exact `node.name` (`processNewick.ts`); unmatched rows or tips are not reported to the host. |
| G | Feed from the shared TreeModel | P | No object API. Input is a file: the adapter writes Newick (internal nodes named `n<preorder>`, so the library's node record maps back to our id with certainty) and a TSV. The jsonl format could carry our own node ids, y positions and both `x_dist` and `x_time` (that would make the cladogram toggle a prop change) but was not implemented in this time-box (S: `importing.js`). |
| G | Large-file loading | M | Parsed in a worker; the main thread still has to build and post the strings (2.3 s for 1M). |
| H | Accessibility | N-M | See C. Contrast of the library's own chrome and the fixed black selection ring on dark was not measured. Touch: deck.gl handles pointer events; phone screenshot shows minimap and buttons crowding a 350 px tall tree (`taxonium-5-phone-390.png`). |
| I | Licence detail | P-S | GPL-3.0 repo; component `package.json` without a licence field; `taxonium_backend` and `taxonium_data_handling` declare ISC (conflict, unresolved, from the earlier research); dependencies permissive. Dependencies of this spike: 361 packages, none GPL besides the component itself. |
| J | Cost to adapt | see below | |

### Scenario summary (runner, `spikes/results/taxonium/`)

20261019-100606 (smoke trees): S2 pass, S3 partial (adapter-derived tip sets), S4 **fail** (fit view, see D), S5 pass, S6 pass, S7 unsupported, S8 unsupported, S9 pass, S10 partial (1k), S11 pass, S12 unsupported, S13 **fail** (singleton), S14 partial, S15 pass (see below), S1 timeout on every tree (software GL). 20261019-101530 (10k), -101917 (100k, S1 timeout, S10 timeout), -102425 (190k, S1 timeout at 600 s), and 20261019-104621 (`dated` trees at load average 1.9: S11 pass again including the dated ultrametric check, S13 fail again, S1 timeout on the Carangaria 135, BirdTree 380 and corvoid 680 trees with 82 to 88% of the time in frames over 50 ms in software GL, click latency 0.33 to 1.15 s; calibration Canvas2D reference 270 fps in that run).

S15 note for the main session: the runner reports click-to-paint **-5008 ms** (negative, invalid) and passes the scenario; the click-to-React-commit median was **1864 ms** at 10k tips in software GL, which is not "about 100 ms". The adapter's event only fires after the details round trip to the worker.

## Cost to adapt

| Gap | Route | Effort | Licence |
|---|---|---|---|
| No object tree API | write Newick (or jsonl) from our model | done here (adapter 400 lines incl. layout replica) | fine, input only |
| Camera, colours, settings, hover not exposed | React fiber props (done, fragile) or a fork that adds a `ref`/props | small patch in a fork (`Deck.tsx`, `useSettings.tsx`) | **GPL-3.0: the fork must be published**; a fiber hack avoids forking but breaks on refactors |
| Clade colouring of branches, per-node style | new line layer with per-node colour in `useLayers.tsx` | medium, fork | GPL |
| Several instances | move the worker into a per-instance hook | medium, fork | GPL |
| Terminate the worker, free `rgb_cache` | same fork | small | GPL |
| Hover callback, tip list in payload | `Deck.tsx` and `getDetails` | small, fork | GPL |
| Columns, radial, time axis, robust Nexus | not in the library | large (columns, radial), medium (axis, Nexus: convert before passing) | GPL for anything inside the component |

## Verdict (3 lines)

Taxonium is the only candidate here that loaded 190k real and 1M synthetic tips in the browser, and its worker plus de-overplotting design is a credible large-tree reference, but it is a whole app in a component: no camera, hover or colour API, a singleton worker that never lets go of the last tree, tip colour only, and no columns, radial layout or axis.
Everything the shared demo needed beyond two callbacks was reached through React fiber props, which works on 2.1.24 but is not an API.
GPL-3.0 makes it a demo and a design reference only (deck.gl itself is MIT and is the reusable part).

## What surprised us

1. Colour is hidden at the fit view of small trees: the library outlines each dot with a grey stroke when fewer than 3,000 nodes are drawn, and dense dots stack so only strokes show. The colour works zoomed in and for large trees, where there is no stroke.
2. The viewer is not fitted to its container: the default view is a fixed zoom and target; fitting needs the camera (not available as a prop).
3. The library's own `console.log` per query and the node-name tooltip make an adapter naming scheme (`n<id>` for internal nodes) visible to users unless it is hidden.
4. The same code that loads 1M tips in 20 s keeps 35 MB of worker heap per 100k tips alive after the component unmounts, until another tree replaces it.
5. At 190k real tips the de-overplotting drew 158k of 380k nodes at the fit view, while at 1M ultrametric tips it drew 27k.

## Corrections to `docs/research/taxonium.md`

- "External highlight and zoom only through `query.srch` and `zoomToSearch`": `srch` works as a controlled prop (M, S5); `zoomToSearch` does **not** work after mount (initial value only, S), so there is no external zoom at all without reaching into internals.
- "React 19 only": confirmed; the shared shell needed no change on React 19.2.0.
- "module-level singleton worker": confirmed by running it (S13 fail), and the worker is also never terminated and retains the last tree (new, probeC).
- "Open question: can the side panel and chrome be hidden by CSS only": `sidePanelHiddenByDefault` hides the panel but leaves a strip; the minimap, buttons, legend and logo remain; the legend can be hidden by a CSS `:has()` selector.
- "Unmount cleanup: UNVERIFIED": measured, see B.
- "Does `query.srch` text_exact highlight a tip": yes; use `text_per_line` for sets (at most 10k results); matching is case-insensitive, so tips that differ only in case collide.
- "Node object not passed on click (id only)": confirmed, and `node_id` is an index into the library's y-sorted array, not stable across loads; the details record carries the Newick name.
- "Nexus: only first tree, one translate pair per line": measured worse: real MCC files with tab-separated TRANSLATE were not translated at all, and multi-tree or quoted files gave parse errors.
- "Newick parser `kn_parse` quoting/NHX behaviour not tested": quotes are not handled (parse error flag on the quoted-label file); `[&...]` comments become `meta_*` fields; the root name keeps the `;`.
- "Does the component work for 100k-1M": measured, see F (190k real: 26 s load; 1M synthetic: 20 s, 27k nodes drawn; both in software GL, interaction speed not judged).
- "No code-level imperative focus API": still true; the camera state (`view.setViewState`) is reachable through fiber props.
- The earlier research read repository `main` (commit `68b5287`); the published 2.1.24 differs from it (no `fitToRanges`, different minimap and useView code).
- "bundle size UNVERIFIED": entry chunk 2.9 MB (981 kB gzip), 9.3 MB total with lazily loaded chunks, JBrowse chunk not requested without Treenome.

## Evidence and reproduction

`cd spikes && node runner/run.mjs --candidate taxonium --trees smoke --port 5207`; probes: `node spikes/taxonium/scripts/probeA.mjs` (1k features, needs `vite preview` on 5207), `probeB.mjs synthetic/newick/yule_1000000.nwk yule1m` (1M tree, git-ignored, generated with `python3 -I data/synthetic/generate.py --sizes 1000000 --shapes yule`), `probeC.mjs` (worker heap through CDP), `parse-probe.mjs` (library parsers; copy `nexusToNewick.ts` and `jstree.js` from the tag next to it). Screenshots: `spikes/results/taxonium/screens/taxonium-*.png` (fit 1k, zoom with colours, highlight and a selected branch, tip links, dark, 390 px phone).
