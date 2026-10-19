# Spike results: summary of the candidates (final harness runs)

## Round 2 (2026-10-19): ten candidates, runner v0.3

Round 2 adds taxonium, reactree and heat-tree and re-runs every candidate (stub, custom, react-bio-viz, phylotree-js, tbrowse, phylocanvas-gl, archaeopteryx-js and the three new ones) one at a time on an otherwise idle 4-vCPU machine with production builds, same caps (40 min per candidate) and the same skip rule as round 1. Run ids are in `spikes/results/FINAL.json` (round 1 is kept in `FINAL.round1.json`); matrix, scale table, calibration and load per run are in `spikes/results/SUMMARY.md`. Evidence level **M**; headless Chromium 141 **without a GPU**, so nothing here is a laptop number.

### What changed in the runner (CONTRACT.md Clarifications 25 to 33)

| Fix | Why |
|---|---|
| S15 click-to-paint: the shell resets the paint mark at the commit and sets it to the first frame after it; the runner waits for it, rejects samples not ordered pointerdown <= event <= commit <= paint, and withholds the verdict (`partial`, "could not be measured") if fewer than 3 of 5 clicks are valid | taxonium showed -5008 ms: a stale mark from software-GL frames that take seconds |
| S5 and S15 run after S1 and use the 10k Yule tree if S1 mounted it within 10 s, otherwise the largest of 1k and 200 tips that S1 mounted; the tree and the reason are recorded; `--s5-tree` and `--s15-tree` choose explicitly | heat-tree, reactree and others cannot mount 10k |
| DOM size pierces open shadow roots (shell `getStats` and the runner's own `domStats`) | heat-tree keeps its SVG in a shadow root (3,261 elements at 200 tips, 160,061 at 10k, were counted as 5) |
| `--max-minutes` below 9: S1's budget is the rest of the cap minus a reserve of min(8 min, a quarter of the cap), at least 30 s | the old deadline was cap minus 8 minutes |
| `syn-yule-1000000` added to `trees.json` (group `huge`, `optional: true`); `check-catalogue`, the site build and the demo picker tolerate its absence; `full-run.mjs` runs S1 on it for candidates that mounted 100k within 10 s | no 1M entry before |
| S7 "tip without a cell" uses a tip with no value in the column that was tested | it used the TSV stats for a FASTA column (reactree) |
| S4, S9 and S15 pixel checks: check at the current view, zoom around the clade (about 60 px box) if the strokes are sub-pixel, and zoom to 14 px rows and check again if it still fails; the JSON records the zoom, the fit-view result and the failed first attempt | reactree hairlines, taxonium outlines hiding fills |
| Shell: "Choose a tree in the Tree panel" only while nothing is mounted by any route; an API mount sets the demo state to mounted, an unmount to idle | text was drawn over API-mounted trees |
| A page that mounts but cannot produce a screenshot within 30 s is `timeout`, not `fail` | phylocanvas-gl at 1M tips |
| taxonium (React 19) | no change needed: `vite.base.mjs` aliases React to the candidate's own copy, the shell uses only APIs present in 18 and 19; `npm run build` works, and the full run went through it |

`node runner/selftest.mjs` now also checks the paint ordering and the small `--max-minutes` case; it passes.

### Which earlier numbers changed, and why

Almost none because of the runner: the new S15 and S5 rules did not trigger for the first seven candidates (all mounted 10k), the shadow-DOM and column fixes do not apply to them, and the pixel retry only changes cases that failed. **The machine is the difference.** This round's VM is slower and its frame cadence worse: the Canvas2D calibration page (same script) gives best p5 20 to 30 in all thirteen runs against 59.5 in round 1, the stub at 200 tips needs 10 to 14 ms of CPU per step against 6 to 9 ms, and heavy main-thread candidates are 1.5 to 2.5 times slower (react-bio-viz 100k mount 160.5 s against 64.6 s, tbrowse 100k 317 s against 154 s, phylotree-js 100k 22.5 s against 14.5 s, stub 10k 250 ms CPU per step against 135 ms). The custom renderer is unchanged (load 152 ms at 100k, 17 ms per step). Consequences: stub and archaeopteryx-js S15 go from `pass` to `partial` (paint 170 ms: two frames at a 30 Hz cadence already cost 67 ms, the pass limit is 120 ms); phylotree-js 1k, otl-1k and corvoid S1 go from `pass` to `partial` (CPU 81 ms per step against 36); archaeopteryx-js corvoid and otl-10k go from `partial` to `timeout`; phylocanvas-gl's 190k tree is now `skipped` by the time cap. Ratios between candidates are stable; absolute numbers are not comparable across the two rounds. Three runs are marked `noisy` (load above 4 at the end): phylocanvas-gl (1M step), archaeopteryx-js and taxonium; the load is the candidate's own browser threads, no other process was running.

### Scenario matrix, ten candidates (S1 = trees that pass of those run)

| Candidate | S1 | S2 | S3 | S4 | S5 | S6 | S7 | S8 | S9 | S10 | S11 | S12 | S13 | S14 | S15 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| stub | 8/21 | pass | pass | pass | pass | pass | pass | pass | pass | TIMEOUT | pass | pass | pass | pass | partial |
| custom | 21/21 | pass | partial | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass |
| react-bio-viz | 9/20 | pass | pass | pass | pass | pass | pass | pass | pass | n/a | pass | pass | pass | partial | TIMEOUT |
| phylotree-js | 6/20 | pass | partial | pass | pass | pass | pass | pass | pass | TIMEOUT | pass | pass | pass | partial | TIMEOUT |
| tbrowse | 9/20 | pass | partial | pass | pass | pass | pass | pass | pass | n/a | pass | unsupported | pass | pass | TIMEOUT |
| phylocanvas-gl | 1/20 | pass | partial | pass | pass | pass | pass | pass | pass | TIMEOUT | pass | pass | pass | pass | partial |
| archaeopteryx-js | 5/16 | pass | partial | pass | pass | pass | partial | pass | pass | partial | pass | pass | FAIL | partial | partial |
| taxonium | 0/18 | pass | partial | pass | pass | pass | unsupported | unsupported | pass | TIMEOUT | pass | unsupported | FAIL | partial | TIMEOUT |
| reactree | 4/20 | pass | partial | partial | pass | pass | partial | partial | pass | n/a | pass | FAIL | pass | partial | TIMEOUT |
| heat-tree | 5/16 | pass | partial | pass | pass | pass | partial | unsupported | pass | n/a | pass | pass | pass | partial | pass |

S5 and S15 fell back to the 1k Yule tree for reactree and heat-tree (their 10k trees need 47 s and 330 s to mount); every other candidate used the 10k tree. S10 ran on the largest tree each candidate mounted (the 100k Yule tree for the stub, custom, phylocanvas-gl and phylotree-js; gtdb-10k for react-bio-viz, tbrowse, archaeopteryx-js and reactree; the 20k caterpillar for taxonium; the 10k bushy tree for heat-tree). Its first pick for reactree was the truncated 190k tree; the selection now skips trees whose S1 row failed and S10 was re-run for reactree (`20261019-161830`, still `n/a`).

### Scale headlines (Yule trees)

| Candidate | Tips | First render | Best p5 fps | Time in frames > 50 ms | CPU per step | Click | Heap | Status |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| stub | 1k | 111 ms | 15.0 | 7% | 32 ms | 5 ms | 5 MB | pass |
| stub | 10k | 766 ms | 5.0 | 25% | 250 ms | 43 ms | 16 MB | TIMEOUT |
| stub | 100k | 8056 ms | 0.6 | 24% | 1994 ms | 406 ms | 108 MB | TIMEOUT |
| stub | 1M | 0.0 s | | | | | | TIMEOUT: mount: S1 syn-yule-1000000 exceeded 600 s (mount never finished) |
| custom | 1k | 128 ms | 30.0 | 0% | 16 ms | 11 ms | 13 MB | pass |
| custom | 10k | 208 ms | 29.9 | 0% | 14 ms | 10 ms | 17 MB | pass |
| custom | 100k | 152 ms | 20.0 | 3% | 18 ms | 11 ms | 36 MB | pass |
| custom | 1M | 661 ms | 15.0 | 9% | 22 ms | 11 ms | 252 MB | pass |
| react-bio-viz | 1k | 1172 ms | 29.9 | 0% | 5 ms | 32 ms | 19 MB | pass |
| react-bio-viz | 10k | 8236 ms | 2.3 | 87% | 212 ms | 415 ms | 128 MB | TIMEOUT |
| react-bio-viz | 100k | 160.5 s | | | | | | TIMEOUT: load 160.8 s > 10 s; interaction measures skipped |
| phylotree-js | 1k | 317 ms | 20.0 | 4% | 81 ms | 57 ms | 9 MB | partial |
| phylotree-js | 10k | 2494 ms | 2.7 | 79% | 610 ms | 597 ms | 36 MB | TIMEOUT |
| phylotree-js | 100k | 22508 ms | 0.3 | 90% | 4125 ms | 6931 ms | 297 MB | TIMEOUT |
| tbrowse | 1k | 490 ms | 20.0 | 2% | 40 ms | 19 ms | 11 MB | pass |
| tbrowse | 10k | 6037 ms | 1.4 | 89% | 1 ms | 241 ms | 48 MB | TIMEOUT |
| tbrowse | 100k | 317.0 s | | | | | | TIMEOUT: load 317.3 s > 10 s; interaction measures skipped |
| phylocanvas-gl | 1k | 2272 ms | 3.3 | 94% | 36 ms | 9 ms | 18 MB | TIMEOUT |
| phylocanvas-gl | 10k | 1064 ms | 0.7 | 99% | 126 ms | 12 ms | 57 MB | TIMEOUT |
| phylocanvas-gl | 100k | 5252 ms | 0.1 | 100% | 0 ms | 32 ms | 303 MB | TIMEOUT |
| phylocanvas-gl | 1M | 57.0 s | | | | | | TIMEOUT: mount: page unresponsive after mount (page.screenshot: Timeout 30000ms |
| archaeopteryx-js | 1k | 277 ms | 6.0 | 41% | 204 ms | 23 ms | 10 MB | TIMEOUT |
| archaeopteryx-js | 10k | 1301 ms | 0.3 | 100% | 2277 ms | 32 ms | 23 MB | TIMEOUT |
| archaeopteryx-js | 100k | skipped | | | | | | skipped: unusable at 10k |
| taxonium | 1k | 2068 ms | 1.6 | 90% | 26 ms | 972 ms | 25 MB | TIMEOUT |
| taxonium | 10k | 2418 ms | 0.7 | 98% | 81 ms | 2066 ms | 40 MB | TIMEOUT |
| taxonium | 100k | 6053 ms | 0.6 | 98% | 0 ms | 3101 ms | 117 MB | TIMEOUT |
| taxonium | 1M | 23521 ms | 1.1 | 97% | 105 ms | 4617 ms | 725 MB | TIMEOUT |
| reactree | 1k | 1773 ms | 10.0 | 49% | 89 ms | 124 ms | 11 MB | partial |
| reactree | 10k | 46730 ms | 1.3 | 94% | 33 ms | 1670 ms | 65 MB | TIMEOUT |
| reactree | 100k | 0.0 s | | | | | | FAIL: mount: page.evaluate: RangeError: Maximum call stack size exceeded |
| heat-tree | 1k | 1166 ms | 20.0 | 10% | 76 ms | 11 ms | 10 MB | partial |
| heat-tree | 10k | 166.7 s | | | | | | TIMEOUT: load 329.9 s > 10 s; interaction measures skipped |
| heat-tree | 100k | skipped | | | | | | skipped: unusable at 10k |

Other scale facts: custom mounts the 1M-tip Yule tree in 661 ms (252 MB heap, 22 ms CPU per step, `pass`) and every one of its 21 trees including the 20k caterpillar and the 190k GTDB tree. Taxonium mounts 100k in 6.1 s (117 MB) and 1M in 23.5 s (725 MB) and is unusable on frames in software GL (98 and 97% of the time in frames over 50 ms; click latency 3.1 s and 4.6 s). Phylocanvas.gl mounts 1M in 57 s and then produces no frame for 30 s (`timeout`). The stub never finished mounting 1M within 600 s. The 10x skip rule skipped the trees above 20k for archaeopteryx-js (36x), heat-tree (35x) and taxonium (12x; taxonium's 100k and 1M were then run separately without the rule, run `20261019-160949`).

### The three new candidates against their authors' reports

| Candidate | Item | Author's report | This run |
|---|---|---|---|
| taxonium | S1 | `timeout` on every tree (software GL) | same: 18 of 18 timeout (including 100k and 1M), 3 skipped |
| taxonium | 1k and 10k first render | 2.1 s, 2.2 to 2.4 s | 2.07 s, 2.42 s (agree) |
| taxonium | 10k click | click-to-event 4.0 to 5.3 s | click latency 2.07 s (the runner measures to the shell's event; differs) |
| taxonium | 100k, 1M load; heap | 7.2 s and 117 MB; 19.9 s and 582 MB | 6.1 s and 117 MB; 23.5 s and 725 MB |
| taxonium | S4 | fail (fit view, outlines hide the fill) | pass: the check zooms in after the fit-view attempt |
| taxonium | S15 | "pass" with click-to-paint -5008 ms, commit 1,864 ms at 10k | timeout: commit 1,513 ms, paint 3,698 ms, both valid |
| taxonium | S10 | partial at 1k, timeout at 100k | timeout, on the 20k caterpillar (the largest tree mounted in the main run) |
| taxonium | S5, S6, S9, S11, S14, S13, S7/S8/S12 | pass, pass, pass, pass, partial, fail, unsupported | the same |
| reactree | S1 at 1k | partial: 86 to 102 ms CPU, 34 to 45% dropped, click 120 to 156 ms, load 1.5 to 2.0 s | partial: 89 ms, 49%, 124 ms, 1.77 s (agree) |
| reactree | S1 at 10k | timeout: load 48.6 s, 96% slow frames, 633 ms CPU per step | timeout: load 46.7 s, 94% slow frames, but 33 ms CPU per step (not reconciled: the probe's idle subtraction and the library's slow frames are mostly raster, not main-thread CPU) |
| reactree | S4, S9 | fail or partial (hairlines, toolbar shift), partial (branch token 0 pixels) | S4 partial (only the 2 px toolbar shift is left), S9 pass after the zoom |
| reactree | S7, S8 | partial (runner artefact), partial | S7 partial (capped by the column-kind rule, all checks pass), S8 partial (5% of the cell repaints: the visible residues are gaps) |
| reactree | S10 | pass | n/a: a plain wheel does not change the scale in this runner's probe |
| reactree | S15 | fail at 10k: commit 2.1 s, paint 7.1 s | timeout on the 1k fallback tree: commit 213 ms, paint 705 ms |
| reactree | S12, S13, S14 | fail, pass, partial | the same |
| reactree | 190k GTDB tree | not run | **fail: the library reports 1,436 of 189,801 tips**, no error (it drops tips silently; the authors saw the same parser fail 2 of 5 tips on quoted labels) |
| heat-tree | S1 | 200 pass; 1k sluggish (53 to 56 ms CPU, load 1.9 to 2.6 s); 10k load 273 s | 200 pass; 1k partial (76 ms CPU, load 1.2 s); 10k load 330 s (167 s of it first render; 160k shadow-DOM nodes afterwards) |
| heat-tree | S5, S15 | pass at 1k, timeout at 10k; S15 at 1k 29 ms commit, 110 ms paint (ad hoc) | pass on the 1k fallback tree; S15 26 ms and 108 ms (agree) |
| heat-tree | S7, S8, S9, S10, S11, S12, S13, S14 | partial (text column), unsupported, pass, n/a, pass, pass, pass, partial | the same |
| heat-tree | DOM nodes | 5 (light DOM) | 3,261 at 200 tips, 16,061 at 1k, 160,061 at 10k (shadow DOM included) |

### Anything a candidate author got wrong

- **reactree**: the library reports 1,436 tips for the 189,801-tip GTDB tree and does not say so. The runner's tip-count check catches it (S1 row `fail`); it is not in its report, which stopped at 10k.
- **taxonium**: the adapter's tip events arrive after a worker round trip; at 10k that is 1.5 s to the React commit and 3.7 s to the paint, so the author's "S15 pass" was an artefact of the negative paint figure. The singleton (S13 fail) is real.
- **reactree and heat-tree** reports describe S5 and S15 as passing at 10k only by ad hoc runs; the runner now falls back to 1k automatically and records it.
- No adapter code was changed in this round.

## Round 1 (six candidates, kept for reference)

Evidence level **M** for every number: measured by `spikes/runner/run.mjs` (runner v0.2) in headless Chromium 141 **without a GPU** (SwiftShader), 4 vCPU, production builds, **one candidate at a time on an otherwise idle machine** (load average 0.9 to 1.1 at the start of each run), 2026-10-14. Run ids are in `spikes/results/FINAL.json`; the full matrix and scale table are in `spikes/results/SUMMARY.md`; the per-candidate write-ups (authors' own runs, made while five agents shared the machine at load 3 to 19) are the other files in this folder. None of this is a laptop number: WebGL and Canvas FPS are pessimistic, and SVG raster runs on the CPU (`--disable-gpu-rasterization`).

### How the numbers were judged (round 1) (what changed in the runner)

The authors found that the runner's p5 FPS rule measured sandbox load: a 5-tip tree read 15 fps and the naive stub at 200 tips 2 to 7 fps under load. Runner v0.2 therefore judges, per tree and best of 3 rounds of 3.5 s scripted wheel and drag: the share of time spent in frames over 50 ms (unusable above 50%), main-thread CPU per interaction step from CDP `ThreadTime` (unusable above 100 ms), load time (above 10 s) and click latency (above 300 ms). p5 FPS is reported, not judged. Every run also records `os.loadavg()` and two calibration references measured at its start (a plain Canvas2D animation and the stub at 200 tips; the Canvas2D page gives median 60 to 150 fps and best p5 59.5 in all seven runs, so the machine was quiet). Details: CONTRACT.md Clarifications 15 to 24.

### Scenario matrix (S1 to S15)

| Candidate | S1 | S2 | S3 | S4 | S5 | S6 | S7 | S8 | S9 | S10 | S11 | S12 | S13 | S14 | S15 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| custom | 20/20 trees pass | pass | partial | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass |
| react-bio-viz | 9/20 trees pass | pass | pass | pass | pass | pass | pass | pass | pass | n/a | pass | pass | pass | partial | TIMEOUT |
| phylotree-js | 9/20 trees pass | pass | partial | pass | pass | pass | pass | pass | pass | TIMEOUT | pass | pass | pass | partial | TIMEOUT |
| tbrowse | 9/20 trees pass | pass | partial | pass | pass | pass | pass | pass | pass | n/a | pass | unsupported | pass | pass | TIMEOUT |
| phylocanvas-gl | 1/20 trees pass | pass | partial | pass | pass | pass | pass | pass | pass | TIMEOUT | pass | pass | pass | pass | partial |
| archaeopteryx-js | 6/16 trees pass | pass | partial | pass | pass | pass | partial | pass | pass | partial | pass | pass | FAIL | partial | pass |
| stub | 9/20 trees pass | pass | pass | pass | pass | pass | pass | pass | pass | TIMEOUT | pass | pass | pass | pass | pass |

S1 shows how many of the trees that were run pass the thresholds (the other statuses per tree are in the scale table). S3 is `partial` for every candidate that computes the tip set itself instead of receiving it from the library (`adapter-derived`); only react-bio-viz delivers it.

### Scale headlines (Yule trees, rectangular, 3 scripted rounds)

| Candidate | Tips | First render | Median fps | Best p5 fps | Time in frames > 50 ms | CPU per step | Click | Heap | Status |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| custom | 1k | 117 ms | 59.9 | 59.5 | 0% | 10 ms | 8 ms | 13 MB | pass |
| custom | 10k | 141 ms | 59.9 | 59.5 | 0% | 16 ms | 6 ms | 17 MB | pass |
| custom | 100k | 144 ms | 59.9 | 59.9 | 0% | 14 ms | 10 ms | 36 MB | pass |
| react-bio-viz | 1k | 740 ms | 59.9 | 59.9 | 0% | 3 ms | 16 ms | 19 MB | pass |
| react-bio-viz | 10k | 6441 ms | 59.9 | 4.3 | 77% | 157 ms | 208 ms | 128 MB | TIMEOUT |
| react-bio-viz | 100k | 64.6 s | | | | | | | TIMEOUT: load 64.8 s > 10 s; interaction measures skipped |
| phylotree-js | 1k | 209 ms | 59.9 | 30.0 | 0% | 36 ms | 44 ms | 9 MB | pass |
| phylotree-js | 10k | 1602 ms | 59.9 | 3.5 | 67% | 190 ms | 429 ms | 38 MB | TIMEOUT |
| phylotree-js | 100k | 14483 ms | 59.9 | 0.6 | 85% | 2161 ms | 3791 ms | 284 MB | TIMEOUT |
| tbrowse | 1k | 420 ms | 59.9 | 59.5 | 0% | 26 ms | 13 ms | 10 MB | pass |
| tbrowse | 10k | 4180 ms | 59.9 | 2.2 | 92% | 553 ms | 194 ms | 47 MB | TIMEOUT |
| tbrowse | 100k | 153.8 s | | | | | | | TIMEOUT: load 154.1 s > 10 s; interaction measures skipped |
| phylocanvas-gl | 1k | 1373 ms | 7.5 | 3.7 | 91% | 28 ms | 6 ms | 18 MB | TIMEOUT |
| phylocanvas-gl | 10k | 2342 ms | 7.5 | 1.1 | 98% | 128 ms | 33 ms | 57 MB | TIMEOUT |
| phylocanvas-gl | 100k | 3169 ms | 0.0 | 0.1 | 100% | 0 ms | 16 ms | 303 MB | TIMEOUT |
| archaeopteryx-js | 1k | 260 ms | 30.0 | 8.6 | 40% | 144 ms | 15 ms | 10 MB | TIMEOUT |
| archaeopteryx-js | 10k | 853 ms | 4.0 | 0.6 | 99% | 1528 ms | 19 ms | 23 MB | TIMEOUT |
| archaeopteryx-js | 100k | skipped | | | | | | | skipped: unusable at 10k |
| stub | 1k | 80 ms | 59.9 | 20.0 | 0% | 22 ms | 4 ms | 5 MB | pass |
| stub | 10k | 579 ms | 59.9 | 3.3 | 65% | 135 ms | 25 ms | 16 MB | TIMEOUT |
| stub | 100k | 5623 ms | 59.9 | 0.9 | 22% | 1499 ms | 294 ms | 108 MB | TIMEOUT |

Other facts from the scale runs: caterpillars (depth 1,000 to 20,000): custom, tbrowse, phylotree-js, react-bio-viz and Archaeopteryx handle the 1k caterpillar; at 10k and 20k tips every library fails with `RangeError: Maximum call stack size exceeded` at mount (react-bio-viz, phylotree-js, tbrowse, Archaeopteryx), only custom (20/20 trees including the 20k caterpillar and the 190k GTDB tree) and Phylocanvas.gl (slow but drawn) mount them. Mount time at 91k to 190k tips: custom 0.12 to 0.19 s; Phylocanvas.gl 3 to 9 s (software GL); phylotree-js 10 to 26 s; tbrowse 89 s (91k), 154 s (100k), the 190k tree did not finish in 600 s; react-bio-viz 65 s at 100k Yule and a stack overflow on otl-91k, gtdb-100k and gtdb-190k (see bugs). Bundle (minified, gzip, includes React and the shell): custom 91 KB, stub 74 KB, react-bio-viz 136 KB, tbrowse 117 KB, phylotree-js 181 KB, phylocanvas-gl 298 KB, archaeopteryx-js 329 KB.

### Where these numbers disagree with the authors' own reports

Both numbers given. The common cause is the earlier rule (raw p5 FPS under a machine that five agents shared) versus the new rule on an idle machine.

| Candidate | Item | Author's report | This re-run |
|---|---|---|---|
| custom | S1 on all trees | `timeout` in every run, p5 2.5 to 15 fps | pass on 20 of 20 trees up to 190k tips, best p5 59.5 to 59.9, 0% of the time in frames over 50 ms, CPU 8 to 17 ms per step |
| custom | load, click | load 114 to 444 ms, click 3 to 10 ms | load 87 to 189 ms, click 5 to 13 ms (heap 12 to 62 MB agrees) |
| custom | S10 and S15 | pass or partial depending on load; paint 33 to 160 ms | pass on the 100k tree; commit 9 ms, paint 34 ms |
| react-bio-viz | S1 at 1k | timeout (p5 6 to 15) | pass: 3 ms CPU per step, 0% slow frames. The 1k timeouts were load |
| react-bio-viz | 10k first render, S15 | 8 to 10 s; click to paint 1.4 s | 4.9 to 6.4 s; click to paint 1.34 s (agrees) |
| react-bio-viz | 100k mount | 76 s | 64.6 s |
| react-bio-viz | S10, S12, S14 | pass (trivial), partial, pass (generous) | n/a (the plain wheel pans, nothing zooms), pass (colour check now relative to the drawn branch width), partial (no Tab target at tip level) |
| phylotree-js | S1 at 1k, 10k | 1k borderline (p5 12 to 59), 10k timeout (p5 2.5 to 4.6) | 1k pass (36 ms CPU per step); 10k timeout (p5 3.5, 190 ms CPU per step, click 429 ms): agrees at 10k |
| phylotree-js | S7 | partial (no cell on screen after zoom) | pass (the new check zooms around a visible tip to 14 px rows) |
| phylotree-js | S15 at 10k | 686 ms to commit, 851 ms to paint | 650 ms and 813 ms (agrees) |
| tbrowse | S4, S7, S11 | partial, pass at 16 px rows but fail at the 24 px default, partial | pass, pass, pass (probes that are off screen are ignored; at least 5 cells; focus to several places) |
| tbrowse | S10 | fail (no zoom-out) | n/a (the wheel does not zoom). The finding stands: there is no overview |
| tbrowse | S15 | fail (node not locatable at the fit view); by hand at 1k 30 to 78 ms | timeout at 10k: 366 ms to commit, 375 ms to paint (after `focusTip` on a tip of the clade) |
| tbrowse | S1 at 100k | mount over 240 s, timeout | 100k Yule mounted in 154 s and the 91k tree in 89 s; the 190k tree did not finish in 600 s; 10k first render 4.2 s, p5 2.2 (authors 0.6 to 1.0) |
| phylocanvas-gl | S1 | timeout from 135 tips, p5 0.1 to 7.5 | the same verdict for 19 of 20 trees, now on frame share (75 to 100% of the time in frames over 50 ms); load 1.4 s (1k), 2.3 s (10k), 3.2 s (100k Yule), 9.3 s (91k OTL), 5.6 s (190k); heap 303 MB (100k) and 569 MB (190k) agree to the MB |
| phylocanvas-gl | S14, S15 | pass (counted the canvas three times), partial 131 ms | pass (distinct elements, tip-level `treeitem` rows reachable), partial 164 ms |
| archaeopteryx-js | S1 | timeout on everything but otl-1k (p5 5 to 12) | pass to 380 tips and for the 1k caterpillar, sluggish at 680, unusable at 888 and 1,000 Yule tips (142 to 144 ms CPU per wheel step), 10k 1.5 to 2.4 s per step, larger trees skipped |
| archaeopteryx-js | zoom cost | 129 ms per zoom step at 5k tips, 768 ms at 25k | 1.5 to 2.4 s CPU per wheel notch at 10k. Not reconciled: my step is one wheel notch (deltaY 120), which the library may turn into several zoom steps |
| archaeopteryx-js | S13 | partial (skipped by the runner, clash verified by hand) | FAIL: the runner now observes the clash (instance 0 goes blank when instance 1 mounts) |
| archaeopteryx-js | S15 | partial, median 201 ms (58 to 336) | pass: 24 ms to commit, 34 ms to paint on the idle machine (the authors' spread was load) |
| archaeopteryx-js | S12 | partial (0.17% against 0.2%) | pass (relative colour metric) |

### Findings from the re-run that are not in the authors' reports

- **react-bio-viz library bug.** The mount fails with `RangeError: Maximum call stack size exceeded` on otl-91k, gtdb-100k and gtdb-190k although their depth is only 76 to 103 (the 100k Yule tree mounts). The stack shows a recursive helper that does `nodes.push(...descendants(child))`: spreading a subtree of more than about 120k nodes into function arguments exceeds V8's argument limit. So the limit is the size of the largest child subtree, not depth. The authors stopped at the 100k Yule tree and did not see it.
- **Archaeopteryx S13**: a second launch empties the first (the self-reported `multipleInstances: no` is true).
- **Skip rule.** "Above 20k tips only if the 10k rung is not more than 10x over the threshold" triggered only for Archaeopteryx (24x). For react-bio-viz, phylotree-js, tbrowse and Phylocanvas.gl the 10k rung is unusable by 1.5 to 5x (frames) so their large trees were run anyway; the results are in the scale table.
- **Phylocanvas.gl** S1 `timeout` is the software-GL ceiling (a 1k-tip frame costs about 0.1 s in SwiftShader), not evidence about a GPU; its main-thread CPU is small (28 to 128 ms per step at 1k to 10k tips, about 0 at 100k where the page produces no frames), so a main-thread-only judgement would call it usable. The run cannot say which.
- **No candidate or adapter code was changed.** The stub got fault-injection switches for the runner self-test; harness files changed.

### Limits of these results

No GPU; one machine; Playwright-driven input; one run per candidate (the Canvas2D calibration in each run was within a few percent of the others, so the runs are comparable, but there is no repeat). Per-tree status uses the best of three 3.5 s rounds. The load average was 1 to 2 at the start of every run and rose to 4 to 5 during the heavy ones (Phylocanvas.gl, Archaeopteryx), which is the candidate's own browser threads, not another process. Runs made with the sampler build before the "no frame counts as slow" fix (custom, react-bio-viz, phylotree-js, tbrowse) have no round without a frame, so the fix does not change their rows.
