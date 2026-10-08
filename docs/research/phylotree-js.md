# phylotree.js, react-phylotree and other wrappers

Research date: 2026-10-08. Evidence is from a shallow clone of each repo (commits named below), npm registry JSON, GitHub issue/PR search, and the project README/paper. Nothing was executed or installed; "by code reading" means I read the source, not that I ran it. Anything I could not confirm is marked **UNVERIFIED**.

Code references use these commits:
- phylotree.js `7b61f5d` (2026-04-15, default branch HEAD at clone time): `https://github.com/veg/phylotree.js/blob/7b61f5d27f4e5176302033bd9b4ae873bd944cd8/<path>`
- react-phylotree `ac46984` (2021-10-08): `https://github.com/stephenshank/react-phylotree/blob/ac469844522fd0c9581ff87988daeea9617908b1/<path>`

## Summary

1. phylotree.js (v2.6.0, MIT, d3 v7) is a maintained-in-bursts, imperative SVG library with a real event emitter (`nodeClick`, `nodeHover`, `branchClick`, `selectionChange`, `collapsed`) and two per-element styling callbacks that hand you the raw d3 selection, so criteria 11 and 16 are met and 13 is feasible by hand.
2. It draws every visible node and branch as DOM elements and re-runs the whole draw on each update. There is no culling, no canvas path and no semantic zoom. Nobody publishes numbers; my estimate is smooth to about 2-3k tips, laggy beyond 5-10k, unusable at 100k. It fails criteria 3, 14 and 15.
3. Input handling is weaker than the README implies: the Nexus parser reads only the first tree and has no translate-table support; phyloXML takes the first phylogeny only; the NeXML parser has an evident bug. A GBIF-owned parsing layer is needed.
4. There is no usable React component. react-phylotree is a 2021 React 16 rewrite on phylotree 1.x, effectively abandoned. A React wrapper has to be written by us (useRef/useEffect, no `destroy()` exists upstream).
5. Verdict: usable only as a data model and layout engine (parsing, `d3.hierarchy` nodes, rerooting, collapse logic), or as an SVG renderer for trees up to a few thousand tips. Not a basis for the 100k target.

## Facts table

| Fact | Value | Source | Verified? |
|------|-------|--------|-----------|
| Repo | github.com/veg/phylotree.js | README | yes |
| npm package / latest | `phylotree` 2.6.0 (published 2026-03-14) | https://registry.npmjs.org/phylotree | yes |
| Licence file | MIT, "Copyright (c) 2016 iGEM/UCSD evolutionary biology and bioinformatics group" | `LICENSE` | yes |
| Licence field in package.json | **absent** (registry shows `license: null`) | `package.json`, registry | yes. Metadata gap only, the LICENSE file is MIT |
| d3 version | `d3 ^7.9.0` (full `d3` bundle, not split modules) | `package.json` | yes |
| Other runtime deps | `underscore`, `lodash`, `fast-xml-parser ^5.5.7`, plus `jquery`, `moment`, `winston`, `commander`, `csv-stringify`, `pretty-data` declared | `package.json` | yes (declared). `src/` imports only d3, underscore, lodash, fast-xml-parser (grep of imports); the rest are used by `bin/` scripts, **not verified** which |
| Dependency licences | d3 ISC; underscore, lodash, fast-xml-parser, jquery, moment, winston, commander, csv-stringify, pretty-data all MIT | npm registry `/latest` for each | yes |
| Entry points | `main: dist/phylotree.js` (UMD), `module: src/index.js` (ESM source), `types: dist/phylotree.d.ts` | `package.json` | yes |
| Build | rollup, UMD, `external` = all deps except d3 and fast-xml-parser (so d3 is inlined into the UMD build) | `rollup.config.mjs` | yes |
| Unpacked npm size | 919,651 bytes (unpacked, incl. src and dist; not a bundle size) | registry `dist.unpackedSize` | yes. Bundle size under a real bundler: **UNVERIFIED** (bundlephobia returned 429) |
| Downloads | 14,214 last month (2026-09-05 to 2026-10-04) | https://api.npmjs.org/downloads/point/last-month/phylotree | yes |
| Last commit (default branch) | 2026-04-15 (about 6 months before today) | `git log -1` of clone | yes |
| Open issues / PRs | 3 open issues and 5 open PRs (`total_count` of the issue search and PR search tools for `repo:veg/phylotree.js is:open`); newest open issue #523 (2026-07-08), newest open PR #521 (2026-07-06) | GitHub search API via MCP, 2026-10-08 | yes (counts as returned by the tool; the issue-search tool may or may not exclude PRs, so the split is slightly uncertain) |
| Old issues | Many old issues were closed in bulk on 2026-01-05 (e.g. #454, #63, #456, #409, #253 all `closed_at` 2026-01-05) | GitHub search | yes |
| Contributors | npm maintainers: maximumsteve, spond, dcallan (all @temple.edu or personal emails); GitHub contributor count not retrieved | registry `maintainers` | partially. Institutional backing (Temple Univ. / Pond lab, HyPhy project): inferred from emails, **UNVERIFIED** |
| Rendering | SVG via d3, one `<path>` per visible branch, one `<g>` per visible node containing `<text>`, optional `<circle>`, optional tracer `<line>` | `src/render/draw.js` `update()`, `src/render/nodes.js` `drawNode` | yes (code reading) |
| Zoom | d3.zoom on the whole `<g>`; `scaleExtent([0.1, 10])`; uniform CSS transform, no semantic zoom; off by default (`zoom: false`) | `src/render/draw.js` lines ~506-535 | yes |
| Input: Newick | yes, with quoted names, HyPhy `{tag}` annotations, NHX `[&&NHX...]` (only when delimiter set to `[`), BEAST `[&...]` via `type: "beast"` | `src/formats/newick.js`, `beast.js`, `registry.js` | yes (code reading), not run |
| Input: Nexus | `type: "nexus"` takes the first line starting with `TREE` in the first `BEGIN TREES;` block and hands the whole line to the Newick parser. **No `TRANSLATE` handling**: grep for "translate" in `src/formats` returns nothing. Only first tree. | `src/formats/nexus.js` lines 55-93 | yes |
| Input: phyloXML | `type: "phyloxml"`; first `<phylogeny>` only (console warning for more); node name taken from `taxonomy.scientific_name`; calls bare `DOMParser` (throws `ReferenceError` outside a browser); branch length from `branch_length` | `src/formats/phyloxml.js` lines 75-95 | yes (code reading) |
| Input: NeXML | parser exists in registry (`nexml`); line 21 has `roots > 0` comparing an array with a number (always false, falls back to the first node as root); NeXML not auto-detected | `src/formats/nexml.js` | yes (code reading), not run |
| Format auto-detect | none: a string is treated as Newick unless `options.type` is set | `src/main.js` lines ~151-170 | yes |
| Events | `tree.on(name, cb)`; names in code: `nodeClick(node, event)`, `nodeHover(node, event)` (mouseenter only), `branchClick(edge, event)`, `selectionChange(nodes)`, `collapsed(node, state)`, `rendered`, `setChange` | `src/render/event-emitter.js`; emit sites in `nodes.js:52,56,203,207`, `edges.js:14`, `menus.js:421`, `events.js:35`, `draw.js:539`, `selection-sets.js:144` | yes |
| Documented but never emitted | `contextMenu` and `rerooted` appear in the emitter's doc comment; the only `emit(` sites are the ones above. Open issue #523 (2026-07-08) reports `contextMenu` is not emitted | grep of `emit(`; https://github.com/veg/phylotree.js/issues/523 | yes |
| Styling callbacks | options `node-styler(container, node)` and `edge-styler(container, edge, transition)`; called on every update for every node/edge | `src/render/nodes.js:215`, `edges.js:55-56`, `draw.js:131-132` | yes |
| Custom labels | `tree.display.nodeLabel(fn)` replaces the label text accessor | `src/render/nodes.js` `nodeLabel` | yes |
| Tip alignment | option `align-tips`; draws tracer lines to the right-most leaf; `display.shiftTip(d)` gives the x offset | `src/render/nodes.js` `shiftTip`, `drawNode` | yes |
| Programmatic selection | `display.selectNodes(names[])`, `deselectNodes`, `clearSelection`, `getSelection()`, `modifySelection(...)`; `initial-selection` render option. Name matching is `names.includes(...)` per node | `src/render/menus.js:492-541`, `draw.js:176-181` | yes |
| Programmatic focus/zoom-to-node | **none found**. `display.zoomBehavior` and `display.svg` are reachable properties, so a zoom transform can be applied by hand | grep for zoomTo/focus/center in `src/` returns nothing relevant | yes (absence by grep) |
| Teardown | no `destroy`/`dispose`/`unmount` anywhere in `src/` (grep). `render()` adds a `document`-level listener (`phylotree.event`) and a capturing `click` handler on the container | grep; `draw.js:160, 283-289`; `events.js` | yes |
| Built-in UI | context menu (collapse, hide, reroot, selection) shown on node click unless `show-menu: false`; brush selection overlay on by default (`brush: true`) | `src/render/menus.js`, `draw.js:105` | yes |
| Types | `types/phylotree.d.ts` (551 lines), copied to `dist/`. `RenderOptions` omits several real options (`node-styler`, `edge-styler`, `responsive`, `initial-selection`, `selection-mode`, `css-classes`); imports types from `d3-hierarchy` | `types/phylotree.d.ts` lines 44-94; `draw.js` defaults | yes |
| CSS theming | fixed CSS class names (overridable through `css-classes` option), `phylotree.css` (91 lines) and `phylotree-menus.css`; grep finds no `var(--` and no dark-mode rule | `phylotree.css`, `src/render/options.js` | yes |
| Accessibility | no `aria-*` or `role` on SVG nodes; menu items carry `tabindex="-1"` and one `role="menu"` | grep of `src/render` | yes |
| Responsive | option `responsive: true` switches the SVG to a `viewBox` with `width: 100%` | `draw.js:261-268` | yes |
| Large-tree support in the repo | issue #63 (2018) describes a "large tree" example with a detailed tree plus a "guide" overview tree that syncs selection only; collapse/hide not synced. The paper says only that the library can "display large trees" and shows a scrollable view with an inset. No tip counts or timings in README, paper or code. | https://github.com/veg/phylotree.js/issues/63 ; https://pmc.ncbi.nlm.nih.gov/articles/PMC6060545/ | yes (statement that no numbers are published) |
| Reported lag | issue #454 (2024): "lag when scrolling the slider" for a radial tree with "too many tips"; no tip count; closed 2026-01-05 in the bulk close | https://github.com/veg/phylotree.js/issues/454 | yes |
| Collapse | `toggleCollapse(node)` sets `collapsed`, relayouts with `compression` factor (default 0.2) and draws a spline blob via `updateCollapsedClades`; hide removes nodes | `src/render/events.js:11-39`, `clades.js` | yes (code reading) |

Correction of earlier notes in `comparison.md`: "Nexus annotations only" is right in spirit but understated (see the Nexus row); "Selection callback documented... node click handlers likely" is now verified (the `nodeClick` event exists); "No React component found" is right for the library itself.

## Criteria scorecard (phylotree.js, as shipped)

| # | Criterion | Score | Evidence |
|---|-----------|-------|----------|
| 1 | Pure browser, static deploy | Yes | README "Runs entirely in the browser". Caveat: phyloXML parser needs `DOMParser`. |
| 2 | Embeddable component (npm, framework-agnostic or React) | Partial | npm ESM + UMD + types; framework-agnostic imperative API; no React component. |
| 3 | 100k+ tips responsive | No | SVG, whole tree redrawn per update, no culling (see Scale section). |
| 4 | Newick, Nexus, phyloXML (NeXML nice) | Partial | Newick good; Nexus first tree only, no translate; phyloXML first phylogeny, name from taxonomy; NeXML buggy. Nothing auto-detected. |
| 5 | Programmatic API: highlight, focus, metadata | Partial | `selectNodes`, `getNodeByName`, `node_styler` for highlight; arbitrary data on `node.data`; no focus/centre/zoom-to-node. |
| 6 | Layouts | Yes | rectangular, radial (`is-radial`), unrooted (`is-unrooted`), right-to-left (`draw.js` defaults, `unrooted.js`, `radial.js`). |
| 7 | Licence | Yes | MIT; deps ISC/MIT. Add the missing `license` field to our own audit notes. |
| 8 | Maintenance | Partial | 83 npm versions since 2016 but long gaps (2.0.1 on 2024-01-17, then 2.1.0 on 2025-01-28); active Dec 2025 to Mar 2026 (2.2.0 to 2.6.0); last commit 2026-04-15; bulk issue closure 2026-01-05; small team. Not dead, not reliable. |
| 9 | Accessibility, theming, mobile | Partial | CSS classes and `responsive` viewBox; d3.zoom handles touch; no CSS variables, dark mode or ARIA. |
| 10 | Export | Partial | `getNewick()`; SVG/PNG export is not in the library (**UNVERIFIED** whether the demo `index.html` has one); the DOM is a plain SVG so serialising it is easy. |
| 11 | Interaction callbacks | Yes | `nodeClick`/`nodeHover`/`branchClick`/`selectionChange` pass the d3-hierarchy node (with `.data`). Gaps: tips are clickable only on the text label (tips have no circle); hover has no leave event; `contextMenu` is not emitted. |
| 12 | React integration | No (library), Partial (wrapper needed) | No component, no `destroy()`, state lives in the instance. A wrapper can feed props into `selectNodes`, `node-styler` closures and `zoomBehavior.transform`, but controlled viewport/selection is ours to build. |
| 13 | Custom node/tip rendering | Partial | `node-styler(selection, node)` receives the node's `<g>` (translated to the node), so you can append arbitrary SVG; tips aligned via `align-tips` + `shiftTip`. No column abstraction, no React-rendered content (would need `foreignObject` or an HTML overlay). Must be idempotent (called on every update). |
| 14 | Semantic zoom | No | Zoom is a uniform transform; collapse is manual; no level-of-detail. |
| 15 | Scale stated as numbers | No (nothing published) | No benchmark in README, paper, tests or issues. See estimate below. |
| 16 | Styling hooks | Yes (callbacks), Partial (theming) | `node-styler`, `edge-styler`, `nodeLabel`, `css-classes`, `font-size`; no CSS variables or dark mode. |

## Scale: where the SVG ceiling bites

Evidence from code (not measurements):
- `TreeRender.update()` (`draw.js:313-540`) runs `placenodes()`, `syncEdgeLabels()`, then a d3 data join over **all** visible links and nodes with `.each(drawEdge)` / `.each(drawNode)`, and calls `node_styler` for each node. Selection changes, collapse and re-layout all go through it. There is no viewport culling and no incremental update.
- Per tip: one branch `<path>`, one `<g>`, one `<text>`, plus a tracer `<line>` when tips are aligned, plus a `data-node-name` attribute. Per internal node: a `<path>`, a `<g>`, a `<circle>`. A binary tree with N tips therefore has roughly 5N to 6N DOM elements with aligned tips, before any custom columns. Every custom column cell added through `node_styler` adds more.
- `selectNodes(names)` does an `Array.includes` scan per node, so highlighting k tips is O(N*k) plus a full redraw.

My estimate (UNVERIFIED, to be measured in the spike): smooth pan/zoom and updates up to about 2-3k tips with a couple of columns; noticeable lag on every collapse or selection at 5-10k; unusable at 20k+; 100k is out of reach (hundreds of thousands of DOM elements and a full rebuild per interaction). The only mitigation in the library is collapse/hide plus the guide-tree pattern from issue #63. The jsPhyloSVG paper's "slows beyond about 2,000 nodes" (from `comparison.md`, second-hand) is the same class of limit.

Could a canvas/WebGL backend be swapped in? Not cleanly. Drawing is fused with layout state inside `TreeRender` (1,493 lines): coordinates are stored on nodes as `screen_x`/`screen_y` and written as DOM attributes, and interaction is DOM events. The reusable parts are the data model (`Phylotree`: parse, `d3.hierarchy`, rerooting, `mrca`, traversal, `getNewick`) and layout arithmetic. Realistic plan: use phylotree for parsing and tree operations only, and write our own renderer (canvas or WebGL, with LOD) on its nodes. That is a renderer rewrite, not a plugin.

## What a GBIF React wrapper would need to add

1. A `<PhyloTree>` component: `useRef` container, `useEffect` to construct `new phylotree(...)`, `tree.render({container, width, height, zoom: true, 'show-menu': false, brush: false, 'align-tips': true, responsive: true, 'node-styler', 'edge-styler'})`, and cleanup that removes the SVG, the container click handler and our `on(...)` listeners (upstream has no teardown, and leaves a `document` listener).
2. Controlled props: `highlightedTips` / `focusTip` mapped to a styler closure over a ref plus a `display.update()`; `onTipClick(node)` bound through `display.on('nodeClick', ...)`, with a ref so React state changes do not re-render the tree. Re-render only on tree change.
3. Focus and viewport: compute the node's `screen_x/screen_y` from `display` and apply `d3.zoomIdentity` through `display.zoomBehavior.transform`, remembering that the zoom handler composes with `baseTransform`. Needs a controlled `viewport` prop, which phylotree does not model.
4. Tip clicks: the click target is the `<text>`; add our own larger hit area in `node-styler` if tips need a point target.
5. Format layer (ours): detect format; a Nexus reader with translate table, multiple trees and `[&R]` comments; phyloXML with `<name>` and `<confidence>`; NeXML fixes; tip-to-GBIF matching with an explicit unmatched list.
6. Tip columns: in `node-styler`, append idempotently to leaf `<g>` at `display.shiftTip(d)` plus an offset for each column; Canvas or HTML overlay for heavy columns; a tooltip layer in React. Row hit-testing must be our own.
7. LOD for large trees: pre-collapse clades below a size threshold on load (`toggleCollapse`) and show summaries (counts) in a styler. This stretches the ceiling but does not remove it.
8. Theming: map GBIF design tokens to CSS rules on `.phylotree-container` classes; no dark mode out of the box.

## Maintenance evidence

- npm: 83 versions, created 2016-09-27, modified 2026-03-14. Release gaps: 2.0.1 (2024-01-17) to 2.1.0 (2025-01-28) to 2.1.1 (2025-08-12); then 2.2.0 (2025-12-05), 2.3.0 (2026-01-05), 2.4.0 (2026-01-10), 2.5.0 (2026-02-13), 2.6.0 (2026-03-14). Source: registry `time`.
- Repo HEAD: 2026-04-15; nothing newer on the default branch as of the clone.
- Issue tracker: bulk close on 2026-01-05; a new issue on 2026-07-08 (#523) and an external docs PR (#521, 2026-07-06) are open with no replies found.
- The 2025-12 to 2026-04 burst added the event emitter, unrooted layout, selection sets, TypeScript types and a Nexus/BEAST parser, which suggests renewed activity, possibly AI-assisted (commit messages not inspected, **UNVERIFIED**).
- Bus-factor: three npm maintainers, one organisation (veg / HyPhy). No evidence of funding either way.

## Licence analysis

MIT per the `LICENSE` file; `package.json` has no `license` field, so automated licence scanners will report "UNKNOWN" for `phylotree`. All declared dependencies are MIT or ISC. No GPL/AGPL anywhere in the declared tree. Fine for gbif.org embedding. Action: pin the version, and note in our dependency policy that the licence rests on the LICENSE file.

## Other React wrappers and forks

| Package | What it is | Evidence | Verdict |
|---------|-----------|----------|---------|
| `react-phylotree` 0.5.0 | React 16 SVG renderer that uses phylotree **1.x** for parsing/layout only | npm: published 2021-10-08, 757 downloads/month; `package.json` deps `react ^16.13`, `d3 ^5.7`, `phylotree "1"`, `bootstrap 4.3.1`, FontAwesome; README says "Under development"; repo HEAD 2021-10-08 | Abandoned. Do not depend on it. Useful as a pattern. |
| react-phylotree licence | `package.json` says MIT; **no LICENSE file in the repo**; open issue #11 (2025-06-16) asks for one | https://github.com/stephenshank/react-phylotree/issues/11 | Licence is ambiguous at repo level |
| react-phylotree API | Props: `tree` or `newick`, `width`, `height`, `showLabels`, `maxLabelWidth`, `alignTips` ("right"), `accessor`, `branchStyler(nodeData)`, `labelStyler(nodeData)`, `tooltip` component, `sort`, `includeBLAxis`, `internalNodeLabels`, `highlightBranches`, `onBranchClick(link)`, `skipPlacement`. It is a `<g>` meant to be placed in your own `<svg>`. | `src/phylotree.jsx`, `src/branch.jsx` | Real React rendering means React-rendered tooltips and easy extra elements, but it recomputes layout and `text_width` on every render with no memoisation (`phylotree.jsx` body), one `<path>`+`<line>`+`<text>` per branch as React elements, so worse than d3 at scale. Only branch clicks, not label clicks. |
| `@giap/phylotree` 1.1.3 | "Phylotree with react", CRA app packaged, React 17, phylotree ^1.0.10 | npm, 2022-01-23 | Stale app, not a library. |
| `annotated-phylotree` 0.1.2 | React 18 radial tree (repo cwf30/react-tree); CRA + semantic-ui deps, no licence in registry | npm, 2023-05-25 | Stale, unlicensed. |
| `geoseeq_phylotree` 1.0.1 | Fork of phylotree.js ("not flexible enough... modified the package") with d3 6 | npm, 2025-01-30; no licence or repo field | Private-style fork, skip. |
| `@lichong/phylotree` 2.1.9 | Republish of upstream | npm, 2025-08-18 | Skip. |
| `hyphy-vision` 2.15.10 | HyPhy results app (MIT) built on react-phylotree 0.4.3, phylotree 0.1.6, d3 3.x, jquery-ui | npm, 2024-11-26 | Application-level, very heavy and dated. Skip. |
| `@phylotree/*`, `phylotree-react` | Not on npm (registry 404) | registry | n/a |
| `@datagrok/phylo-tree-viewer` 1.4.1 | Datagrok-platform plugin on deck.gl and `@phylocanvas/phylocanvas.gl` | npm, 2026-07-12 | Platform-bound; relevant only as a Phylocanvas.gl usage example (other researchers' scope). |

Lead worth a look by someone else: **`react-bio-viz` 0.3.0** (MIT, React 18/19, published 2026-10-07/08, repo holmrenser/react-bio-viz, 7 stars). README lists a `PhyloTree` (rectangular, cladogram, radial, collapse, reroot, node and branch click callbacks, per-node/branch styles, search) and a canvas MSA viewer, with the claim that "an alignment, its distance matrix and its tree can share one row order". Rendering tech and scale of `PhyloTree` are not stated in the README or the docs home page I fetched. It is days old (npm versions 0.1.0 to 0.3.0 within two days, after a 2024 gap), so maintenance and API stability are **UNVERIFIED**. It matches criteria 11-13 on paper and deserves its own source-level check.

## Extension effort (to meet GBIF criteria)

| Gap | Effort |
|-----|--------|
| React component, events to callbacks, controlled highlight | Thin wrapper (about a week for a solid one including teardown and tests) |
| Nexus translate/multi-tree, phyloXML names/confidence, NeXML fix, format detection | Our own parser layer; small patch upstream is possible but upstream pace is uncertain |
| Zoom-to-node / viewport control | Small patch or wrapper code over `zoomBehavior` |
| Tip-aligned columns, badges, tooltips | Plugin-style code on `node-styler`; feasible for hundreds to low thousands of rows |
| CSS-variable theming, dark mode, ARIA | Small patch to CSS plus wrapper |
| 100k tips, semantic zoom, LOD | Rewrite of the renderer (keep parsing and tree model) |

## Risks

- Scale ceiling is architectural, not a bug to fix.
- Upstream activity is bursty and tied to a small team; the DOM-coupled event system was added only recently (2.x), so APIs may still shift. Pin versions.
- Parser gaps would silently mislabel Nexus tips (numeric labels without translate) if we relied on it.
- No teardown: leaked document listener and capturing click handler per `render()`.
- `d.ts` omits real options and relies on `d3-hierarchy` types not declared as a dependency.
- Missing `license` field breaks automated licence checks.

## Open questions for hands-on testing

1. Measure load time, pan/zoom frame rate and `update()` cost at 1k, 5k, 20k tips with 0 and 3 `node-styler` columns (confirm or correct the estimate above).
2. Does a Nexus file with a translate block really keep numeric labels? (Code says yes.)
3. What happens to listeners and DOM after calling `render()` twice in one container, and after React unmount?
4. Can `zoomBehavior.transform` plus `baseTransform` give a reliable centre-on-tip?
5. Does `collapse + compression` give a usable pre-collapsed view for 20k tips?
6. Bundle size with Vite/webpack tree-shaking (ESM entry is source `src/index.js`; underscore and lodash are both pulled in).
7. Are `react-bio-viz`'s `PhyloTree` rendering tech and scale adequate? (separate check)
