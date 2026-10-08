# Phylocanvas.gl, react-phylogeny-tree-gl, PhyloScape, Microreact - source-level verification

Researched 2026-10-08. Sources read: GitLab repo `gitlab.com/cgps/phylocanvas/phylocanvas.gl` (cloned, 60 commits), npm tarball `@phylocanvas/phylocanvas.gl@1.64.1` (downloaded, read only), docs at https://www.phylocanvas.gl/docs/*, GitHub `mkoliba/react-phylogeny-tree-gl` (cloned), PhyloScape paper full text via Europe PMC (PMC12243251) and repo `github.com/SciDataLab/PhyloScape` (cloned). Paths relative to the respective repo. UNVERIFIED = not confirmed.

## Summary

- Verdict: **Phylocanvas.gl is MIT-licensed, WebGL (deck.gl), current (npm 1.64.1 on 2026-07-13) and scales to large trees, but it is a bare renderer with no event/callback API, Newick only, and its vendor says it is "feature complete" for CGPS needs only and gives no support.** Two things the earlier notes had wrong: it is MIT (not LGPL; LGPL is the old canvas Phylocanvas) and it is actively published (not "no longer updated"; that is the old library).
- The React wrapper (`react-phylogeny-tree-gl`) is dead (one commit, 2022-01-28, pinned to phylocanvas.gl 1.36.0 and deck.gl 8). It is a useful pattern (init-once + controlledProps -> `setProps`, plugin-decorated events) but we would write our own ~100-line wrapper.
- Good primitives for our case: `selectedIds`, `highlightedId`, `styles` per tip (shape, colour, label), `collapsedIds`, `metadata`+`blocks` coloured columns, rectangular/circular/radial/diagonal/hierarchical layouts, SVG/PNG/Newick export, label thinning by zoom. Missing: native callbacks, hover/click node objects to the host, text/graphic columns, internal-node markers (only labels), React content, phyloXML/Nexus/NeXML.
- PhyloScape: not embeddable as a library for us (Vue app, d3 + modified Phylocanvas.gl in iframes, script from an HTTP URL, no licence file, 7 commits, no npm). Microreact: could not locate a readable source repo or licence (UNVERIFIED).
- Risks: single-person upstream (all 60 commits by one developer under 3 names), deck.gl peer pinned `^8.8.12` (current deck.gl is 9.x), one WebGL context per page, sparse docs lagging the code.

## Facts table

| Fact | Value | Source | Verified? |
|---|---|---|---|
| Source repo | https://gitlab.com/cgps/phylocanvas/phylocanvas.gl (GitLab, not GitHub). Repo holds source only: no package.json, no tests besides `utils/jewick.test.mjs`, 60 commits, 1 branch, 0 tags | clone; GitLab page | Yes |
| npm | `@phylocanvas/phylocanvas.gl`, latest 1.64.1, 71 versions, created 2021-07-02 | https://registry.npmjs.org/@phylocanvas%2fphylocanvas.gl | Yes |
| Licence | MIT, "Centre for Genomic Pathogen Surveillance" | `LICENSE`; npm `license: MIT`; README Q3 table | Yes |
| Old library | `phylocanvas` npm: LGPL-3.0, last publish 2.8.1 on 2017-02-13 (11 versions) | registry JSON | Yes. This is the "no longer updated" one |
| Recent npm publishes | 1.60.0 2025-12-10; 1.61.0 2025-12-12; 1.62.0 2026-03-30; 1.63.0 2026-05-15; 1.64.0 2026-06-25; 1.64.1 2026-07-13 | registry JSON `time` | Yes |
| Last commit in repo | 2026-06-25 "Use scale projection and clipping when exporting SVG" | `git log` | Yes |
| Committers | 60 commits: "Khalil" 44, "KAD" 9, "Khalil Abu-Dahab" 7 = one person. README paper authors: Abudahab, Underwood, Taylor, Yeats, Aanensen (via PhyloScape ref 17) | `git log --format=%an`; PMC12243251 refs | Yes |
| npm maintainer | `cgps-admin` only | registry JSON | Yes |
| Issues | Support tracker is `gitlab.com/cgps/phylocanvas/support` (not in the code repo). Count not readable (page needs JS) | README Q6; fetch returned no data | UNVERIFIED |
| Vendor stance | README Q7: "primarily designed to be incorporated into CGPS software... considered to be feature complete... unable to provide support for its use or modification"; forks must rename | `README.md` Q7 | Yes |
| Rendering | deck.gl OrthographicView, WebGL only, no Canvas fallback; "uses a single WebGL context, it can only render into a single canvas" | `methods/init.js`; README Q5; https://www.phylocanvas.gl/docs/usage.html | Yes |
| Peer dependency | `deck.gl ^8.8.12` (deck.gl 9.4.0 is current on npm, 2026) | npm package.json 1.64.1; Taxonium's deck.gl 9.4.0 from registry | Yes. 8.x vs 9.x compatibility UNVERIFIED |
| Package size | dist: `phylocanvas.js` 152,454 B (expects deck.gl peer), `bundle.min.js` 636,590 B (standalone with deck.gl), npm unpackedSize 3,607,802 B (includes source maps) | downloaded tarball; registry JSON | Yes (unminified/gz sizes: not measured) |
| Source formats | `newick` (string, default), `jewick` (array, custom compact format), `biojs` (object `{name, branch_length, children}`) | `utils/parse-source-as-graph.js` | Yes |
| Nexus / phyloXML / NeXML | none in the library | grep, parse-source-as-graph.js | Yes (absence) |
| Newick parser quality | Tiny tokenizer (`utils/newick.js`, based on Jason Davies 2010 / Pignatelli 2014): splits on `; ( ) , :` with regex; no quoted labels containing delimiters, no comments, no NHX. Quotes trimmed on leaf names (`trimQuotes`). Internal node names kept as `name` (used for support labels) | `utils/newick.js`; `utils/tree-traversal.js` | Yes |
| Tree types | `Circular` "cr", `Diagonal` "dg", `Hierarchical` "hr", `Radial` "rd", `Rectangular` "rc" | `constants.js` L57-L63 | Yes |
| Stated scale | README: "scaling to hundreds of thousands of leaves". React wrapper README: "It handles up to 100 000+ leaves". Paper listing claims 100K+ (via earlier notes) | `README.md` Q1; wrapper README | Yes (claims). No benchmark numbers anywhere in repo. PhyloScape paper: "capable of efficiently rendering hundreds of thousands of nodes" (citation only); largest tree shown in that paper: 15,092 tips | PMC12243251 | Yes |
| Docs site | https://www.phylocanvas.gl/docs/ ; properties/methods pages exist; `plugins.html` page is empty (last updated 6/30/2021); methods page lists some names that differ from source (`fitInPanel` vs `methods/fit-in-canvas.js`) | docs fetches; source | Yes |
| Bundle debris | Constructor sets a CGPS logo as `view.style.backgroundImage` (data URL) bottom-right of the host element | `methods/init.js` | Yes. Must be overridden (MIT permits removal, README forbids using the name/logo trademark in forks) |

## How events and control work (verified in source)

- Instance API: `new PhylocanvasGL(domElement, props, plugins)`; `tree.setProps(partialProps)` shallow-merges and re-renders (`PhylocanvasGL.js`, `methods/set-props.js`). `setProps(updater, eventOrigin)` accepts a second argument that is **ignored**.
- Click: deck `onClick` -> `handleClick` -> `selectNode(node, ctrl/meta)`; only **leaf** nodes can be selected (`methods/select-node.js`). Result lives in `tree.props.selectedIds`. No callback is invoked.
- Hover: `handleHover` calls `highlightNode(node)` (sets `props.highlightedId`) and optionally `setTooltip(text)`, with tooltip text hard-coded to leaf label or "Leaves in subtree: N" (`methods/handle-hover.js`).
- Plugin mechanism: `applyPlugins` gives `decorate(fnName, fn)` which monkey-patches any instance method (`utils/apply-plugins.js`). The only way to get events out is to decorate `selectNode`, `selectLeafNodes`, `highlightNode`, `setView` etc. This is exactly how `react-phylogeny-tree-gl`'s `createOnSelectPlugin` works (`src/plugins/createPluginOnSelect.ts`: decorates `selectNode`, calls `onSelect(tree, selectedIds)`).
- Controlled from outside: `selectedIds`, `highlightedId`, `collapsedIds`, `rootId`, `styles`, `metadata`, `blocks`, `zoom`, `centre`, `type`, `size`. Programmatic zoom-to-node helper: **not found**; `setZoom`, `setView({centre, zoom})` exist; `centre` is in normalized tree space (`defaults.centre [0.5,0.5]`), so centring on a tip needs node coordinates from `getGraphAfterLayout()` plus `unprojectPoint` (UNVERIFIED that this works as a recipe).
- Cleanup: `destroy()` calls `deck.finalize()` and clears caches, but does not remove the canvas element or the inline logo style (`methods/destroy.js`; docs claim it removes the canvas; not matched in code). Wrapper calls `tree.destroy()` in effect cleanup (`hooks/usePhylogenyTree.ts`).

## Customisation (verified in source)

- Per-leaf style: `props.styles[leafId] = {shape, fillColour, strokeColour, label}` (`methods/get-graph-with-styles.js`). `label` can differ from id (display name vs join key). Node shapes: ~20 (`constants.js` Shapes: circle, diamond, chevrons, heptagram...). Internal nodes: no per-node marker; collapsed subtrees can be pie charts (`showPiecharts`, `layers/piecharts`).
- Metadata columns: `props.metadata[leafId][column] = {colour, label}`, `props.blocks = ["col1", ...]`; drawn only when `colour` is present (`layers/metadata/blocks-data.js`: `if (metadataValue.colour)`). So columns are **coloured squares only**; tooltip shows column name and `label ?? colour` (`handle-hover.js`). Not available in radial layout (`init.js` metadata layer condition `type !== Radial`). Supports alignment of leaf labels (`alignLabels`) in rect/circular. No text/number cells, thumbnails, sequence alignment letters, or React content.
- Labels: leaf labels, internal labels (node name, optional `internalLabelsFilterRange` for support values), branch-length labels, block headers.
- Fonts/colours: `fontFamily`, `fontSize`, `fontColour`, `fillColour`, `strokeColour`, `highlightColour`, `backgroundColour`, all JS props as RGBA arrays or CSS colour strings (`defaults.js`). No CSS-variable/dark-mode integration (canvas), so tokens must be read in JS and passed in.
- Highlight: halo around `highlightedId` and `selectedIds` (`layers/highlight`, `layers/selection`). No row band.
- LOD: leaf-label thinning (`leavesPerLabel` computed from font size and pixel height, power-of-2 stride; `layers/leaf-labels/labelled-leaf-nodes.js`), `edgeOverlapFactor` sub-pixel line skipping, `nodeOverlapFactor` (defaults), collapse subtrees (`collapsedIds`, `collapseNode`). No automatic clade aggregation by zoom; metadata blocks are drawn per leaf at all zooms (UNVERIFIED whether culled; no culling code found in `blocks-data.js`).
- Export: `exportPNG` (data URL via `preserveDrawingBuffer`), `exportSVG` (rect/circular/diagonal/radial/hierarchical, shapes, labels, metadata), `exportNewick`, `exportJSON`, `exportJewick` (`methods/*`).
- Interaction: pan/zoom via deck controller when `interactive: true` (cannot be changed after init per docs), ctrl/meta-click multi-select, reroot, rotate, midpoint root (methods exist).

## React wrapper (`react-phylogeny-tree-gl`, github.com/mkoliba/react-phylogeny-tree-gl)

- Single commit 2022-01-28 ("v1.0.0-beta"); npm 1.0.0-beta (3 versions, first 2021-10-14); MIT; depends on `@phylocanvas/phylocanvas.gl` exactly `1.36.0` and `deck.gl ^8.3.10`, peer React >=16.8 (registry JSON). Third-party, single author (`mkoliba`).
- Pattern worth copying: `initProps` (reinstantiates if identity changes) + `controlledProps` (effect -> `tree.setProps`), `plugins` for events, `hooks` (`useAutoResize`, `useLeafSubtree`), forwarded ref exposing `getTree()` (`src/hooks/usePhylogenyTree.ts`).
- It would need to be rewritten against 1.64.1 (API drift UNVERIFIED but likely: methods list grew from 1.36 to 1.64).
- SSR: constructor touches `document`/`getBoundingClientRect` only inside `useEffect`, so SSR-safe by construction (inference from `usePhylogenyTree.ts`). The library import itself (deck.gl) at module level: UNVERIFIED.

## PhyloScape

| Fact | Value | Source | Verified? |
|---|---|---|---|
| Paper | BMC Bioinformatics 2025, 26:172, "PhyloScape: interactive and scalable visualization platform for phylogenetic trees"; open access CC BY-NC-ND (the article, not the code) | Europe PMC PMC12243251 | Yes |
| Code | https://github.com/SciDataLab/PhyloScape ; 7 commits, last 2025-07-16 ("citation"); no LICENSE file; two Vue 3 projects (`phyloscape-web`, `phyloscape-geo`), package names "my-vue3-app" version 0.0.0; no npm package found (`registry.npmjs.org` search "phyloscape" returned none) | clone; npm search | Yes |
| Library | Distributed as scripts `http://www.darwintree.cn/PhyloScape/phyloscape.main.js` and `phyloscapeGL.main.js` (HTTP, third-party host); docs: "PhyloScape JS library is based on d3.js... supports tree files in Newick format" | `phyloscape-web/docs` bundle; paper | Yes (docs text from built vitepress asset) |
| GL | "PhyloScape adjusts and implements Phylocanvas.gl" for large trees; plugins integrate via iframe + Vue | paper "Dependencies" | Yes |
| Formats | Web interface imports Newick, NEXUS, PhyloXML, NeXML, plus PhyloScape JSON; exports PNG/SVG | paper "Data input and output" | Yes. Whether the JS library (vs the website) parses all these: UNVERIFIED |
| Scale | Paper's largest example: Newick with 15,092 tips (Chinese vascular plants + MapColor plugin) | paper | Yes |
| Licence | None found in repo; treat as all rights reserved => unusable | repo | Yes (absence) |

Conclusion: useful as a feature/UX reference (formats incl. NeXML/phyloXML are handled in their web app, metadata signs, tooltips, plugin panels linked by click events), not as a dependency.

## Microreact (UNVERIFIED)

- Microreact (microreact.org) uses Phylocanvas (archived Sanger page; PMC 5320705 describes the older version). I could not reach its source repository: `gitlab.com/cgps/microreact/microreact` requires sign-in, `github.com/microreact/microreact` returns 404, and no npm package `microreact` exists. Its licence, its React tree component, and any integration code are therefore UNVERIFIED. Earlier note that "Taxonium's authors report Microreact locked up" is second-hand and remains unverified.

## Criteria scorecard (goal.md 1-16) - Phylocanvas.gl core (with notes where wrapper matters)

| # | Criterion | Score | Evidence |
|---|---|---|---|
| 1 | Pure browser, static deployable | **Yes** | No backend; `source` is a string you fetch yourself. Requires WebGL (README Q5). |
| 2 | Embeddable component (npm, React) | **Partial** | npm package, framework-agnostic class API (`new PhylocanvasGL(el, props)`). No maintained React component; the third-party wrapper is stale (1.36.0 pin). No bundled types in 1.64.1 (`types` absent in package.json), wrapper ships its own typings. |
| 3 | 100k+ tips responsive | **Likely yes (UNVERIFIED)** | Vendor claim "hundreds of thousands of leaves" (README). No benchmark. Layout is recomputed on JS main thread (`getGraphAfterLayout`), so interaction on 1M tips unknown. |
| 4 | Newick/Nexus/phyloXML | **Partial/No** | Newick only (+ `biojs` object, `jewick`). Parsers for the rest must be ours (convert to Newick or biojs object). |
| 5 | Programmatic API (highlight, focus, metadata) | **Partial** | `highlightedId`, `selectedIds`, `styles`, `metadata`, `collapsedIds`, `rootId`, `setView/setZoom`. No documented zoom-to-node/focus method. |
| 6 | Layouts | **Yes** | Rectangular, circular, radial, diagonal, hierarchical (`constants.js`). Unrooted ~ radial ("rd"); equal-angle vs. other algorithm: UNVERIFIED. |
| 7 | Licence | **Yes** | MIT (LICENSE, npm). deck.gl MIT (registry). Old `phylocanvas` is LGPL - different library. |
| 8 | Maintenance | **Partial** | Regular releases through 2026-07-13, but one developer, no tags, issues on a separate tracker, vendor says no support and "feature complete"; deck.gl 8 pin; wrapper dead. |
| 9 | A11y / theming / mobile | **Partial/No** | Canvas, no ARIA/keyboard. Theming only by passing JS colours. Touch via deck.gl controller (UNVERIFIED on mobile). Logo background override needed. |
| 10 | Export | **Yes** | PNG, SVG, Newick, JSON exports in `methods/`. |
| 11 | Click/hover/select callbacks with node + metadata | **Partial** | No callback API. Obtainable by `decorate('selectNode' ...)` plugin (works, proven by wrapper) or by wrapping `handleClick/handleHover`. Node objects are available via `findNodeById`. Hover only sets `highlightedId`. |
| 12 | React integration | **Partial** | Pattern exists (controlledProps/setProps, destroy on unmount) but wrapper is unmaintained; we must write our own. One WebGL context per page ("can only render into a single canvas"), so multiple trees on a page is unsupported. |
| 13 | Custom node/tip rendering, aligned columns | **Partial/No** | Aligned label + coloured squares (`blocks`) + per-leaf shapes/colour/label. No text/number/thumbnail/React/alignment columns. Extensible via `tree.addLayer(id, visibleFn, renderer)` (documented) using raw deck.gl layers, which is a real extension point (see effort). |
| 14 | Semantic zoom/LOD | **Partial** | Label thinning by zoom, sub-pixel edge skipping, manual collapse + pie charts. No automatic clade summarisation of columns/blocks at low zoom. |
| 15 | Scale as numbers | **Partial** | Only claims; paper listing 100K+. Must benchmark. |
| 16 | Styling hooks | **Partial** | `styles` object per leaf (colour, shape, label); global font/colour props; no per-internal-node/branch style except `styleNodeEdges` (edge colour inherited from leaf styles; internal edge coloured only if all children agree, `get-graph-with-styles.js`). No CSS theming. Objects not callbacks. |

## Maintenance evidence

- npm: 6 releases in the last ~7 months (2025-12-10 to 2026-07-13); `release` script bumps minor and publishes straight from a build commit (`package.json` scripts.release), explaining no git tags.
- Repo: last commit 2026-06-25 (SVG export clipping), 2026-05-15 (aligned label connector lines in SVG export), so export is under active work.
- Single developer; source on GitLab only (README also mentions a `github` remote merge in commit "Merge remote-tracking branch 'github/main'" but no public GitHub repo was found; `github.com/cgps/phylocanvas...` not checked and is UNVERIFIED).
- README Q7 states scope is limited to CGPS tools and it is "feature complete". Upstream is therefore unlikely to accept GBIF-specific features; we must expect to fork or extend via plugins.
- Docs: `plugins.html` empty; "Last Updated: 6/30/2021" on docs; methods page differs from code.

## Licence analysis

- Phylocanvas.gl: MIT (LICENSE; `Centre for Genomic Pathogen Surveillance`). Each source file carries the MIT header. Permits modification and bundling in gbif.org without copyleft. Trademark note: no right to the Phylocanvas name or logo; a published fork must be renamed (README Q7). Do not ship the embedded logo background.
- Dependencies: deck.gl (MIT per registry) as a peer; embedded `utils/newick.js` (MIT-style notice, Jason Davies/Pignatelli); `jewick.mjs` licence not checked (UNVERIFIED).
- `react-phylogeny-tree-gl`: MIT (package.json). PhyloScape repo: **no licence**, so unusable. Original `phylocanvas`: LGPL-3.0.
- No GPL/AGPL anywhere in the chain I inspected.

## Extension effort

| Gap | Effort | Route |
|---|---|---|
| Events (click, hover with node object) | Small | Own plugin using `decorate('selectNode'|'highlightNode'|'handleClick')`; no fork. Or patch `set-props` to emit events (small fork). |
| React wrapper for 1.64.1 | Small | ~100 lines modelled on `usePhylogenyTree.ts`: init in `useEffect`, `setProps` on changed props, `destroy()` on unmount, ResizeObserver. |
| Highlight + centre a tip on occurrence page | Small-medium | `highlightedId`/`selectedIds` plus own centre/zoom computation from `getGraphAfterLayout()` node coordinates and `setView`. Also `setRoot`/`rootId` to show parent clade for context (both exist). |
| Nexus/phyloXML/NeXML | Small-medium | Convert outside the library to Newick or the `biojs` object (`{name, branch_length, children}`, supported). |
| Tip match status / counts as extra columns | Medium | `metadata`/`blocks` gives coloured squares (match status colour); counts need custom layer. |
| Text/number/thumbnail/alignment columns, internal-node markers, support-sized circles | Medium-large | `tree.addLayer(...)` with custom deck.gl layers that read `getGraphWithStyles()` node positions (documented extension point). Needs our own LOD, because built-in metadata blocks have no zoom culling that I found. |
| Semantic zoom (clade summaries) | Large | Not present; would use collapse + piecharts or custom aggregation layer. |
| React-rendered tip content | Large | Not natural in WebGL; would need an HTML overlay synced to viewport (projectPoint/unprojectPoint exist). |
| deck.gl 9 upgrade | Unknown | Peer pinned `^8.8.12`; migration effort UNVERIFIED. |

Licence permits all of the above, including a private fork. Upstream will not help (README Q7).

## Risks

1. Single upstream developer; "feature complete" and "unable to provide support" stance.
2. deck.gl 8 peer: collides with any deck.gl 9 in the app; version-skew risk when GBIF wants other WebGL tooling.
3. One WebGL context/canvas per page (docs). A dataset page with tree plus another deck.gl map could conflict (UNVERIFIED).
4. Weak Newick parser (quoted labels with commas/parentheses, comments, NHX). We must pre-parse and pass the `biojs` object.
5. Event API is monkey-patching `this` methods (`decorate`), relying on internal method names that change across versions.
6. Docs thin and out of sync with code. No tests in the public repo (one `jewick.test.mjs`).
7. Selection is leaf-only; internal nodes have synthetic ids `__<preorderIndex>` (`utils/tree-traversal.js`), so internal-node ids change with tree edits/reorder.
8. Unmatched-tip reporting is ours to build (styles/metadata are keyed by leaf id; missing keys are silently ignored).

## Open questions for hands-on testing

- Real load time and fps for 1k/5k/20k/100k/1M tips, with `blocks` (3 columns) on, circular and rectangular. Does the metadata layer cull at low zoom?
- Does `getGraphAfterLayout()` block the main thread noticeably on 1M tips (layout is synchronous JS)?
- Does 1.64.1 work with deck.gl 9.x? Which deck.gl 8 minor does it need? Bundle-size impact of deck.gl 8 on gbif.org (gzipped).
- Recipe for centring/zooming on a given tip id (rect and circular) and showing "N levels up" context (`setRoot`).
- Do `decorate`-based events give the right node (and hover) at 100k scale without re-render storms?
- Does `addLayer` allow aligned text/count columns with LOD, and picking?
- Multiple instances on a page; destroy/re-create (canvas and logo style leak?); SSR import safety.
- Mobile touch pan/pinch; keyboard accessibility story (likely a parallel DOM list).
- Microreact: find its repo and licence; check whether its tree panel adds callbacks we could reuse.
- Is there a public GitHub mirror or issue tracker content for phylocanvas.gl (support tracker unreadable)?
