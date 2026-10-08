# Reactree (`reactreejs`)

Research date: 2026-10-08. Evidence is from a shallow clone of https://github.com/vaaloo/reactreejs at commit `a6981e6` (2026-04-27), the npm registry, and the project site. Nothing was executed. Code references are `https://github.com/vaaloo/reactreejs/blob/a6981e63efab887cb9cec8d2e6f6a43c5086c1ce/<path>`.

## Summary

1. Reactree is a finished-looking, single-author (Valentin Gorgodian per the LICENSE), 3-week-old React 18/19 component that bundles a full editing toolbar around an SVG tree and a canvas alignment panel. MIT, d3 v7 plus jsPDF.
2. Its public API is three props: `newick`, `fasta`, `defaultHeight`. There are no callbacks, no imperative handle, no custom node rendering and no controlled selection or viewport. Criteria 5, 11, 12 (beyond mounting), 13 and 16 (beyond CSS tokens for the toolbar) are not met.
3. The tree is one SVG, rebuilt from scratch (`svg.selectAll('*').remove()`) by a single 600-line effect on any of 17 state dependencies, with a fixed 26 px per leaf and roughly 6 to 8 SVG elements per leaf. By code reading it is a small-tree viewer: fine for tens to a few hundred tips, painful at 1k, impractical at 5k.
4. It could be extended by forking (the internals are one 2,140-line component plus helper files), but that amounts to rewriting the render effect around props and callbacks. It is not a basis for GBIF's needs.
5. Verdict: reject as a dependency; at most a UX reference for toolbar, collapse triangles and a tree-synchronised alignment panel.

## Facts table

| Fact | Value | Source | Verified? |
|------|-------|--------|-----------|
| Repo | https://github.com/vaaloo/reactreejs | `package.json` | yes |
| Site | https://reactree.vaaloo.fr ("Reactree.js was developed as the tree viewer powering Phylogeny.fr") | WebFetch of site | yes that the site says it. The Phylogeny.fr link is the project's own claim, **UNVERIFIED** independently |
| npm package | `reactreejs` 1.0.3 (npm latest). Repo `package.json` says 1.0.2, so 1.0.3 was published without a matching version bump in HEAD | registry; `package.json` | yes |
| npm history | 1.0.0 2026-04-17, 1.0.1 2026-04-24, 1.0.2 2026-04-27, 1.0.3 2026-04-27 (package created 2026-04-17) | https://registry.npmjs.org/reactreejs | yes |
| Licence | MIT, "Copyright (c) 2026 Valentin Gorgodian" | `LICENSE`, `package.json` | yes |
| Dependencies | `d3 ^7.9.0` (ISC), `jspdf ^4.2.1` (MIT); peer `react ^18 \|\| ^19`, `react-dom` | `package.json`; registry licences | yes |
| Unpacked size | 952,430 bytes (npm package, includes CSS and maps; not a bundle size) | registry `dist.unpackedSize` | yes. Real bundle size **UNVERIFIED** |
| Downloads | 42 last month | https://api.npmjs.org/downloads/point/last-month/reactreejs | yes |
| Last commit | 2026-04-27 ("font size, branch width sliders + toolbar ergonomics"); the clone is shallow, so earlier history not counted (earlier note said 11 commits) | `git log` | yes for date |
| Issues / PRs | 0 issues matched `repo:vaaloo/reactreejs` | GitHub search | yes |
| Stars / contributors | not retrieved (earlier note said 1 star) | | UNVERIFIED |
| Institutional backing | none stated on site; copyright is an individual | `LICENSE`, site | yes (absence) |
| Props | `ReactreeProps = { newick: string; defaultHeight?: number; fasta?: string }` | `src/Reactree.tsx:30`; README "TypeScript" | yes |
| Callbacks / ref / imperative handle | none: the component signature destructures only the three props and is not wrapped in `forwardRef`; grep for `props.`, `onNode`, `onSelect`, `callback` finds none | `src/Reactree.tsx:32` | yes |
| Rendering of the tree | One `<svg ref>`; the tree is drawn imperatively with d3 inside a single `useEffect` that begins `svg.selectAll('*').remove()` and rebuilds everything | `Reactree.tsx:667-1273` (effect), `:727` (clear), `:1706` (`<svg ref={svgRef} />`) | yes |
| Rendering of the alignment | Two `<canvas>` elements (sequence + label canvases) drawn from `drawAlnCanvas`; redrawn on each zoom event | `Reactree.tsx:130-136, 391-640, 735` | yes |
| Effect dependencies (full rebuild triggers) | `treeData, containerH, hScale, vScale, fontScale, strokeWidth, layout, treeType, colorOverrides, theme, labelMode, alignLabels, truncateNames, collapsedNodes, collapseLabels, searchQuery, searchMatchIdx, showAlignment` | `Reactree.tsx:1273` | yes |
| Per-leaf DOM (rectangular layout) | visible link `<path>`, transparent hit `<path>` (`addBranchHits`), node `<g>` with 4 `<circle>`s (ring, glow, inner, 13px hit circle), label `<text>`, optional dotted leader `<line>`, optional bootstrap/branch-length labels | `Reactree.tsx:745-760, 975-985, 1075-1085`; `utils/d3NodeHelpers.ts:10-36` | yes (code reading) |
| Leaf spacing | `leafSpacing = 26 * vScale` px; `innerHeight = max(leaves * leafSpacing, 60)`; layout `d3.cluster()`; initial view scaled to fit via `fs = min(w/treeW, h/treeH) * 0.92` | `Reactree.tsx:949-957` | yes |
| Zoom | d3.zoom, `scaleExtent([0.05, 14])`, uniform transform on a `<g>`; no semantic zoom | `Reactree.tsx:732-736` | yes |
| Input formats | Newick only. Hand-rolled parser: name = everything up to `: , ) (`; no quoted labels, no `[...]` comments, no NHX, no Nexus or phyloXML. The README says internal labels in [0,100] are treated as bootstrap values | `utils/parseNewick.ts` (59 lines); README "Newick format" | yes |
| Prop change | new `newick` prop dispatches `RESET`, discarding edits, colours, collapse state and view transform | `Reactree.tsx:223-238` | yes |
| Collapse | user clicks an internal node: it collapses into a named, coloured triangle ("N taxa" label) and opens an inline editor; collapsed state is internal React state | `d3NodeHelpers.ts` click handler; `Reactree.tsx:975-1060` | yes |
| Search | built-in (Ctrl/Cmd+F), highlights matches and pans to the match with a 280 ms transition | `Reactree.tsx:645-665` | yes. Not controllable from props |
| Export | SVG, PNG (2x canvas rasterisation), PDF (jsPDF), Newick | README; `Reactree.tsx:1300-1370` | yes (code present), not run |
| Theming | Stylesheet `reactreejs/style.css` defines tokens on `:root` (`--clr-primary-a0`, `--clr-surface-a0`, `--clr-text-primary`, `--font-family`, ...); dark mode only through `data-theme="dark"` on `<html>` watched by a MutationObserver; tree colours (`baseColor`, scale bar, etc.) are hard-coded hex in JS and chosen by `isDark` | README; `src/reactree.css`; `Reactree.tsx:707-712` | yes |
| Token naming | generic global names on `:root`, so collisions with gbif.org tokens are possible; no `prefers-color-scheme` handling | `src/reactree.css` | yes |
| Accessibility | `aria-` appears 0 times in `Reactree.tsx`; the tree SVG has no roles or labels; keyboard: only Ctrl/Cmd+F, Enter, Esc, Ctrl/Cmd+Z | grep | yes |
| SSR | README: "not compatible with SSR as-is" (needs client-only boundary) | README "Server-side rendering" | yes |
| Mobile | website has a `MobileUnsupported` component; README lists evergreen desktop browsers | `website/src/components/ui/MobileUnsupported.tsx`; README | yes for component presence; behaviour on phone **UNVERIFIED** |
| TypeScript | `types` exported (`ReactreeProps` only); component code is `@ts-nocheck` in `d3NodeHelpers.ts` | `package.json`, `src/index.ts`, `d3NodeHelpers.ts:1` | yes |
| Documented scale | none. Phylogeny.fr one-click caps at 200 sequences (page cited in `comparison.md`; not re-fetched) | | no number for Reactree itself |

## Handling 1k and 5k tips, by code reading

- 1,000 tips: tree height `1000 * 26 = 26,000` px before zoom; roughly 6 to 8 SVG elements per leaf plus per internal node gives about 10,000 to 15,000 elements. First paint and every dependency change rebuild all of it. Pan/zoom itself is a single `transform` attribute change on one `<g>` so it should stay interactive, but typing in the search box (which changes `searchQuery`, a dependency) rebuilds the entire SVG per keystroke. Labels are 11.5 px at the fit-to-view scale of about 0.02 to 0.05 and unreadable until zoomed in, and nothing is aggregated.
- 5,000 tips: 130,000 px tall and tens of thousands of elements, rebuilt on every slider, toggle, collapse and search change; the alignment canvas redraws on each zoom tick. I would expect visible stalls per interaction (**UNVERIFIED, not measured**).
- 100k: not viable; the layout is not virtualised, labels are always drawn, and the fit scale would sit below the minimum zoom extent of 0.05 (26 px * 100k = 2.6M px vs a 520 px viewport gives a fit scale near 0.0002, clamped to 0.05 by `scaleExtent`, so the full tree cannot even be fit). That follows from the code constants; I did not run it.

## Criteria scorecard

| # | Criterion | Score | Evidence |
|---|-----------|-------|----------|
| 1 | Pure browser, static deploy | Yes | client-only React component. |
| 2 | Embeddable component | Partial | npm ESM/CJS React 18/19 component with CSS import; but it ships its own toolbar and layout and cannot be driven. |
| 3 | 100k+ tips | No | SVG, 26 px per leaf, full rebuild, no culling. |
| 4 | Formats | No (Newick only) | quoted labels, comments, NHX, Nexus and phyloXML unsupported. |
| 5 | Programmatic API: highlight, focus, metadata | No | three props, no ref, no callbacks. Search is UI-only. |
| 6 | Layouts | Partial | rectangular and circular, phylogram/cladogram. No unrooted. |
| 7 | Licence | Yes | MIT; d3 ISC; jsPDF MIT. |
| 8 | Maintenance | No evidence | 4 versions in 10 days in April 2026, then nothing for 5 months (as of 2026-10-08); single author; 42 downloads/month. Too new to judge; trending quiet. |
| 9 | Accessibility, theming, mobile | Partial | CSS tokens plus dark mode attribute for chrome; no ARIA; tree colours hard-coded; mobile flagged unsupported. |
| 10 | Export | Yes | SVG, PNG, PDF, Newick. |
| 11 | Interaction callbacks | No | internal handlers only (collapse, node-info panel, reroot, colour). Nothing reaches the host. |
| 12 | React integration | Partial | real React component; the effects I read remove their listeners on cleanup (wheel, window `keydown`, MutationObserver disconnect), so unmount looks clean (not run); but not controllable; a window-level `keydown` handler intercepts Ctrl/Cmd+F for the whole page while mounted (`Reactree.tsx:280-300`), which would override the browser's find on gbif.org; `newick` change resets all state; no SSR. |
| 13 | Custom node/tip rendering | No | only the built-in FASTA canvas panel, matched to leaves by name. Not extensible via props. |
| 14 | Semantic zoom | No | collapse is manual and user-driven; no LOD. |
| 15 | Scale as numbers | No | none published; code analysis above. |
| 16 | Styling hooks | Partial | CSS custom properties for UI chrome; no per-node/branch style callbacks (colours only through the built-in colour tool, stored in internal state). |

## Maintenance evidence

- npm created 2026-04-17; last publish 2026-04-27 (registry `time`). Repo HEAD 2026-04-27. Nothing since, about 5 months before today.
- 0 issues found; 42 downloads in the last month.
- `website/` folder contains a Next.js site, `CLAUDE.md` and `AGENTS.md` files, which suggests AI-assisted development (inference, **UNVERIFIED** how much).
- Version drift: published 1.0.3 vs repo `package.json` 1.0.2.

## Licence analysis

MIT (repo LICENSE and `package.json`). Runtime deps d3 (ISC) and jsPDF (MIT; jsPDF is only needed for PDF export but is a hard dependency, which adds weight). No copyleft. Licence is not the problem.

## Extension effort

| Need | Effort |
|------|--------|
| Click/hover callbacks and `onTipClick(node)` | Small patch: add props and call them from `_addInteractionLayer` (`d3NodeHelpers.ts`), but note the click handler is overloaded with edit modes. |
| Highlight/focus from props | Small to medium patch: reuse the search highlight code path (`applySearchHighlight`, pan-to-match at `Reactree.tsx:645-665`) with a prop-driven list; each change triggers a full rebuild unless the effect is split. |
| Custom per-tip content, aligned columns | Medium to large: the alignment canvas is hard-wired to FASTA; would need a generic column renderer. |
| Hide the toolbar / editing modes | Medium: toolbar is intertwined in the same component. |
| Scale to 100k, semantic zoom | Rewrite. Layout, drawing and state live in one effect. |
| New formats | Replace `parseNewick` with our own parser outside the component, pass in a hierarchy; the component accepts only a Newick string, so we would also need to change it to accept a tree object. |

Overall: a fork would need the render effect split and the public API invented; it is cheaper to write our own renderer than to retrofit this.

## Risks

- Very young, single maintainer, no issue tracker activity, unknown commitment.
- Internal API is a monolith; upstream refactors will conflict with any fork.
- Global CSS variable names and `data-theme` reliance can clash with gbif.org.
- Full SVG rebuild per keystroke or toggle.
- `@ts-nocheck` and `any`-typed tree data limit type safety.
- A global `keydown` listener calls `preventDefault()` on Ctrl/Cmd+F for the whole page while the component is mounted (`Reactree.tsx:280-300`).

## Open questions for hands-on testing

1. Real frame times for 200, 1k, 5k tips: first render, search keystroke, collapse, pan/zoom.
2. Does the fit-to-view scale clamp (min 0.05) make 5k+ trees impossible to view whole?
3. Behaviour with quoted tip labels like `'Homo sapiens (Linnaeus, 1758)'` and with Nexus/NHX input (expected to break).
4. Does the claim that it powers Phylogeny.fr hold (check the live Phylogeny.fr viewer)? This only matters for confidence in robustness.
5. Mobile behaviour; keyboard operation.
