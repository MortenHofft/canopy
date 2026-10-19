# Reactree (reactreejs) 1.0.3 (2026-10-19)

Spike: `spikes/reactree/` (adapter `src/adapter.tsx`, about 760 lines; `spike.json`; exact versions plus `package-lock.json`, installed with `npm install --ignore-scripts`). Runs: `spikes/results/reactree/` (runner JSON, `screens/`, `probes/` with the manual Playwright scripts and `manual-probes.json`). Library source was read from the source map shipped in the npm tarball (`dist/index.mjs.map` contains `sourcesContent`, the same files as the repo at the research commit), not from a clone.

Machine: 4 CPU Xeon 2.8 GHz, 16 GB, headless Chromium 141.0.7390.37 **without GPU** (software raster), shared with two other agents (load average 0.7 to 7 during the runs; the final smoke run started at 0.7 and ended at 2.7, not flagged noisy). The tree is SVG, so the missing GPU matters less than for canvas, but software SVG raster is slow: **absolute frame rates and times are pessimistic, and the main session will make the final sequential measured run**. The numbers below that do not depend on load: DOM node counts, heap, JS time, what crashes, what the library does.

Run ids (`spikes/results/reactree/<id>.json`): **R1** `20261019-110442` (final smoke run S1 to S15 on the smoke trees), **R2** `20261019-100553` (S4, S9, S15 with the 197-tip tree as functional tree), **R3** `20261019-101156` (S1 on 200, 680, 888, 1,000 tips), **R4** `20261019-103119` (S1 on 10,000-tip Yule and 1,000-tip caterpillar), **R5** `20261019-104727` (S1, 10,000-tip caterpillar), **R6** `20261019-105514` (S1 edge trees), **R7** `20261019-105700` (S1 dated trees), **R8** `20261019-105850` (S1 align trees). **P** = `manual-probes.json` and `probes/` (my own scripts, not the runner; same Chromium, same machine, evidence M).

## How the adapter works (nothing is patched)

Reactree has three props (`newick`, `fasta`, `defaultHeight`), no callbacks, no ref. Every capability beyond "draw this Newick" is driven through the DOM the library produces, so every one of them is `partial` at best. The mechanisms, all checked by running them:

| Need | Mechanism | Result |
|---|---|---|
| Click and hover on tips, nodes, branches | capture-phase listeners on our wrapper; the clicked `circle.r-hit`, `path.b-hit` or `text.leaf-label` carries the d3 datum in `__data__`; its leaf names (`d.data.children`, iterative) are mapped to the shared `TreeModel` by name (MRCA); events are `source: 'adapter-derived'` | works (S2 pass, S3 partial by definition); clade is checked to be exactly a clade of the shared tree (`exactClade`) because the library can reroot and ladderize |
| Library's own response to a click | tip: opens its node-info panel (left alone); internal node: collapses to a named triangle and opens its clade editor. The adapter stops that click in the capture phase unless the "Library collapse" switch is on, otherwise the demo's colour-on-click would also collapse every clade | both verified (screenshots in the demo, `probes/d8.mjs`) |
| Layout, phylogram/cladogram, labels, search panel, alignment panel, truncate | click the library's own toolbar buttons (`button[title=...]`) inside `flushSync` from a microtask | works; no prop exists |
| Clade colour | library colour mode driven from outside: click the Color button, click a palette swatch, dispatch `click` on the d3-bound hit circles of the wanted nodes (one batched state update, one rebuild per colour), click Color again. Removal uses the Erase swatch or Clear all | works, but **only the 12 palette colours exist** (the adapter picks the nearest to the requested colour); costs one full SVG rebuild per colour group |
| Highlight tips | our own `<circle class="rt-hl">` inserted into the tip group, re-applied by a `MutationObserver` after every library rebuild | works; the library's own search highlights one substring only and is not used for this |
| Focus a tip | synthetic `wheel` and `mousedown/mousemove/mouseup` events fed to the library's d3-zoom (zoom to about 24 px row pitch, then drag the tip to the middle) | works on 10,000 tips (S5 pass) |
| Tip as link | each `text.leaf-label` wrapped in an SVG `<a href data-tip-id tabindex=0>` after every rebuild | works; all tips are in the DOM, so all are links (S6 pass) |
| Alignment column | one `alignment` column becomes the `fasta` prop; the panel is opened by clicking its toolbar button | rows line up with the tips to 0.0 px at the fit view and after zoom and pan (S7, S8) |
| Dark theme | the library's documented `data-theme="dark"` on `<html>` | works, global attribute |
| Tokens | `--clr-*` and `--font-family` mapped to GBIF tokens in CSS on `:root`; hard-coded tree colours re-themed with CSS attribute selectors on their exact hex values | works for chrome and tree, not for the alignment canvas (see styling in `spike.json`) |
| Library-specific toggles (demo "Library options") | library collapse, search panel, align labels, node labels, truncate names, "keep browser find" (stops the library's Ctrl/Cmd+F hijack) | all verified by hand (`probes/d8.mjs`, `probes/d12.mjs`) |

## Gates

**G1 pass.** MIT (`package.json`, `LICENSE`). Dependencies installed by `npm install` (83 packages incl. dev tooling): d3 modules ISC and BSD-3-Clause (`d3-ease`), jsPDF MIT with optional dependencies that npm installed and the bundle includes as lazy chunks: `dompurify` (MPL-2.0 OR Apache-2.0), `pako` (MIT AND Zlib), `rgbcolor` ("MIT OR SEE LICENSE IN FEEL-FREE.md", a non-standard licence file: **flag for legal review**), `html2canvas`, `canvg` family. All permissive or dual-licensed; the PDF export chunks are only loaded on PDF export (dynamic `import('jspdf')`). **G2 pass** (client only, static build; `npm run build` works under a sub-path). **G3 pass with reservations**: a React 18/19 component that mounts and unmounts cleanly (S13), but it is not controllable (no props beyond three, a changed `newick` resets all state) and has a window-level key handler. **G4 flag**: last release 1.0.3 on 2026-04-27, nothing since (checked on npm 2026-10-19), 47 downloads in the last month (npm API, 2026-09-17 to 10-16); inside the 12-month window but quiet for 6 months, single author. GitHub stars, issues and contributors not re-checked (no GitHub access in this session): **unverified**.

## Results table

Capability letter then evidence letter. Scenario statuses are from R1 unless another run is named.

| Dimension | Item | Cap+ev | Notes and evidence |
|---|---|---|---|
| A | last release / cadence | Y-S | 1.0.0 to 1.0.3 between 2026-04-17 and 2026-04-27, then nothing (`npm view reactreejs time`, 2026-10-19); repo `package.json` said 1.0.2 at the research commit (published 1.0.3 not bumped there) |
| A | adoption | N-S | 47 downloads per month (npm API) |
| A | bus factor, issues | ?-U | single author per LICENSE; issue and star counts not re-checked |
| B | React component | P-M | three props; no callbacks, ref or imperative handle (checked in source and by `getCapabilities`) |
| B | controlled state | N-M | `newick` change resets everything (source `Reactree.tsx` sync effect; every other state is internal) |
| B | several instances | P-M | S13 pass (clicks reach only their instance, instance survives the other's unmount); but both share the window `keydown` handler (Ctrl/Cmd+F opens search in every instance), the `data-theme` attribute and `getElementById('clade-input-<sid>')` ids |
| B | clean unmount | Y-M | S13: 0 DOM nodes left, document DOM back to baseline (328 to 328), no portals left on `<body>`, no `data-theme` left, heap +5 MB over cycles 2 to 5 (R1; +9 and +17 MB in two other runs, mostly noise); P: 8 cycles 10 to 17 MB without a trend |
| B | global side effect | P-M | Ctrl/Cmd+F `preventDefault`, verified (`defaultPrevented=true`); adapter switch stops it (`keepBrowserFind`, capture listener with `stopImmediatePropagation`, verified) |
| B | bundle | P-M | whole demo (React 18, shell, d3, library): 364 KB gzip total, main chunk 367 KB raw / 115 KB gzip; PDF export adds lazy chunks of about 770 KB raw (R1 `bundle`, build output); the library's own share is not separated |
| B | SSR | N-D | README: not compatible (client-only boundary) |
| C | tip click | P-M | S2 pass (adapter-derived payload) |
| C | internal-node click with tip set | P-M | S3 partial: tip sets correct but adapter-derived. After a library reroot the clicked clade may not exist in the shared tree: flagged `exactClade=false` in the payload |
| C | branch click | P-M | `path.b-hit` datum; library itself acts only in colour mode |
| C | hover | P-M | mouseover capture; library tooltips exist only inside its edit modes |
| C | programmatic highlight | P-M | S5 pass: own rings, 341 pixels differ around the tip |
| C | programmatic focus | P-M | S5 pass on 10,000 tips via synthetic wheel and drag (dx 0%, dy 5% from centre); instant, no API |
| C | tip as link | P-M | S6 pass: 1,000 real `a[href][data-tip-id]`, focusable, new tab opens |
| C | keyboard / ARIA | N-M | S14 partial: Tab reaches 8 toolbar controls, no tip is focusable at the fit view (only after tip links are on), no role or label on the tree (`aria-` count 0 in source, S) |
| C | search from outside | P-M | no prop, but the input is a controlled React input: set its value with the native setter and dispatch `input` (works; `probes/d8.mjs`: 18 matches, 179 non-matches dimmed). One keystroke rebuilds the whole SVG: 323 to 503 ms at 1,000 tips (P) |
| D | hide / replace UI | N-M | no option; toolbar cannot be hidden or reordered; nowrap row with overflow hidden: right-hand controls are cut off on a card narrower than about 1,000 px (screenshots) |
| D | clade colouring | P-M | S4 **fail at the 1,000-tip fit view** (R1): strokes scale with zoom and are 0.03 px wide there (fit k = 0.0197), so the runner measures 0.00% change. On the 197-tip tree it is partial (R2): 2.8% of the clade box moves to red, and the control clade shows 4% because the toolbar badge (Color 1) makes the toolbar 2 px taller and **shifts the whole tree 2 px down** (P: probe tips +2.0 px). Colouring itself is verified in the DOM (391 elements with the swatch colour) and in the screenshot |
| D | colour palette | N-M | 12 fixed colours (Tailwind-like); GBIF categorical colours impossible; nearest swatch is used |
| D | CSS tokens, dark | P-M | S9 partial: dark pass (luminance 244 to 48), background token 95% of pixels; branch-token pixel check reads 0 because strokes are sub-pixel at the fit view. Computed styles confirm the tokens reach branch stroke, dots, labels, font and container (`probes`, light, tokens and dark) |
| D | custom columns | P-M | only `alignment`: bar and text columns cannot be drawn |
| D | alignment panel | P-M | S7 partial (runner caps non-bar kinds at partial; its "unmatched tip has no cell" check uses the TSV stats, not the FASTA row set, see runner note), S8 partial: the rows line up exactly (`maxDy 0.0 px`, 197 of 197 at the fit view) but at the fit view the cell is 3 px high and the visible 16 residues are mostly gaps, so the "painted" and "several colours" checks fail (5%, 2 groups). Fixed 14 px cells, 172 px label canvas, panel beside the tree, rectangular layout only. **Fuzzy matching misattributes**: a tip with no sequence is drawn with the sequence of any header that contains its name (A1 gets A10's row; `probes/d10.mjs`, source `findSeqForLeaf`) |
| E | layouts | P-M | rectangular and circular by toolbar click; S12 **fail**: the circular layout has radius `(min(w,h)/2 - 170)`, about 80 px, and max zoom is 14, so at 1,000 tips neighbouring tips are about 7 px apart while each hit circle is 13 px radius times zoom: a click lands on a different tip (4 of 4 probes) |
| E | phylogram / cladogram | P-M | S11 pass |
| E | scale bar / axis | Y-M | axis with ticks (phylogram), scale bar (circular); label is always "substitutions / site" (source) |
| E | collapse | Y-M | click internal node: named, coloured triangle plus clade editor popover (verified); 12 colours; state internal |
| E | reroot, midpoint, flip, swap, ladderize, undo | Y-M | toolbar modes work (midpoint and ladderize checked, tip count and locate still correct); no events leave the component; our id mapping flags `exactClade` |
| E | export | Y-M | SVG download checked (109 KB, 197 tips); PNG and PDF and Newick present in source (not run) |
| E | overview / minimap, semantic zoom | N-M | none (S10 overview self-report `no`; whole-tree view is the fit button only) |
| E | zoom model | P-M | uniform scale to fit: 1,000 tips are about 8 px wide; first wheel step jumps from k 0.0197 to 0.05 and zoom-out stops at 0.05, so after one zoom the whole 1,000-tip tree can only be seen again with the Fit button (P) |
| F | 200 tips (R1/R3) | M | load 600 to 730 ms, 17 to 21 ms CPU per step, 0 to 32% dropped (load dependent), click 32 ms; heap 6 MB; 2,943 DOM nodes; status pass or partial by load |
| F | 1,000 tips (R1, R3, R4, P) | M | load 1.5 to 2.0 s, 86 to 102 ms CPU per step (partial, once timeout at 102 vs 100 under load), dropped 34 to 45%, click 120 to 156 ms; 14,143 DOM nodes (about 14 per tip), heap 11 to 14 MB; JS per step 0.4 ms, the rest is style, layout and paint of the SVG |
| F | 5,000 tips (P) | M | ready after 15.5 s (rebuild done at 3.3 s, the rest is slow frames during the library's fade-in), 70,143 DOM nodes, 326 ms per step, every state change 1.9 to 4.3 s |
| F | 10,000 tips (R4, P) | M | **timeout (unusable)**: load 48.6 s, 96% of the time in frames over 50 ms, 633 ms per step, 140,152 DOM nodes, heap 67 MB; colour a clade 5.9 s, switch layout 5.6 to 6.4 s, every other state change takes about as long (the search keystroke was measured only at 1,000 tips); click-to-paint of a 969-tip clade 7.1 s (S15 fail) |
| F | caterpillar (R4, R5, R6, P) | M | works to 2,700 tips (heap 34 MB at 1,000, 100 MB at 2,000, 170 MB at 2,700: the library builds per node a sorted, joined list of descendant names, quadratic); **crashes with `RangeError: Maximum call stack size exceeded` at 3,500 tips and above** (recursion in `treeHasBootstraps`; `parseNewick` and `check` are recursive too); 10,000 and 20,000-tip caterpillars fail at mount |
| F | 100k | N-S | not run: `Math.max(...root.descendants().map(...))`, one SVG, 26 px per leaf; already unusable at 10k |
| G | formats | N-M | Newick only; **quoted labels break the parser**: `edge-quoted-labels` reports 2 of 5 tips, the converted NEXUS edge tree 3 of 7 (R6); no `[...]` comments, no NHX; internal labels 0 to 100 read as bootstrap |
| G | tree operations | Y-M | reroot, midpoint, flip, swap, ladderize with undo, collapse; not separable from the renderer |
| G | polytomy, missing lengths, trifurcating root, internal support | Y-M | all four edge trees pass (R6) |
| G | dated trees | Y-M | 135, 380 and 680-tip dated trees mount (R7): 563 to 884 ms load, 15 to 68 ms per step; the axis says "substitutions / site", no time axis |
| H | accessibility | N-M | S14 partial; no ARIA; keyboard only Ctrl/Cmd+F, Enter, Esc, Ctrl/Cmd+Z; phone: toolbar clipped, tree a sliver (screenshot `reactree-phone-390.png`) |
| I | licences | Y-S | see G1; one non-standard licence file (`rgbcolor`, optional chain) |
| J | cost to adapt | see below | |

## Scenarios (R1, smoke trees)

| S | Status | What happened |
|---|---|---|
| S1 | partial | `edge-quoted-labels` fail (2 of 5 tips); 200 tips pass; 1,000 tips partial. Ladder: R3, R4, R5, R6, R7, R8 |
| S2 | pass | tip click, all checks |
| S3 | partial | tip sets correct, `adapter-derived` |
| S4 | fail (R1), partial (R2) | see C/D rows: sub-pixel strokes at 1,000 tips, 2 px toolbar shift on 197 tips; functionally works |
| S5 | pass | 10,000 tips, focus and highlight |
| S6 | pass | 1,000 links |
| S7 | partial | alignment kind only (declared `columnKinds`), rows aligned; one check is a runner artefact (below) |
| S8 | partial | alignment rows aligned exactly; cell paint checks fail at the fit view |
| S9 | partial | dark and background pass, branch-token pixels 0 (hairlines) |
| S10 | pass | zoom out works (the library's own clamp is 0.05) |
| S11 | pass | |
| S12 | fail | radial clicks hit the wrong tip at 1,000 tips (radius about 80 px) |
| S13 | pass | two instances, five mount/unmount cycles clean |
| S14 | partial | no tip-level keyboard target without links, no tree role |
| S15 | fail | the clade is a hairline at the 10,000-tip fit view (0.00% change); click to React commit 2.1 s, to paint 7.1 s |

## Library features tried (manual, `probes/`)

Search (Ctrl/Cmd+F, input drivable from outside, dims and glows, pans 280 ms), collapse triangle and clade editor, reroot, midpoint, flip, swap, ladderize, undo, label cycle (bootstrap, length), align labels with leader lines, truncate, export SVG, node info panel on a tip click, FASTA panel with a legend, resize handle. Everything exists; none of it reaches the host.

## Corrections to `docs/research/reactree.md`

| Research claim | Finding |
|---|---|
| "6 to 8 SVG elements per leaf" | **about 14 DOM nodes per tip in total** (14,143 DOM nodes at 1,000 tips, 140,152 at 10,000; P, R1) |
| "26 px per leaf" | right, but `d3.cluster` doubles the gap between non-sibling leaves (separation 2), so the real pitch is 26 to 52 px; at the fit view a 1,000-tip tree is a sliver about 8 px wide because the fit scale is uniform |
| "rebuilt on any state change" | confirmed by measurement: every state change costs 0.4 to 0.7 s at 1,000 tips, 2 to 4 s at 5,000, 4.5 to 6.4 s at 10,000 (P). Pan and zoom are cheap in JS (0.4 to 1.2 ms per step) but 60 ms (1k) to 633 ms (10k) per step in style, layout and paint |
| "5,000 tips: stalls (unverified)" | measured: ready after 15.5 s, 326 ms per interaction step |
| "min zoom 0.05 makes 5k+ trees impossible to view whole (open question 2)" | the initial fit is not clamped (k 0.0197 at 1,000 tips), but the first wheel step clamps to 0.05 and zoom-out stops there; whole-tree view returns only with Fit |
| "window-level handler captures Ctrl/Cmd+F" | confirmed (`defaultPrevented=true`) and it opens the search panel in every mounted instance |
| "internal node click collapses to a named coloured triangle" | confirmed; a clade editor popover (name, 12 colours, Expand, Apply) opens at once |
| "Search highlighting pans with a 280 ms transition, not controllable from props" | right, but the input is drivable from the DOM (native setter plus `input` event) |
| "unmount looks clean (not run)" | verified (S13, probes): nothing left in DOM, portals, or `<html>` |
| "no quoted labels (parser)" | confirmed: 2 of 5 tips on the quoted-label tree, 3 of 7 on the NEXUS edge tree |
| not in research | recursion limit: caterpillar of 3,500 tips crashes the component (`RangeError`); quadratic heap on deep trees |
| not in research | alignment panel uses substring matching and silently draws another tip's sequence for a tip that has none |
| not in research | adding a colour override changes the toolbar height by 2 px and shifts the tree |
| not in research | the library builds the SVG twice on mount (the RESET effect), plus a 350 ms fade-in; 1,000 tips are ready after about 1.6 s, 10,000 after 49 s on this machine |
| not in research | colour palette is 12 fixed colours, no free colour input |
| "mobile unsupported (site component)" | on a 390 px phone the toolbar is clipped and the tree is a sliver (`reactree-phone-390.png`); usable only as a desktop viewer |
| "42 downloads last month" | 47 on 2026-10-16 (npm API) |
| "Unpacked size 952 KB" | the production demo bundle is 364 KB gzip in total; PDF export adds about 770 KB raw in lazy chunks |

## Cost to adapt

| Gap | Route | Effort | Licence |
|---|---|---|---|
| Callbacks (click, hover, colour, collapse state) | fork: add props and call them from the three handlers in `d3NodeHelpers.ts`; or keep the DOM wrapper used here (works, fragile) | small as a fork, but it still sits on a full-rebuild renderer | MIT, fine |
| Free colours, GBIF palette | fork: replace `PALETTE`, add a prop | small | fine |
| Controlled layout, lengths, search, selection | fork: lift 17 state variables to props | medium | fine |
| Scale beyond about 1,000 tips | rewrite: one effect builds, lays out and draws everything | large; cheaper to write our own renderer | n/a |
| Deep trees and quoted labels | replace `parseNewick` and the recursive helpers; our shared parser could feed a tree object | medium | fine |
| Custom columns beyond FASTA, bar columns | fork: generic column canvas | medium to large | fine |
| Hide the toolbar, responsive layout | fork or CSS; toolbar and view are one component | medium | fine |

## Verdict

1. As a dependency for gbif.org: **no**. It is a nice self-contained desktop editor for trees up to a few hundred tips (collapse, reroot, colour, search, a FASTA panel that lines up exactly, SVG/PNG/PDF export, dark mode). Everything the host would need is missing and had to be driven through its DOM, one `partial` at a time.
2. Scale: passes at 135 to 380 tips and at 200 tips, sluggish from 680 tips (R7) and at 1,000, unusable at 5,000 and above (about 14 DOM nodes per tip, full rebuild on every state change), and it crashes on trees about 3,500 levels deep or with quoted labels containing commas or parentheses.
3. Use it as a UX reference only (toolbar, collapse triangle with editor, synchronised alignment panel). The adapter proves that clicks, links, highlight, focus and a form of clade colouring are reachable without patching, which is useful evidence about how much a library with no API costs.

## What surprised us

- It worked far better than "three props, no callbacks" suggests: a click listener plus `__data__` on the d3 elements gave full tip sets, and d3-zoom accepts synthetic wheel and mouse events, so `focusTip` and the colour mode could be automated.
- The colour badge shifts the whole tree by 2 px; the toolbar rows cannot wrap, so the library is a desktop widget.
- The 1,000-tip fit view is a sliver and the clamp at zoom 0.05 means you cannot get back to the overview by zooming out.
- Fuzzy FASTA matching silently shows the wrong sequence for an unmatched tip.
- The library cannot read a tree that GBIF would hand it: quoted labels, which are the normal case for species names with spaces, break the parser.

## For `shared/` and `runner/` (for the main session)

- S7 with `columnKinds: ['alignment']`: the "tip without a data row gets no cell" check takes the first `tipsWithoutRow` from the TSV stats, but the alignment column is built from the FASTA, which has a row for that tip; the check fails for a correct adapter. It should use the row set of the column that was tested.
- Fit views of large trees are hairlines (strokes scale with zoom): S4, S9 and S15 pixel checks read 0.00% for any SVG viewer with a uniform fit. They would be fairer after a `focusTip` zoom (as S5 does), or on a tree of 100 to 200 tips.
- The shell shows "Choose a tree in the Tree panel to load it" over a tree mounted through `window.__spike.mount` (phase stays `idle`); screenshots taken that way carry the text. Screenshots in this folder use `?tree=<id>`.
- Mount-time libraries that animate (here a 320 to 350 ms fade-in and fit transition) are waited out by the adapter before `onReady`; `firstRenderMs` therefore includes that animation. It is stated in the mount notes.
