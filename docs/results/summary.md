# Spike results: summary of the six candidates (final harness runs)

Evidence level **M** for every number: measured by `spikes/runner/run.mjs` (runner v0.2) in headless Chromium 141 **without a GPU** (SwiftShader), 4 vCPU, production builds, **one candidate at a time on an otherwise idle machine** (load average 0.9 to 1.1 at the start of each run), 2026-10-14. Run ids are in `spikes/results/FINAL.json`; the full matrix and scale table are in `spikes/results/SUMMARY.md`; the per-candidate write-ups (authors' own runs, made while five agents shared the machine at load 3 to 19) are the other files in this folder. None of this is a laptop number: WebGL and Canvas FPS are pessimistic, and SVG raster runs on the CPU (`--disable-gpu-rasterization`).

## How the numbers were judged (what changed in the runner)

The authors found that the runner's p5 FPS rule measured sandbox load: a 5-tip tree read 15 fps and the naive stub at 200 tips 2 to 7 fps under load. Runner v0.2 therefore judges, per tree and best of 3 rounds of 3.5 s scripted wheel and drag: the share of time spent in frames over 50 ms (unusable above 50%), main-thread CPU per interaction step from CDP `ThreadTime` (unusable above 100 ms), load time (above 10 s) and click latency (above 300 ms). p5 FPS is reported, not judged. Every run also records `os.loadavg()` and two calibration references measured at its start (a plain Canvas2D animation and the stub at 200 tips; the Canvas2D page gives median 60 to 150 fps and best p5 59.5 in all seven runs, so the machine was quiet). Details: CONTRACT.md Clarifications 15 to 24.

## Scenario matrix (S1 to S15)

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

## Scale headlines (Yule trees, rectangular, 3 scripted rounds)

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

## Where these numbers disagree with the authors' own reports

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

## Findings from the re-run that are not in the authors' reports

- **react-bio-viz library bug.** The mount fails with `RangeError: Maximum call stack size exceeded` on otl-91k, gtdb-100k and gtdb-190k although their depth is only 76 to 103 (the 100k Yule tree mounts). The stack shows a recursive helper that does `nodes.push(...descendants(child))`: spreading a subtree of more than about 120k nodes into function arguments exceeds V8's argument limit. So the limit is the size of the largest child subtree, not depth. The authors stopped at the 100k Yule tree and did not see it.
- **Archaeopteryx S13**: a second launch empties the first (the self-reported `multipleInstances: no` is true).
- **Skip rule.** "Above 20k tips only if the 10k rung is not more than 10x over the threshold" triggered only for Archaeopteryx (24x). For react-bio-viz, phylotree-js, tbrowse and Phylocanvas.gl the 10k rung is unusable by 1.5 to 5x (frames) so their large trees were run anyway; the results are in the scale table.
- **Phylocanvas.gl** S1 `timeout` is the software-GL ceiling (a 1k-tip frame costs about 0.1 s in SwiftShader), not evidence about a GPU; its main-thread CPU is small (28 to 128 ms per step at 1k to 10k tips, about 0 at 100k where the page produces no frames), so a main-thread-only judgement would call it usable. The run cannot say which.
- **No candidate or adapter code was changed.** The stub got fault-injection switches for the runner self-test; harness files changed.

## Limits of these results

No GPU; one machine; Playwright-driven input; one run per candidate (the Canvas2D calibration in each run was within a few percent of the others, so the runs are comparable, but there is no repeat). Per-tree status uses the best of three 3.5 s rounds. The load average was 1 to 2 at the start of every run and rose to 4 to 5 during the heavy ones (Phylocanvas.gl, Archaeopteryx), which is the candidate's own browser threads, not another process. Runs made with the sampler build before the "no frame counts as slow" fix (custom, react-bio-viz, phylotree-js, tbrowse) have no round without a frame, so the fix does not change their rows.
