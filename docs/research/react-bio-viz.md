# react-bio-viz: source-level assessment

Assessed 2026-10-08 from a read-only clone (`git clone` of https://github.com/holmrenser/react-bio-viz at commit `d75ad20`, "Release 0.3.0", 2026-10-08) and the npm tarball `react-bio-viz-0.3.0.tgz` (downloaded, unpacked and read; nothing installed or run). "Verified" below means I read it in that source. Anything not read is marked **UNVERIFIED**.

## Summary

react-bio-viz is a MIT-licensed React 18/19 component library for biological views (alignment, tree, distance matrix, gene model, genome browser, BLAST hits). Its `PhyloTree` / `SimplePhyloTree` is the best match found so far for the React-integration criteria (11, 12, partly 16): fully controlled `viewport` and `selection` props, `onNodeClick` and `onBranchClick` callbacks that receive a rich node payload, per-node and per-branch styles keyed by node id, a `leafTextComponent` render prop, and a documented way to share row order with an alignment viewer.

It is not a large-tree viewer. The tree is drawn as **SVG with one set of React elements per node, no culling and no level of detail** other than manual clade collapse. It has a Newick parser only, no Nexus/phyloXML/NeXML, no unrooted layout, no hover callback, and no aligned per-tip columns. The project is a single-maintainer repository whose 0.1.0 to 0.3.0 releases appeared on 2026-10-07/08 after a long quiet spell (see Maintenance). Verdict: a credible **small and medium tree (low thousands of tips) component and a design reference for the controlled-state API**, not a candidate for the 100k-tip requirement.

## Facts

| Fact | Value | Source | Verified |
|---|---|---|---|
| Package | `react-bio-viz` 0.3.0 (latest dist-tag) | https://registry.npmjs.org/react-bio-viz | yes |
| Licence | MIT (package.json and LICENSE, "Copyright (c) 2020 GeneNoteBook") | `packages/components/package.json` in the 0.3.0 tarball; repo `LICENSE` | yes |
| Peer deps | `react ^18.3.1 \|\| ^19.0.0`, `react-dom` same; no runtime `dependencies` (Zustand, Radix, Tailwind output are bundled) | npm registry JSON; tarball package.json | yes |
| Type-only dep | `betula-schema` (types inlined into the published declarations) | `packages/core/src/data/index.ts` header comment | yes |
| Rendering of PhyloTree | SVG; `<svg viewBox>` is the only thing that changes on pan/zoom | `packages/components/src/components/PhyloTree/SimplePhyloTree.tsx` (return block, "panning and zooming only change the `<svg>`'s viewBox") | yes |
| DOM per node | Per tip: 2 `<path>` (branch hit area and branch) in `TreeBranch.tsx`; `<g class="tipnode">` with `<title>`, `<line>`, `<g>`, `<text>` in `LeafNode.tsx`; one `<circle>` in `NodeMarker.tsx`. Per internal node: 2 paths, a `<text>` (support) and optionally a circle. So roughly 8 elements per tip plus about 4 per internal node | `components/TreeBranch.tsx`, `LeafNode.tsx`, `NodeMarker.tsx`, `InternalNode.tsx` | yes (counted from source, not measured) |
| Culling / LOD | None for the tree. `body` is memoised apart from the viewport, but all `nodes` are mapped to elements regardless of what is visible. AGENTS.md states "Everything costs O(what is on screen)" as a design rule, but the tree does not implement it (the alignment does, with canvas windows) | `SimplePhyloTree.tsx` `body = useMemo(... nodes.map ...)`; `AGENTS.md` section "Viewports and performance" | yes |
| Manual collapse | `selection.collapsed: string[]` draws a clade as a triangle with `collapsedLeafCount`; `collapseBySupport(tree, threshold)` helper | `types.ts`; `utils/collapse.ts`; docs `phylo-tree.mdx` | yes |
| Layouts | `"rectangular"` (phylogram), `"cladogram"`, `"radial"` (circular phylogram). No unrooted/equal-angle | `types.ts` `LayoutMode`; `layouts/` has rectangular.ts, cladogram.ts, radial.ts | yes |
| Formats | Newick via `parseNewick` / `toNewick` (quoted labels handled; no NHX, comments or `[&...]` annotations seen). No Nexus, phyloXML or NeXML anywhere in `packages/` (case-insensitive grep returned nothing). Input type is the betula `Tree` JSON `{ id?, name, length, children }` | `utils/newick.ts`; grep over `packages/` | yes |
| Parser robustness | `parseNode` is recursive; `buildHierarchy` and `descendants` are recursive (`descendants` uses `result.push(...descendants(child))`). Deep (caterpillar) trees risk stack overflow and the spread is O(n x depth). Not tested by me | `utils/newick.ts`, `utils/hierarchy.ts` | code read yes; failure not reproduced (UNVERIFIED) |
| Tests | Vitest. `index.test.tsx` (432 lines) uses trees of a few tips ("Three tips spread over 850px"); unit tests for layouts, reroot, reorder, collapse, newick, search. No benchmark or large-tree test found | `PhyloTree/index.test.tsx` and `*.test.ts` | yes |
| Published size | `dist/main.es.js` 409,724 bytes (113,043 gzip -9), `main.cjs` 294,759 (97,385 gzip), `style.css` 34,793, `utils.es.js` 14,279 (4,914 gzip). This is the whole library (alignment, matrix, genome browser, UI chrome), not the tree alone; per-component tree-shaking not tested; package has no `sideEffects` field and injects its stylesheet on import | tarball file sizes; `package.json` exports | yes (my gzip measurement) |
| Docs | Astro Starlight site https://holmrenser.github.io/react-bio-viz/ with live examples | README | site not opened by me; docs source read in `apps/docs/src/content/docs/` |

## Callbacks, state and hooks (exact names, verified in `types.ts`)

| Prop | Signature | Notes |
|---|---|---|
| `onNodeClick` | `(node: TreeNodeInfo, event: React.MouseEvent) => void` | Fires on click of a node marker (leaf or internal). Markers exist for leaves always; they are interactive only if `interactive`, `onNodeClick` or `dragEnabled` is set. When set, it replaces the default collapse toggle on internal nodes |
| `onBranchClick` | `(node: TreeNodeInfo, event: React.MouseEvent) => void` | Node below the branch; makes branches clickable |
| `TreeNodeInfo` | `{ id, name, isLeaf, isRoot, isCollapsed, length, support?, leafNames: string[], descendantIds: string[], rerootAbove, clientX, clientY }` | Our per-tip metadata is not in the payload; map `id` or `name` back to our own table |
| Hover | **No hover or mouse-enter callback.** Hover styling is CSS only (`hover:stroke-2`, `[&:hover+path]:stroke-...`) | grep for hover in `PhyloTree/` |
| `onLeafOrderChange` | `(leafNames: string[]) => void` | Fires with leaf names in display order whenever the arrangement changes |
| `viewport` / `onViewportChange` | `Viewport` = `{ x0, x1, y0, y1, xMin, xMax, yMin, yMax }` in pixels of the laid-out tree | `SimplePhyloTree` is fully controlled; `PhyloTree` also has `defaultViewport` and `viewportStore` |
| `selection` / `onSelectionChange` | `TreeSelection` = `{ rerootedAt?, rerootPosition?, collapsed: string[], order?: Record<string,string[]> }` | Not a "selected tips" set: it is root position, collapsed clades and sibling order. Highlighting is separate (below) |
| `activeNodeId` | `string \| null` | Draws one node highlighted (enlarged, accent stroke) |
| `nodeStyles` | `Record<id, { color?, bold? }>` | Colours the marker and label of the node |
| `branchStyles` | `Record<id, { color? }>` | Colours a branch |
| `searchQuery`, `searchUseRegex` | `string`, `boolean` | Bolds matching leaves and dims the rest |
| `leafTextComponent` | `(props: { node: HierarchyPointNode<Tree>; fontSize? }) => JSX.Element` | Render prop for the label slot (SVG content), the only custom-rendering hook. Radial layout truncates names before calling it |
| `colorFunction`, `leafMarkerColor` | `(node) => string`, `string` | Marker colour seed |
| `leafSpacing` | pixels per leaf | Lays the tree out that tall and scrolls (the response to large trees in the docs) |
| `svgRef` | `React.Ref<SVGSVGElement>` | For export; `serializeSvg` and `svgToPng` documented in `guides/export.mdx`; `toNewick` + `applyTreeSelection` export the tree as displayed |

Controlled-state contract (README "Controllable state"): each state has `value` / `defaultValue` / `onChange` / `store` variants, so React state, uncontrolled use and a shared external store (`createControllableStore`) all work. Clean unmount: window pointer listeners from a drag are removed in an effect cleanup (`useEffect(() => () => endGestureRef.current?.(), [])`). Verified in `SimplePhyloTree.tsx`.

Focus/centre a tip from outside: there is **no `focusNode(id)`**. `computeLayout` is a module function in `layouts/index.ts` and is not re-exported by `src/main.ts` (grep found only a comment), so to centre a tip you would compute its row yourself (with `leafSpacing` set, a leaf's y is its index in display order times the spacing plus the top margin; this inference is UNVERIFIED) and set a controlled `viewport`.

## Alignment sharing (verified)

`guides/linked-views.mdx` and `MultipleSequenceAlignment/types.ts`: the alignment has `rowOrder` / `defaultRowOrder` / `onRowOrderChange` / `rowOrderStore` (ids in display order). The tree reports `onLeafOrderChange(names)`; the docs bridge the two with a shared store and `orderForLeafNames(tree, selection, order)` so that dragging in either view reorders the other. "Leaf names and row ids must agree." This shares **order**, not pixel geometry: whether tree rows and alignment rows line up on the same horizontal bands is **UNVERIFIED** (they are separate components with their own row heights). The alignment is canvas-windowed ("thousands of sequences or columns render", `multiple-sequence-alignment.mdx`).

## Scorecard against docs/goal.md criteria 1 to 16

| # | Criterion | Rating | Evidence |
|---|---|---|---|
| 1 | Pure browser, static deployable | Pass | Client-only; no fetching of its own; no runtime dependencies |
| 2 | Embeddable component | Pass | npm, React 18/19 peers, ESM+CJS, `use client` marker, SSR-capable (0.3.0 changelog) |
| 3 | 100k+ tips responsive | **Fail (by design, UNVERIFIED by measurement)** | SVG with about 8 elements per tip and no culling; collapse is manual. Expect trouble in the low thousands of tips. Not benchmarked by me |
| 4 | Newick, Nexus, phyloXML | Partial | Newick only (own parser). Nexus/phyloXML/NeXML: none |
| 5 | Programmatic API: highlight, focus, metadata | Partial | Highlight: `nodeStyles`, `activeNodeId`, `searchQuery`. Focus: via controlled `viewport` only, no helper. Metadata: none built in (use closures in `leafTextComponent` and `colorFunction`) |
| 6 | Layouts | Partial | Rectangular, cladogram, radial. No unrooted |
| 7 | Licence | Pass | MIT |
| 8 | Maintenance | Weak to unknown | Single maintainer, bus factor 1, 0.x semver, burst release after a gap (see below) |
| 9 | A11y, theming, mobile | Partial | CSS custom properties (`--background`, `--font-sans`, `--rbv-accent` per README and source), `data-pan-ignore`, `touchAction: none`. Keyboard/screen-reader support UNVERIFIED; SVG gives text in DOM and `<title>` per tip |
| 10 | Export | Pass | SVG and PNG (`serializeSvg`, `svgToPng`), Newick (`toNewick`, `applyTreeSelection`) per `export.mdx` |
| 11 | Interaction callbacks | Mostly | Click on node/branch with a rich payload; **no hover**, no tip-specific "select" event |
| 12 | React integration | **Strong** | Native; controlled/uncontrolled/external-store; clean unmount; React-state driven |
| 13 | Custom node/tip rendering | Weak | `leafTextComponent` render prop for the label slot only; no aligned columns, no per-internal-node renderer, no tooltips on custom graphics |
| 14 | Semantic zoom | **Fail** | Pan/zoom changes `viewBox` only; everything stays drawn; collapse is user-driven |
| 15 | Scale as numbers | No data | No benchmarks in repo or docs |
| 16 | Styling hooks | Partial | Per-node colour/bold and per-branch colour via id-keyed props; global props for widths and sizes; CSS variables for theme. No per-node size/shape callback |

## Maintenance evidence (verified from `git log` and npm `time`)

- 717 commits. By author: Rens Holmer 378 + 44 ("Holmer, Rens"); bots: Renovate 250 + 33, dependabot 12. One human contributor.
- Commits per year (all authors): 2020: 281, 2021: 239, 2022: 54, 2023: 3, 2024: 103, **2025: 0**, 2026: 37. In 2026 the 37 commits fall on 2026-09-22 to 2026-10-08 (19 on 2026-09-24, 10 on 2026-10-07).
- npm: versions 0.0.1 to 0.0.5 in 2020; 0.0.6/0.0.7 2021-08-19; 0.0.8 2022-11-01; 0.0.9 to 0.0.17 in 2024-06/07; then nothing until **0.1.0 and 0.2.0 on 2026-10-07 and 0.3.0 on 2026-10-08**. 0.1.0 to 0.2.0 contains breaking renames (`header` to `identifier`, `ID` to `id`), published a day apart.
- 27 of the commits carry `Co-Authored-By: Claude Opus 5.5` (24) or `Claude Opus 5` (3) trailers; `AGENTS.md` instructs AI coding agents. Not a defect, but the recent surge is AI-assisted and very new, so it has had little time in the field.
- Repository is a pnpm monorepo with a Python/Jupyter wrapper published to PyPI under the same name, docs site, and CI release workflow. Stars, issues, dependents: not retrieved (UNVERIFIED).
- Institution: author address and npm maintainer `holmrenser` (rens.holmer@gmail.com); the data schemas (`betula`) are shared with `picea`, `acacia` (github.com/wur-bioinformatics, i.e. Wageningen University & Research bioinformatics) and others. Institutional backing is UNVERIFIED.

## Licence analysis

MIT, compatible with gbif.org. Copyright holder string is "GeneNoteBook". Type-only dependency `betula-schema` (its licence: UNVERIFIED, types only so it is not shipped at runtime). Third-party code bundled into `dist/main.es.js` (Zustand, Radix UI, Tailwind-generated CSS, shadcn/ui source copies per `AGENTS.md`) has its own licences, which I did not audit (UNVERIFIED); all are commonly MIT but a `licence-checker` pass on the built bundle is needed before a recommendation.

## Extension effort (for GBIF needs)

| Need | Work | Rough effort (judgement, UNVERIFIED) |
|---|---|---|
| Nexus / phyloXML | Parse outside the library to a betula `Tree` (needed anyway for Nexus translate tables) | days; shared with every other candidate |
| Hover callback | Add `onNodeHover` to `NodeMarker`/`LeafNode` (small patch; upstream PR or fork) | 1 to 2 days |
| Centre tip from React | Expose `computeLayout` or a `layoutOf(tree, selection)` helper and use it to build a `viewport` | 1 to 3 days |
| Large trees | Needs viewport culling and clade aggregation before layout: a different architecture (canvas or windowed SVG, pre-aggregated clades). `body` already ignores viewport, so culling would need a new layer | weeks; effectively the custom-renderer option, using this library only as an API template |
| Aligned per-tip columns | Not present for trees; `rowOrder` sharing plus own column component aligned by `leafSpacing` rows | 1 to 2 weeks for a prototype |
| Unrooted layout | Add `layouts/unrooted.ts` following the radial pattern | days |

## Risks

1. **Scale.** Fails criteria 3, 14 and 15 as shipped. Accept it only for datasets below a few thousand tips, or after adding collapse-by-default above a threshold.
2. **Bus factor and age.** One maintainer, a 2025 gap with zero commits, 0.x versions with breaking renames in consecutive days; the recent surge is AI-assisted. Pin the version and be ready to fork (MIT permits it).
3. **Recursive helpers** may overflow the stack on very deep trees (code read; not reproduced).
4. **Bundle weight.** About 113 kB gzip for the full library with a stylesheet injected on import (no `sideEffects` hint); the tree-only cost is unmeasured.
5. **Node identity.** Without an `id` in the data, ids are positional paths ("stable across renders, not across re-sorts", `types.ts`). For GBIF we must set `id` from the tip label/taxon key to keep highlights stable.

## Open questions

- Actual frame rate and memory at 1k, 5k, 20k tips (needs a spike; nothing found in repo).
- Does `serializeSvg` / the tree behave with Nexus-derived trees that have quoted labels and `[&...]` comments? (Parser handles quotes; comments are not mentioned.)
- Do tree rows and alignment rows line up pixel-for-pixel when `leafSpacing` equals the alignment `cellSize`?
- Dependents, stars, issue response times (not retrieved).
- Licences of the bundled third-party code.

## Sources

- Repo: https://github.com/holmrenser/react-bio-viz (cloned; HEAD `d75ad20`, 2026-10-08)
- npm: https://www.npmjs.com/package/react-bio-viz and https://registry.npmjs.org/react-bio-viz (version/time data)
- Files read: `packages/components/src/components/PhyloTree/{types.ts,SimplePhyloTree.tsx,index.tsx,components/*,utils/newick.ts,utils/hierarchy.ts,layouts/*}`, `packages/core/src/data/*`, `AGENTS.md`, `CHANGELOG.md`, `README.md`, `apps/docs/src/content/docs/{components/phylo-tree.mdx,guides/linked-views.mdx,guides/export.mdx,concepts/data-formats.mdx}`
- Docs site (not opened): https://holmrenser.github.io/react-bio-viz/
