# OneZoom: full analysis

Assessed 2026-10-08. Primary sources: a shallow clone of https://github.com/OneZoom/OneZoom (the checkout's `package.json` points to `jrosindell/OneZoomComplete`; HEAD `53b0f2c`, "Merge pull request #1114 from OneZoom/is-testing-appconfig", committed 2026-10-07), the licence PDF in that repo (`OneZoom_License_V1.pdf`, read in full), the data files in `static/FinalOutputs/data/`, the JS module `OZprivate/rawJS/OZTreeModule/`, and the project's own pages. Nothing was run or installed. "UNVERIFIED" marks what I could not confirm. The GitHub page for the repo is also titled https://github.com/OneZoom/OZtree (redirect name, 113 stars, 27 forks, 3,796 commits per the page).

## Summary

OneZoom is the only candidate found whose scale is proven on a biodiversity tree: the live site's root page lists **2,228,001 species** (https://www.onezoom.org/life), and the repository's newest bundled topology file contains **2,235,472 nodes** in a **4.47 MB string (679 KB gzipped)**. It does this on an HTML canvas with lazy node creation, pixel-threshold level of detail and garbage collection, and the paper says it works "even on relatively old mobile devices". It is actively maintained by a UK charity.

It is **not a drop-in component for gbif.org**, for four independent reasons: (1) the licence is a custom non-profit, source-available licence, not open source, with obligations that need GBIF legal review; (2) there is no npm package or React story, only a global-singleton bundle driven by a canvas id; (3) it does not read Newick/Nexus/phyloXML, it consumes its own pre-built data products from a DVC pipeline and a web2py JSON API for names, images and search; (4) its layout is a fractal "tree of life" shape, not the rectangular/circular phylogram that criteria 6 and 13 describe. Its value to us is mainly as **architecture to learn from** (two-bytes-per-node topology string, lazy materialisation, frame-time-adaptive LOD, static binary slices for per-node data), and possibly as a **linked external view** (iframe or link) of the whole tree of life.

## Facts

| Item | Finding | Source | Verified |
|---|---|---|---|
| Project | OneZoom Tree of Life Explorer; UK charitable incorporated organisation no. 1163559, run by an independent charity since 2015; first released under an open source licence in 2012 | https://www.onezoom.org/about.htm ; licence PDF definitions | yes |
| Code | `OneZoom/OneZoom` (web2py app plus JS module). JS source `OZprivate/rawJS/OZTreeModule/src`, about 15,140 lines in `src/*.js` and `src/*/*.js` (counted with wc) | clone | yes |
| Data pipeline | `OneZoom/tree-build`: DVC pipeline, inputs Open Tree of Life synthesis (`ot_version` in `params.yaml`, e.g. v16.1), Wikidata, EOL, Wikipedia pageviews. Outputs `completetree_XXXXXX.js(.gz)`, `cut_position_map_XXXXXX.js(.gz)`, `dates_XXXXXX.js(.gz)`, SQL import. MIT licence. 448 commits, 2 stars | https://github.com/OneZoom/tree-build | yes (page) |
| Activity | Last commit in clone 2026-10-07; about page lists version `4.1-156-g2e87f40a`; grant of GBP 25,000 in 2022 for tree tours; "OneZoom still needs funding" | clone; about page | yes |
| Scale (live) | Root page "All life (biota)": 2228001 species; Archaea and Eukaryotes 2,168,389; Eubacteria 59,612 | https://www.onezoom.org/life | yes |
| Scale (data in repo) | `static/FinalOutputs/data/completetree_28585326.js`: 4,471,540 bytes raw, 679,436 gzip. The topology string is 4,470,944 chars with 216,658 `(` and 2,018,814 `{` openers, i.e. 2,235,472 nodes, about 2 characters per node (0.3 byte per node gzipped). `cut_position_map_28585326.js`: 1,909,104 bytes, 397,948 gzip. The metadata section in that file is only the column headers (581 bytes), so names, images etc. are not in it | counted with python3 -I over the file | yes (the file's date relative to the live site: UNVERIFIED) |
| Paper | Wong and Rosindell, "Dynamic visualisation of million-tip trees: the OneZoom project", Methods in Ecology and Evolution 13(2):303-313 (2022), DOI 10.1111/2041-210X.13766; preprint https://doi.org/10.1101/2020.10.14.323055. Abstract: "feed these data to a client-side visualisation engine in parts. We develop a way to store the whole tree topology locally in a highly compressed form, then dynamically populate metadata such as text and images as the user explores. The result is a seamless and smooth way to explore the complete tree of life ... even on relatively old mobile devices"; layout and UI are "abstracted components of the codebase enabling other zoomable tree layouts to be swapped in" | Europe PMC record for the preprint (abstract read); full text not retrieved (bioRxiv returned 429, Wiley 403) | abstract yes; body UNVERIFIED |
| Earlier paper | Rosindell and Harmon 2012, PLoS Biol: largest example a 408,135-tip SILVA SSU rRNA tree; "mega-trees" with millions of tips described as expected, not demonstrated; software runs in a browser | https://journals.plos.org/plosbiology/article?id=10.1371/journal.pbio.1001406 | yes |
| Users | Abstract of the 2022 paper reports "nearly 1.5 million online users" after ten years | Europe PMC abstract / search summary | partly (abstract truncated in my fetch; figure from a search summary, UNVERIFIED) |
| Rendering | HTML canvas 2D (`context = canvas.getContext("2d")` in `src/render/renderer.js`; a second off-screen canvas is used for backgrounds). No WebGL | clone | yes |
| Build | Webpack/Babel/Grunt; `package.json` name `onezoom` v1.0.0, `"license": "SEE LICENSE IN license.txt"`, not published to npm as a library (I did not search npm for a published copy: UNVERIFIED) | clone | yes |

## Architecture

1. **Topology as a bracket string.** `fetch_tree_data()` (`src/api/api_manager.js`) injects two scripts, `completetree.js` and `cut_position_map.js`, which define `window.rawData` (the bracket string) and `window.cut_position_map_json_str`. A node is a substring `[start, end]` of `rawData`; there is no per-node object until needed (`Midnode.init(start, end, ...)` in `src/factory/midnode.js`, root created with `init(0, raw_data.length-1, ...)`).
2. **Finding children.** `Midnode.get_cuts()` finds the split point between a node's children by scanning brackets from the end of its substring, unless the substring is at least `cut_threshold` (default 10000) long, in which case it looks the answer up in the precomputed `cut_map`. So the cut map is an index that turns an O(length) scan into an O(1) lookup for large clades, shipped as a separate file.
3. **Lazy materialisation and garbage collection.** `Factory.dynamic_loading_by_visibility()` develops undeveloped nodes in the current viewport; `dynamic_loading_by_metacode(OZid)` develops the path to a given node (3 generations beyond a leaf, 9 beyond an interior node per `docs/factory.markdown`; `config.generation_at_searched_node = 9`, `generation_on_subbranch_during_fly = 7`). `src/factory/garbage_collection.js` runs after each draw and destroys nodes more than a set distance from the visible branch, skipping collection mid-flight.
4. **Level of detail.** `config.threshold = { default: 3, dynamic_adjust: true }` with the comment "set true to adjust threshold according to last frame rendering time cost" (`src/global_config.js`): the minimum on-screen size at which a node is developed and drawn adapts to measured frame time. Rendering cost is therefore bounded by what is legible, which is the behaviour criterion 14 asks for. (How the threshold is applied per shape: not read in depth.)
5. **Per-node data is fetched separately and in batches.** Names, common names, images, IUCN status, popularity, sponsors come from a web2py JSON API (`docs/webAPI.markdown`: "the client needs to get information from the server ... you should not make AJAX calls to this server API directly" because the explorer queues requests). Binary per-node arrays use `DataStore` slices (`src/data_store/data_store.js`, `api.js`): "maps requests for data for a node back to binary array files" such as `iucn_le.dat` read as a `Uint16Array`, fetched on demand with `_batchSize = 5`, retries `_maxFails = 5`. This is a static-file pattern for per-tip numbers (it could carry occurrence counts) and is the part least tied to the server.
6. **Navigation and highlighting.** Controller methods `leap_to(dest_OZid, ...)`, `fly_straight_to`, `fly_on_tree_to`, `highlight_replace / highlight_add / highlight_remove / highlight_list` (`src/controller/controller_anim.js`, `controller_highlight.js`). Highlight strings are `path:[colour]@pinpoint...` and `fan:[colour]@pinpoint...` where pinpoints are names, OTT ids or `@_ozid=N` (`src/projection/highlight/highlight.js`). Only "path" and "fan" highlight types exist.
7. **Events.** A hook registry (`add_hook`/`remove_hook`/`call_hook` in `src/util/hook.js`) with hooks such as `on_tree_loaded`, `before_draw`, `after_draw`, `mouse_down_on_node` (receives the node), `mouse_wheel`, `flying_finish`, plus a `UI_functions` dict passed to the entry function. These are imperative callbacks on the Midnode, not React-style props.
8. **Entry point.** `OZentry.default(server_urls, UI_callbacks, pagetitle_func, canvasID, tree_config)` returns an object with `.controller`, `.data_repo`, `.tree_state`, `.tree_settings`, `.config`, `.add_hook` (`src/OZentry.js`, `docs/JSinterface.markdown`). Embedded mode: `if (!document.body.classList.contains('tree-viewer')) config.disable_record_url = true` ("Don't record tree changes on embedded uses").
9. **Global state.** `controller.js` has a module-level `let controller;`, and `tree_state`, `data_repo`, the renderer's canvas/context are module singletons. There is one explorer per page; I found no `destroy()` (a global event binding `bind_listener()` and a garbage-collection hook are installed at start). Clean unmount: UNVERIFIED and likely not supported.
10. **Chunking of the tree for other uses.** The Python `ChoppingAlgorithm.py` (in `OZprivate/ServerScripts/Utilities`) builds the cut scores and chunks from `.dot`/`.nodes` files produced by the pipeline (read, not run).

## Licence analysis (needs GBIF legal review; I am not a lawyer)

The code is under the **OneZoom Non-Profit Source Available Licence, Version 1 (2017-09-06)** (`license.txt`, `OneZoom_License_V1.pdf`). It is not an OSI licence. Clauses that matter for gbif.org:

- 1.1 "You" means "any not-for-profit entity ... or any individual or group ... acting in their personal capacity".
- 2.1 Grants a perpetual, royalty-free licence to use, modify, distribute and sub-license "for charitable, non-commercial, not-for-profit purposes relating to the Advancement of Science", including "as part of a Larger Work". You may sub-license to a for-profit organisation only in relation to your own use; that organisation "must not and cannot use such Software or Modifications for its own purposes".
- 2.2 and 3.3 No use "to build a tree with sponsorable elements whether or not such sponsorship generates revenue" without a separate licence.
- 3.1 "For-profit organisations are not permitted to use or exploit the Software or any Modification under this Licence in any manner."
- 4.1(b) Software or Modifications that are Made Public ("including ... running the Software or Modifications on a server that serves public webpages") must be licensed on the same terms, with the notice, and be provided in source form; 4.1(e) you must upload Modifications to github.com/orgs/OneZoom.
- 2.3 You grant OneZoom a perpetual, irrevocable licence to use Modifications "for any purpose".
- 10.2 OneZoom may terminate your rights "at any time immediately on notice, if You are causing the Original Developer any damage, including reputational damage, in the Original Developer's absolute discretion".
- 2.4 The code converts to MIT if the charity ceases to exist.
- `license.txt` also says images in `/static/images` and some other material are not licensed for reuse, and that third-party parts keep their own licences.

Reading for GBIF: as a non-profit pursuing science, GBIF may fall inside "You", but (a) the licence travels with every Modification (copyleft-like, plus an inbound grant to OneZoom), (b) hosted portals or partners that are for-profit entities could not reuse the combined work, (c) clause 10.2 gives a discretionary termination right, and (d) the licence is unusual enough that standard open-source compliance tooling will not classify it. Whether embedding unmodified OneZoom in an iframe (not distributing its code) triggers any of this is a legal question. Linking to the public onezoom.org site involves no licence at all. The `tree-build` repository is MIT.

## Scorecard against docs/goal.md criteria 1 to 16

| # | Criterion | Rating | Evidence and caveat |
|---|---|---|---|
| 1 | Pure browser, static-file deployable | **Partial** | Topology and cut map are static JS files, and `DataStore` slices are static binaries, but names/images/search come from a web2py JSON API. README "partial installation" still needs the OneZoom website's APIs. A static-only deployment means reimplementing the API surface |
| 2 | Embeddable component (npm, framework-agnostic or React) | **Fail as shipped** | No npm package found; webpack bundle; imperative `OZentry.default(...)` with a canvas id; module singletons; jQuery shim in `src/libs/` |
| 3 | 100k+ tips responsive | **Pass, strongest evidence** | 2.2M tips on a canvas; repo data file holds 2,235,472 nodes in 4.47 MB. No frame-rate numbers published that I found |
| 4 | Newick, Nexus, phyloXML | **Fail** | Consumes its own bracket-string product built by `tree-build` from Open Tree data; no Newick reader in the viewer. A converter for arbitrary Newick would have to reimplement the pipeline's output (bracket string, `cut_position_map`, OZid numbering, metadata slices) |
| 5 | Programmatic API: highlight, focus, metadata | **Partial** | `highlight_replace/add/remove` (path and fan types only, by name/OTT/OZid), `leap_to` / `fly_*` for focus. Metadata via the server API or `DataStore` slices, not arbitrary tip tables. Tip labels must be resolvable to OTT or OZids, a different identifier scheme from GBIF taxon keys (a mapping would be needed) |
| 6 | Layouts: rectangular, circular, unrooted | **Fail** | Fractal shapes ("spiral", "natural", "fern", "balanced" via `Controller.prototype.change_view_type`; polytomy variants). No rectangular phylogram. Branch lengths are not the primary encoding. The paper says layouts are swappable components, so another layout is possible but means engine work |
| 7 | Licence compatible with gbif.org | **At risk** | Custom non-profit source-available licence; see analysis. Not GPL/AGPL, but not permissive |
| 8 | Maintenance health | **Good** | Commit on 2026-10-07; 3,796 commits; charity; continuous releases (4.1-156). Single-institution risk and funding stated as a need |
| 9 | Accessibility, theming, mobile | **Mixed** | Canvas: no DOM text, so no screen-reader access (inference, UNVERIFIED). Themes are JS objects (`src/themes/*`, including colour-blind variants), not CSS tokens. Mobile: touch handlers (`src/interactor/touch.js`) and the paper's claim of working on old phones |
| 10 | Export (SVG/PNG/Newick) | **Not found** | I found no export function (UNVERIFIED; not searched exhaustively) |
| 11 | Interaction callbacks | **Partial** | Hooks (`mouse_down_on_node` etc.) and `UI_functions`; node object is an internal `Midnode`, not a metadata payload |
| 12 | React integration | **Fail** | No wrapper; singletons; one instance per page; unmount cleanup unproven. Workable only as `useEffect` around a canvas with a hand-written wrapper, or as an iframe |
| 13 | Custom node/tip rendering | **Fail** | Drawing is canvas code in `src/projection/shapes`, `src/ui/leaf_draw.js` and theme files; extending means patching the library under the OneZoom licence. No aligned per-tip columns |
| 14 | Semantic zoom, responsiveness | **Pass, by design** | Pixel-threshold node development with frame-time-adaptive threshold, on-demand node creation and garbage collection |
| 15 | Scale as numbers | **Partial** | Node counts and file sizes verified (above); no published frame rates or load times with custom columns |
| 16 | Styling hooks | **Partial** | `default_viz_settings` accepts keys such as `colours:'popularity'` or `'cols.branch.stroke':'rgb(190,0,0)'` (documented in `OZentry.js`) and custom theme objects; no CSS tokens, no per-node style callback seen |

## Extension effort

Three ways to use OneZoom, with a rough size of work (judgement, UNVERIFIED):

1. **Link or iframe the public site for the whole tree of life.** Effort: hours. No code reuse. Useful for a "see this taxon on the tree of life" link; OneZoom pinpoints are by name/OTT (e.g. `@Mammalia`). No publisher trees.
2. **Fork the engine and feed it publisher trees.** Work: (a) a converter from Newick/Nexus to the bracket string, cut map and OZid numbering, plus a metadata slice writer; (b) replace the web2py API client (`api_manager.js`) with static JSON or `DataStore` slices; (c) a React wrapper with explicit start/stop (and patching out global listeners); (d) add per-tip columns and a rectangular layout (new `projection/layout` and `shapes` modules); (e) legal sign-off and adherence to 4.1(b)/(e) (publish changes to OneZoom). Order of months, and the layout would remain a fractal one unless a new layout is written. Not recommended on current evidence.
3. **Reimplement the ideas in the custom renderer (clean room).** Ideas that carry over, with no code reuse: a succinct topology string that costs about 2 bytes per node (0.3 byte gzipped) and is loaded whole; a precomputed split index for large clades; creating node objects only for the visible region and discarding them afterwards; a LOD threshold tied to measured frame time; per-node binary slices fetched in small batches. The OneZoom bracket string is a form of balanced-parentheses tree, which is also what Empress (`empress/support_files/js/bp-tree.js`, BSD-3-Clause, last commit on the default branch 2022-05-23) uses; that gives a permissively licensed precedent for the same representation. To keep the work independent of the OneZoom licence, derive the design from the papers and public descriptions, not by copying code.

## Risks and caveats

- The 2.2M figure is about the OneZoom tree of life topology rendered as a fractal; the cost per frame at 2M tips is bounded by LOD, but there are no per-column or per-tip-graphic loads in it. It does not show that an ETE-style rectangular tree with aligned columns would scale the same way.
- Metadata and search depend on a live server (names are not in the bundled file).
- The in-repo data files are dated by version number only; the relationship of `completetree_28585326.js` to what is currently served is UNVERIFIED.
- Funding and a single-organisation dependency (stated on the about page).

## What I could not verify

- Full text of the 2022 paper (bioRxiv 429, Wiley 403): any frame-rate or memory numbers and details of the LOD maths.
- Whether an npm build or a documented embed mode for third parties exists beyond the `tree-viewer` body class.
- Clean unmount, multiple instances, export functions.
- Behaviour on non-OTT identifiers.
- Legal reading of the licence for gbif.org; contact point is mail@onezoom.org (licence clause 12.1).

## Sources

- Repo (cloned): https://github.com/OneZoom/OneZoom (files: `license.txt`, `OneZoom_License_V1.pdf`, `package.json`, `OZprivate/rawJS/OZTreeModule/src/{OZentry.js,global_config.js,api/api_manager.js,factory/*.js,controller/*.js,data_store/*.js,projection/highlight/highlight.js,render/renderer.js}`, `docs/{factory,JSinterface,webAPI}.markdown`, `static/FinalOutputs/data/completetree_28585326.js`, `cut_position_map_28585326.js`)
- https://github.com/OneZoom/tree-build, https://github.com/OneZoom/OZtree
- https://www.onezoom.org/about.htm, https://www.onezoom.org/life
- Paper abstract: https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=DOI:10.1101/2020.10.14.323055&format=json&resultType=core ; paper listing https://www.bdi.ox.ac.uk/publications/publication_modal/1230274 (from search results, not opened)
- 2012 paper: https://journals.plos.org/plosbiology/article?id=10.1371/journal.pbio.1001406
- Empress (for the bracket-tree precedent): https://github.com/biocore/empress
