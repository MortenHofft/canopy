# Taxonium (taxonium-component) - source-level verification

Researched 2026-10-08. Repo cloned (full history) from https://github.com/theosanderson/taxonium at commit `68b5287` (2026-10-07); npm registry JSON read directly. Paths below are relative to that repo unless stated. Anything not confirmed is marked UNVERIFIED.

## Summary

- Verdict: **technically the strongest large-tree renderer, but GPL-3.0 and a poor fit as an embeddable library.** It is an app (side panel, search UI, modals) packaged as a React component, not a tree widget with an API.
- Scale is its real strength: WebGL (deck.gl), in-browser worker, "millions of nodes". Rendering LOD is pixel-level de-overplotting, not clade aggregation.
- Interaction API is thin: one click callback (`onNodeSelect(nodeId)`) and one async details callback. No hover callback, no imperative handle, no viewport props. External highlight/zoom works only through the app's search-query state (`query.srch`, `zoomToSearch`).
- Layout is rectangular only. No circular/unrooted. Nexus support is a regex hack (single tree, line-based translate table). No phyloXML/NeXML.
- Process risks: a module-level singleton web worker (one tree per page), `window.alert` for errors, 107 MB npm tarball, React 19 peer, 8 months since last npm publish while repo is active, ~84% of commits by one person.

## Facts table

| Fact | Value | Source | Verified? |
|---|---|---|---|
| Repo | github.com/theosanderson/taxonium (monorepo) | README.md | Yes |
| Component package | `taxonium-component` on npm, latest 2.1.24 | https://registry.npmjs.org/taxonium-component (`dist-tags.latest`) | Yes |
| Licence, repo | GPL-3.0 (root `LICENSE`, "GNU GENERAL PUBLIC LICENSE Version 3, 29 June 2007"); GitHub page shows GPL-3.0 | `LICENSE`; https://github.com/theosanderson/taxonium | Yes |
| Licence, component package | `taxonium_component/package.json` has **no `license` field**; npm registry `license` is empty for 2.1.24. Effective licence is the repo GPL-3.0 | `taxonium_component/package.json`; registry JSON | Yes (absence); inference for effective licence |
| Licence, other sub-packages | `taxonium_backend` and `taxonium_data_handling` declare `"license": "ISC"` in package.json, which conflicts with the root GPL-3.0 (not resolved) | their package.json | Yes (declared); intent UNVERIFIED |
| Last commit | 2026-10-07 "Give modals a default z-index..." (#838) | `git log -1` | Yes |
| Last git tag | v2.1.24 (2026-01-20); GitHub Releases section empty | `git tag`, `git log v2.1.24`; GitHub page | Yes |
| Last npm publish | 2.1.24 on 2026-02-04; prior 2.1.23 2026-01-16, 2.1.18 2025-11-12 | registry JSON `time` | Yes |
| npm cadence | 51 entries (incl. created/modified); first 2023-05-24; ~4-8 per active month in 2025-07/2025-10, sparse since | registry JSON `time` | Yes |
| Commits | 2,531 total; 93 since 2025-10-08 (12 since 2026-04-08) | `git log` | Yes |
| Contributors | 17 distinct commit author names (incl. bots); Theo Sanderson 1,829 + "theosanderson" 299 + agent 26 = ~85% of commits; Alex Kramer 95 | `git log --format=%an` | Yes |
| Open issues / PRs | 87 open issues, 48 open PRs; 134 stars, 29 forks | https://github.com/theosanderson/taxonium (fetched page) | Yes (page text) |
| Backing | Single maintainer (npm maintainer `theosanderson`); academic project (eLife 2022 paper). Institutional funding UNVERIFIED | registry JSON; README | Partly |
| Rendering | deck.gl (WebGL): ScatterplotLayer, LineLayer, TextLayer, PolygonLayer | `taxonium_component/src/hooks/useLayers.tsx` L294-L652 | Yes |
| Tree processing | Parsing and querying in an inline Web Worker | `src/hooks/useLocalBackend.ts` L17-L26 (`?worker&inline`) | Yes |
| Inputs, tree | `nwk`, `nexus`, `jsonl` (Taxonium format), `nextstrain` JSON; optional UShER protobuf via taxoniumtools | `src/webworkers/localBackendWorker.js` L200-L239; `src/types/newick.ts` | Yes |
| Inputs, metadata | CSV/TSV, first column (or `taxonColumn`) joined to tip name; columns become `meta_<header>` | `src/utils/processNewick.ts` `processMetadataFile` | Yes |
| Compressed input | `.gz` via pako, for URL and for loaded buffers | `processNewick.ts` L16-L75 | Yes |
| phyloXML / NeXML | Not found anywhere in `taxonium_component/src` | grep | Yes (absence) |
| Nexus | `nexusToNewick`: regex for first `Translate...;` block, splits per line into exactly 2 space-separated parts, takes the first `tree` statement only, regex-extracts `( ... ) ... ;` | `src/utils/nexusToNewick.ts` | Yes. Quality: fragile (see Risks) |
| Newick parser | Adapted jstree (lh3/jstreeview), MIT, "heavily based on JStree" | `src/utils/jstree.js` header | Yes |
| Layout | Rectangular only (x = distance or time, y = tip order). No circular/radial/unrooted code in component | grep `circular|radial|unrooted|polar` hits only a progress-bar and jstree | Yes |
| Stated scale | "a tool for exploring trees, including those with millions of nodes"; ">6M tips... unreliable... use desktop app" | README.md; `docs/app.md` | Yes (claim) |
| Code-level scale guard | Alert if total nodes > 6,000,000 | `src/hooks/useLocalBackend.ts` (`total_nodes > 6000000`) | Yes |
| Benchmarks | None in repo. eLife paper figures not read | - | UNVERIFIED |
| LOD mechanism | `reduceOverPlotting`: rounds node x/y to a precision derived from visible y-range (`2000/(max_y-min_y)`), dedups nodes mapping to the same cell; query by y-range via binary search | `taxonium_data_handling/filtering.js` L45-L165 | Yes |
| npm unpacked size | 107,170,906 bytes (2.1.24); was 50 MB at 2.0.227 | registry JSON `dist.unpackedSize` | Yes (what is in dist/ vs. bundled deps UNVERIFIED) |
| Runtime deps | `@jbrowse/react-linear-genome-view` ^3.1.0, `@tailwindcss/postcss`, `postcss`, `zod`; deck.gl, axios, pako etc. are devDependencies, i.e. **bundled into dist** | `taxonium_component/package.json` | Yes |
| Peer deps | react ^19.1.1, react-dom ^19.1.1, prop-types | same | Yes |
| React externalised | yes; react-dom subpaths listed to avoid two copies | `vite.config.js` | Yes |
| Dep licences (npm registry `license`) | deck.gl 9.4.0 MIT; @luma.gl/core MIT; @jbrowse/react-linear-genome-view 3.1.0 MIT (as listed by npm; JBrowse repo licence UNVERIFIED); zod MIT; axios MIT; pako "MIT AND Zlib" | registry JSON | Yes |

## Public API actually present (component)

`src/Taxonium.tsx` `TaxoniumProps` (L38-L60) and `README.md`:

- Data: `sourceData {status, filename, filetype, data?, metadata?, ladderize?, taxonColumn?}` (`status: "url_supplied"` fetches `filename` as URL, `"loaded"` takes inline string/ArrayBuffer); `backendUrl`; `usherProtobuf`/`metadataUrl`/etc. for a "place sequences" feature.
- Config: `configDict`, `configUrl` (merged into the tree config; `name_accessor`, `colorMapping`, `colorBy`, `search_types`... see `types/backend.ts` `Config`).
- State: `query` / `updateQuery` (controlled URL-like state: `srch`, `enabled`, `color`, `xType`, `zoomToSearch`, `config`...). If omitted, an internal state is used (`Taxonium()` wrapper, L370-L390).
- UI: `overlayContent`, `setOverlayContent`, `setAboutEnabled`, `onSetTitle`, `sidePanelHiddenByDefault`.
- Callbacks: **`onNodeSelect(nodeId|null)`**, **`onNodeDetailsLoaded(nodeId, nodeDetails)`** (`types/ui.ts`). Click handler: `Deck.tsx` L135-L209. Note README names the title prop `setTitle` but code uses `onSetTitle` (README error).
- No hover callback prop (hover details are internal: `useHoverDetails`). No `ref`/imperative handle (`export default React.memo(Taxonium)`).

## Criteria scorecard (goal.md 1-16)

| # | Criterion | Score | Evidence |
|---|---|---|---|
| 1 | Pure browser, static-file deployable | **Yes** | `sourceData` with `status:"url_supplied"` fetches a (gz) file client-side, parses in worker (`localBackendWorker.js`). `backendUrl` is optional. README script-tag example works with inline data. Needs CORS on the tree URL (axios GET). |
| 2 | Embeddable component (npm, React) | **Partial** | npm `taxonium-component`, React 19 only, default export. But it is the whole app UI (side panel, search, settings modals, JBrowse panel, Tailwind CSS injected). Hiding the panel: only `sidePanelHiddenByDefault` (user can reopen). UI chrome not removable by prop (UNVERIFIED for CSS-only hiding). |
| 3 | 100k+ tips responsive | **Likely yes (UNVERIFIED by measurement)** | Design targets millions (README). LOD by overplotting reduction. No benchmark in repo; must measure. |
| 4 | Formats Newick/Nexus/phyloXML | **Partial** | Newick yes, Nexus yes but crude (`nexusToNewick.ts`), phyloXML No, NeXML No. Extra: Nextstrain JSON, Taxonium jsonl. |
| 5 | Programmatic API (highlight, focus, metadata) | **Partial** | Metadata via CSV/TSV join (yes). Highlight/zoom only indirectly: set `query.srch` (JSON string of search specs, e.g. exact name match) and `query.zoomToSearch` index; `useSearch.tsx` L283-L330 then zooms to results. No documented method; undocumented query schema. No imperative focus-on-node API found. |
| 6 | Layouts rect/circular/unrooted | **No (rectangular only)** | grep; `useLayers.tsx` draws horizontal+vertical line layers only. x-axis can switch between distance and time (`xType`). |
| 7 | Licence compatible | **No / needs sign-off** | GPL-3.0. dist bundle contains GPL code. See Licence analysis. |
| 8 | Maintenance health | **Partial** | Very active repo (93 commits in 12 months; last commit yesterday) but npm lags (2026-02-04), single maintainer (~85% commits), 87 issues/48 PRs open. |
| 9 | Accessibility / theming / mobile | **Partial/No** | `index.css` sets `color-scheme: light dark` but tooltip colours hard-coded (`backgroundColor="#e5e7eb"`, `Taxonium.tsx`), Tailwind classes, white side panel (`bg-white`). Canvas only: no ARIA/keyboard tree semantics found (UNVERIFIED beyond grep). Layout responsive (`md:flex-row`). |
| 10 | Export SVG/PNG/Newick | **Partial** | PNG (`useSnapshot.ts`) and SVG (`utils/deckglToSvg.ts`, SnapshotButton) yes; subtree to Nextstrain JSON; Newick export not found (UNVERIFIED; search for "newick" download not done exhaustively). |
| 11 | Click/hover/select callbacks with node + metadata | **Partial** | Click: `onNodeSelect(nodeId)` + `onNodeDetailsLoaded(nodeId, details)` (details are fetched asynchronously from the worker and include metadata). Hover: **No** prop. The node object itself is not passed on click (id only). |
| 12 | React integration, controlled state, clean unmount | **Partial** | `query`/`updateQuery` give controlled search/colour/axis state. Selection and viewport not controlled. **Module-level singleton worker and global callbacks** (`useLocalBackend.ts` L17-L62: `const worker = new workerSpec(); let onQueryReceipt...`), so two instances on one page share state (inference from code; not run). Unmount cleanup of worker/deck: UNVERIFIED. Uses `window.alert` on load errors. |
| 13 | Custom node/tip rendering, aligned columns, React content | **No (limited)** | Fixed layers: scatter nodes, lines, text labels (`name_accessor`, clade labels). Colour by any metadata column, searchable fields shown in side panel. No aligned per-tip columns, no per-node custom graphics, no React-rendered tip content. Only `overlayContent` (React node overlaid on viewer) and a JBrowse genome track for mutation-annotated trees. Adding layers means editing `useLayers.tsx` (fork). |
| 14 | Semantic zoom / LOD with decorations collapsing | **Partial** | Node/branch thinning by overplotting (`filtering.js`), minimap, clade labels (`main-clade-node`), tip labels when zoomed. No columns to collapse. No clade aggregation/collapsing summaries (counts per clade) beyond that. |
| 15 | Scale stated as numbers | **Partial** | "millions of nodes", >6M tips unreliable. No load-time/FPS numbers in repo. eLife paper not read (UNVERIFIED). Must benchmark. |
| 16 | Styling hooks | **Partial** | Colour by metadata field via `colorBy`/`colorMapping`/`colorRamps` config; settings for font colours (`settings.terminalNodeLabelColor`, `cladeLabelColor`). No per-node style callback prop (colour accessor is internal `getNodeColorField`). No CSS-variable theming documented; Tailwind classes. |

## Maintenance evidence

- `git log -1`: 2026-10-07. `git log --since=2025-10-08 | wc -l` = 93.
- Tags: v2.1.24 (2026-01-20) is the newest; npm 2.1.24 published 2026-02-04, so about 8 months with no npm release despite ongoing commits (inference: unreleased fixes sit on `main`; build from source or pin a commit).
- npm history shows breaking jumps: 0.0.x (2023), 2.0.x (2025-03..), peer React 19 only now.
- Issue/PR backlog: 87 open issues, 48 open PRs on the GitHub page.
- The commit list includes `theosanderson-agent` (26 commits) and `pre-commit-ci[bot]` (54); AGENTS.md exists in repo (AI-assisted development; relevant for review standards, not necessarily bad).
- `npm view` registry says maintainers: only `theosanderson`.
- Bus factor: 1 (single maintainer).

## Licence analysis

- Repo and component: GPL-3.0 (root `LICENSE`). The component package.json has no licence field, which is itself a defect for consumers.
- Distribution: `vite build` bundles deck.gl, luma.gl, etc. into `dist/taxonium-component.*.js` (they are devDependencies, not externals; `vite.config.js` externalises only React). All of these are permissive (MIT; pako MIT+Zlib; jstree-derived parser MIT). The GPL applies to Taxonium's own code, and the bundle as a whole is a GPL-3.0 work.
- Consequence for gbif.org: shipping Taxonium to browsers in the gbif.org JS bundle is conveying a covered work. Under GPL-3.0 a combined work would have to be offered under GPL-3.0 terms (source of the combined work). Loading it as a separate, unmodified script/iframe from a distinct origin is a commonly-argued "aggregate" route, but that is a legal question for GBIF counsel, not something this research can settle. Note CLAUDE.md: "GPL/AGPL matter for embedding in gbif.org". Not AGPL: the GPL network clause does not apply, but distribution to browsers counts as conveying.
- Contributors: 17 authors; relicensing request to the maintainer would be needed for anything other than GPL (UNVERIFIED feasibility; Theo Sanderson owns ~85% of commits).
- Mixed licences inside the repo: ISC declared in `taxonium_backend` and `taxonium_data_handling`, which are inputs to the component build (`taxonium_data_handling` is `file:../taxonium_data_handling` devDependency). Whether those packages are separately usable under ISC is UNVERIFIED (their own LICENSE files not checked).

## Extension effort

| Gap | Effort | Notes |
|---|---|---|
| Hover callback, pass node object on click | Small patch | Edit `Deck.tsx` `onClickOrMouseMove`; GPL allows modifying, but the modified source must be published. |
| Imperative highlight/focus/viewport API (`ref`) | Small-medium patch | State already lives in `useView`/`useSearch`; need `forwardRef` + `useImperativeHandle`. |
| Hide side panel / expose only canvas | Medium | `Taxonium.tsx` layout is hard-coded; fork or refactor into a `<TaxoniumCanvas>` using `Deck.tsx`. |
| Multiple instances per page | Medium | Move worker from module scope into per-instance hook. |
| Aligned per-tip columns, badges, thumbnails | Large (fork) | Needs new deck.gl layers keyed to row y-positions and LOD for them. The data model (nodes sorted by y, precision-binned) fits, but must be written. |
| Circular / unrooted layouts | Large | Layout (`kn_calxy`, worker query/precision logic) assumes y-ordered rectangular. |
| phyloXML / NeXML, robust Nexus | Medium | Add parsers (outside the component, convert to Newick + metadata before passing in). |
| Theming/dark mode/GBIF tokens | Medium | Tailwind classes plus hard-coded colours. |

Realistic route: fork under GPL-3.0 and treat as an application GBIF hosts (iframe/separate bundle), or use only as design reference for a deck.gl-based custom renderer (note: reading its ideas is fine, copying its code brings in GPL).

## Risks

1. Licence (GPL-3.0) is a hard blocker unless GBIF legal signs off on the embedding model.
2. App-in-a-component: layout, CSS (Tailwind), modals, side panel come with it; React 19 only; 107 MB npm tarball (bundle size of `dist/*.js` itself UNVERIFIED, not downloaded).
3. Module-level singleton worker => multiple trees per page, hot-remount and tests unreliable.
4. Single maintainer, npm lag behind main.
5. `window.alert` on errors and large trees, `window.location.includes("epicov.org")` special case in `Taxonium.tsx`, console logging in `filtering.js`: not production-clean for an embedded widget.
6. Nexus parsing is regex-based (`nexusToNewick.ts`): only first tree, one translate pair per line with exactly one space, `parts.length === 2` (labels with spaces or quotes break), likely mis-parses `Translate` blocks written on one line or with tabs. Newick parser `kn_parse` quoting/NHX behaviour not tested (UNVERIFIED). README says "new and in flux" in `docs/component.md`.
7. Tip labels = join key: metadata join is by exact `node.name` string (`metadata.get(node.name)`), so unmatched tips are not reported to the host.

## Open questions for hands-on testing

- Real frame rate and load time for 1k/5k/20k/100k/1M tips Newick with a 3-column metadata TSV (tooltip, colour by column).
- Can the side panel and chrome be fully hidden with CSS only? What is the real size of `dist/taxonium-component.es.js` gzipped?
- Does `query.srch` with a `text_exact` search on `name` highlight a tip and does `zoomToSearch: 0` centre it on the occurrence page? Is the schema stable?
- Does mounting two `<Taxonium>` on one page break? Does unmount free the worker/WebGL context?
- Behaviour with Nexus files with quoted labels, multiple trees, one-line translate blocks.
- Does the component work under Next/SSR (it touches `window` at module/render time, e.g. `window.location`, `window.innerWidth` in `Taxonium.tsx` render)? UNVERIFIED, likely needs client-only import.
- Read the eLife paper for benchmark numbers (not fetched).
- Legal: is an iframe or separately-served bundle acceptable to GBIF counsel under GPL-3.0?
