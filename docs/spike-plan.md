# Spike plan: test the candidates for real

Purpose: replace claims with measurements. The research ([research/](research/), [recommendation.md](recommendation.md)) found that no existing library clearly meets the requirements and that nothing was ever run in a browser. This plan is the brief for the next session. Dimensions and scoring are in [evaluation-framework.md](evaluation-framework.md); requirements in [goal.md](goal.md); test trees in [../data/README.md](../data/README.md).

## Questions the spikes must answer

1. At which tree size does each candidate stop being usable (parse, first render, pan and zoom, click latency), with and without custom columns?
2. Can each do the **linked-view scenario**: click a node (tip or internal) and get the tip set in a React callback; colour that clade from React state; clear it; two clades at once?
3. Can each do the **occurrence-page scenario**: highlight and centre one tip from outside, with its surrounding clade visible?
4. Can each render **custom per-tip content**: an occurrence-count bar and an alignment column, aligned to the tips, from our own data?
5. Can the tip label be a **real link**?
6. Is styling controllable (design tokens, dark mode, per-node colour)?
7. How much does each need to be adapted, and is that a wrapper, a fork or a rewrite?

## Candidates

| Candidate | Why | Known caveats (from research and from the user's hands-on test) |
|-----------|-----|-----------------------------------------------------------------|
| **tbrowse** (MIT, React 18) | Closest to the table-like layout and aligned zones | User found it slow on large trees and without whole-tree zoom-out; SVG tree |
| **react-bio-viz** (MIT, React 18/19) | Controlled state, `onNodeClick` on internal nodes with `leafNames` and `descendantIds`, `nodeStyles` and `branchStyles` | SVG, no culling, Newick only, no hover callback; very new releases, one maintainer |
| **phylotree.js** (MIT) with our own React wrapper | Click and hover events, `node-styler` and `edge-styler` hooks | SVG, smooth only to about 2-3k tips (estimate); heavy dependencies; no Nexus TRANSLATE |
| **Phylocanvas.gl** (MIT) with our own wrapper | WebGL, claims 100k+ | Tips only for selection, no callbacks (needs method patching), single canvas per page, deck.gl 8 pinned |
| **Archaeopteryx.js** (LGPL-3.0) | Built-in heat map, alignment, domain tracks | No node click callback, singleton, one maintainer, large API churn |
| **Custom baseline** (own typed-array model, Canvas2D) | Sets the performance ceiling and the API shape every other candidate is judged against; meets 11 to 20 by design | Effort (agent estimate: MVP about 9 weeks); the spike builds only the minimum |

Not spiked unless the above disappoint: Taxonium (GPL-3.0, singleton, only `onNodeSelect`), OneZoom (licence), Reactree and Heat-tree (no callbacks), figtreejs (pre-1.0).

## Harness

Create `spikes/` with one Vite + React + TypeScript app, `spikes/harness`, and one adapter per candidate behind a common interface so identical tests run on each:

```ts
interface TreeViewAdapter {
  mount(el: HTMLElement, opts: { newick: string; layout: 'rectangular' | 'radial'; branchLengths: boolean }): Promise<void>;
  setColouredClades(clades: { nodeId: string; colour: string }[]): void;   // criterion 20
  highlightTips(tipIds: string[]): void;
  focusTip(tipId: string): void;
  setTipColumns(cols: { id: string; values: Record<string, number | string> }[]): void; // criterion 13
  on(event: 'tipClick' | 'nodeClick' | 'tipHover' | 'nodeHover', cb: (e: { nodeId: string; isTip: boolean; tipIds: string[] }) => void): () => void;
  unmount(): void;
}
```

Where a candidate cannot implement a method, the adapter throws `Unsupported` with a reason; that is itself a result.

Pages: tree and size selector (from `data/`), scripted interaction runner, FPS meter (`requestAnimationFrame` deltas during a scripted pan and zoom), timing marks (parse, first paint, interaction latency from click to callback), memory (`performance.memory` in Chromium), and a results panel that writes JSON.

## Test data

Use the files in [../data/](../data/); do not generate new ones unless a gap appears.

| Purpose | Trees |
|---------|-------|
| Size ladder, balanced shape | `synthetic` yule 200, 1k, 10k, 100k (generate with `make large`); real `real-ladder` OTL 1k, 10k, 91k and GTDB 10k, 100k, 190k |
| Worst cases | `synthetic` caterpillar 1k and 10k (and 100k if possible), bushy 10k, balanced 10k |
| Branch lengths | `real-ladder` fish dated (fetched), GTDB non-ultrametric, `rich/` BEAST sets, edge-case negative and missing lengths |
| Custom columns | `synthetic` yule 1k and 10k with `meta/*.tsv` (occurrence count, country, trait; about 2% unmatched rows) |
| Alignment column | `rich/ens-protein-197` and `rich/ens-ncrna-102` (aligned FASTA plus members table), `synthetic` yule 200 and 1k with FASTA |
| Format parsing | `rich/` Nexus with TRANSLATE (fish Carangaria, corvoid), multi-tree (birdtree), phyloXML (Ensembl, PANTHER), `edge-cases/` |
| GBIF linking | `rich/` fish, bird, corvoid, butterfly, mammal (match samples in `gbif_match_sample.tsv`) |

## Scenarios (acceptance tests, run on each candidate)

| # | Scenario | Pass looks like | Criteria |
|---|----------|-----------------|----------|
| S1 | Load 1k, 10k, 100k tree and fit to screen | Rendered, interactive | 3, 15 |
| S2 | Click a tip | React callback with tip id and our metadata row | 11 |
| S3 | Click an internal node | Callback with node id and the full descendant tip set | 19 |
| S4 | Colour a clade red from React state; clear it; colour two clades differently | Colours update without a full redraw or layout change; clear restores | 20 |
| S5 | Occurrence page: highlight one tip from outside and centre it with sibling context | Tip visibly marked and in view; parent clade visible | 5 |
| S6 | Tip label as a link (open in a new tab, keyboard focusable) | A real anchor, or an overlay that behaves like one | 11 |
| S7 | Custom column: occurrence-count bar aligned to each tip | Aligned across rows from our TSV; survives zoom and pan | 13 |
| S8 | Alignment column (Ensembl FASTA) beside the tree | Rows line up with tips | 13 |
| S9 | Theming: GBIF design tokens, dark mode, per-node colour from a callback | Visible without forking | 16 |
| S10 | Zoom out to the whole 100k tree | Readable summary or at least responsive; no freeze | 14, 17 |
| S11 | Toggle phylogram and cladogram; scale bar; dated tree axis | Lengths correct; aligned tips handled | 18 |
| S12 | Radial layout | Works with S2 to S4 | 6 |
| S13 | Two instances on one page; mount and unmount five times | No leak, no singleton clash | B |
| S14 | Keyboard and screen-reader quick check | Focusable tips, a text fallback or ARIA | H |
| S15 | Linked view: click clade, red clade, tip labels sent to a stub map panel | End-to-end in under about 100 ms for a 1,000-tip clade | 19, 20 |

## Measures and thresholds

For each (candidate, tree, columns on or off): parse ms, first render ms, median and 5th-percentile FPS over a 10 s scripted pan and zoom, click-to-callback latency ms, JS heap MB, minified and gzipped bundle size. Call a result **unusable** when load exceeds 10 s, FPS drops below 20, or click latency exceeds 300 ms. Record Chromium version, machine, and whether a GPU was available.

**Caveat on automated runs.** The cloud sandbox has Chromium at `/opt/pw-browsers/chromium` (use Playwright with `executablePath`, do not run `playwright install`), but it is headless and probably without a GPU. WebGL then falls back to software rendering, so absolute FPS for WebGL candidates will be pessimistic. Use the sandbox for functional tests (S2 to S9, S13) and for relative comparisons. Get the final scale numbers from a real browser on a normal laptop (provide a build the user can open) and mark those results **M** with the machine noted.

## Order of work

1. **Harness skeleton** with the adapter interface, a data loader for `data/`, FPS and timing utilities, results JSON writer. Include a small quote-aware iterative Newick parser (needed for tip counts and to feed adapters; note recursive parsers overflow on caterpillar trees).
2. **Custom baseline**: typed-array tree model with preorder indices and subtree-end (descendant tips are a contiguous range), cumulative branch-length x, rectangular layout, Canvas2D drawing with a viewport cut, d3-zoom-free pan and zoom with independent axes, click hit-testing, clade colouring from React state, one aligned column. Aim for days, not weeks: its purpose is to set the ceiling and the API.
3. **Adapters** for react-bio-viz, phylotree.js (own wrapper), tbrowse. Run S1 to S15.
4. **Adapters** for Phylocanvas.gl (own wrapper, patch methods to get events) and Archaeopteryx.js.
5. **Fill** `docs/results/<candidate>.md` and `docs/results/matrix.md` using the template in the evaluation framework; update [recommendation.md](recommendation.md).

In parallel, outside the spikes: begin the data layer the recommendation says is needed whatever we choose (iterative Newick and Nexus parser with TRANSLATE and annotations, tip-to-GBIF matching, capability tiers); ask publishers for sample trees to learn real sizes; take the licence questions (Taxonium GPL-3.0, Archaeopteryx LGPL packaging, OneZoom) to GBIF's licensing owner.

## Rules and gotchas

- Install candidates with pinned exact versions and `--ignore-scripts`; commit the lockfile; check the licence of anything added. Do not run code from downloaded test data.
- Keep recursion out of parsers and tree walks. Keep committed data small; large files are fetched or generated (see `data/README.md`).
- Count tips with a quote-aware parser: real Open Tree files have quoted labels with commas and parentheses.
- Phylocanvas.gl's selection is tips-only and its internal node ids are synthetic and unstable; Taxonium and Archaeopteryx.js use singletons; Reactree captures Ctrl/Cmd+F globally (from the research reports).
- Follow GBIF design tokens for any UI (the `gbif-design-tokens` skill).
- Do not open a pull request unless asked; develop on a feature branch.

## Done when

- `docs/results/` has one file per spiked candidate and a matrix, with evidence levels and versions.
- S1 to S15 have a recorded pass, partial or fail for every candidate, with the failure threshold for scale.
- The linked-view scenario (S15) runs on at least the custom baseline and the best library candidate.
- [recommendation.md](recommendation.md) is updated with the decision (adopt, extend, or build) and the effort for the chosen path.
