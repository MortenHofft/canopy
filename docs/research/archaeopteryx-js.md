# Archaeopteryx.js: source-level verification

Researched 2026-10-08 against `cmzmasek/archaeopteryx-js` master at commit `d200b6f` (3.24.0, 2026-10-07), cloned and read, nothing executed. Criteria numbers refer to [goal.md](../goal.md). Quotes are exact; paths are relative to the repo root and line numbers refer to that commit. "UNVERIFIED" means I could not confirm it from a primary source. The "My judgement" label marks estimates and opinions as opposed to facts.

## Summary

1. Archaeopteryx.js is the only candidate with built-in aligned alignment, heat-map, domain-architecture and gene-arrow tracks, and its rendering is better engineered for scale than the earlier notes assumed. Branches, dots and shapes are batched into a handful of SVG paths, and the changelog claims a 50,000-node tree opens in a third of a second and pans at 60 fps (self-reported, not independently measured).
2. It is a full application, not a component. There is no node-click or hover callback, no highlight/focus/zoom-to-node method, one viewer per page (module-level singleton state), a control panel that cannot be switched off by config, and custom columns exist only as phyloXML-shaped data: numeric properties become heat-map columns, and nothing else is pluggable. Criteria 11, 12 and 13 are therefore Partial or No without patching.
3. Maintenance is a risk of an unusual kind: one maintainer (Christian Zmasek, JCVI), every recent commit co-authored with Claude, and 22 npm releases between 2026-09-04 and 2026-10-07 after a quiet 2019-2026. It is very alive but its surface is churning (118 config keys were removed in the 3.0 rewrite and now make `launch()` throw).
4. Licence is LGPL-3.0-or-later (and the `phyloxml` dependency is LGPL-2.1-or-later). That is usable from an Apache-2.0 app if the library stays a separate, replaceable file and our patches to it are published under LGPL. Do not fold it into one minified application bundle without legal sign-off.
5. Verdict: strong reference and plausible quick demo for the ETE-style "tree plus aligned tracks" view of a static tree, weak as the embeddable, event-driven component the goal describes. Realistic roles: (a) a read-only "explore this tree" tab, (b) a fork we would carry patches on, or (c) a source of ideas for our own renderer. It does not meet the occurrence-page story (criteria 5, 11, 12) without a fork.

## Facts table

| Fact | Value | Source | Verified? |
|---|---|---|---|
| Repo | https://github.com/cmzmasek/archaeopteryx-js | README.md:8-10 | Yes |
| npm | `archaeopteryx` 3.24.0, published 2026-10-07T19:54Z | https://registry.npmjs.org/archaeopteryx (`time`, `dist-tags`) | Yes |
| Licence | `LGPL-3.0-or-later` | package.json `license`; LICENSE (LGPL v3 text); header of archaeopteryx.js:1-19 | Yes |
| Copyright holders | Christian M. Zmasek, Yun Zhang, J. Craig Venter Institute (2026) | archaeopteryx.js:2-4 | Yes |
| Runtime deps | `d3 ^7.9.0` (ISC), `phyloxml ^1.1.7` (LGPL-2.1-or-later, which pulls `sax ^1.6.1`, BlueOak-1.0.0) | package.json; registry.npmjs.org/phyloxml/latest, /sax/latest, /d3/latest | Yes |
| Optional peer deps | `canvg ^4.0.3` (MIT), `jspdf ^4.2.1` (MIT), `svg2pdf.js ^2.8.1` (MIT); only for PNG and PDF export | package.json `peerDependencies`; registry | Yes |
| Package contents | 6 files; `archaeopteryx.js` 973,074 bytes and `forester.js` 504,741 bytes, both unminified source; unpacked size 1,668,768 bytes | `ls -la` of clone; registry `dist.unpackedSize` | Yes |
| Gzipped size of those two files | 256,567 bytes and 136,591 bytes (`gzip -9`, unminified) | local measurement | Yes. Minified size UNVERIFIED (no minifier run). Full `d3` and `phyloxml` come on top. |
| Repo stats | 44 stars, 16 forks, 813 commits on master | https://github.com/cmzmasek/archaeopteryx-js (WebFetch) | Yes, point in time |
| Issues / PRs | 13 issues in total, all closed, 0 open; 6 PRs, 0 open. Only 1 outside PR since 2017 (#18, 2026-01-31, merged, from `kscgl`) | https://github.com/cmzmasek/archaeopteryx-js/issues?q=is%3Aissue ; /pulls?q=is%3Apr | Yes |
| Performance issues | None filed. No issue title mentions performance, large trees, React or callbacks | the issues list above | Yes (titles only; bodies not read) |
| Authors of recent commits | "all co-authored by cmzmasek and claude" for the 30 most recent (Sep 30 to Oct 7 2026) | https://github.com/cmzmasek/archaeopteryx-js/commits/master | Yes |
| npm maintainers | one: `thezma1` | registry `maintainers` | Yes |
| npm release history | 1.0.8, 1.0.9, 1.8.1 (all 2019-05-16), then 2.3.2 (2026-07-29), 3.0.0 (2026-09-04), then 3.1.0 to 3.24.0, 22 releases in 33 days | registry `time` | Yes |
| npm downloads | 4,661 last month (2026-09-05 to 2026-10-04); 6,228 last year | https://api.npmjs.org/downloads/point/last-month/archaeopteryx and /last-year/ | Yes |
| Production use | BV-BRC is named repeatedly (Dojo/AMD loading, "BV-BRC's page CSS", BV-BRC accession links, "tuned" on ViPR / BV-BRC trees). I did not open BV-BRC to confirm the live deployment | archaeopteryx.js:65-68 (UMD comment "AMD loaders such as Dojo (BV-BRC)"), CHANGELOG.md:36-39, README.md:605, 1761, 2095 | Partial: the repo says BV-BRC embeds it; deployment UNVERIFIED independently. Other production users: UNVERIFIED |
| Rendering | SVG via d3 v7 (`d3.cluster` layout, `d3.zoom`, `d3.quadtree` for hit-testing). No canvas/WebGL for the tree | archaeopteryx.js:1807-1840 (quadtree at 1838), 6745-6790, 5013-5040 | Yes |
| Formats in | Newick, NHX, Nexus (TREES, TAXA, CHARACTERS/DATA blocks, TRANSLATE), phyloXML, Auspice v2 JSON, BEAST/MrBayes/FigTree annotations, TSV/CSV metadata table | README.md:1217-1235 | Yes |
| Formats out | Newick, Nexus (with alignment), phyloXML, FASTA, TSV, SVG, PNG (needs canvg), PDF (needs jspdf+svg2pdf) | README.md:1217-1260 | Yes |
| Nexus TRANSLATE tables | Parsed: `translateMap` applied to node names; also TAXLABELS | forester.js:5892-6145 (`NexusPhylogeniesParser`, `setTranslatePairs` at 5989, applied at 6131-6142); tests at test/forester_test.js:2347, 2723 | Yes (read; tests not run) |
| Layouts | `rectangular`, `circular`, `unrooted`; display modes phylogram / aligned / cladogram | archaeopteryx.d.ts `Layout`, `ViewState.display`; README.md:202-280 | Yes |
| Tracks (aligned per-tip graphics) | alignment (rectangular only), conservation bar or sequence logo, heat map (rectangular columns; circular rings; none in unrooted), protein domain architectures, genome-region gene arrows | README.md:548-832, 2168-2552 | Yes |
| Node count thresholds | "Drawing N nodes" card from 5,000 nodes; "Redrawing" card if last redraw >= 300 ms; heat map merges runs above 60,000 cells | archaeopteryx.js:`OPENING_CARD_NODES = 5000` (line 297), `REDRAW_CARD_MS = 300`, `HEATMAP_BORDER_MAX_CELLS = 60000` (line 660) | Yes |
| Types | `archaeopteryx.d.ts`, 303 lines; omits `ViewerHandle.ready` and `archaeopteryx.busy`, which the README documents | archaeopteryx.d.ts vs README.md:1062-1075, 1094-1108 | Yes |

## The public API, from source

### Entry points (archaeopteryx.d.ts `Archaeopteryx`)

- `launch(container, tree | tree[], config?) -> ViewerHandle`. Container is a CSS selector or an element; an unresolvable container throws (archaeopteryx.js:6567-6577). Exactly 3 arguments, else throws (line 6591).
- `launchArchaeopteryx(container, fileName, data, config?)`: parse and launch.
- `parseTree`, `parseTrees`, `parsePhyloXML`, `parseNewHampshire`, `parseNexus`, `parseAuspiceJson`.
- `getSelectedNodes()`, `encodeViewState()`, `decodeViewState()`.
- Not in the .d.ts but documented/implemented: `archaeopteryx.busy(container, label, detail, fn)`; `forester.joinMetadataTable(tree, text)` (README.md:454); `forester.*` helpers (own entry `archaeopteryx/forester`, package.json `exports`).

### Viewer handle (archaeopteryx.js:6454-6483)

`getSelectedNodes()`, `ready` (Promise), `getTreeCount()`, `getTreeIndex()`, `showTree(i)`, `getViewState()`, `applyViewState(state)`, `destroy()`. That is the complete list. There is no `highlight`, `focus`, `zoomTo`, `on(...)`, `setData`, `resize` or `getNode` method.

### Config keys (README.md:1498-1560 and archaeopteryx.d.ts `ArchaeopteryxConfig`)

About 40 current keys: `collapseControlPanel`, `panelDensity`, `enableDynamicSizing`, `displayWidth`, `displayHeight`, `zoomToFitUponWindowResize`, `rootOffset`, `layout`, `ladderizeTree`, `showMsa`, `showMsaLogo`, `showProperties`, `labelProperties`, `showHeatmap`, `heatmapColumnOrder`, `heatmapManualOrder`, `showDomainArchitectures`, `domainLabels`, `domainGlow`, `domainEvalueExponent`, `showGenes`, `geneAnchor`, `geneFamily`, `geneLabels`, `showScaleAxis`, `showScaleGrid`, `showSupportDots`, `supportDotMinimum`, `searchAinitialValue`, `searchBinitialValue`, `view`, `onViewChange`, `enableVisualizations`, `initialVisualization`, `visualizationsLegendXpos/Ypos`, `enableDownloads`, `pngExportScale`, `nhExportWriteConfidences`, `internalNumericLabels`, `nodeLabels`, `enableSubtreeDeletion`, `enableAccessToDatabases`, `enableManualNodeSelection`. Unknown or removed keys throw (README.md:1566-1580). The 118 removed keys (README.md:1612-1735) include every colour, font and size default (`backgroundColorDefault`, `branchColorDefault`, `labelColorDefault`, `defaultFont`, `fontSize`, `nodeSizeDefault`, `branchWidthDefault`, ...), each with a reason such as "The default branch colour is fixed."

### Events and callbacks

| Mechanism | What it gives | Source |
|---|---|---|
| `config.onViewChange(state, encoded)` | called once per settled redraw when the view changed; `state` is the serialisable view (layout, collapsed clade ids, searches, colour-by, tracks, ...) | archaeopteryx.d.ts; archaeopteryx.js:6319-6323 |
| `document` event `selected_nodes_changed_event` | plain `Event`, no payload; fires at selection changes. Read the selection with `viewer.getSelectedNodes()`. Needs `enableManualNodeSelection` for the node menu's Select entries; the clock plot also selects | archaeopteryx.js:7284, 7299, 11727; README.md:2666-2687 |
| Node click | `svg.on('click.aptxnode')` calls the internal `_treeFn.clickEvent`, which is `getClickEventListenerNode(phylo)` and opens the built-in node menu. No user hook | archaeopteryx.js:1805-1818, 6783, 7085 |
| Node hover | internal `hover()` shows a built-in tooltip `div` appended to `document.body`. No user hook | archaeopteryx.js:1792-1803, 1837-1844, 18246 |
| Domain / gene click | click opens Pfam / InterPro / BV-BRC / NCBI links. No user hook | README.md:577-580; archaeopteryx.js:12232, 13008 |

So the earlier note "no documented node-click callback" is correct and confirmed in code. A selection event with no payload is the only generic outbound signal, and it is reached via a two-click menu path.

### Programmatic select / highlight / zoom to a node

- No direct method. Indirect routes that do exist:
  1. `applyViewState({ searchA: { field: 'name'|..., mode: 'whole word', value: 'TIP' } })` highlights matching nodes (bold search colour, pulsing halo, everything else dimmed; README.md:458-477). `applySearchState` also opens the Search panel section (archaeopteryx.js:10249-10251). Whether the viewport is centred on the first hit automatically is UNVERIFIED; the "k / N" navigator centres on a hit only on user action.
  2. `applyViewState({ subtree: <preorder id> })` switches to a clade view (archaeopteryx.js:10063-10073) and `collapsed: [ids]` collapses clades. Node ids are launch-time preorder indexes, so they only make sense for the same tree object.
  3. `config.view` opens straight into such a state.
- `centerNode()` (archaeopteryx.js:1407) exists internally but is not exposed.
- Highlight "from outside" with a distinct marker and a row band, as in goal.md's occurrence-page story, is therefore only approximated by a search highlight, not a persistent per-node style set by the host.

### Injecting custom data

| Need | Mechanism | Limits |
|---|---|---|
| Metadata per tip | `forester.joinMetadataTable(tree, tsvText)` before `launch()`; columns become `meta:<header>` node properties (README.md:420-456). Or write properties onto nodes (`node.properties = [{ref, value, datatype, applies_to}]`, archaeopteryx.d.ts `PhylogenyNode`) | exact then case-insensitive tip match; `{columns, tips, matchedTips, unmatchedTips, unmatchedRows}` report is returned, which suits the "unmatched tips must be visible" requirement |
| Text beside the tip | `showProperties`, `labelProperties: [refs]`, `nodeLabels` | text only; values joined by ' | '; no per-field styling |
| Colour / shape by field | automatic "Color by" / "Shape" from properties | palette fixed (Observable10, README/JS lines 70-79 of archaeopteryx.js) |
| Heat map | numeric per-tip properties (two or more) -> columns; `showHeatmap`, order keys | one shared colour scale; columns are properties, not arbitrary graphics (README.md:724-830) |
| Alignment | phyloXML `<mol_seq is_aligned="true">` or Nexus CHARACTERS matrix | rectangular only, windowed scroller, wheel over the track scrolls columns |
| Domains | phyloXML `<domain_architecture>` | coloured by domain name, E-value filter |
| Gene arrows | phyloXML sequences with `<location>` | as above |
| Anything else (thumbnails, count badges, match-status icons, React content) | none | no custom-track or cell-renderer API. Would need a fork |

### Styling

- Honoured per node via phyloXML `style:` properties: `style:font_color`, `style:node_color`, `style:node_shape` (circle/rectangle/diamond), `style:font_size`, `style:font_style`; plus phyloXML `<color>` on branches. Not honoured: font name, `node_size`, `node_transparency`, `node_fill_type` (README.md:2093-2108). This confirms the earlier note. Note these are data (set on the tree object before launch), not callbacks; a colour-by-field legend overrides `style:font_color`.
- Colours, fonts, sizes: fixed or panel sliders; the launch config deliberately has no colour/font keys (README.md:1612+).
- Theming: panels, dialogs and tooltips follow `prefers-color-scheme` or an explicit `aptx-light` / `aptx-dark` class (archaeopteryx.js:1600, 16082, 16117, 16669-16740). The CSS is injected by the library (`PANEL_STYLE_ID = 'aptx-panel-styles'`, line 277). Class names are `aptx-*`; the host can restyle with CSS but the project itself removed the legacy class `node_mouseover_tooltip` in 3.24.0 and warns that host stylesheets can leak in (CHANGELOG.md:30-39). No CSS-variable / design-token contract is documented. GBIF token mapping would be selector overrides: UNVERIFIED how much of the tree drawing (inline SVG attributes) can be restyled by CSS.

### Reducing the UI to a bare tree

- `collapseControlPanel: true` folds the panel "to just its header bar" (README.md:1521). `panelDensity: 'compact'` narrows it (196px). `enableDownloads`, `enableVisualizations`, `enableSubtreeDeletion`, `enableAccessToDatabases` hide sub-features. There is no key that removes the panel, the toolbar, the overview miniature or the legend.
- Hiding `.aptx-panel` with CSS is conceivable, but `rootOffset` defaults to 254 px "clears the control panel" (README.md:1523, approximate), and the keyboard shortcuts and panel-driven state would remain. UNVERIFIED whether the layout copes; it needs a hands-on test.

### React, lifecycle, SSR

- Mount: `useEffect(() => { const v = archaeopteryx.launch(ref.current, tree, cfg); return () => v.destroy(); }, [...])`. `destroy()` removes the container DOM, node menu, dialogs, MSA scroller, body-level tooltip, resize listener, and every document-level key/wheel listener (archaeopteryx.js:6491-6560). The README states a later `launch()` works normally. Good, but see the singleton problem below.
- **Singleton state.** README.md:1110-1112: "One viewer per page: the library keeps its display state in one place, so a second launch — into any container — replaces the first." The module keeps `_container`, `_root`, `_state`, `_settings`, `_treeFn`, `_selectedNodes` etc. as closure variables (archaeopteryx.js:6491-6560 resets them). Two trees on one page (e.g. a mini-tree in a sidebar and a Phylogeny tab) or React 18 StrictMode double-mount races are therefore hazardous. `_launchSeq` guards a deferred first draw against destroy (line 6492).
- **State sync from React:** one direction only. `getViewState()` / `applyViewState()` / `onViewChange` give a serialisable view (layout, collapsed clades, search, colour-by, tracks), but not pan/zoom ("Zoom, pan ... are not part of a view; a shared view opens fitted", README.md:526-528). Selection is readable via `getSelectedNodes()`, not settable.
- **Resize:** only `window` resize events are listened to (archaeopteryx.js:6764 `d3.select(window).on('resize.archaeopteryx', ...)`); there is no `ResizeObserver` on the container for the tree itself (the only `ResizeObserver`s are inside the panel, lines 17311, 18836). A container that changes size without a window resize (tab reveal, split panes) will not re-fit. Mitigation: dispatch `window.dispatchEvent(new Event('resize'))`: UNVERIFIED. A hidden tab with `display:none` at launch would measure zero: UNVERIFIED, test it.
- **Global listeners:** while mounted it binds `document` `keydown` and `wheel` handlers (lines 18615-18660). These act on Ctrl/Cmd combos, Page Up/Down (font size), `O`, and any shifted wheel anywhere on the page, unless the event is `defaultPrevented` or the target is a typing target. On gbif.org they could fight page shortcuts. UNVERIFIED how far the wheel handler is limited to the tree area.
- **SSR:** importing in Node works. The UMD wrapper tolerates a missing d3 and the parsers run in plain Node; only `launch()` needs a browser (README.md:1130-1136, archaeopteryx.js:6567 `typeof document` guard). So `import` at module scope in Next.js is fine as long as `launch()` is called in an effect. Parsing in Node/SSR is a bonus.
- **Bundlers: probable problem.** The CommonJS branch resolves dependencies with `reqOpt(name)` calling `require(name)` on a variable (archaeopteryx.js:84-96). Webpack/Vite/esbuild cannot statically resolve `require(variable)`, so `d3`, `phyloxml` and `./forester` would not be bundled; the library then reads `root.d3`, `root.forester`, `root.phyloXml` globals, and failing that throws "d3 (version 7) must be loaded before launching" (archaeopteryx.js:296-330). This is inferred from reading, not tested (UNVERIFIED), but it means a bundler install may need `window.d3 = d3; window.forester = ...; window.phyloXml = ...` before launch, or loading the files as plain scripts (which the README presents as the primary path, "the classic path"). Add to the hands-on test list.
- **Bundle size:** not tree-shakeable (single CommonJS/UMD file, whole `d3` object). Raw 973 KB + 505 KB unminified; 257 KB + 137 KB gzipped unminified, plus d3 and phyloxml. Minified size UNVERIFIED. Expect on the order of 0.5 MB gzipped all in (My judgement).

### d3 version

d3 `^7.9.0` (package.json); `requireD3()` demands `d3.zoom` and `d3.cluster` (archaeopteryx.js:316-330). Auspice and Phylo.io use older d3 (see other-web-viewers.md).

## Scale: what the rendering code does

- Layout is `d3.cluster()` over the whole tree (archaeopteryx.js:6781); redraw recomputes layout and paths. A collapsed clade is a single leaf taking `2r-1` rows weight (lines 2991-3006) and "what it hides is not laid out".
- **Elements per node.** Since 3.6.0 branches, node dots, shapes and halos are batched into "a handful of paths, not as elements per node": one path per distinct branch style and one per distinct dot/shape style (archaeopteryx.js:5013-5040). Quote: "250,374 elements for a 50,000-node tree ... dragging that tree ran at about 12 frames a second ... hiding them with the branches merged into one path made it 60. The browser pays per ELEMENT painted, not per segment drawn." An uncoloured tree is ONE branch path. Per-node `<g class=node>` groups exist "only for nodes that draw a label, value or collapsed clade" (CHANGELOG.md:540-556). Hit-testing uses a `d3.quadtree` over nodes, not an element each (line 1838).
- **Labels** are the remaining per-node element cost. "Auto-hide Labels" thins by index (`n.hide = !n.children && _dynahide_factor >= 2 && (++_dynahide_counter % _dynahide_factor !== 0)`, lines 3161-3183, factor derived from font size and rows on screen) and by overlap in the radial layouts. It samples every Nth label rather than showing clade-level summaries.
- **Tracks.** Domain backbones/shadows are batched (lines 12036-12060: "32,346 elements ... 430 ms against 22 ms with the track off" before batching). Domain bodies remain one rect each. The heat map draws per-cell above 5 px cell size, otherwise merged runs of equal colour, and always merged above 60,000 cells (README.md:751; archaeopteryx.js:659-660). Wide matrices are windowed (columns scroll). The alignment track is a scrolling window of columns, never drawn whole.
- **Thinning / semantic zoom:** partial. Zoom re-lays-out (it is not a CSS scale); labels thin automatically; tracks switch representation by cell size; the overview miniature is one concatenated path. Missing: automatic collapse of clades into summary labels at low zoom. The config keys for auto-collapse by depth/rank/feature were removed ("The collapse feature was removed", README.md:1628-1640). Manual collapse remains (node menu, README.md:220-240) and `applyViewState({collapsed: [...]})` can collapse specified clades from code. Clade labels spanning a taxonomy band (goal.md's wish) do not exist.
- **Documented numbers (all self-reported by the maintainer):** "a 50,000-node tree opens in a third of a second and pans at 60 fps" (CHANGELOG.md:540-541, 3.6.0); a bare 5,000-node tree opens in about half a second and 20,000 in a second with CPU slowed 6x, "a real annotated tree takes several times longer" (archaeopteryx.js:~279-285 comment); a 1,386-node tree with 1,428 domain architectures "redraws slower than a 50,000-node tree without" (same comment block). Demo trees go up to 13,246 tips (README.md:53). No benchmark above 50k nodes, none at 100k tips, none with several columns active, no 1M. No third-party reports. Rooting MAD is O(n^2) (README.md:346). Criterion 15's numbers must be measured.

## Criteria scorecard

| # | Criterion | Rating | Evidence |
|---|---|---|---|
| 1 | Pure browser runtime, static-file deployable | **Yes** | "The library does no networking" (README.md:1033-1035); all in-browser; open.html reads files locally. You fetch the file yourself |
| 2 | Embeddable component (npm, React or agnostic) | **Partial** | npm + .d.ts, imperative `launch()`/`destroy()`; framework-agnostic; but a full-app UI, one viewer per page, probable bundler issue with dynamic `require` (see above), no React component |
| 3 | 100k+ tips responsive | **Unknown (promising)** | Batched paths and quadtree design; claim 50k nodes at 60 fps (self-reported). Layout, label and track costs at 100k tips are unmeasured; demo max 13,246 tips |
| 4 | Newick, Nexus, phyloXML (NeXML nice) | **Yes** (NeXML **No**) | README.md:1217-1235; TRANSLATE handled in forester.js:5892-6145; also NHX, Auspice JSON, BEAST/MrBayes |
| 5 | Programmatic API: highlight, focus, metadata | **Partial** | metadata yes (`joinMetadataTable`, properties); highlight only via `applyViewState` search; no focus/centre/zoom-to; no per-node style setter at runtime |
| 6 | Layouts rectangular, circular, unrooted | **Yes** | `Layout = 'rectangular' | 'circular' | 'unrooted'` (archaeopteryx.d.ts). Heat map not in unrooted, alignment rectangular only |
| 7 | Licence compatible | **Partial** | LGPL-3.0-or-later + LGPL-2.1+ phyloxml; workable with conditions, see Licence analysis. Needs deliberate sign-off but is not GPL/AGPL |
| 8 | Maintenance health | **Partial** | extremely active but single maintainer, AI co-authored, 22 releases in 33 days after a 2019-2026 gap, 44 stars. Active, not yet proven durable |
| 9 | Accessibility / theming / mobile | **Partial** | light/dark theming and `panelDensity`; SVG with no documented ARIA or keyboard tree navigation (README.md:478-513 lists shortcuts for zoom and search). Mobile/touch: UNVERIFIED. Design-token theming: No documented contract |
| 10 | Export (SVG/PNG/Newick) | **Yes** | SVG native; PNG needs canvg; PDF needs jspdf + svg2pdf; Newick/Nexus/phyloXML/FASTA/TSV (README.md:1236-1290) |
| 11 | Interaction callbacks with node + metadata | **No** (workaround only) | No click/hover/select callback; only a payload-less `selected_nodes_changed_event` on `document` after menu selection (archaeopteryx.js:7284). A patch to `clickEvent`/`hover` would be small |
| 12 | React integration, controlled state, clean mount/unmount | **Partial** | `destroy()` is thorough, but there is no component, state is one-way (view state out/in; no selection or viewport setter), one instance per page, window-only resize |
| 13 | Custom per-tip rendering aligned beside the tree, React content | **Partial** (built-ins) / **No** (custom) | Built-in heat map, alignment, logo, domains, gene arrows, text labels are the nearest thing to the ETE screenshots; no custom track API, no React/HTML cells, no thumbnails or badges, tooltips are fixed templates |
| 14 | Semantic zoom, collapse into summaries when zoomed out | **Partial** | label thinning, heat map run-merging, windowed tracks; no automatic clade summaries (auto-collapse removed); internal-node markers: support dots (`showSupportDots`), colour/shape by field |
| 15 | Scale as numbers with custom columns | **Unknown** | maintainer-reported 50k nodes only; must be measured |
| 16 | Styling hooks (colours, fonts, sizes, per-node style from code; CSS theming) | **Partial** | per-node via data `style:*` properties (5 honoured, 4 not); colour-by-field; no callback hooks; colour/font config keys removed; theming by light/dark class and `aptx-*` CSS |

Relation to goal.md's "seen in the screenshots" table:

| ETE screenshot feature | Archaeopteryx.js |
|---|---|
| Coloured squares / circles sized by support on internal nodes | Support dots (threshold) and colour/shape by property; size by support not exposed (UNVERIFIED) |
| Several labels per tip, styled separately | Several fields in one label via `labelProperties`; no per-field style |
| Aligned columns: presence/absence bars, alignment, domains | Heat map (presence/absence works), alignment, domains: Yes, via phyloXML data |
| One row highlighted with a focus marker, set from outside | Search highlight only |
| Support labels on branches | Yes (confidence values) |
| Hover tooltips on custom graphics | Yes for the built-in tracks (heat-map cell, residue, domain), not custom |

## Corrections to docs/comparison.md

- "No limits documented ... SVG, so expect an SVG-class limit": partly wrong. It is SVG, but batched into a handful of paths; the maintainer claims 50k nodes at 60 fps (CHANGELOG.md:540). Still unmeasured at 100k+ and with tracks.
- "Documented: `onViewChange`, and `selected_nodes_changed_event`... Node-click callback not found": confirmed.
- "full-app UI": confirmed; the panel can be collapsed, not removed.
- "some `style:` properties are not honoured": confirmed (font name, `node_size`, `node_transparency`, `node_fill_type`). Add: the honoured ones are per-node data properties, and the global colour/font/size config keys were deleted.
- "Config, not callbacks": confirmed.
- Missing from the notes: one viewer per page; window-only resize; global key/wheel listeners; probable bundler problem; collapse-by-feature removed; `viewer.ready`; LGPL-2.1+ phyloxml dependency; AI-assisted single-maintainer history.

## Maintenance evidence

- Commits: 813 on master. The 30 most recent span 2026-09-30 to 2026-10-07, all co-authored "cmzmasek and claude" (https://github.com/cmzmasek/archaeopteryx-js/commits/master). A depth-1 clone showed only the latest commit, so I could not compute full history locally.
- Releases: 3.0.0 on 2026-09-04, then 3.1.0 to 3.24.0 through 2026-10-07 (registry). CHANGELOG.md:1-9 says entries accumulate under Unreleased as work lands, then a release makes the GitHub Release body.
- Before that: npm 1.x published 2019-05-16; 2.3.2 on 2026-07-29. The original repo dates from 2016-2017 (issues #1-#11 are from 2016-2017). Issue #13 "npm support?" was closed 2019-10-29.
- Community: 13 issues ever, all closed; 6 PRs, one external fix in 2026 (#18 from `kscgl`); Dependabot PR #19 (2026-10-03). Open issues 0, open PRs 0. This reads as a small user base, not as a healthy support channel.
- Backing: copyright lines list JCVI and Yun Zhang as well as the author (archaeopteryx.js:2-4); BV-BRC is the named consumer. Funding statement: UNVERIFIED.
- Bus factor: 1 (one npm maintainer, one human committer). The rewrite style (long design commentary in comments, "or another Claude" in the README at line 1740) suggests the code is intended to be maintainable by AI agents; that is a risk and an opportunity for a fork.
- API stability: 3.0 is a hard break (118 removed keys throw). Within 3.x, 3.6.0 changed the SVG structure ("no `path.link` per branch ... For embedders: the SVG is structured differently", CHANGELOG.md:543-545) and 3.24.0 removed a CSS class. Anything we do that depends on DOM structure or class names will break regularly.

## Licence analysis (LGPL-3.0-or-later in an Apache-2.0 project, shipping a minified browser bundle)

Not legal advice; GBIF needs deliberate sign-off per CLAUDE.md. Reasoning from the licence text (https://www.gnu.org/licenses/lgpl-3.0.html, section 4):

1. gbif.org serves JavaScript to users' browsers. That is distribution (conveying) of the library to the user, even if no server code is distributed, so LGPL obligations apply.
2. Using Archaeopteryx.js through its public API and linking it unchanged makes our app a "Combined Work", which LGPL §4 lets us license under terms of our choice (Apache-2.0 is fine), provided those terms "permit modification of the Combined Work for the customer's own use and reverse engineering for debugging such modifications". Apache-2.0 permits both.
3. Conditions for a Combined Work: give prominent notice that the Library is used and covered by the LGPL; ship the LGPL text (and GPL text it references); and either (a) link dynamically via a "suitable shared library mechanism" or (b) supply the Minimal Corresponding Source and Corresponding Application Code so the user can relink with a modified library. For a browser, the cleanest compliance is (a): ship `archaeopteryx.js` as its own unmodified, separately loadable file (the npm package already is one), loaded via `<script>` or a dynamic import, and keep it out of the minified application chunk. A user can then substitute a modified copy. Folding it into one minified application bundle with tree-shaking, as bundlers would, makes (a) harder to argue and pushes you to (b). Even then the library's own source is public, so the burden is mainly publishing our application's source or build inputs; Apache-2.0 application code is already open, if gbif.org's frontend is.
4. Modifications to Archaeopteryx.js itself (patch or fork) must be released under LGPL-3.0-or-later with source. Our wrapper and React components, using only the public API, can stay Apache-2.0. The line to keep clean is "patches live in the fork; GBIF application code only calls the public API".
5. Apache-2.0 and GPLv3/LGPLv3 are one-way compatible (Apache-2.0 code can be incorporated into GPLv3 works because of the patent clause). The combined distribution is not a problem so long as we do not claim to relicense the LGPL parts.
6. `phyloxml` (the parser/serialiser dependency) is LGPL-2.1-or-later (registry). Its handling is the same pattern. d3 (ISC), sax (BlueOak-1.0.0) and optional canvg / jspdf / svg2pdf.js (MIT) are permissive.
7. Practical approach: vendor the unmodified package files as static assets (or the fork's files, with source), load with `<script>`/dynamic import, record the notice in the site's third-party licences page.
8. Open point for legal: whether serving a webpage that executes an LGPL library in the user's browser triggers the "User Product / Installation Information" clause (GPLv3 §6); that clause is about consumer hardware products, so it probably does not apply. UNVERIFIED legal view.

## Extension effort (My judgement, based on the code structure; no work was done)

Context: `archaeopteryx.js` is one 20,504-line closure with ~100 module-level `let` variables, written to be read in one piece; the maintainer is adding features daily.

| Gap | Approach | Effort | Notes |
|---|---|---|---|
| Node click / hover callbacks (11) | Fork: add `onNodeClick(node, event)`, `onNodeHover(node, event)` config keys and invoke them from `svg.on('click.aptxnode')` / `hover()` (archaeopteryx.js:1805-1844) | Small: days incl. tests | Node objects are phyloXML-shaped with our properties attached; `config` validation list needs the new keys (line ~5700) |
| Highlight / focus / zoom-to node (5) | Expose `highlightNodes(nodesOrNames)`, `focusNode(node)` using existing `centerNode` (1407), found-colours and halo code (5223, 5314) | Small to medium: about 1 to 2 weeks | Wrapper-only alternative: `applyViewState` search to highlight, plus manual DOM zoom. Poor |
| Persistent, host-set row band + marker (occurrence page) | New "pinned tips" layer reusing the batched dot/halo layers | Medium: 1 to 2 weeks | Needs design in the batched geometry code |
| Multiple instances per page / StrictMode safety (12) | Refactor module singletons into a per-viewer object | Large: weeks, high merge-conflict risk against upstream | A wrapper can avoid this by allowing exactly one viewer per page (acceptable for a Phylogeny tab) |
| Container ResizeObserver + hidden-mount (12) | Add `ResizeObserver` calling the existing resize handler | Small | Wrapper can dispatch `resize` as a stopgap (UNVERIFIED) |
| Hide the panel / bare tree (2) | Config key to not create `.aptx-panel`, toolbar, overview | Small to medium: touches layout offsets such as `rootOffset` and `leftPanelClearance()` | CSS-hiding is a hack to test first |
| Bundler-friendly build (2) | Replace `require(variable)` with static requires or an ESM entry | Small | Lets bundlers tree-shake d3 |
| Custom tracks with host data and React-like content (13) | A track plug-in API: host supplies per-tip drawing function / cell renderer plus width, invoked in the batched layers; HTML overlay for rich cells | Large: weeks to a few months | Built-in tracks (heat map, domains) show the pattern but each is bespoke (~500 lines each). Lower-effort alternative: encode our columns as numeric properties and use the built-in heat map for counts/presence |
| Per-node style callback (16) | `nodeStyle(node) -> {color, shape, size, ...}` evaluated in the draw pass | Small to medium | Currently styles come from `style:` properties; you can set those from the host before launch, which covers static styles |
| Automatic clade summaries at low zoom (14) | New LOD pass: collapse by pixel size, draw clade labels | Large | Upstream removed auto-collapse; manual collapse code exists to build on |
| 100k+ tips with columns (3, 15) | Measure first; likely work on labels, layout cost, track windows | Unknown | Maintainer has shown willingness to profile and batch; a good upstream conversation |

Wrapper-only (no fork) can deliver: load tree, join metadata table, colour/shape by field, built-in heat map and domain tracks, `onViewChange` sync, destroy on unmount, search-based highlight. A fork is required for criteria 11, parts of 5, 12 (resize, singleton) and 13 (custom).

Fork versus upstream: upstream is moving at 1+ release per 1.5 days and rewrote its structure within the last month. A fork carrying even small patches will conflict continuously; the better route is proposing the small callbacks/focus API upstream first (the maintainer is responsive and AI-assisted, 0 open issues). If rejected, pin a version and carry patches. We have no evidence yet on how upstream treats outside feature PRs (only 1 merged in 2026).

## Risks

1. API and DOM churn; 118 removed keys; breaking SVG structure change within the 3.x line.
2. Single human maintainer; AI-generated code volume (about 35k lines in two files); no outside contributors beyond one bug fix.
3. Singleton architecture blocks multi-instance and complicates React.
4. No event API: the core GBIF interaction (click tip, open occurrence) needs a patch.
5. Scale beyond 50k nodes unmeasured; labels and track costs are the likely bottlenecks; no 1M path.
6. LGPL compliance depends on packaging as a separate file.
7. Global `document`/`window` listeners and a body-level tooltip can collide with gbif.org.
8. Bundler incompatibility of the UMD `require(variable)` pattern (inferred).
9. Accessibility: SVG canvas with menus; no evidence of ARIA or keyboard tree navigation. UNVERIFIED.
10. Theming to GBIF tokens is selector overriding of generated CSS; no stable contract.

## Open questions for hands-on testing

1. Does `import {archaeopteryx} from 'archaeopteryx'` work under Vite/webpack, and what globals must be set? Measure minified+gzipped size with and without d3 tree-shaking.
2. Load 1k, 5k, 20k, 100k, 500k-tip Newick files (single tree, then with 3 numeric properties as heat-map columns and a metadata table): record parse time, `viewer.ready`, frame rate while panning and wheel zooming, and the size at which it becomes unusable. Check whether the browser stays responsive during `d3.cluster` at 100k tips and which label policy applies.
3. Does `applyViewState({searchA: ...})` centre the first hit? Can a wrapper call anything to pan to a node? Check how many DOM elements exist at 100k tips (labels, node groups).
4. Does hiding `.aptx-panel` (CSS) give a usable bare tree, and what happens to `rootOffset` and the legend?
5. Container resize without a window resize; mount into a hidden tab; React StrictMode double mount; two mounts on one page.
6. Which of the page-level key/wheel handlers fire when focus is elsewhere on gbif.org?
7. Can the GBIF design tokens override the panel, tooltip and dialog CSS, and what is still hard-coded in inline SVG attributes?
8. Nexus file with a TRANSLATE table plus unmatched tip handling, via `joinMetadataTable` report.
9. Would the maintainer accept an `onNodeClick` / `focusNode` PR? (Ask in an issue before forking.)
10. BV-BRC: confirm the live deployment and its tree sizes, and ask what scale they run.
