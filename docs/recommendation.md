# Consolidated findings and recommendation

Status: research round of 2026-10-08, updated 2026-10-14 after the browser spike (see the update section below; the sections after it describe the pre-spike state). Supersedes the shallow notes in [comparison.md](comparison.md) where they disagree. Detailed evidence is in [research/](research/). Nothing here was run in a browser: **no frame rates, no load times were measured by anyone**. Where this document says "verified", it means read in source or in npm registry JSON; "agent claim" means reported by a research agent and not independently re-checked.

## Update after the browser spike (2026-10-14)

Everything below the line "Scorecard" was written before any library was run. All six candidates have now been built as demos inside one shared GBIF-styled shell and run through the same 15 scenarios (S1 to S15), one at a time on an idle machine in headless Chromium **without a GPU**. Full numbers: [results/summary.md](results/summary.md) and the per-candidate files in [results/](results/); the live comparison is the deployed hub (see [deploy-vercel.md](deploy-vercel.md)). The hub matrix now marks measured cells with evidence letter **M**.

### What the spike showed

1. **Every existing library hits a wall far below 100k tips.** Measured on balanced trees: react-bio-viz and phylotree.js are fine at 1k and unusable at 10k (6.4 s and 1.6 s first render, 157 to 191 ms CPU per step, 208 to 429 ms click); tbrowse takes 4.2 s at 10k and 154 s to mount 100k (cost grows with the square of the rows); Archaeopteryx.js is unusable from about 900 tips on the new metric (142 ms CPU per step) and 1.5 to 2.4 s per step at 10k. The causes are architectural (an SVG or DOM element per node, text layout on every zoom, O(rows squared) loops), not tuning.
2. **Phylocanvas.gl's scale is unresolved here.** Software GL times out on 19 of 20 trees, but its JavaScript cost looks fine (3.2 s constructor and 590 MB heap at 190k tips). It needs a real GPU to be judged.
3. **Only our own prototype passes everywhere.** The custom Canvas2D baseline (about 3,100 lines, built during the spike) passes S1 on 20 of 20 trees up to 190k tips with 0% slow frames and 8 to 17 ms CPU per step, and passes the overview, columns, links, clade-colouring and keyboard scenarios. Caveat: its author is also the author of the adapter, and it is a prototype; the author's estimate to production is 12 to 18 engineer-weeks. I re-ran its 10k tree myself and got the same result (14 ms CPU per step, no dropped frames), and phylotree.js's 10k result (211 ms CPU, 411 ms click).
4. **Interaction is a different story from scale.** react-bio-viz is the only library whose node click delivers the tip set itself; tbrowse has the best aligned-columns model; phylotree.js has the most hooks. Phylocanvas.gl and Archaeopteryx.js need adapter-derived events (their authors' workarounds are labelled `partial`). Archaeopteryx.js cannot host two instances (S13 fails).
5. **Robustness problems in every library:** deep (ladderised) trees overflow the call stack at 5k to 10k tips (tbrowse, react-bio-viz, phylotree.js, Archaeopteryx.js; custom handles them but still walks the whole tree per frame); react-bio-viz throws on the 91k to 190k real trees.

### Round 2 (2026-10-19): three more libraries, same scenarios

Taxonium (GPL-3.0, demo only), Reactree and Heat-tree were also built into the shell and run through the runner (runner fixes in [results/summary.md](results/summary.md), "Round 2"). They confirm the pattern rather than change it:

- **Taxonium** is the only library that loads a 1M-tip tree (23.5 s, 725 MB heap) and 100k in 6 s, so its large-tree claim holds for loading; its frame rate could not be judged without a GPU. It has no hover, columns, alignment or radial layout, allows one tree per page, is controlled only through React internals, and is GPL-3.0.
- **Reactree**: 1,000 tips already sluggish, 10k takes 47 s to mount, deep trees overflow the stack, quoted labels break the parser, and it silently read only 1,436 of 189,801 tips on one real tree.
- **Heat-tree**: first render is quadratic (1k 2 s, 5k 17 s, 10k over 270 s), no callbacks, no alignment rendering, BEAST Nexus and quoted labels fail.

Nothing in these results changes the recommendation below. Note the machine used for round 2 was slower than in round 1 (heavy main-thread libraries 1.5 to 2.5 times slower); ratios between libraries are stable, absolute numbers are not comparable across rounds.

### Revised recommendation

The earlier question was whether an existing library could be adopted or extended to avoid a rewrite. For small trees yes; for large trees no, because the limits are in how the libraries draw and traverse the tree, not in missing features.

- **If most published trees are small (up to about 1k tips):** adopt an existing library behind our component API. react-bio-viz (React-native, delivers tip sets, controlled state) or phylotree.js with our own wrapper (1 to 2 weeks per its author; more hooks, more bugs). Gate large trees (see the capability tiers above) and say so in the UI. Budget for fixing library problems ourselves.
- **If trees of 10k tips and above matter** (as the real GBIF data may well include): a library cannot get there. Build our own renderer; the `spikes/custom` prototype is a working start with an API that already meets every scenario we defined, and its core is separate from React. Plan for the production gaps its author lists (worker for parsing and the viewport cut, user collapse and search, clade labels, React-rendered cells, unrooted layout, export, URL state, accessibility testing, real-GPU numbers, a browser matrix).
- **Hybrid:** ship the small-tree path first with a library while building the custom core, behind one component API (`tree`, `layout`, `columns`, `clades`, `highlight`, callbacks), so the switch is invisible. This still depends on the same unknown: real tree sizes.

### Still open

- **Real tree sizes from publishers.** This decides between the options above and is still the highest-value question.
- **Real-GPU and real-laptop numbers.** Everything measured here is headless without a GPU. Open the deployed demos on a normal laptop and try the 10k and 100k trees; WebGL (Phylocanvas.gl) in particular could look very different.
- **Whether the library authors' maintainers would accept fixes** for the problems we found (stack overflow, quadratic loops): not asked.
- **User-applied tree operations** (reroot, midpoint root, ladderise, collapse by support, prune): built and measured on our own data model ([results/tree-ops.md](results/tree-ops.md), 2026-10-20). Under 75 ms up to 190k tips, under 1 s at 1M tips, no WebAssembly needed (a Worker is). Open: whether gbif.org offers them at all, and how an applied operation is shown and shared (view state in the URL, never a change to the archived tree). In-memory trees only, not the Parquet source.
- Legal sign-off for copyleft options is unchanged (Taxonium GPL-3.0, Archaeopteryx.js LGPL-3.0 packaging); neither is needed for the options above.

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

## Hands-on observations

- **tbrowse (user, 2026-10-08, playground demo at warelab.github.io/tbrowse):** feels slow with large trees. Tip count, and whether the slowness is on load, pan/zoom or collapse, not recorded yet. This agrees with the source reading (SVG tree, no scale numbers published) and means tbrowse is a candidate for its **API and zone model**, not for large-tree rendering. Re-test with recorded tip counts.
- **tbrowse (user):** no zoom-out to see the whole tree, which some users will miss; the tabular layout (tree, labels and data zones as aligned columns) is liked. Recorded as criterion 17 in [goal.md](goal.md). A design that keeps the row-aligned table at high zoom and switches to clade summaries at low zoom would give both.

## Added requirement: branch lengths (criterion 18)

Branch length is central, not a detail. Implications for the design, from the research so far (agent claims, not re-checked):

- **Layout:** x position is cumulative branch length (phylogram), with a cladogram mode as an alternative. react-bio-viz, Reactree, Archaeopteryx.js and Phylocanvas.gl list both modes; Taxonium can switch its x axis between distance and time; tbrowse's input has a per-node `distance` but I have not seen how it is drawn. Not checked for the others.
- **Data model:** store cumulative x (root-to-node distance) in the typed-array tree model; a branch-length-free tree must still render (cladogram fallback).
- **Level of detail and summaries:** a collapsed clade needs a defined width (for example max or mean depth of its tips), and the overview must not misrepresent lengths.
- **Aligned columns:** in non-ultrametric trees tips end at different x, so aligned columns need leader lines; ultrametric (dated) trees end at the same x and need a time axis.
- **Extreme lengths:** one very long branch can squash the rest of the tree; PhyloScape mentions an optimisation for this. We should offer a scale or transform option (for example a log or capped scale), clearly labelled.
- **Edge cases:** missing, zero and negative lengths, and tools that write lengths as support values; the data layer should flag these.
- **Test data:** the real-ladder and synthetic trees need to include branch lengths (ultrametric and non-ultrametric), and some without.

## Proposed next steps

The detailed plan for steps 2 and 3 is in [spike-plan.md](spike-plan.md); how results are scored is in [evaluation-framework.md](evaluation-framework.md).


1. Ask for sample trees from likely publishers and record their tip counts and formats.
2. Spike tbrowse and react-bio-viz against the same test trees and the three interaction checks; record bundle size and frame rate in a real browser.
3. Draft the tree model, `capabilities` tiers and component API (`tree`, `layout`, `columns`, `highlight`, `onNodeClick`, `onNodeHover`, `viewState`) so spikes and any later custom renderer share one contract.
4. Revisit this document with measurements, then decide on A, B, C, E or the hybrid.
