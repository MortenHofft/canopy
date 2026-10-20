# Static level-of-detail spike (radial cut without view dependence)

Branch `spike/static-lod`, base `claude/trusting-mccarthy-c5ensy` (3925182). Code: `spikes/custom/src/core/static-lod.ts` (new), wiring in
`core/types.ts`, `core/renderer.ts`, `react/TreeView.tsx`, `adapter.tsx` (Library option "Cut method": current (default) / static global
level / static per-tile level, plus "Static cut: zoom steps"). Checks: `spikes/custom/scripts/check-static-lod.mjs` (browser-free),
`spikes/custom/bench/static-lod.mjs`. Evidence marks: **M** measured here (Node 22 and headless Chromium without GPU, 4 CPUs, 2026-10-20),
**U** not measured / unverified. Rectangular layout is NOT implemented: with a static method selected it uses the current cut (the option
description says so). The default cut (`lod.ts`) is untouched.

## What was built

1. **Critical zoom.** The radial collapse rule is linear in the zoom k, so each node has `crit[i]` with "expanded iff crit[i] <= k / minPx"
   (`1/A`, `min(1/D, 4/A)`, `cc/A` for a polytomy of tips; A = tips * da * XMAX, D = XMAX - X). One O(n) pass into a `Float32Array`; a child's
   value is raised to its parent's where needed. Cut = nodes whose parent is expanded; collapsed = children of expanded nodes that are not.
2. **Detail level d.** q(d) = step^d / base; at the quantised zoom kq = step^zi the clade threshold is `base * step^(zi - d)` px (d = zi: no
   budget pressure). Zoom ladder: powers of two, 1.41, 1.19 (default), 1.15 selectable.
3. **Runs, no grouping layers.** Siblings of a node with >= 16 children that are tips/collapsed and smaller than the threshold form maximal
   runs counted left to right from the first child, so the partition does not depend on the view; >= 16 members = ONE entry with the existing
   `last/xmax` fields (draw.ts and hit.ts unchanged; clicks report the parent and the exact tip range). **Virtual grouping layers and skip
   pointers were NOT built** (staged as allowed): the pure-function run rule alone handled the polytomies tested (f), so grouping is unmeasured (U).
4. **Budget without view dependence**
   - **A, global level:** d depends on the zoom step only: the finest d whose densest viewport-sized window fits the budget. Chain
     `d(zi) = max(d(zi-1), finest feasible)`, computed lazily and memoised. "Fits" = anchors of the level's cut binned in cells <= window/8, largest
     block of cells that can hold a window (conservative bound; coarse pre-filter) **plus** real walks at the 6 densest blocks and at the deepest
     entries of the cut (they count entries anchored outside a window that reach into it) **plus** a shortcut for small windows (all nodes in the
     densest window + tree depth fit).
   - **B, per-tile level:** 256 px tiles at the ladder scale anchored at the root; a node belongs to the tile of its anchor; each tile's level is the
     finest whose cut has <= budget / (tiles a view can meet) entries anchored in it (bisection, cached per zoom step and tile, lazy). A node is
     expanded when its parent is and `crit <= q(own tile level)`.
5. **Emission rule (new, needed):** a tip or expanded node is emitted only if what it draws itself (branch segment, connector arc; exact
   segment/arc tests) reaches the padded window; the walk descends either way. Without it a deep spine fills the list with ancestors whose only link
   to the window is a sector that contains it. No pixel-cell dedupe and no interaction-LOD are used (static cuts ignore "Reduce detail while
   zooming"); neither turned out to be needed for the guarantees below.

## Results (otl-100k = OTL vertebrata 90,938 tips; ladder 1.19; `check-static-lod.mjs`, full run: OK, 0 FAIL) [M]

Comparison of the three methods (current = view-dependent cut run from scratch per view, no hint):

| | current | static global | static tiles |
|---|---|---|---|
| a. pan invariance: sampled tips covered by a different entry after an arbitrary pan (otl-100k, budget 500 / 2000) | 41.7% / 26.7% (a quick run with other samples: 36.5% / 52.4%) | **0%** | **0%** |
| otl-2m (budget 500 / 2000) | 36.1% / 40.2% | **0%** | **0%** |
| b. zoom monotonic (tips seen under a BIGGER entry in the next 3% frame), otl-100k budget 500 / 2000 | 0.1% / 0% (8,303 of 6.0M) | **0%** | 1.9% / 1.2% on ladder 1.19; **0%** on powers of two |
| caterpillar-10000, budget 500 / 2000 | 20.9% / 20.3% | 0% | 0% |
| c. entries changing per 2% zoom step, otl-100k budget 500 / 2000 | 5.8% / 4.9% | 5.9% / 5.4% | 7.4% / 6.7% |
| c. worst single step (ladder 1.19 / 2 / 1.07), otl-100k b2000 | about 48% | 64% / 90% / 37% | 68% / 94% / 67% |
| level changes per 100 2% steps | 8 (b500), 1 (b2000) | 11 | 12 |
| d. budget exceeded | never; but truncated lists on caterpillar (21/85, 8/85 views, tips lost) | never (85 views per budget and tree) | **1 of 85 views truncated (otl-100k, b500)** and 1 of 25 on otl-2m: not budget-safe |
| d. mean share of budget used, otl-100k b500 / b2000 | 93% / 57% | 38% / 32% | 39% / 24% |
| d. smallest clade drawn (mean px), otl-100k b500 / b2000 | 11.0 / 3.1 | 29.1 / 6.0 | per-tile 4.1..143 / 3.6..17.6 |
| otl-2m b500 / b2000: share used, smallest clade | 82% / 46%, 10.7 / 3.2 px | 27% / 26%, 30.3 / 5.5 px | 35% / 22%, 8-176 / 4-16 px |
| e. tips covered exactly once, every sampled visible tip covered | yes (except caterpillar) | yes | yes (when not truncated) |
| e. hit-test of summaries / runs (otl-100k, mixed polytomy) | existing checks | 218/218, 124/124 | 278/278, 91/91 |
| budget 20,000 | identical in practice (the cut is not budget-limited) | identical | identical |

Notes on the table:
- (a) static: exact by construction (state = f(static data, zoom step, level), the level depends on the zoom or on a tile, not on the view).
- (b) global: monotone by construction (chain with max) and also numerically: the previous level failed the test at the next, smaller window in
  **0 of 60 steps** (otl-100k, budgets 500 and 2000, ladder 1.19) (g). Tiles: strictly monotone only on a **power-of-two ladder**, where tiles of one
  step nest in those of the previous; on 1.41/1.19/1.15/1.07 ladders 0.5/1.2/2.0/4.6% of tip observations were merged into a bigger entry
  (otl-100k b2000). Closest achievable guarantee for tiles: powers of two (the adapter's "automatic" ladder uses 2 for tiles, 1.19 for global).
- (c) average churn is the same for all (about the natural 5%); the ladder only decides burstiness. Zoom step 2 gives bursts of up to 90% of the
  list every doubling; 1.19 about 47-64%; 1.07 about 37%. Level changes are not flicker: they are monotone detail additions at ladder crossings.
- (d) The price of view independence is utilisation: with budget pressure the global level is set by the densest window **anywhere** in the tree,
  so sparse views get 2-3x fewer entries than the current cut (otl-2m b2000 at 8x zoom: 357 vs 574 entries, threshold 5.8 vs 3.0 px). The estimator
  adds slack (up to about 2x at deep zoom; the sampled-window maximum was 141-1,800 against bounds of 1.0-4.3x). Per-tile is worse: the per-tile
  share is budget / tiles a view can meet (24 for 1100x640; fewer when the tree is small), so a dense tile is pruned hard while sparse tiles leave
  their share unused.
- **Seams (tiles):** neighbouring tiles differ by up to 6 levels (e.g. 3.3 px vs 52 px thresholds at 3x on otl-91k, or 3.1..99.7 px on otl-2m).
  Seen as abrupt detail steps along tile borders (fans next to resolved branches), no geometric cracks. Screenshots with the tile grid and
  per-tile thresholds: `seams/tiles-z3-grid.png` (tile column at the rim 26 px, interior 3 px), `tiles-z6-grid.png`, next to the plain ones, in
  `/tmp/claude-0/-home-user-gbif-phylo/755848e2-b52c-5a39-af58-27e7ed8b2655/scratchpad/seams/`. I judge the seams not acceptable at budget 2000
  (not at 20,000, where tiles are not budget-limited).

### f. Polytomies (star of 10,000 tips, mixed polytomy 22,800 tips, Polyphaga-like children) [M]
Zoomed on the polytomy where children are about a pixel apart: the star is one slice entry; the mixed polytomy gives runs plus its 100 large
children as their own entries (when the detail is not budget-limited), polytomy entries bounded (39-61 at budget 2000, as many as the current
cut or fewer), runs hit-test to the exact tip range (159/159 and 142/142). At budget 2000 the polytomy never raises the level (forced = 0). At
budget **500** the static cuts do raise it (global: 6.8 px, 60 clades forced at 4x), not because of the polytomy (39 entries) but because the two
dense 1,000-tip clades elsewhere set the global level; tiles collapse the 10 large children in view because 20 entries per tile cannot hold a
60-tip clade. In the real otl-2m tree the 8,550-child Polyphaga node is drawn as a run slice with the correct tooltip (42,378 tips in 7,637
clades and 912 single tips) by all three methods (screenshots below).
**Caterpillar-10000 (deep spine): not solved.** Static global collapses the spine almost completely (3 entries at budget 500, 903 at 2,000,
smallest clade 1,860-18,700 px) because windows deep in the spine see hundreds of concentric spine arcs; tiles likewise. The current cut fills the
budget but loses tips (truncated lists in 8-21 of 85 views) and flickers (20% merged-into-bigger). Neither is good; skip pointers / spine grouping
are the remaining work (U).

### Cost (otl-2m, 2,385,875 tips, 2,725,682 nodes) [M]
- Critical zoom pass: **125-150 ms, 10.9 MB** (4 B/node) at load. Grouping tables: not built. Tile tables: lazy.
- Global level tables are **lazy and costly**: first frame at 1x 230 ms; 4x 220 ms; 16x 490 ms; 64x 1.0 s; 256x 1.1 s; 1024x 1.9 s; 4096x 1.2 s (each
  covers the chain from the previous requested zoom; per ladder step roughly 50-400 ms at deep zoom). Total to reach 4096x: 65 cut enumerations,
  2.35 s, 551 verification windows; transient memory +11 MB; afterwards 0.3-3 ms per frame. On otl-100k the per-step hitch is 25-45 ms. This
  needs a worker or idle precompute before it can ship (U: not built).
- Tiles: first frames 9-145 ms (power-of-two ladder), 0.6-2 ms after; up to about 1 s on a 1.19 ladder at very deep zoom (U for the browser).
- Per-frame JS (cut + draw, headless Chromium, median of 5 alternating rounds, `bench/static-lod.mjs`, budget 2000): otl-2m fit / 8x / 64x:
  current 13.7 / 2.75 / 0.68 ms; static global 6.4 / 1.0 / 0.55 ms; static tiles 7.8 / 2.8 / 1.1 ms. otl-91k: current 4.9 / 1.1 / 0.21,
  global 2.9 / 0.66 / 0.18, tiles 1.2 / 0.9 / 0.24. Default path vs the base commit build alternating: 13.7 vs 15.7, 2.75 vs 3.3, 0.68 vs 0.97 ms
  (otl-2m), 4.9 vs 5.5, 1.1 vs 1.0, 0.21 vs 0.21 (otl-91k): within noise (< 10% or favouring the new build). Frame rates need a real browser (U).
- Regression of the default path: `check-radial-cut.mjs` OK, `check-radial-ui.mjs` OK, `npm run typecheck` and `npm run build` clean.

### Visual check (headless Chromium, real wheel zoom, 12 steps of about 16%, budget 2000, aimed at the rim of otl-2m / otl-91k)
Scratchpad `/tmp/claude-0/-home-user-gbif-phylo/755848e2-b52c-5a39-af58-27e7ed8b2655/scratchpad/shots-2m/{current,static-global,static-tiles}/step-00..12.png`
(otl-91k: `shots-91k/`), numbers per step in the console output of `zoomshots.mjs` (same folder). Settled frames, otl-2m:
- current: threshold 9.2 -> 18.4 -> 3.4 px; step 1 has 86 expanded nodes collapsed again (node -> summary) and 69% of the entries change; step 5 changes 97%
  (threshold drops back at once, 233 ms). Drawn 680-1,700.
- static global: 0 expanded nodes collapsed in 12 steps; changes per 16% step 0-75% (ladder crossings), drawn 2,000 -> 437 as detail is spent
  elsewhere; at the same view it is visibly coarser than current (threshold 10 px vs 3 px) but structurally identical.
- static tiles (ladder 2): 0 collapsed again, but 341-608 entries and thresholds 3-340 px between tiles: much coarser, seams visible.
Frame-to-frame flicker of the current cut while wheeling also includes reduced (interaction) frames, which static cuts do not have (U: not
measured as a per-frame series in the browser).

## What could not be met, and why
- **Strict zoom monotonicity for tiles** on any ladder but powers of two (tile grids do not nest). Powers of two cost bursts of up to 90%.
- **Budget guarantee.** Global: bound for anchored entries + verification at 12 windows; a rigorous bound over entries whose anchor is outside the
  window (sector semantics) was tried (footprint classes) and was far too loose (e.g. 56 entries instead of ~470 at 4x on otl-100k), so it is
  a verification, not a proof, for crossing entries. 0 of the 85 sampled views per budget and tree (4 trees) and 0 of 25 on otl-2m exceeded it [M]. Tiles can overflow (leak between tile
  levels): 1 of 85 and 1 of 25 views truncated at budget 500.
- **Utilisation** of the budget (see table): inherent to a view-independent level plus estimator slack; mitigation is a bigger budget for static
  cuts (the budget then means "densest window" rather than "this view").
- **Deep spines** (caterpillar) and grouping layers: not solved / not built.
- Rectangular: not implemented. Real-device frame rates, background precompute (worker), 1M-tip OTL tree, rect layout: U.

## Recommendation
**Adopt neither as it stands; if one is carried forward, carry A (global level) and treat B as dropped.** A delivers what was asked for the
guarantees (a)(b)(c): pan invariance exactly (current: 26-52% of covered tips change entry under a pan), strictly monotone zoom-in, same
average churn as the current cut, bounded polytomy entries, fast steady frames (2-4x cheaper cut at fit on 2.4M tips). Its costs: 2-3x lower
effective detail under budget pressure (set by the densest window of the tree), bursts of new detail at ladder steps, lazy tables that hitch
(50-400 ms per step at deep zoom on 2.4M tips) and a caterpillar that collapses. B has seams, 20-40% utilisation, budget leaks and is
monotone only on a power-of-two ladder: no advantage over A except cheap tables.
Remaining work before A could replace the current cut: (1) precompute the level chain off the main thread (worker/idle) or ship it as a static
table per tree; (2) a tighter estimator (exact max-overlap sweep, or sampled exact windows) to recover utilisation, and decide whether the
budget means "densest window"; (3) heavy-spine handling (skip pointers / chain collapse) and virtual grouping layers if runs prove insufficient;
(4) rectangular layout (two zooms kx, ky: crit becomes 2-D); (5) browser per-frame flicker series on a real GPU, and tests with real users
panning/zooming; (6) decide the ladder (1.19 bursts of about 50% vs 1.07 about 37% with 4x the tables).
