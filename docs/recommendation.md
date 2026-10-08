# Consolidated findings and recommendation

Status: end of the first research round (2026-10-08). Supersedes the shallow notes in [comparison.md](comparison.md) where they disagree. Detailed evidence is in [research/](research/). Nothing here was run in a browser: **no frame rates, no load times were measured by anyone**. Where this document says "verified", it means read in source or in npm registry JSON; "agent claim" means reported by a research agent and not independently re-checked.

## What I re-checked myself (npm registry JSON)

| Claim | Result |
|-------|--------|
| `@phylocanvas/phylocanvas.gl` is MIT, 1.64.1, peer `deck.gl ^8.8.12`, repo on GitLab | Confirmed. Earlier notes (LGPL, "unverified") were wrong. |
| `phylojs` 1.12.0 is MIT, no runtime dependencies | `package.json` MIT confirmed. The agent says the repo's LICENSE file is GPL-3: not re-checked, **resolve before use**. |
| `tbrowse` 2.10.0 is MIT, React ^18 peer, 36 versions, 2.0 was a rewrite after a 2020-2026 gap | Confirmed. |
| `phylotree` 2.6.0: no `license` field, no `repository` field, dependencies include jquery, lodash, moment, winston, underscore, d3 7 | Confirmed. Heavy for a renderer; a licence-hygiene issue (the LICENSE file is MIT per the agent). |
| `react-bio-viz` 0.3.0 MIT, React 18/19 peers, releases 2026-10-07/08 after 2020-2024 history | Confirmed. |

## The answer to the main question

**No existing library meets all of: React-native callbacks and controlled state (11, 12), custom per-tip content and aligned columns (13), semantic zoom (14), and 100k-tip scale (15).** The research found that the market splits cleanly:

- **React-native, customisable, SVG-bound** (small and medium trees, low thousands of tips): tbrowse, react-bio-viz, figtreejs, phylotree.js (with a wrapper).
- **Scales, but not integrable the way we need**: Taxonium (GPL-3.0, whole app, only `onNodeSelect`), Phylocanvas.gl (MIT, WebGL, no callbacks, one canvas per page), OneZoom (2.2M tips proven, but a non-profit source-available licence, no npm package or React story).
- **Rich tracks, but an app**: Archaeopteryx.js (heat maps, alignments, domains; one viewer per page; no click callback; LGPL; one maintainer).

So the real choice is **how to combine a small/medium component with a large-tree path**, and how much of it to build.

## Scorecard (summary)

Y = yes, P = partial, N = no, ? = unknown/unmeasured. "Agent" means taken from the agent's report. Full 1-16 tables are in each research file.

| Candidate | Licence | Callbacks 11 | React 12 | Custom rows 13 | Semantic zoom 14 | Scale 15 | Styling 16 | Maintenance |
|-----------|---------|--------------|----------|----------------|------------------|----------|-----------|-------------|
| **tbrowse** | MIT | Y (hover, select) | Y (controlled `viewState`) | Y (`ZoneDefinition`, virtualised rows) | N | ? (SVG tree; MSA is canvas) | P | Active, single maintainer likely |
| **react-bio-viz** | MIT | P (click, no hover) | Y (controlled) | P (render prop for labels, alignment rows) | N | N (SVG, ~8 elements per tip, no culling) | P | One maintainer, burst of releases |
| **phylotree.js** | MIT (no field in package.json) | Y (click, hover, branch, selection) | N (wrapper needed) | P (raw d3 selections) | N | N (about 2-3k smooth, agent estimate) | Y (stylers) | Maintained; heavy dependencies |
| **Phylocanvas.gl** | MIT | N (monkey-patch plugins) | N (own ~100-line wrapper) | P (coloured blocks, custom deck.gl layers) | N | Y? (100K+ claimed) | P | Published 2026-07; "feature complete" |
| **Taxonium** | GPL-3.0 | P (`onNodeSelect` only) | P (React 19 only, singleton) | N | P | Y (millions) | P | Active, one main author |
| **Archaeopteryx.js** | LGPL-3.0 | N | P (imperative, singleton) | Y (built-in tracks) but not custom | P (thinning) | ? (50k at 60 fps, self-reported) | P (118 keys removed in 3.0) | One maintainer, 22 releases in 33 days |
| **OneZoom** | non-OSI | N | N | N | Y | Y (2.2M) | N | Active |
| **Custom** | Apache-2.0 | Y | Y | Y | Y (designed) | Y (designed; unmeasured) | Y | Ours |

## Options and effort

Engineer-weeks are from the custom-renderer and data-layer agent unless noted; treat them as ±40%.

| Option | Idea | Effort | Avoids rewrite? | Main risk |
|--------|------|--------|-----------------|-----------|
| **A. Adopt tbrowse** for the tab; extend | Use its zone model (tree plus aligned zones, URL-serialisable state). Add Newick/Nexus input, GBIF zones, a highlight/focus helper. | Small to start; unknown to extend | Yes for small/medium trees | SVG scale ceiling; single maintainer; no circular layout; large trees need a separate path |
| **B. Adopt react-bio-viz** | Controlled API, click callbacks, alignment viewer. | Small | Yes for small trees | Same ceiling; no hover callback; Newick only; burst of AI-assisted releases, one maintainer |
| **C. Phylocanvas.gl for large trees, own wrapper** | MIT WebGL renderer, about 100 lines of React wrapper, our own callbacks via patched methods. | Wrapper small; columns limited | Partly | No real callbacks; one canvas per page; pinned deck.gl 8; "feature complete, no support"; custom rows would need custom deck.gl layers |
| **D. Fork Archaeopteryx.js** | Tracks for free. Small fork for callbacks/focus; large changes for custom tracks and multi-instance. | Medium to large | No, it is a fork | LGPL packaging; one maintainer; its own UI and singleton |
| **E. Custom renderer** (own typed-array core, Canvas2D, React layer) | Meets 11-16 by design. | MVP about 9 (7-12) weeks; full about 31 | No (it is the rewrite) | Effort; unmeasured performance; LOD must handle caterpillar trees |
| **F. Staged hybrid** (recommended, below) | A or B for small/medium, E's core only if real trees demand it | Start small, decide with data | Mostly | Two code paths if both are needed |

**Needed in every option:** a GBIF data layer. No existing parser is both licence-clean and robust (phylotree.js ignores TRANSLATE and conflates names with support values; PhyloJS has a licence question and flawed quoted labels; Archaeopteryx's is LGPL; Heat-tree and Reactree have naive parsers). Estimate parsers 7-8 weeks, tip matching 2-3 weeks. The agent found GBIF has no documented batch name-match; the best route is faceting occurrence search by dataset.

## Recommendation

1. **Find out the real tree sizes first.** Everything above hinges on whether GBIF trees are typically 200 tips, 5,000 tips or 500,000 tips. If the large majority are under a few thousand tips, options A or B may be enough and the custom renderer is not needed at all. Ask for a sample of the trees publishers intend to attach. This is the cheapest and highest-value next step.
2. **Build the data layer regardless:** own typed-array tree model, iterative Newick/Nexus parser with TRANSLATE and annotation handling, tip-to-GBIF matching, and the `capabilities` tiers (S/M/L; rerooting and similar only on small trees, lazy-loaded).
3. **Spike tbrowse first (option A).** It is the closest to what you want: React-native, MIT, tree plus aligned zones, hover/select callbacks, a controlled state that round-trips through a URL. Test it against 1k, 5k and 20k tips with three custom zones, and a click-to-callback and highlight-from-state check. If it holds up for the sizes we actually have, **extending it is the way to avoid a rewrite**.
4. **Run react-bio-viz in the same spike** as a comparison point for the controlled-state API and for its alignment viewer.
5. **Decide on the large tier only after step 1.** If trees above roughly 10k tips matter, the choice is between Phylocanvas.gl behind our own wrapper (option C) and our own Canvas2D renderer (option E). The agent's prototype suggests parsing 1M tips takes about 1.5 s and layout about 0.3 s, so the real cost is drawing and download size. Option E's core could reuse tbrowse's zone model as the API shape.
6. **Take the legal questions to GBIF early:** Taxonium (GPL-3.0), Archaeopteryx.js (LGPL packaging in a minified bundle), OneZoom (non-OSI licence). None is needed for the staged plan above, so they only matter if we choose them.

## Things the research flags that change the design

- **Caterpillar (ladderised) trees defeat "clade pixel height" LOD:** a 200k-tip caterpillar still drew 398k nodes. Any renderer needs a second rule (for example capping drawn nodes per frame).
- **DuckDB-WASM is out for tiled storage** (about 35 MB of wasm). Plain chunked binary or a PMTiles-style archive is more realistic. Medium confidence (about 55%).
- **OneZoom's data encoding** (bracket string, about 2 bytes per node, 2.2M nodes in 4.47 MB) is worth borrowing as an idea.
- **Archaeopteryx.js 3.0** deleted its auto-collapse and many config keys and breaks consumers; the maintainer's pace makes it a moving target.
- **phylotree.js** drags in jquery, lodash, moment and winston: a poor bundle citizen.

## Still unverified (needs hands-on work)

- Any measured performance for any candidate, including tbrowse and react-bio-viz.
- Real GBIF tree sizes and how tips map to occurrences.
- Hosting: CORS and Range-request support for the supplementary files.
- tbrowse: contributor count, Newick input path, whether a canvas/LOD tree zone can be added without changing its zone API.
- PhyloJS repo LICENSE file (GPL-3 per the agent) versus its MIT `package.json`.
- PhyloScape's software licence, Microreact's repo and licence.
- Legal sign-off on any copyleft option.

## Proposed next steps

1. Ask for sample trees from likely publishers and record their tip counts and formats.
2. Spike tbrowse and react-bio-viz against the same test trees and the three interaction checks; record bundle size and frame rate in a real browser.
3. Draft the tree model, `capabilities` tiers and component API (`tree`, `layout`, `columns`, `highlight`, `onNodeClick`, `onNodeHover`, `viewState`) so spikes and any later custom renderer share one contract.
4. Revisit this document with measurements, then decide on A, B, C, E or the hybrid.
