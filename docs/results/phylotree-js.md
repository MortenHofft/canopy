# phylotree.js 2.6.0 with our own React wrapper (2026-10-14)

Spike: `spikes/phylotree-js/` (wrapper and test API in `src/adapter.tsx`, metadata and styling facts in `spike.json`, measurement scripts in `measure/`). Runs: `spikes/results/phylotree-js/` (run ids below), screenshots in `spikes/results/phylotree-js/screens/` (`demo-1..5` from the dev server on port 5303; the rest are runner output). Versions pinned: `phylotree` 2.6.0, `d3` 7.9.0, React 18.3.1, Vite 5.4.11. Chromium 141.0.7390.37, headless, **no GPU**, 4 CPU Xeon 2.8 GHz shared with five other agents (**load average 3 to 19 during the work**). Source read from the installed npm package (`node_modules/phylotree/src`, the ESM entry Vite bundles); GitHub was not reachable from this session, so repository activity facts are carried over from [../research/phylotree-js.md](../research/phylotree-js.md) and marked as such.

**How to read the numbers.** The runner's p5 FPS rule reacts to machine load: under load 10 to 19 even the naive stub fell to p5 2 to 4 fps at 200 tips, and a 5-tip tree read 15 fps. FPS statuses for small trees are therefore a noisy lower bound; the final runs (load 3 to 9) are quoted, with the two samples I have where they differ. For scale I lean on main-thread CPU time per interaction step (CDP `Performance.ThreadTime`, `measure/cpu-probe.mjs`, compared with the stub measured the same way). Everything is evidence **M** unless marked otherwise. Two builds were measured: the default (wrapper with a label level-of-detail, "LOD") and `VITE_PT_LOD=0 npm run build`, which is the library as it ships (every label always in the DOM and laid out).

## Gates

- **G1 Licence: pass with a flag.** `LICENSE` is MIT ("Copyright (c) 2016 iGEM/UCSD ..."); `package.json` has **no `license` field** and the registry reports `license: null` (`npm view phylotree license` empty), so automated scanners say UNKNOWN. Installed runtime dependencies are MIT or ISC (d3 7.9.0 ISC; lodash 4.18.1, underscore 1.13.8, fast-xml-parser 5.11.2 and its five helper packages MIT, read from their `package.json`). `npm audit --omit=dev`: 0 vulnerabilities. jquery, moment, winston, commander, csv-stringify and pretty-data are declared dependencies but are imported only by `bin/*.js` (grep of `src/` and `bin/`) and are not in the bundle.
- **G2 Browser-only: pass.** Parse and render run in the browser from static files. `render()` needs a DOM (`d3.create('svg')`); `new phylotree(newick)` also runs in Node (used here for the Nexus check).
- **G3 React-embeddable: pass with our wrapper.** No React component exists; the imperative API (`new phylotree`, `tree.render`, `display.on`, `display.update`) is drivable from `useLayoutEffect` with clean unmount (S13: 5 mount/unmount cycles, DOM back to baseline 347 nodes, heap growth -1.5 MB, no page errors). One document-level listener of the library stays (see B).
- **G4 Not abandoned: pass with a flag.** Latest and only recent line is 2.6.0 on 2026-03-14 (registry `time`, M), seven months before today; 83 versions since 2016 with long gaps (2.1.7 on 2025-08-15, then 2.2.0 on 2025-12-05). Last commit 2026-04-15 and the 3 open issues are from the earlier research, **not re-verified** (no GitHub access). Three npm maintainers, all at Temple (emails).

## Scenario results (runner)

| S | Scenario | Result | Run | Notes |
|---|----------|--------|-----|-------|
| S1 | Load and fit | pass up to about 700 tips, borderline at 1k, **timeout from 10k** | smoke `20261014-162158`, ladder `-162347`, worst `-162525`, dated/align/edge `-162622`, 100k `-161443` | 1k: p5 12 to 59 fps (four samples: 59.5, 30, 30, 12), 10k: p5 2.5 to 3.5 fps and click 400 ms, 100k: load 19.4 s, p5 0.5 fps, click 4.6 s. Caterpillars: 1,000 tips fine, **10,000 and 20,000 fail with stack overflow** |
| S2 | Click a tip | **pass** | `-162158` | needs a readable zoom (label is the click target) |
| S3 | Click internal node, tip set | **partial** | `-162158` | all 4 nodes right with the right tip sets, but the sets come from d3's `node.leaves()` on the payload node: `adapter-derived` |
| S4 | Colour clades from React | **pass** | `-162158` | stylers, no layout change |
| S5 | Highlight and focus (10k) | **pass** | `-162158` | dx 10.6% off centre, dy 0.1% |
| S6 | Tip as link | **pass** | `-162158` | real SVG `<a href data-tip-id target=_blank tabindex=0>`, new tab opened |
| S7 | Bar column | **partial** | `-162158` | 299/299 cells aligned (max dy under 0.001 px) at the fit view; after zoom and pan 0 tips visible with a cell: uniform zoom pushes the columns out of the view |
| S8 | Alignment column (197 tips) | **pass** | `-162158` | at the fit view |
| S9 | Theming | **pass** | `-162158` | dark and tokens via CSS custom properties |
| S10 | Zoom out to whole tree | pass at 1k (p5 20), partial at 10k (p5 3.3 to 4.6 fps) | `-162158`, `-163000` | it fits by construction; the cost is the frame rate |
| S11 | Phylogram / cladogram | **pass** | `-162158` | Pearson 1.0, dated tree tip spread 3.5e-16; scale bar self-reported partial |
| S12 | Radial | **pass** | `-162158`, dated tree `-162817` | after fixing ring label and node sizes (see below) |
| S13 | Two instances, 5 cycles | **pass** | `-162158` | |
| S14 | Keyboard | **pass** (with a note) | `-162158` | wrapper-added `tabindex` and Enter; tips are focusable only after zoom (labels hidden by the LOD at the fit view) |
| S15 | Linked view | **timeout at 10k** (969-tip clade: 686 ms to commit, 851 ms to paint) | `-162158` | by hand on 1k tips (100-tip clade, 3 clicks, `measure/click-latency.mjs`): 82 to 89 ms commit, 105 to 123 ms paint |

All nine dated, real and small edge trees from the catalogue load and render (135, 197, 380, 680 tips and the five edge trees), run `-162622`; the functional scenarios also pass on the dated 680-tip tree (`-162817`: S2, S4, S6, S9, S11, S12, S13, S14 pass, S3 partial).

## Results table

Capability: Y yes, P partial, N no. Evidence: M measured, S source, D docs, C claimed, N not found, U not looked at.

| Dim | Item | Cap+ev | Notes and evidence |
|---|---|---|---|
| A | last release / cadence | P-M | npm `time`: 2.6.0 on 2026-03-14, nothing since; 2.2.0 to 2.6.0 within 100 days after a 2025-08 to 2025-12 gap |
| A | bus factor, issues, institution | P-C | from the earlier research: Temple University / HyPhy lineage, 3 maintainers, 3 open issues, bulk close 2026-01-05; not re-checked |
| A | adoption | P-C | 14,214 downloads last month (research, 2026-10-04) |
| A | API stability | P-S | the event emitter, unrooted layout, selection sets and types were added in 2.2 to 2.6 (research); the `refresh()` and `reroot()` behaviour below suggests the new paths are lightly exercised |
| B | React integration | P-M | no component; wrapper is `useLayoutEffect` (create, destroy), a second effect that diffs props, refs for styler state. `src/adapter.tsx` is about 1,170 non-comment lines including the whole test API (about 400 lines are the contract plumbing) |
| B | controlled state | P-M | colour, highlight, links, columns, layout, lengths, theme, focus are props applied through stylers and options; the library keeps zoom, collapse, selection and reroot state inside the instance and has no controlled viewport |
| B | several instances | Y-M | S13 pass with two instances; ids scoped by host; the only global is one `document` listener |
| B | clean unmount | P-M | no `destroy()`. Wrapper removes `display.on` listeners, `svg.on('.zoom')`, the capturing `click` handler on the host and the DOM. Leftover: one `document` listener for `phylotree.event`, registered with a module-level function so repeated renders do not add more (CDP `getEventListeners`: 0 before, 1 after 5 cycles and 1 while mounted). **Corrects the research**, which implied a leak per render |
| B | SSR | P-S | `render()` needs `document`; the model and parser run in Node (M) |
| B | bundle | P-M | +325 KB minified, **+109 KB gzip** over the stub (stub 221,745 B / 71,098 B gz, phylotree 546,979 B / 180,500 B gz, both with React and the shell, run `-162158`). **Not tree-shaken**: whole CommonJS lodash (about 550 KB before minification), fast-xml-parser and five helper packages (about 190 KB, pulled by the phyloXML parser although only Newick is used), underscore 61 KB, d3 modules (selection, transition, zoom, brush, time-format ...) about 150 KB, phylotree itself 143 KB. Per-module report from a Rollup `generateBundle` hook (pre-minification sizes). Aliasing lodash to lodash-es would likely help: **U** |
| B | ESM and types | P-S | `module` is `src/index.js` with extensionless imports (bundlers only); `dist/phylotree.d.ts` omits several real options (research); the wrapper types the library as `any` |
| C | tip click | Y-M | S2 pass. Tips have no circle: the `<text>` is the target, so tips are clickable only at a readable zoom |
| C | internal node and branch click with tip set | P-M | `display.on('nodeClick'|'branchClick')` deliver the d3 hierarchy node; no tip set in the payload (S3 partial, adapter-derived). `branchClick` also toggles the library selection and runs a **full `update()`** (200 ms at 2k tips). Branch click verified with the real mouse |
| C | hover | P-S/M | `nodeHover` is mouseenter on tip `<text>` and internal `<circle>` only, no leave event. The tooltip is drawn by the shell |
| C | tip label as real link | P-M | node-styler wraps the library's `<text>` in an SVG `<a>`; S6 pass |
| C | programmatic highlight | P-M | S5 pass: ring, row band, bold label from the node-styler. The library's own `selectNodes()` does a full `update()` (200 ms at 2k, 618 ms at 5k, M) and paints with fixed `.node-selected` CSS, so it is not used |
| C | focus / zoom to node | P-M | no API; wrapper computes a `d3.zoomIdentity` from `node.screen_x/y` and calls `display.zoomBehavior.transform`. The library's `scaleExtent([0.1, 10])` is hard-coded; widened to `[0.3, 8000]` through the reachable property. **Zoom is uniform** (x and y together): a readable row at 10k tips needs k of about 300, which also magnifies the tree 300x horizontally |
| C | keyboard | P-M | none in the library (research); wrapper adds `tabindex=0`, `role=button` and Enter to every tip label (1 tab stop per tip, no roving tabindex) |
| C | context menu | Y-M | built-in menu on node click (collapse, select, reroot, hide); restyled with tokens; works, see reroot below |
| C | URL / shareable state | N-N | not found |
| D | hide built-ins | Y-M | `show-menu`, `brush: false`, `selectable: false`, `show-scale`, `show-labels` are options; the menu and brush are off by default in our wrapper |
| D | per-node / per-branch style callbacks | Y-M | `node-styler(g, node)` and `edge-styler(path, edge)`, called on every `update()`. **`display.refresh()` is broken for edge-styler**: it calls it with `d3.select(<TreeRender>)` (arrow-function `this`), measured: 3,998 calls, element kind `TreeRender`. The wrapper's styler guards against that |
| D | clade colouring | P-M | S4 pass (pixel check, control clade unchanged, clear restores, no layout change). Mechanism: edge-styler stroke on every branch below the clade (incl. its own), node-styler on circles, dots and labels; applied incrementally to the changed nodes only (30 to 50 ms for a 969-tip clade at 10k) |
| D | CSS tokens, dark mode, fonts | P-M | S9 pass. No CSS variables or dark mode in the library; we map `--pt-*` custom properties onto its fixed class names. Font size cannot be set from a token (details in `spike.json`) |
| D | custom columns | P-M | S7 partial. Node-styler appends SVG (rect, text, path) to each tip `<g>` at `shiftTip()` plus the measured label width, with `align-tips` on; header row appended from the `rendered` event; viewBox widened. Cells live in the zoomed group, so bar widths scale with the zoom (27x at the focus zoom) and the columns leave the view when zooming from the fit view. Rectangular only |
| D | alignment column | P-M | S8 pass at the fit view: one `<path>` per residue colour per tip (about 20 elements per tip) |
| D | internal-node markers, labels | Y-M | circles (radius `node_circle_size`, clamped to 0.75 x font size), `internal-names` option; turning labels on gives internal nodes their own rows (layout changes) |
| E | rectangular, radial, unrooted, mirrored | P-M | all four exist (`layout`, `is-radial`, `is-unrooted`). **Radial and unrooted size labels and circles from `scales[0]` (the rectangular row spacing), not from the tip gap**: on the 680-tip dated tree the ring radius is 4.7 units and the label font 0.9 units, so labels overlap about 20x and node circles are larger than the ring spacing; S12 failed until the wrapper derived a font and circle size from the median tip gap and overrode the inline font-size with `!important`. Unrooted in fit-to-size mode comes out small (reserves room for full-size labels). The radial layout leaves a wedge gap (last tip to first) |
| E | phylogram / cladogram | P-M | S11 pass (Pearson 1.0; tip spread 3.5e-16 on the dated tree). **If any branch has no length the constructor sets ALL lengths to 1** (`hasBranchLengths`), measured on `edge-polytomy-missing`; negative lengths clamp to 0 |
| E | scale bar, time axis | P-M | built-in d3 axis, but in rectangular layouts it is **about 20% too long** (nodes are placed at `scales[1] * .8` in `draw.js`, the axis spans the full range): the tips of a depth-100 ultrametric tree end at the 78 tick. The wrapper redraws the axis from the layout's own numbers. Radial axis is a single tick. No dated axis |
| E | collapse, hide, reroot | Y-M | `toggleCollapse` (spline blob; collapsed tips leave the DOM), reroot via menu. **`reroot()` replaces `tree.display` with a new `TreeRender`**, dropping every `display.on()` listener; the `rerooted` event is emitted on the new object before anyone can listen. The only hook is the DOM `reroot` CustomEvent on the container; the wrapper re-binds there. After a reroot the shared ids of clades on the old root path no longer exist (5 of 399 library nodes unmapped on a 200-tip tree) and are not reported |
| E | ladderize | P-M | wrapper uses d3 `count()` and `sort()` and re-lays out (ids stay right: 4/4 node clicks match ground truth in both orders). The library's own `resortChildren()` sorts by `d.value`, which is unset (S, not run) |
| E | overview, minimap, semantic zoom | N-M | none: every visible node is DOM at every zoom. The wrapper's LOD only hides label text under 3.5 px |
| E | export | P-S | `getNewick()`; SVG export is not in the library (a plain `<svg>` is easy to serialise); U |
| F | first render | M | `firstRenderMs`: 5 tips 34 to 56 ms; 200: 99 to 124 ms; 1k: 231 to 323 ms; 10k: 1.3 to 2.0 s; **100k: 18.6 s** (11.6 s inside `render()`, the rest browser layout and paint; load about 5). Custom yule trees by hand: 2k 0.5 to 0.9 s; 5k 1.0 to 2.0 s; 20k 8.4 s (load 11); 50k 18 s (load 14); so about 0.2 ms/tip when quiet, linear |
| F | parse | M | `new phylotree()` plus d3.hierarchy plus our comment strip: 1k 24 to 26 ms, 10k 56 to 109 ms, 100k 835 ms. The Newick parser is iterative (no depth limit) |
| F | DOM size, memory | M | **9.0 DOM nodes per tip** (9,034 at 1k, 90,034 at 10k, 900,034 at 100k: `g`, `text`, our dot, a `path` and a `<title>` per branch). JS heap 9 MB (1k), 38 MB (10k), 299 MB (100k) |
| F | pan and zoom, main-thread CPU per wheel step (`measure/cpu-probe.mjs`, load 9) | M | LOD build: 1k 24 ms, 2k 50 ms, 5k 102 ms, 10k 228 ms. **Library as shipped** (no LOD): 54, 97, 238, 506 ms. Stub reference: 21, 31, 84, 173 ms. 60 fps needs under 16 ms |
| F | drag cost, CPU per mousemove (LOD build) | M | 1k 12 ms, 2k 23 ms, 5k 78 ms, 10k 193 ms (stub 9, 25, 34, 53 ms); inferred to be per-event hit testing over every element, not profiled |
| F | why the zoom step is expensive | M | with label text hidden by CSS, layout time per step at 2k tips falls from 74 to 11 ms (`LayoutDuration`): SVG text is re-laid out on every zoom transform. That is what the wrapper's LOD exploits; the LOD roughly halves the CPU per step |
| F | click latency (pointerdown to library event) | M | 3 to 11 ms up to 200 tips, 37 to 59 ms at 1k, about 400 ms at 10k, 4.6 s at 100k; click to paint 92 to 123 ms at 1k, 850 to 1,000 ms at 10k, 32 s at 100k |
| F | max practical size | M | smooth (p5 >= 30 fps) to about 700 tips; borderline (p5 12 to 30) at 1k; below the 20 fps rule from 2k (p5 7 at 2k, by hand, load 6); unusable at 10k (3 fps, click 400 ms). First render stays under 10 s to roughly 30 to 50k tips and under 30 s (the shell's timeout card) to well beyond 100k (18.6 s at 100k when quiet), but the tab is unresponsive meanwhile |
| F | **estimate check** | M | the research estimate "smooth to 2 to 3k tips" **does not hold** on this machine (software raster, shared CPU; a laptop may be 2 to 3x faster, **U**); "laggy at 5 to 10k, unusable at 100k" holds |
| F | deep trees | N-M | the layout (`tree_layout` / `process_internal_node`) is recursive: **a caterpillar of 1,750 tips renders, 2,000 throws `RangeError: Maximum call stack size exceeded`** (Chromium 141 default stack); 10k and 20k fail in the runner. Also recursive: `selectAllDescendants`, `getSelection` (S). Parsing is iterative |
| G | Newick | Y-M | quoted labels with spaces, parentheses, doubled quotes work (edge-quoted-labels). **Square-bracket comments are not stripped**: `'Ursus arctos'[&note=x]` becomes the tip name `Ursus arctos[&note=x]` (M); the wrapper strips them before parsing (quote-aware pass) |
| G | Nexus | N-M | **TRANSLATE is not applied**: the hand-made multi-tree file gives tips `7,3,4,5,6,1,2` instead of names (Node, `type: 'nexus'`). Confirms the research. Our shell converts Nexus before the library sees it |
| G | phyloXML, NeXML | U | not run here; research says first phylogeny only, `DOMParser` needed, NeXML bug (S, research) |
| G | tree operations | P-M/S | reroot (works, replaces the display), collapse, hide, MRCA, `getNewick`, rooting helpers exist and are separable from the renderer (the model runs in Node) |
| G | id mapping | M | the wrapper maps library nodes to shared ids by preorder (fast path, verified), with a tip-set fallback (rank range) for reordered or rerooted trees; ladderize, mirror, unrooted and collapse keep every id correct |
| H | accessibility | P-M | none in the library. Wrapper: `role=img` and label on the `<svg>`, focusable tip labels with names; no text fallback, no reduced-motion handling needed (`transitions: false`) |
| I | licence detail | P-S | see G1; the missing `license` field is the only gap |
| J | cost to adapt | see below | |

## Cost to adapt

| Gap | Fix | Effort | Licence |
|---|---|---|---|
| React component, events, controlled colour/highlight/links, clean unmount | wrapper (done here) | a few days for a solid version with tests | MIT |
| Node ids and tip sets in events | mapping by preorder plus tip-set fallback; `node.leaves()` (done) | small, but every structural operation (reroot) needs re-mapping | MIT |
| Scale bar 20% wrong, radial/unrooted sizing, `[..]` comments, missing-length flattening, `refresh()` bug, `reroot()` swapping the display | wrapper workarounds (done: scale bar, ring sizing, comments, refresh guard, reroot re-bind) or small upstream patches; missing-length flattening has no wrapper fix (pre-fill lengths) | 1 to 2 days each to fix properly upstream; the workarounds now sit in our code | MIT, upstream pace uncertain |
| Columns that stay on screen and keep their width under zoom | needs non-uniform zoom or a separate column layer (HTML or canvas) aligned to the zoom state | rewrite of the zoom layer: about a week; not attempted | MIT |
| Scale beyond about 1k tips, deep trees, overview | not a patch: DOM per node and recursive layout. Use phylotree only as parser and tree model, and write a canvas/WebGL renderer | rewrite of the renderer (the research's conclusion holds) | MIT |
| Nexus TRANSLATE, phyloXML names, comments | our own format layer, needed whatever we choose | as in the research | n/a |

A realistic production wrapper for trees up to 1k tips is 1 to 2 weeks including tests (the research said about one week; the findings above add the id mapping, scale bar, ring sizing and reroot handling).

## Verdict

1. As a React-wrapped SVG viewer phylotree.js does everything the contract asks (click and hover with tip sets, clade colouring, highlight, links, aligned columns, radial, dark theme), but mostly through workarounds in the two styler callbacks, and only up to about 1k tips: 10k tips give 3 fps and 400 ms clicks, 100k tips need 19 s and 900,000 DOM nodes, and caterpillars deeper than about 1,800 overflow the stack.
2. The wrapper is the cost: ids, tip sets, a scale bar that is 20% off, ring layouts that need their sizes recomputed, `reroot()` that swaps the display object, comments and Nexus TRANSLATE handled outside the library, and columns that scale with a uniform zoom.
3. Use it, if at all, as a parser and tree-model library or for small trees; the 100k target needs a canvas or WebGL renderer.

## What surprised us

- The scale bar in rectangular layouts is wrong by about 20% (a `.8` factor in node placement that the axis does not share), so tips of a dated tree end at "78" instead of "100".
- `display.refresh()` hands the edge-styler the wrong object; `reroot()` silently replaces the whole display and its listeners, and its `rerooted` event is emitted into the void.
- Radial layouts size labels and nodes from the rectangular row spacing: on 680 tips the labels overlapped 20x.
- A missing branch length on one branch turns the whole tree into a unit-length tree.
- A 1,000-tip caterpillar renders but a 2,000-tip one overflows the stack.
- The cost of a zoom step is SVG text layout, not scripting: hiding labels under 3.5 px halves it. Mouse events still cost 12 to 190 ms each at 1k to 10k tips.
- The CommonJS lodash, a whole XML parser and half of d3 end up in the bundle although Newick-only use needs none of the first two.

## Differences from [../research/phylotree-js.md](../research/phylotree-js.md)

| Research said | Measured here |
|---|---|
| smooth to about 2 to 3k tips, laggy at 5 to 10k (estimate, unverified) | p5 12 to 30 fps at 1k even with a wrapper LOD, 7 fps at 2k, 3 fps at 10k; library as shipped is half as cheap per step (54 vs 24 ms CPU per wheel step at 1k). The 2 to 3k figure was optimistic by 2 to 3x on this machine |
| "render() adds a document listener ... leaks" | one listener in total (module-level function, deduplicated by the DOM): 1 after 5 cycles |
| `rerooted` is documented but never emitted | it is emitted (`rooting.js`), but on the new `TreeRender` that replaces `tree.display` (listeners lost); the DOM `reroot` event on the container is the only usable hook |
| bundle size UNVERIFIED | +325 KB minified, +109 KB gzip over the stub; lodash, underscore, fast-xml-parser not tree-shaken; jquery, moment, winston not bundled |
| `tree.render` into a container | `render()` builds a detached `<svg>`; the caller must append `display.show()`; the context menu needs a CSS selector string as container |
| zoom: `scaleExtent([0.1, 10])` | confirmed, and it can be widened through `display.zoomBehavior.scaleExtent`; zoom is uniform |
| Nexus: no TRANSLATE | confirmed by running it |
| scale and styling hooks "yes" | stylers work, but `refresh()` breaks the edge-styler and the scale bar is mis-scaled; radial sizing and comment handling were not mentioned |
| no mention of missing-length behaviour, recursion depth, 0.8 width factor | all measured above |

## Library options in the demo (what works, what breaks)

Tried through the demo's Library options card (`measure/features.mjs`): layout variants (mirrored works; unrooted works but starts small), align tips (works; forced on with columns), scale bar toggle, tip dots, ladderize (works, ids stay correct), collapse on click (spline blob, 2,034 to 1,745 DOM nodes, expands again), internal labels (works, internal nodes take rows), context menu (all items appear and are token-styled), reroot through the menu (works after the wrapper re-binds; 5 library nodes lose their shared ids; zoom and colouring keep working), hide labels LOD toggle. Not exposed: the library's brush (conflicts with pan), selection sets, size bubbles.

## Reproduce

```
cd spikes/phylotree-js && npm ci --ignore-scripts && npm run build && npm run typecheck
cd .. && node runner/run.mjs --candidate phylotree-js --trees smoke --port 5203
VITE_PT_LOD=0 npm run build          # library as shipped (no wrapper LOD), then run with --no-build
npm run dev -- --port 5303           # the demo
node measure/cpu-probe.mjs http://127.0.0.1:5203/ <newick> <label>   # see header comments in measure/*.mjs
```
