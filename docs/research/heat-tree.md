# Heat-tree (`@grunwaldlab/heat-tree`)

Research date: 2026-10-08. Evidence is from shallow clones of https://github.com/grunwaldlab/heat-tree (JS library, commit `2634290448270a4b095256a1c6ca7aaa80da0a75`, 2026-05-08) and https://github.com/grunwaldlab/heattree (R wrapper, commit `ae7b403`, 2026-05-08), the npm registry, GitHub issue search and the arXiv abstract page. Nothing was executed. Code references are `https://github.com/grunwaldlab/heat-tree/blob/2634290448270a4b095256a1c6ca7aaa80da0a75/<path>`.

## Summary

1. Heat-tree is an MIT, d3-only SVG widget (a function `heatTree(container, trees, options)` that builds its own toolbar and legends inside a Shadow DOM) from Oregon State University's Grunwald lab, with R and Python wrappers. It is built for reports and notebooks, not for host-app control.
2. It parses Newick and, notably, Nexus with TRANSLATE tables and several trees (the best Nexus handling of the four tools in this batch), but its Newick parser is naive (no quoted labels or comments) and there is no phyloXML or NeXML.
3. Interaction is closed: tip and subtree clicks select a node inside the widget (private `#selectNode`) and show built-in buttons (collapse, hide, reroot, rotate). There is no click, hover or selection callback, no highlight/focus/search API, no per-tip columns. The only data hooks are metadata tables that map to tip label colour, size, font, style and text.
4. Rendering is SVG with transitions (default 500 ms), full node-group joins and no culling. No scale numbers are published anywhere (README, docs, arXiv abstract). By code reading it is a small to medium tree tool.
5. Verdict: reject as an embedded component for gbif.org; useful as a UX and legend/aesthetics-mapping reference and for its Nexus translate code. Repo hygiene issues: no LICENSE file in the JS repo, README names the wrong npm package.

## Facts table

| Fact | Value | Source | Verified? |
|------|-------|--------|-----------|
| JS repo | https://github.com/grunwaldlab/heat-tree | `package.json` | yes |
| R wrapper | https://github.com/grunwaldlab/heattree (CRAN-style package v0.3.1, "MIT + file LICENSE") | `DESCRIPTION` of that repo | yes |
| Python wrapper | https://grunwaldlab.github.io/heattree_py/ (linked from the R README); not inspected | R `README.md` | link yes, contents **UNVERIFIED** |
| Docs | https://grunwaldlab.github.io/heat-tree/ (VitePress) | README | link yes |
| Paper | arXiv:2605.01109, "Heat-tree: Cross-platform software for interactive and embeddable phylogenetic tree visualization and editing", Foster, Chang, Grunwald, submitted 1 May 2026 (q-bio.PE). The abstract page says nothing about tree size, performance or rendering library | https://arxiv.org/abs/2605.01109 | yes (abstract only; full text not read) |
| npm package | `@grunwaldlab/heat-tree` 0.3.1. Versions: 0.1.0 2026-01-06, 0.1.1 and 0.1.2 2026-01-09, 0.2.0 2026-01-15, 0.3.0 2026-04-14, 0.3.1 2026-04-16 | https://registry.npmjs.org/@grunwaldlab%2fheat-tree | yes |
| Wrong name in docs | README and `docs/guide/installation.md` say `npm install heat-tree` and a CDN path `unpkg.com/heat-tree/dist/heat-tree.iife.min.js`. The unscoped `heat-tree` package was created and **unpublished** on 2026-01-06; `package.json` "main" is `dist/heat-tree.umd.min.js`, not `.iife.min.js` | registry `heat-tree` JSON; `package.json`; docs | yes |
| API mismatch in README | README documents `{newick: ...}` per tree; the code requires `treeConfig.tree` (`throw new Error("Tree at index N is missing tree string")`); `docs/guide/*.md` and `demo/index.html` use `tree:` | `src/index.js` (loop over `treesInput`); `README.md`; `docs/guide/getting-started.md:52` | yes. A copy-pasted README example would throw |
| Licence | package.json `"license": "MIT"`; README "MIT". **No LICENSE file in the JS repo root** (listing: CHANGELOG.md, README.md, demo, docs, notes, package*.json, scripts, src, vite/vitest configs). The R repo has `LICENSE` | `package.json`; `ls` of clone | yes |
| Dependencies | `d3 ^7.9.0` (ISC), `vanilla-picker ^2.12.3` (ISC) | `package.json`; registry | yes |
| Module formats | ESM (`dist/heat-tree.es.min.js`), UMD (`dist/heat-tree.umd.min.js`); `"type": "module"`; no `types` field, no `.d.ts`; JSDoc only | `package.json` | yes |
| Downloads | 54 in the last month | https://api.npmjs.org/downloads/point/last-month/@grunwaldlab/heat-tree | yes |
| Last commit | 2026-05-08 (README citation link) by Niklaus Grunwald; npm last publish 2026-04-16 | `git log`; registry | yes |
| Issues | 8 matching `repo:grunwaldlab/heat-tree` (all-state search). Example open: #8 "Support nexus format as input" (2026-04-10) although `src/nexusParser.js` exists | GitHub search | yes (issue #8 may be stale) |
| People / backing | Zachary Foster (author, maintainer of the R package), Niklaus Grunwald (Oregon State); R `DESCRIPTION` lists "USDA Agricultural Research Service" as funder (`fnd`); npm maintainers: zachary-foster, cworthy, ngrunwald | `DESCRIPTION`; registry | yes |
| Rendering | One SVG (`document.createElementNS(..., 'svg')`) inside `.ht-tree`; node groups `<g class="node">` each holding an optional triangle `<path>`, a collapsed-root `<line>`, tip `<text>` and interior `<text>`; branches as paths; invisible `.hit`, `.tip-hit`, `.collapsed-hit` paths/rects in a hit layer. d3 data joins with enter/update/exit and a transition per update (default `transitionDuration` 500 ms) | `src/index.js`, `src/treeView.js:895-990, 1280-1380` | yes (code reading) |
| Zoom/pan | `d3.zoom`; `fitToView` with auto zoom/pan modes; manual zoom can be disabled for scrolling documents | `src/treeView.js:242, 509`; README options | yes |
| Layouts | `rectangular` and `circular` only | README; `treeState` layout setter | yes |
| Input formats | Newick string; Nexus (`#NEXUS` first line): all `BEGIN TREES;` blocks, every `TREE` command (named, multiple trees selectable in the Data tab), **TRANSLATE table applied** (numeric keys only: pattern `^(\d+)\s+(.+)$`). Metadata TSV/CSV. R wrapper accepts `ape::phylo`. **No phyloXML, NeXML, NHX/BEAST annotations** | `src/nexusParser.js`; `src/parsers.js`; `src/index.js` | yes (code reading) |
| Newick parser limits | label = text up to `,` or `)`, split on first `:`; no quote handling, no `[...]` comments (so `[&R]` or BEAST annotations leak into labels), commas or parentheses inside quoted names break parsing; throws on trailing characters | `src/parsers.js:13-60` | yes (code reading) |
| Metadata join | TSV/CSV; the ID column is auto-detected as the column whose values best match node names; match is exact string equality (`valid_ids.has(value)`); unmatched rows are not surfaced as such in the code I read | `src/parsers.js` `parseTable` (match counts) | yes for exact matching; unmatched reporting **UNVERIFIED** |
| Aesthetic mappings | `tipLabelText`, `tipLabelColor`, `tipLabelSize`, `tipLabelFont`, `tipLabelStyle`, plus node label and branch/node shape settings; categorical and continuous scales (viridis-based) with legends | README "Available Aesthetics"; `src/aesthetic.js`, `src/scales.js`, `src/legends.js` | yes |
| Return value of `heatTree()` | `{treeDataInstances, treeStateCache, treeViewCache, getCurrentTreeState, getCurrentTreeView, getCurrentTreeName, switchToTree, addNewTree, container, shadowRoot}`; no `destroy()` | `src/index.js` end | yes |
| Events | internal pub/sub exists: `TreeState.subscribe(event, cb)` with events such as `coordinateChange`, `layoutChange`, `legendsChange`, `tipLabelColorChange`; it signals state changes, not user clicks. Selection is a private method: `#selectNode(node)` only updates the selection rectangle and buttons, emits nothing; `treeView.selectedNode` is a readable field | `src/utils.js:224-245`; `src/treeState.js` notify calls; `src/treeView.js:256-292, 680-692` | yes |
| Highlight/search/focus API | none found: grep for highlight/search/focus/zoomTo in `src/treeView.js` and `src/treeState.js` finds only `fitToView`. Programmatic state: `treeState.collapseSubtree/expandSubtree/hideSubtree/rotateSubtree(node)`, `fitToView()` | grep; `src/treeState.js:320-390` | yes (absence by grep) |
| Isolation / theming | `isolation: 'shadow'` (default) attaches an open Shadow DOM and injects `styles.css`; `styles.css` contains 2 `var(--` uses and no `prefers-color-scheme`/dark rules; colours come from JS aesthetics. Page CSS cannot reach inside (the point of the option); `isolation: 'none'` injects into `document` | `src/index.js`; `src/styles.css` | yes |
| Accessibility | no `aria-`/`role` attributes in `src/*.js` (non-test) | grep count 0 | yes |
| Export | SVG and PNG (`exporter.js`), Newick (per the architecture notes) | `src/exporter.js`; `notes/architecture/summary.md` | yes for SVG/PNG code; Newick export code not located, **UNVERIFIED** |
| React usage | no React example, component or mention in README/docs (grep). Usable via `useRef`/`useEffect` around the imperative function; the wrapper must clean up (no `destroy`; the widget also adds `document` listeners from the colour picker, `aesthetic.js:463,495,633-634`) | grep; `src/aesthetic.js` | yes |
| SSR | `heatTree` touches `document` immediately; module import itself not checked | `src/index.js` | import-time safety **UNVERIFIED** |
| Tests | vitest unit tests for parsers, treeData, treeState; browser tests via playwright dev dependency | `package.json`; `src/*.test.js` | yes |
| Documented scale | none (README, docs, notes, arXiv abstract). Architecture note says only "Light weight, fast, and scalable" as a design aim | `notes/architecture/summary.md` ("Design philosophy"); grep for numbers found none | yes (no numbers) |

## Criteria scorecard

| # | Criterion | Score | Evidence |
|---|-----------|-------|----------|
| 1 | Pure browser, static deploy | Yes | no server component; npm/UMD/ESM. |
| 2 | Embeddable component | Partial | `heatTree(selector, ...)` imperative widget with Shadow DOM; no React component, no types, no destroy; docs name the wrong package. |
| 3 | 100k+ tips | No | SVG + per-node groups + transitions + no culling; no numbers. |
| 4 | Formats | Partial | Newick, Nexus with translate (good); naive Newick; no phyloXML/NeXML. |
| 5 | Programmatic API: highlight, focus, metadata | Partial / No | metadata tables via API: yes. Highlight/focus: none. State changes (collapse/hide/reroot/rotate) callable on `TreeState`. |
| 6 | Layouts | Partial | rectangular and circular; no unrooted. |
| 7 | Licence | Partial | MIT declared in `package.json` and README, but the JS repo has no LICENSE file (R repo does). Needs the authors to add it before we rely on it. Deps ISC. |
| 8 | Maintenance | Partial | 6 releases in Jan to Apr 2026, last commit 2026-05-08, USDA-ARS funded lab, active paper; but 5 months quiet, 54 downloads/month, a docs/README/package-name mismatch and 1 maintainer doing most work. Young. |
| 9 | Accessibility, theming, mobile | Partial | mobile stated as a design goal ("no mouse hover or right click effects"); Shadow DOM blocks external CSS; no ARIA; no design tokens or dark mode. |
| 10 | Export | Yes | SVG and PNG exporter; Newick per notes (code not located). |
| 11 | Interaction callbacks | No | no click/hover/select callback; internal `subscribe` is for state changes; selection is private. |
| 12 | React integration | No | not provided; wrapper would need `useRef`/`useEffect`, and cannot read selections without patching. |
| 13 | Custom node/tip rendering | No | only colour/size/font/style/text of tip labels from metadata; no columns, badges or injected content. |
| 14 | Semantic zoom | No | manual collapse/hide; no zoom-driven LOD. |
| 15 | Scale as numbers | No | nothing published. |
| 16 | Styling hooks | Partial | aesthetic mappings (data-driven colour/size) are strong; no per-node style callback; Shadow DOM isolates CSS theming. |

## Maintenance evidence

- npm: created 2026-01-06; six versions to 0.3.1 on 2026-04-16 (registry `time`). The unscoped name `heat-tree` was published once and unpublished within five minutes on 2026-01-06.
- Repo HEAD 2026-05-08; CHANGELOG says "0.3.0 First version with changelog" (2026-04-14); the R package says "The first stable version released on CRAN" (R `NEWS.md`).
- Downloads: 54/month. Issues: 8 total in all states.
- Backing: academic lab (Oregon State), USDA-ARS funding noted in the R package metadata; paper preprint May 2026.
- Active study of the design is visible in `notes/tasks/*.md` and `notes/architecture/*.md` (planning documents in the repo), which suggests an organised roadmap, but also AI-assisted planning is plausible (**UNVERIFIED**).

## Licence analysis

MIT declared (package.json, README, R `DESCRIPTION`: "MIT + file LICENSE"). The JS repo lacks a LICENSE file, so the grant is only metadata-level; ask the authors to add one (a one-line issue or PR) or rely on the `package.json` field. Dependencies are ISC (d3, vanilla-picker). The arXiv paper is CC BY 4.0, which is irrelevant to the software licence. No copyleft in the tree.

## Extension effort

| Need | Effort |
|------|--------|
| Click/hover/select callbacks | Small patch (emit from `#selectNode` and node-group handlers), but the selection model is a single node with built-in action buttons. |
| Highlight/focus/search from outside | Small to medium patch (state field + zoom transform helper). |
| React component with controlled props | Thin wrapper after the above patches; without them, impossible. |
| Per-tip aligned columns, counts, badges | Large: `TreeView` has no column or decoration concept; the layout engine (`scaling.js`, `treeState.js`) allocates space for labels only. |
| Semantic zoom, 100k tips | Rewrite of `TreeView` (1,586 lines of d3 joins and transitions); `TreeData` (494 lines) and parsers could be reused. |
| Formats beyond Newick/Nexus | Add parsers; `TreeData.parseTrees` is the entry point. |

## Risks

- Documentation errors (`newick:` vs `tree:`, wrong npm name, CDN filename) mean the docs cannot be trusted verbatim; check the code.
- Missing LICENSE file in the JS repo.
- Closed selection model and Shadow DOM make host-page integration awkward.
- Very small user base; the project's centre of gravity is R/Python reports.
- Naive Newick parser would corrupt labels with quotes, commas or comments.
- Transitions on every update add cost at larger sizes.

## Open questions for hands-on testing

1. Time and memory to load and render 1k, 5k, 20k tips; interaction cost of collapse with 500 ms transitions.
2. Does the Nexus translate path work with quoted names and `[&R]` comments? (Code suggests comment text leaks into the tree string via the `(?:\[\S+\])?` pattern only for a single token.)
3. How unmatched metadata rows or tips are shown (criterion in goal story 3).
4. Whether the full arXiv text (not read) states target sizes or benchmarks.
5. Can the widget be mounted and unmounted repeatedly in React without leaking document listeners?
6. Would the authors accept callback and highlight PRs? (Ask via an issue; low-cost test of responsiveness.)
