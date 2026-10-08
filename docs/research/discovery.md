# Discovery: other phylogenetic tree viewers and building blocks

Discovery round on 2026-10-08. Goal: find everything not already on the shortlist (Taxonium, Phylocanvas.gl family, phylotree.js and wrappers, Reactree, Heat-tree, Archaeopteryx.js, Phylo.io, IcyTree, PhyD3, jsPhyloSVG, Auspice, Microreact) so that we do not miss a good option. Judged against the 16 criteria in [../goal.md](../goal.md). Facts come from npm registry JSON (`registry.npmjs.org`), read-only shallow clones, GitHub pages and papers; **UNVERIFIED** marks anything I could not confirm. Dates are npm publish dates unless stated; "clone HEAD" is the latest commit of the default branch in a shallow clone made today.

Dedicated write-ups: [onezoom.md](onezoom.md), [react-bio-viz.md](react-bio-viz.md).

## Headline findings

1. **OneZoom is the only candidate with proven 2M-tip scale, but it is not embeddable as a component and its licence is non-profit source-available.** See [onezoom.md](onezoom.md). Its ideas (bracket-string topology at about 2 bytes per node, lazy node creation, frame-time-adaptive LOD, static per-node binary slices) are the main thing to learn from.
2. **tbrowse (Gramene/Ensembl Plants lineage, MIT, React 18) and react-bio-viz (MIT, React 18/19) are the best new React-native candidates for criteria 11 to 13 and 16**, but both draw SVG and neither shows large-tree numbers. tbrowse already has the "tree plus row-aligned zones" model (labels, MSA, custom `ZoneDefinition` plug-ins with `visibleRows` and virtualised row ranges) that criterion 13 asks for; react-bio-viz has the cleanest controlled-state API.
3. **figtreejs (MIT, React, SVG) is the only other React-first tree library**, but it is pre-1.0 and its repository HEAD in my clone is November 2025; no scale evidence.
4. **No new large-tree (100k+) JavaScript viewer with a permissive licence turned up beyond Phylocanvas.gl (MIT per npm), Taxonium (GPL-3.0, verified in clone) and PhyloScape (adapts Phylocanvas.gl).** The WebGL options remain Phylocanvas.gl and Taxonium; Empress (BSD-3-Clause) has not had a commit on its default branch since 2022-05-23 in my clone.
5. Correction to [../comparison.md](../comparison.md): npm lists `@phylocanvas/phylocanvas.gl` 1.64.1 as **MIT**, published 2026-07-13 (71 versions, repo on gitlab.com/cgps/phylocanvas/phylocanvas.gl, peer `deck.gl ^8.8.12`). The PhyloJS paper's "10^6" is superscript text flattened by the page ("101 to 106 tips" = 10^1 to 10^6), so it is not a typo; the paper gives timings only as a plot.

## Table of all candidates found

Legend: Credible = worth a spike or reading; Reference = learn from, do not adopt; Skip = abandoned, off-target or unusable.

| Candidate | Licence | Last release / commit | Rendering | React story | Scale evidence | Verdict |
|---|---|---|---|---|---|---|
| **OneZoom** (github.com/OneZoom/OneZoom) | OneZoom Non-Profit Source Available Licence v1 (not OSI) | commit 2026-10-07 | Canvas 2D, LOD | None; global singleton, canvas id | 2,228,001 species live; 2,235,472 nodes in a 4.47 MB file | **Reference; link/iframe only.** Full analysis in onezoom.md |
| **react-bio-viz** `PhyloTree` | MIT | npm 0.3.0 2026-10-08; commit 2026-10-08 | SVG, no culling | Native, controlled | None; SVG about 8 elements/tip | **Credible for small trees and API design.** react-bio-viz.md |
| **tbrowse** (github.com/warelab/tbrowse) | MIT | npm 2.10.0 2026-09-02; commit 2026-10-02 | SVG tree zone, canvas MSA zone, row virtualisation | Native React 18, controlled `viewState` | None found; ~14 kB gzip claimed | **Credible** (see below) |
| **figtreejs** (github.com/figtreo/figtreejs) | MIT (package.json) | `@figtreejs/browser` 0.1.0-beta.9 2026-04-18; `@figtreejs/core` 0.0.1-alpha.0 2025-11-26; clone HEAD 2025-11-26 | SVG, react-spring animation | React-first (`FigTree` component, baubles) | None | **Credible but immature** |
| **PhyloScape** (github.com/SciDataLab/PhyloScape; darwintree.cn/PhyloScape) | UNVERIFIED (paper CC BY-NC-ND; software licence not stated) | 2025 paper | d3 v7, adapts Phylocanvas.gl for large trees | Vue front end, iframe plug-ins; no npm package mentioned | Tested with 15,092 tips and 149 strains; no load times | **Look closer** (licence first) |
| **react-msaview / JBrowseMSA** (github.com/GMOD/JBrowseMSA) | MIT | npm 8.4.1 2026-09-25 | Tiled canvas; SVG export | React, but peers on mobx, MUI 9 and `@jbrowse/*` | none stated | **Reference** (tree beside MSA) |
| **hoodini-viz** (github.com/pentamorfico/hoodini-viz) | MIT | npm 0.2.20 2026-02-02 | deck.gl WebGL | React 18/19 | "100k+ genes" (README) | **Reference** for tree plus aligned tracks on deck.gl; tree is a side feature (UNVERIFIED how large) |
| **lwPhylo** (`@euphrasiologist/lwphylo`) | ISC | 1.5.1 2026-08-29 | Layout maths handing output to d3; rect/radial/unrooted | None (d3 peer) | None | **Reference**: small, three layouts, `onNodeClick` |
| **TidyTree** (github.com/CDCgov/TidyTree) | Apache-2.0 | npm 0.7.0 2023-12-18 (registry modified 2025-05-27) | d3/SVG | None | None | Skip (SVG, dormant) |
| **Empress** (github.com/biocore/empress) | BSD-3-Clause | clone HEAD 2022-05-23 | WebGL; balanced-parentheses tree (`bp-tree.js`) | None; QIIME 2 plugin/standalone HTML | "fast and scalable" (README) | **Reference** (bracket representation); not embeddable |
| **Lifemap** (github.com/damiendevienne/Lifemap) | Code GPL-3.0; site content CC BY-NC 4.0 | UNVERIFIED | Map tiles via mapnik/mod_tile (PostGIS) and Leaflet 0.7 | None | Tree of life about 2.3M species; about 200 GB of non-blank tiles | **Reference** for the tile idea; server-side; GPL |
| **PhyloTree/Phylocanvas.gl** | MIT per npm | 1.64.1 2026-07-13 | WebGL (deck.gl) | wrappers | 100K+ nodes claim | Covered by another researcher |
| **Datagrok PhyloTreeViewer** (`@datagrok/phylo-tree-viewer`) | UNVERIFIED | 1.4.1 2026-07-12 | Wraps PhylocanvasGL | Only inside the Datagrok platform | n/a | Skip (platform-bound) |
| **gen-epix ui-phylogenetic-tree** (`@gen-epix/ui-phylogenetic-tree`) | EUPL-1.2 | 3.4.2 2026-09-21 | UNVERIFIED | React with `@mui/material` and `@gen-epix/ui-core` peers | n/a | Skip (framework-bound, copyleft) |
| **mseaboard** (github.com/lucanest/mseaboard) | AGPL-3.0 | UNVERIFIED | UNVERIFIED (D3 likely) | App | none | Skip (AGPL, hosted app) |
| **jstreeview** (github.com/lh3/jstreeview) | UNVERIFIED | README: untouched "over a decade" | Canvas | None | none | Skip (dormant, 2008) |
| **Phandango** (github.com/jameshadfield/phandango) | MIT | UNVERIFIED (339 commits; README: Node 8 setup verified Oct 2023) | UNVERIFIED | None | none | Skip (app for bacterial genomes) |
| **MicrobeTrace** (github.com/CDCgov/MicrobeTrace) | Apache-2.0 | active (pushed 2026-10-06 per topic page) | App, includes tree | App; partner embed button | none | Skip (app) |
| **Open Tree of Life web apps** (github.com/OpenTreeOfLife/opentree) | BSD-2-Clause | UNVERIFIED | "Argus uses Raphaeljs and jQuery" | None | none | Skip (README says setup outdated) |
| **PhyloRecViewer** (github.com/ZengZichao/PhyloRecViewer) | UNVERIFIED | pushed 2026-10-05 | UNVERIFIED | none | none | Skip (reconciliation trees) |
| **vue-phylogram** | Apache-2.0 | 3.4.3 2024-07-09 | SVG, `vue-svg-pan-zoom` | Vue 2/3-era component | none | Skip (Vue, small) |
| **@lipme/vue3-phylogram** | UNVERIFIED | 0.0.2 2025-05-20 | d3 | Vue 3 | none | Skip (toy stage) |
| **chrono-phylo-tree** | UNVERIFIED (no licence in registry) | 1.3.1 2025-07-30 | UNVERIFIED | React + Tailwind | none | Skip (chronogram app) |
| **annotated-phylotree** | UNVERIFIED | 0.1.2 2023-05-25 | d3, CRA | React, radial only | none | Skip (abandoned) |
| **react-phylocanvas, react-phylogenetic-tree, react-phylogeny-tree(-gl)** | n/a | 2017 to 2022 | Phylocanvas | React | claims | Skip (abandoned; already in comparison.md) |
| **Phylo.io npm `phyloio`** | ISC | 2.2.5 2026-01-30 | d3/SVG | none | small/medium | Covered by another researcher; note the npm package is still being published |
| **PhyloJS (`phylojs`)** | MIT | 1.12.0 2025-05-18 | none (library) | n/a | benchmark plot up to 10^6 tips; **15.1 kB minified, 0 deps** (paper Table 1) | **Credible parser/data layer** (Newick; also others? UNVERIFIED) |
| **`@gmod/newick`** | UNVERIFIED | 1.0.3 2026-09-14 | none | n/a | "stack-safe tree traversals" in description | Parser candidate (stack safety is relevant, see risks) |
| **`phyloxml` npm** (cmzmasek) | UNVERIFIED | 1.1.7 2026-09-30 | none | n/a | SAX-style reader/writer | Parser candidate for phyloXML |
| **`newick-js`** | UNVERIFIED | 1.2.4 2026-10-03 | none | n/a | no benchmarks | Parser candidate |
| **`@bioscript/seq-format`** | UNVERIFIED | 0.2.3 2026-08-04 | none | n/a | | Not tree-specific |
| **jbrowse-plugin-msaview** | UNVERIFIED | 5.1.0 2026-10-05 | canvas | JBrowse plugin | | Skip (JBrowse-bound) |
| **exelixis, phylocanvas (2.x), biojs-io-newick, tnt.newick, nhx.js, petrie** etc. | various | 2014 to 2019 | various | none | | Skip (abandoned) |
| **sdras/project-explorer, tree-visualization topic repos** | n/a | n/a | n/a | n/a | | Skip (not phylogenetic) |
| **Mammalia-tree (SeanWong17)**, **concestor**, **dinosauria** | UNVERIFIED | 2024 to 2026 | d3 art/explorers | none | | Skip (single-tree demos) |
| **iTOL, EvolView, Iroki, TimeTree, PhyloWidget, Lifemap web** | closed or hosted | n/a | hosted | no library | | Skip (hosted apps; UX references) |
| **R/Python widgets: ggtree (R), toytree (Python), ipytree (Jupyter)** | UNVERIFIED | n/a | ggtree draws via R; toytree via toyplot; ipytree via jstree (general knowledge) | none | | Skip: no reusable phylogram JS core found; ipytree is a file-tree-style widget (UNVERIFIED) |

### Genre-adjacent libraries (brief; licence and date verified from npm, suitability judgement UNVERIFIED)

| Library | Licence | Latest | Use for a phylogram host |
|---|---|---|---|
| d3-hierarchy 3.1.2 | ISC | 2022-04-02 | Layout (`cluster`, `tree`); phylogram x from cumulative length is easy to add; stable, tiny |
| d3-zoom 3.0.0 | ISC | 2021-06-10 | Pan/zoom transform; fits canvas or SVG |
| @visx/hierarchy 4.0.0 | MIT | 2026-06-11 | React wrappers around d3-hierarchy; SVG |
| @xyflow/react (React Flow) 12.12.0 | MIT | 2026-09-24 | Node-graph UI; DOM nodes, poor fit for 10^4+ nodes (judgement) |
| cytoscape 3.34.3 | MIT | 2026-09-07 | Graph lib; canvas; has tree layouts; heavy; not phylogram-native |
| sigma 4.0.0 | MIT | 2026-10-08 | WebGL graph renderer; could draw nodes/edges for very large graphs, but needs our layout and labels |
| deck.gl 9.4.0 | MIT | 2026-09-05 | WebGL layers; what Taxonium and Phylocanvas.gl are built on |
| pixi.js 8.22.0 | MIT | 2026-10-01 | 2D WebGL/canvas scene graph; text-heavy trees need atlas care |
| regl 2.1.1 | MIT | 2024-11-12 | Low-level WebGL; no release for 2 years |
| flatbush 4.6.2 / rbush 4.0.1 | ISC / MIT | 2026-06-09 / 2024-08-21 | Spatial indexes for hit-testing and viewport culling of drawn nodes (react-msaview already depends on flatbush) |
| react-d3-tree 3.6.7 | MIT | 2026-09-22 | Already judged unsuitable in comparison.md (not a phylogram) |

## Credible new candidates

### tbrowse (https://github.com/warelab/tbrowse, npm `tbrowse`)

- **What:** "Embeddable React component for visualizing phylogenetic trees with pluggable data zones" (README). `<TBrowse tree taxonomy msa geneMetadata nodeAnnotations labelProviders zones ... />`. Originated for Gramene/Ensembl gene trees; `2.0.0` was a rewrite on React 18, TypeScript and Zustand; 1.x was a React 16 / Redux version (README "Status").
- **Licence:** MIT (LICENSE: "Copyright (c) 2019-2026 Andrew Olson"). **Releases:** npm 2.10.0 on 2026-09-02; clone HEAD 2026-10-02. Shallow clone shows one commit, so contributor count UNVERIFIED. npm shows 36 versions since 2019.
- **Rendering:** SVG branches, glyphs, triangles and tooltip in `src/zones/tree/`; canvas in the MSA zone (`src/zones/msa/`, "canvas paint, minimap"). Rows are virtualised: zone render props include `visibleRows` and a "virtualization `rowRange`" (`src/layout/rowRange.ts`).
- **Formats:** input is a flat `Tree.nodes` object `{ id, parentId, distance, isLeaf, taxonomyId?, geneId?, eventType?, bootstrap? }`; adapters for Ensembl REST and Gramene (`src/adapters/`). No Newick/Nexus parser in the README; you convert yourself (UNVERIFIED whether a Newick helper exists).
- **State and events:** `viewState` / `initialViewState` / `onViewStateChange` with a serialisable `ViewState` (`selectedNodeId`, `collapsedNodeIds`, `prunedNodeIds`, `swappedNodeIds`, zone widths, `zoneStates`, `search`), designed to round-trip through a URL; `ZoneRenderProps` carry `hoveredNodeId`, `hoveredSubtreeIds`, `onHoverNode(id)`, `onSelectNode(id)` (`src/types.ts` lines about 362 to 382). That is hover and select in the shape criterion 11 wants, and `ZoneDefinition { Header, Body, defaultWidth, ... }` is a React-rendered per-row column hook for criterion 13.
- **Gaps:** layouts: phylogram/cladogram-style only (`computeTreeLayout`); no circular or unrooted; no scale numbers anywhere in README, CHANGELOG or source comments; SVG tree so expect the usual low-thousands ceiling (UNVERIFIED); bundle "~14 kB gzipped (CJS)" per README (not measured by me).
- **Verdict:** worth a hands-on spike for criteria 11 to 13 and as the model for "tree plus aligned zones". Scale must be measured.

### react-bio-viz

See [react-bio-viz.md](react-bio-viz.md). Short version: controlled `viewport`/`selection`, `onNodeClick(TreeNodeInfo, event)`, `onBranchClick`, `nodeStyles`, `branchStyles`, `leafTextComponent`, `onLeafOrderChange` plus alignment `rowOrder`; SVG without culling; Newick only; one maintainer, long gap in 2025, burst of AI-assisted releases on 2026-10-07/08.

### figtreejs (https://github.com/figtreo/figtreejs)

- **What:** React reimplementation of FigTree: `@figtreejs/core` (React `FigTree` component, immutable tree, layouts, "baubles") and `@figtreejs/browser` (non-JSX wrapper for plain pages and Observable). README: "built a reimplementation of the original figtree to show the utility of this package" (`apps/figtree`).
- **Licence:** MIT in both package.json files (no LICENSE file at the repo root in my clone). **Releases:** `@figtreejs/browser` 0.1.0-beta.9 on 2026-04-18; `@figtreejs/core` 0.0.1-alpha.0 on 2025-11-26 (registry modified 2026-04-18); clone HEAD 2025-11-26 "updating missed file in docs" (shallow clone, so the number of commits and contributors is UNVERIFIED).
- **Rendering and API:** SVG via React with `@react-spring/web` for animation; deps include d3-scale, d3-shape, immer, uuid. `FigTree` takes `tree`, `layout` (rectangular, radial, with options such as fish-eye and pollard in `FigtreeProps` defaults), `baubles` (branches, nodes, labels, clade shapes), `animated`, `axis`. `Bauble` types accept `onClick?: (n: NodeRef) => void` (`src/components/baubles/types.ts`). Hover handlers: not found.
- **Gaps:** pre-1.0 and alpha tags, peers pinned to React ^18.3.1, no scale evidence, no Newick/Nexus parser scope read (`ImmutableTree.fromNewick` exists in source). SVG ceiling applies.
- **Verdict:** interesting as a "baubles" (per-node shape) API model and an MIT React-first option; too immature to depend on today.

### PhyloScape (BMC Bioinformatics 2025, https://pmc.ncbi.nlm.nih.gov/articles/PMC12243251/)

- d3.js v7 library; for large trees "adapted Phylocanvas.gl, which ... [is] capable of efficiently rendering hundreds of thousands of nodes"; inputs Newick, NEXUS, PhyloXML, NeXML and PhyloScape JSON; CSV/TXT annotation with leaf names in the first column; export PNG/SVG; plug-ins (Heatmap, ACMap, MapColor, MapTransmission, FreqStack) via iframes with Vue, OpenLayers, ECharts, pdbe-molstar. Tested: 15,092 tips (Chinese vascular plant tree) and 149 strains, no timings. Code at https://github.com/SciDataLab/PhyloScape; **software licence and npm packaging not found** (the article is CC BY-NC-ND 4.0, which says nothing about the code). It covers all four formats we want and has a "map" plug-in, which is notable for GBIF, so it deserves a repository read once the licence is known.

### Reference-only items worth a note

- **react-msaview / JBrowseMSA** (MIT, GMOD): "Tree and alignment are drawn together and tiled to stay fast on large inputs", Newick and EMF parsing; React but tied to MobX, MUI and JBrowse core peers. A model for tree plus alignment with tiled canvas.
- **hoodini-viz** (MIT): deck.gl-based React library with tree plus aligned gene-neighbourhood tracks and a virtualised table; README claims "100k+ genes"; a signal that deck.gl layers can carry aligned tracks next to a tree. Tree scale UNVERIFIED.
- **lwPhylo** (ISC): dependency-free layout code (rectangular, radial, unrooted equal-angle, based on "ggfree") producing coordinates for d3; `onNodeClick`; no scale claims. A source for unrooted layout code.
- **Empress** (BSD-3-Clause): WebGL viewer built on a balanced-parentheses tree (`empress/support_files/js/bp-tree.js`, `postorderselect`), barplot layers, metadata colouring; default branch inactive since 2022-05-23 in my clone; no embedding API documented. Relevant as precedent for compact tree encodings.
- **Lifemap**: server-rendered tiles (PostGIS plus mapnik plus mod_tile, 256x256 px tiles, "52 zoom levels" for the deepest OTOL species, "the non-blank tiles ... need about 200 GB" from the paper, https://pmc.ncbi.nlm.nih.gov/articles/PMC5179005/); code GPL-3.0, content CC BY-NC 4.0. Shows that a map-tile approach works for 2M-species trees but needs a tile server.

## Cross-cutting observations

- **Parsing is solved by small libraries**: PhyloJS (MIT, 15.1 kB minified, no deps, benchmarked to 10^6 tips in a plot), `@gmod/newick`, `phyloxml`, plus our own Nexus handling. Nobody found handles Nexus translate blocks as a first-class tree loader (not exhaustively checked).
- **Scale pattern is unchanged**: every React/SVG option found (react-bio-viz, tbrowse, figtreejs, vue-phylogram) will hit an SVG ceiling; only the WebGL family (Phylocanvas.gl, Taxonium, Empress, hoodini-viz) and OneZoom's canvas-with-LOD scale. No candidate combines React-native custom rows (criterion 13) with 100k-tip LOD (criterion 14); that combination is what the custom-renderer option would have to supply, possibly borrowing tbrowse's zone model and OneZoom's LOD ideas.
- **Licence landscape**: permissive options (MIT/ISC/BSD/Apache) cover everything credible above except OneZoom (custom), PhyloScape (unknown), Taxonium (GPL-3.0, verified in the clone's LICENSE), Lifemap (GPL-3.0), mseaboard (AGPL), gen-epix (EUPL).

## Searches and sources used (to repeat the search)

npm registry search (`https://registry.npmjs.org/-/v1/search?text=<q>&size=40`), queries: `phylogenetic`, `phylogeny`, `newick`, `phyloxml`, `nexus tree viewer`, `dendrogram newick`, `phylotree`, `tree of life`. Package metadata via `https://registry.npmjs.org/<pkg>` (versions, `time`, licence, peers) for: @figtreejs/core, @figtreejs/browser, @euphrasiologist/lwphylo, tbrowse, react-msaview, chrono-phylo-tree, @datagrok/phylo-tree-viewer, @gen-epix/ui-phylogenetic-tree, hoodini-viz, tidytree, @lipme/vue3-phylogram, vue-phylogram, annotated-phylotree, phyloio, phylojs, @grunwaldlab/heat-tree, taxonium-component, @phylocanvas/phylocanvas.gl, phylotree, reactreejs, react-bio-viz, d3-hierarchy, d3-zoom, @visx/hierarchy, @xyflow/react, cytoscape, sigma, deck.gl, pixi.js, regl, react-d3-tree, flatbush, rbush.

GitHub topic pages fetched (the GitHub search API is blocked in this sandbox: HTTP 403 "sessions are bound to their configured repositories"): `topics/phylogenetic-tree?l=javascript` and `?l=typescript`, `topics/phylogenetic-trees`, `topics/phylogenetics?l=javascript&o=desc&s=stars`, `topics/phylogeny?l=typescript`, `topics/newick?l=javascript`, `topics/tree-visualization?l=javascript&o=desc&s=stars`, `topics/tree-of-life`. Those pages show only the first 20 results per view, so lower-starred repositories may be missing.

Other sources: Wikipedia https://en.wikipedia.org/wiki/List_of_phylogenetic_tree_visualization_software (online tools listed: Aquapony, ETE tree viewer, EvolView, IcyTree, Iroki, iTOL, Microreact, OneZoom, Lifemap, Phylo.io, PhyloExplorer, PHYLOViZ Online, PhyloWidget, PRESTO, Taxonium, T-REX, TidyTree, TreeVector; JS libraries jsPhyloSVG, PhyD3, phylotree.js); OneZoom repos and pages (see onezoom.md); PhyloJS paper https://pmc.ncbi.nlm.nih.gov/articles/PMC11199911/; PhyloScape https://pmc.ncbi.nlm.nih.gov/articles/PMC12243251/; Lifemap paper https://pmc.ncbi.nlm.nih.gov/articles/PMC5179005/; repos cloned read-only: OneZoom/OneZoom, figtreo/figtreejs, warelab/tbrowse, biocore/empress, pentamorfico/hoodini-viz, holmrenser/react-bio-viz, theosanderson/taxonium (for the licence file).

## Not covered or not verifiable

- TDWG phylogenetics interest group threads and `tdwg-phylo`: not searched in depth (no results found by topic pages); UNVERIFIED whether a TDWG-endorsed viewer exists.
- BioJS tree components: https://github.com/biojs/biojs says each component is a separate repository (v2.0.0_alpha); the registry was not searched, so BioJS tree components are not assessed.
- Observable/D3 notebooks of large phylogenies and deck.gl/PixiJS/regl tree demos: only the libraries above were checked; no specific notebook was evaluated.
- TimeTree: hosted site, no reusable library found.
- Licence of PhyloScape, Datagrok PhyloTreeViewer, gen-epix beyond npm metadata, mseaboard rendering tech, Phandango rendering tech and last commit dates, last commit dates of repos where GitHub pages hid them.
- Numbers for scale: none measured by me for any candidate; where I quote numbers they come from the sources named.
