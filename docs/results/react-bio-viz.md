# react-bio-viz 0.3.0 (2026-10-14)

Spike: `spikes/react-bio-viz/` (adapter `src/adapter.tsx`, about 950 lines; metadata `spike.json`; exact versions and `package-lock.json`, `npm ci --ignore-scripts` checked in a clean directory). Runs: `spikes/results/react-bio-viz/`. Machine: 4 CPU Xeon 2.8 GHz, 16 GB, headless Chromium 141.0.7390.37 **without GPU** (software raster), shared with five other agents (**load average 9 to 17 during all runs**). The library is SVG, so there is no canvas/WebGL caveat, but software SVG raster is slow: absolute frame rates here are pessimistic.

Source: npm tarball 0.3.0 (types and `dist/` in `node_modules`), plus a depth-1 clone of github.com/holmrenser/react-bio-viz at `d75ad20` (the commit of the research note) for reading `PhyloTree/` and `core/` source. Line references are to that clone, `packages/components/src/components/PhyloTree/` unless stated. Used: `PhyloTree` (with the library toolbar, the default) and `SimplePhyloTree` (toolbar off, a demo toggle).

**How to read the numbers.** The runner's FPS rule (p5, time weighted) is unreliable under that load: a 5-tip tree shows p5 15 to 20 fps in some runs and 59.5 in others, and the 200-tip tree flips between `pass` and `timeout` from run to run. Statuses of S1 for up to 1,000 tips are therefore noise-limited; the median FPS was 59.9 in every run. What does not depend on load: DOM node counts, heap, React commit time, and everything at 10k tips and above.

Gates: **G1 pass** (MIT in `package.json` and `LICENSE`; no runtime dependencies; Tailwind 4.3.3 CSS and Zustand/Radix are bundled in `dist`, their licences not audited: U). **G2 pass** (client only, static files). **G3 pass** (React 18/19 peer range, ESM and CJS, TypeScript types; used with React 18.3.1; S13 mount/unmount cycles clean). **G4 flag**: release 2026-10-08, still `latest` on 2026-10-14 (`npm view`), but single maintainer, a 2024-07-05 to 2026-10-07 gap with no release, three 0.x releases in two days with breaking renames (see A).

## Results table

Capability: Y yes, P partial, N no, ? unknown. Evidence: M measured here, S source, D docs, C claimed, N looked for and not found, U not looked at. "Smoke run" is `20261014-155502`; ladder and worst runs are listed under Scenarios.

| Dim | Item | Cap+ev | Notes and evidence |
|---|---|---|---|
| A | last release | Y-S | npm `time`: 0.3.0 on 2026-10-08, `latest` unchanged on 2026-10-14 |
| A | cadence, churn | P-S | 0.0.17 on 2024-07-05, then 0.1.0 and 0.2.0 on 2026-10-07 and 0.3.0 on 2026-10-08 (registry). Breaking renames between 0.1.0 and 0.2.0 (`docs/research/react-bio-viz.md`, CHANGELOG, not re-read) |
| A | bus factor, AI-assisted commits | P-S | research note from `git log` (one human author, 27 commits with Claude co-author trailers); my clone was depth 1, so not re-measured |
| A | adoption | P-M | 664 npm downloads in the last month (api.npmjs.org, 2026-09-13 to 10-12). Stars, issues, dependents: U (GitHub API not reachable from the sandbox) |
| A | docs accuracy | P-M | JSDoc and README claims matched behaviour everywhere tested (Ctrl-scroll zoom, `leafSpacing`, `selection`, `nodeStyles`, `onLeafOrderChange`, `midpointRoot`, `ladderizeOrder`). Not tested: docs site, `serializeSvg`, `svgToPng`, the MSA component |
| B | React component, controlled state | Y-M | `viewport`/`onViewportChange` and `selection`/`onSelectionChange` are plain controlled props; the adapter keeps both in `useState`, plus `*Store` variants exist (S). Clade colours, highlight, layout, columns, theme all go through props. S2 to S5 and S15 prove React state changes |
| B | several instances, unmount | Y-M | S13 pass: two instances, 5 mount/unmount cycles, DOM back to baseline (406 to 406), heap growth 2.0 MB, no page errors. The only leftover is the injected `<style id="rbv-styles">` (34.8 KB) |
| B | side effects | P-M/S | stylesheet injected into `<head>` on import (no `sideEffects` field), and it registers `:root` variables (`--radius`, `--spacing`, `--font-sans`, `--background`, `--primary`, Tailwind `--color-*`, `--text-*`). Measured: GBIF tokens in unlayered CSS keep winning (`--radius-md` stays 4px, `--text-xs` `.75rem`), but the names overlap. Window listeners only exist during a drag (S, `SimplePhyloTree.tsx` cleanup effect). No global hotkeys found in the files read |
| B | bundle | P-M | `dist/main.es.js` 409,724 B, **113,043 B gzip -9** (matches the research note); style.css 34,793 B. Whole demo app (React 18 + shell + library): 414,963 B, 134,947 B gzip (`20261014-155502`). Library-only share after tree-shaking not isolated (the stylesheet and all components are bundled) |
| B | input format | P-S | betula `Tree` JSON `{id?, name, length, children}`; own `parseNewick`. Adapter calls the library parser (parse 1.1 ms for 200 tips, 5.5 ms for 1k, 44 ms for 10k, 196 ms for 100k) and writes our shared node id into `Tree.id`, which the library keeps and reports back in every callback (id mapping: 0 mismatches on all trees tried; a tip-set fallback exists but was never needed) |
| C | tip click | Y-M | S2 pass (4/4 tips, tip metadata row shown from React state, unmatched tip reported UNMATCHED) via `onNodeClick` on leaf markers; libraryPayload `isLeaf` |
| C | internal node click with tip set | Y-M | S3 pass, 4/4 nodes, sets equal ground truth, `source: library` (`TreeNodeInfo.leafNames`). Also `descendantIds`, `isCollapsed`, `support`, `rerootAbove` in the payload |
| C | branch click | Y-M | `onBranchClick` adds a transparent hit path per branch (doubles the path count). Clicked by hand: `branchClick n25 tips=2 source=library`, colours the clade through the shell (manual) |
| C | hover with payload | P-M | **no hover callback** (confirmed, S and N). Adapter listens to DOM `mouseover` on `circle[data-node-id]`, `path[data-branch-id]` and label groups and builds `tipHover`/`nodeHover` from the shared TreeModel, `source: adapter-derived`. Works (tooltip shown in the demo). Hover styling in the library is CSS only |
| C | tip label as link | Y-M | S6 pass: SVG `<a href target=_blank rel=noopener data-tip-id tabindex=0>` rendered in the `leafTextComponent` slot for all 1,000 tips, real click opened a tab. Needed `data-pan-ignore` on the anchor: without it the library's drag handler captures the pointer on `pointerdown` and the click never reaches the link (found when S6 first failed: `popups=0`) |
| C | programmatic highlight | Y-M | `nodeStyles` (colour + bold on marker) plus our label halo in the slot; library search (`searchQuery` regex of the highlighted tips) dims all others (checked: 4 highlighted, 196 dimmed). S5 pass. One-node `activeNodeId` exists but is not used |
| C | focus / centre a tip | P-M | no API. Adapter raises `leafSpacing` to 18 px when rows are thinner than 14 px (the library's own scrolling answer), reads the marker position back from the DOM and sets a controlled viewport. S5 pass at 10k tips (dx 20%, dy 3% off centre, sibling and parent clade visible). Cost: a whole-tree relayout, **3.3 s the first time at 10k, 0.8 s the next** (manual, load 13); 0.1 to 0.4 s at 200 to 1k tips |
| C | viewport and selection control, serialisable | Y-M | both are plain JSON (`Viewport`, `TreeSelection`). Verified by use: the adapter resets and sets them from React |
| C | wheel and drag | P-M | **plain wheel pans; zoom needs Ctrl/Cmd+wheel** (`useWheelZoom` with `onPan`, S and M). The runner's wheel notches therefore only pan; S10 passes at 1k because the whole tree is already in view at the fit view. Zoom is uniform in x and y (viewBox), so markers, strokes and labels scale with it. Demo toggle "Plain wheel zooms" re-dispatches wheel events with `ctrlKey` (adapter patch, checked: viewBox changes) |
| C | keyboard | N-M | tree markers have no `tabindex`, no role, no key handlers (S; DOM check: `tabindex` null, svg `role` null). Only the toolbar buttons are focusable (and most are disabled at the fit view). Tips become tabbable only because the adapter's links are anchors (not tested with Tab through 1,000 anchors). Native `<title>` per tip |
| D | per-tip columns | P-M | **none in the library.** The label slot cannot host them: right margin is `min(300, round(0.3 x width))` and the svg clips at the viewBox (S, `SimplePhyloTree.tsx` margin memo). Adapter draws an own canvas to the right of the tree; rows read back from rendered markers, mapped with the controlled viewport (no DOM reads while panning). S7 pass: 300/300 cells within 0.00 px of the tip row at fit and after zoom and pan, Spearman 1.00, unmatched tip gets no cell. Rectangular only; follows ladderize, reroot, collapse (checked by hand: cell y equals tip y after ladderize and after reroot) |
| D | alignment column | P-M | same canvas; one pixel per row image cached offscreen, drawn scaled (O(1) per frame; capped at 30,000 rows). S8 pass (197/197 aligned, 4 residue colour groups). The library's own `MultipleSequenceAlignment` and `rowOrder` linking exist (S) but were **not tried**: whether its rows line up with tree rows is still open |
| D | clade colouring | P-M | `nodeStyles` and `branchStyles` for every descendant id (branches, markers, collapsed triangles). S4 pass at 1k (29% of the clade box turns red, control clade 0%, no layout change, DOM delta 0, clear restores). **Every change re-renders the whole tree body** (`body` memo depends on `nodeStyles`): `setColouredClades` returns in 51 to 140 ms at 200 to 1k tips and 1.2 to 1.5 s at 10k (manual, prod build). Radial: the colour is applied (visible by eye) but at the fit view the runner's colour check sees 0.00% because the virtual-canvas lines are about 0.4 px (S12 partial) |
| D | styling hooks | P-M | see `spike.json`. CSS variables (`--foreground` is the branch colour, `--background`, `--rbv-accent` for hover and active, shadcn tokens for the toolbar), one render slot for labels, global numeric props. S9 pass (light 227 to dark 53 luminance, token background 79%, 65,908 pixels in the branch token colour). Per-node size, shape and width: none |
| D | custom labels | Y-M | `leafTextComponent`: italic scientific names in `--font-body`, halo, links. Radial labels are truncated to 24 chars before the slot (S, `LeafNode.tsx`) |
| D | tooltips | P-S | native `<title>` only; the demo tooltip is the shell's, fed by our adapter-derived hover |
| D | hide or disable features | Y-M | `showSupportValues`, `showScaleBar`, `showBranchLengths`, `nodeRadius`, `interactive`/`dragEnabled`, `SimplePhyloTree` without toolbar (all in the demo "Library options"). `nodeRadius 0` hides tip markers only; internal markers keep radius 0.5 (M) |
| E | rectangular phylogram, cladogram | Y-M | S11 pass: tip x follows root-to-tip length (r = 1.000), toggle moves tips by 232 px, ultrametric tips end at the same x (0.00% spread), edge case with missing, zero and negative lengths renders. Library `layout="cladogram"` |
| E | circular | P-M | `layout="radial"` is always a phylogram. Cladogram radial: adapter feeds synthetic lengths (clade height differences, `adapter-derived`). No `leafSpacing` in radial, so the circle size is tied to the container and labels overlap beyond about 150 tips; workaround: lay out on a virtual square canvas (14 user units per tip, up to 16,000) and show it through the container with CSS size; then tips are 14 px apart at scale 1. Radial S2, S3 pass at 1k; S4 colour check fails at the fit view (see D) |
| E | unrooted | N-S | none (`LayoutMode`: rectangular, cladogram, radial) |
| E | scale bar | P-M | `showScaleBar` I-beam with a round length at the bottom of the tree (screens); no axis, no time axis for dated trees; omitted in cladogram. Scrolls away when the tree is taller than the view |
| E | collapse | Y-M | `selection.collapsed`; click action "Collapse" in the demo: triangle with "2 taxa", expands again; collapsing emits nothing. `collapseBySupport` helper dissolves low-support nodes (9 to 8 markers on the support edge tree) |
| E | reroot, midpoint, ladderize, reorder | Y-M | reroot above a clicked node, `midpointRoot`, `ladderizeOrder` asc/desc, drag a marker among siblings (order changed, checked by tip positions). **Node ids stay valid but clades of nodes on the old root path change:** after a reroot 3 of 14 clicked nodes reported a library tip set different from the original-rooted clade of the same id (197 versus 16 tips for `n203`). The adapter flags this in `libraryPayload.rerootedMismatch` |
| E | search | Y-M | `searchQuery`/`searchUseRegex`: bold matches, dim the rest (4 matches, 196 dimmed) |
| E | whole-tree overview, minimap, semantic zoom | N-M | none: every node and label is drawn at every zoom. Fit view is the zoom-out limit (viewport clamped to the extent). S10 passes only at 1k tips. The adapter hides label text with CSS below 8 px rows (labelled partial; off switch in the demo) |
| E | export | Y-S | `serializeSvg`, `svgToPng`, `toNewick`, `applyTreeSelection` exported (types read); **not exercised** |
| F | load, 1k tips | Y-M | first render 0.9 to 1.3 s (load dependent), React commit 74 ms, parse 5.5 ms, DOM 13,038 nodes (13 per tip: 2 paths per branch incl. hit path, marker, label group with title, line, text), heap 18 MB (`20261014-155502`) |
| F | pan and zoom, 1k | P-M | median 59.9 fps in every run; p5 6 to 15 fps in S1 under load (`20261014-155502`: 15). Manual, dev build: p5 6 to 15 fps default; switching off the 1,000 branch hit paths gave p5 20 and a 1.4x higher frame count; 4 columns cost about 2x more frames (canvas drawing is cheap after caching, so most of it is the SVG repaint). For scale, the naive stub with 4 elements per tip: p5 20 at 1k under similar load |
| F | 10k tips | N-M | first render **8.0 to 10.4 s** (yule 8.0, balanced 9.3, bushy 7.4, otl 10.4, gtdb 8.2); of which React commit only 0.6 to 0.9 s, the rest is browser style, layout and software paint of 106k to 132k SVG elements; heap 98 to 126 MB; p5 FPS 1.5 to 3.8; click to callback 196 to 280 ms, **to paint 1.5 to 2.1 s** (`20261014-154425`, `-154619`). Unusable on every 10k tree. At 10k, colouring or highlighting costs 1.2 to 1.8 s, S15 (969-tip clade) click to commit 863 ms and to paint 1,405 ms (smoke run) |
| F | 100k tips | N-M | mount finished after **76 s** (earlier runs on a more loaded machine: 109 s and 131 s, their JSON was superseded), 1,300,038 DOM nodes, **heap 1.17 GB**, React commit 11.9 s, parse 196 ms; interaction measures skipped by the runner (`20261014-154854`). 91k and 190k real trees not run (100k already exceeds the limit) |
| F | deep trees | N-M | **stack overflow on caterpillars of 3,000 tips and more** in Chromium (2,000 deep works, 2.4 s; 3,000 to 7,000 fail at mount; `syn-caterpillar-10000` fails in `20261014-154500`). Cause: recursive `buildHierarchy`, `descendants`, `assignSpread`, layout and `countLeaves` (S). In Node 22 the library's `parseNewick` alone fails between 6,000 and 8,000 deep, `leafOrder` (hierarchy) between 2,000 and 3,000 |
| F | 0 versus 3 columns | P-M | only measured at 1k (see pan row) and via S7/S8; not on 10k (the runner's scale phase does not use columns) |
| G | formats | P-S | Newick only, from the library (quoted labels fine: `edge-quoted-labels` pass). Nexus and others are converted by the shared harness; no NHX, comments or `[&...]` |
| G | tree operations | Y-M | reroot, midpoint, ladderize, collapse by support, reorder, `orderForLeafNames`, `leafOrder`, `applyTreeSelection` + `toNewick` for the displayed arrangement (S; the first five exercised in the demo). Pure functions on the `Tree`, separable from the renderer, but recursive (see deep trees) |
| G | lengths | P-M | missing lengths become 0; **trees without lengths** (OTL) lay out as a flat line in the phylogram and radial modes: adapter uses cladogram (rectangular) or synthetic lengths (radial). Negative lengths are used as-is by the layout; adapter clamps them to 0 in a copy (`adapter-derived`) |
| H | accessibility | N-M/S | no roles, no focus on markers, no key handling, no text fallback; `<title>` per tip; toolbar buttons are labelled ("Pan left" and so on). S14 passes but see "For shared/ and runner/" |
| I | licence detail | Y-S | MIT, copyright "GeneNoteBook" (LICENSE) vs author Rens Holmer in `package.json`; bundled Tailwind 4.3.3 (MIT banner seen in `style.css`); Zustand, Radix, shadcn copies not audited (U); no bundled data |
| J | cost to adapt | see below | |

## Scenarios

Smoke run `spikes/results/react-bio-viz/20261014-155502.json` (S1 on 5, 200 and 1,000 tips and S2 to S15); S10 on 10k tips: `-160118`. S1 ladder and worst: `-154425` (yule 10k), `-154500` (caterpillar 1k, 10k), `-154519` (dated, otl-1k), `-154619` (otl-10k, gtdb-10k, balanced and bushy 10k), `-154854` (yule 100k). Screens: runner PNGs plus `demo-1-rect-1k.png`, `demo-2-radial-200.png`, `demo-3-clade-columns.png` (clade n451 coloured, 4 columns, readable rows), `demo-4-dark-columns.png`, all in `screens/` under 150 KB.

| Scenario | Result | Notes |
|---|---|---|
| S1 load and fit | 5 tips pass; 200 tips pass or timeout (noise); 1k timeout (p5 15 in the smoke run; 6 to 15 across runs); 10k, 100k timeout; caterpillar 10k fail (stack overflow); dated 135 to 680 tips and otl-1k mixed pass/timeout (noise) | see F rows. Median FPS 59.9 throughout |
| S2 tip click | pass | 1k, 4/4, after `focusTip` |
| S3 node click | pass | 4/4 nodes, `source: library` |
| S4 colour clades | pass | 1k; whole-tree re-render per change (D) |
| S5 highlight and focus | pass | 10k, via leafSpacing and a computed viewport |
| S6 link | pass | real `<a>` in SVG, needed `data-pan-ignore` |
| S7 bar column | pass | own canvas, dy 0.00 px |
| S8 alignment | pass | own canvas |
| S9 theme | pass | CSS variables and `.dark` class |
| S10 whole tree | pass (1k, and 10k in `-160118`) | trivial pass: the whole tree is already in view at the fit view and the runner's plain wheel only pans, so no zoom-out happens (idle p5 59.9 fps at 10k). It says nothing about an overview: there is none. 100k not run in S10 (S1: mount 76 s) |
| S11 branch lengths | pass | scale bar self-reported (and seen in screens); no time axis |
| S12 radial | partial | S2 and S3 pass; S4 colour check 0.00% at the fit view because lines of the virtual canvas are about 0.4 px; colour is visible by eye. Without the virtual canvas and the auto marker radius S12 **failed** (marker circles of radius 3 overlap at 2 px tip spacing, so a click hit a neighbour: `got n258` for `n252`) |
| S13 two instances | pass | |
| S14 keyboard | pass (runner) | generous: see below; real keyboard support is none |
| S15 linked view | timeout | 10k tips, 969-tip clade: click to commit 863 ms, to paint 1,405 ms (median of 5) against the 100 ms target. At 1k the same operation is about 120 to 140 ms (manual) |

## Library features tried through the demo (manual, Playwright scripts against the dev server, no runner run)

Works: toolbar versus `SimplePhyloTree`; `leafSpacing` 12, 18, 28; click-to-collapse and expand; click-to-reroot (tip order changed, columns stay aligned: 3/3 cell y equal tip y); ladderize both ways (order changed, cell y equals tip y); midpoint root (on an ultrametric tree it changes nothing, on `rich-ens-protein-197` it does); `collapseBySupport` thresholds; support labels, branch-length labels, scale bar toggle, align labels toggle, marker radius 6 and 0; branch hit paths on and off (398 to 0 paths on 200 tips); drag a marker to reorder (tip order changed); library search dimming; Ctrl-wheel zoom and the adapter's plain-wheel patch.

Breaks or surprises: reroot changes clade semantics for ids on the root path (E); `shadeBranchBySupport` (default on) sets branch opacity to a numeric parent label, so 0 to 100 supports are all clamped to 1 and 0 to 1 supports fade branches (adapter turns it off); `showSupportValues` (default on) prints every internal node name (adapter turns it off); `nodeRadius 0` leaves internal markers; with columns on and a narrow container the toolbar wraps to two rows and the 30% label margin leaves about 95 px for names (columns need roughly 480 px); a dense tree shows an unreadable blob of labels unless hidden (adapter CSS).

## Differences from `docs/research/react-bio-viz.md`

Confirmed: SVG with no culling or level of detail; Newick only; no hover callback; no per-tip columns; no focus API; `onNodeClick`/`onBranchClick` payload with `leafNames` and `descendantIds` (works, 4/4 nodes); controlled viewport and selection; 113 kB gzip library file; DOM per tip about 8 plus 4 per internal node (research estimate 12 per tip; measured 13).

Corrections and additions:

1. **Scale is worse than "low thousands".** 1k tips is already at the edge of smooth panning in software raster (p5 6 to 15 fps, 13k DOM nodes); 10k first render is 8 to 10 s and a click-to-paint of 1.5 to 2 s; 100k mounts in 76 s with 1.2 GB of heap. Most of the 10k cost is the browser painting the SVG, not React (commit 0.6 to 0.9 s).
2. **Recursion limit measured:** caterpillars fail from 3,000 tips in Chromium (research: "not tested"). The limit comes from the hierarchy and layout code, not the parser (parser alone: 6,000 to 8,000 in Node).
3. **Focus inference verified:** leaf rows are evenly spaced at `leafSpacing` (margins 10 px top and 20 px left per `constants.ts`; the adapter reads the real positions back from the markers, and S5 and S7 rows align to 0.00 px). A focus helper therefore needs only `leafSpacing` and a controlled viewport; it is still a whole-tree relayout (3.3 s at 10k).
4. **Wheel semantics:** plain scroll pans, Ctrl/Cmd+scroll zooms; the runner's plain wheel never zooms (not in the research note).
5. **Zoom is uniform in x and y**, so markers, strokes and labels grow with it; this is why radial tips overlap at any zoom, and why radial needs a virtual canvas (the research note did not cover radial size at all; radial has no `leafSpacing`).
6. **Per-tip columns cannot live in `leafTextComponent`** (right margin capped at 300 px and clipped): the note's "own column component aligned by `leafSpacing` rows" is correct and works (own canvas, 0.00 px).
7. **Open question answered in part:** tree rows line up exactly with our own column canvas; whether they line up with the library's `MultipleSequenceAlignment` is still unknown (not mounted).
8. **Link anchors need `data-pan-ignore`**; otherwise the library captures the pointer and the click is lost.
9. **Ids after reroot** are stable but clade membership is not (see E).
10. **Global CSS:** the injected stylesheet registers Tailwind and shadcn variable names on `:root` (zero specificity or layered, so unlayered host CSS wins; measured against the GBIF tokens).
11. Maintenance numbers (downloads 664 per month) added; stars and issues still unknown.

## Cost to adapt

- Hover events: wrapper (DOM `mouseover`, 25 lines, works) or patch `NodeMarker`/`LeafNode` upstream (1 to 2 days). Licence allows both (MIT).
- Focus and zoom-to-node: wrapper over `leafSpacing` plus viewport (done, 40 lines); a proper helper needs `computeLayout` exported (patch, 1 to 3 days).
- Columns and alignment: wrapper (own canvas, about 200 lines here, rectangular only); the library offers nothing for trees.
- Clade colouring without a full re-render, and everything at 10k tips and above: **fork or rewrite**: the whole tree is one memoised React body, one element set per node, no culling. Windowing, aggregation and canvas are a different architecture (weeks).
- Deep trees: patch (iterative `buildHierarchy`, `descendants`, `assignSpread`, layouts; days) or avoid by capping depth.
- Radial at scale and labels: wrapper (virtual canvas) or patch (`leafSpacing` for radial).
- Unrooted layout, time axis, keyboard and ARIA: patch or fork (days each).
- Formats other than Newick: shared parser, already needed for every candidate.

## Verdict

1. The best React-API fit of the candidates for small trees: controlled `viewport` and `selection`, click callbacks with the full tip set on tips, nodes and branches, per-node colour keyed by our own ids, `leafTextComponent` for italic names and real links, ladderize, midpoint, collapse and a scale bar, all working in one afternoon with 0 patches.
2. It does not scale: 1k tips is borderline, 10k takes 8 to 10 s and 1.5 to 2 s per click or colour change, 100k takes over a minute and 1.2 GB; caterpillars of 3,000 tips overflow the stack. No overview, no level of detail, no hover, no columns, no keyboard.
3. Use it, if at all, as a component for trees up to about 1,000 tips (or collapsed to that), or as the API template (controlled state, id-keyed styles) for a canvas-based viewer, not as the large-tree solution.

## What surprised us

- The cost at 10k tips is mostly the browser painting 130k SVG elements (commit 0.6 s of an 8 s first render), not React.
- Zoom scales markers and strokes, so a radial tree of 1,000 tips cannot be clicked at any zoom with the default marker size, and the first fix (smaller markers, auto radius) is not enough for readable labels: it needed a virtual canvas.
- A click on an SVG `<a>` inside the tree is eaten by the drag handler's pointer capture unless the element carries `data-pan-ignore`.
- `shadeBranchBySupport` and `showSupportValues` default to on and quietly wreck trees whose internal labels are names or percentages.
- Rerooting keeps node ids valid but changes what a node id means.
- The runner's S14 and S10 pass for a viewer with no keyboard support and no wheel zoom (see below).

## For `shared/` and `runner/` (reported to the main session)

- S14: "Tab reaches at least 3 focusable elements" counted three Tab presses on the same element (`tabAtFit` lists "Zoom in" three times; the other toolbar buttons are disabled at fit). It should count distinct elements and require at least one tip or marker.
- S10: a viewer that cannot zoom with plain wheel still passes when the tree already fits; consider also testing Ctrl+wheel or `zoomToFit` honesty.
- S1: p5 on 5-tip trees fluctuates between 15 and 59.5 fps with load; a CPU-time or best-of-N rule would make statuses meaningful on a shared machine.
