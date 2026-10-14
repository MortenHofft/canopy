# Spike results summary

Generated 2026-10-14T21:46:50.681Z by `node spikes/runner/report.mjs` from `spikes/results/*/*.json` (runs listed in FINAL.json only). All numbers are **M** (measured) in headless Chromium **without a GPU** (SwiftShader), 4 vCPU, one candidate at a time. Canvas and WebGL FPS are pessimistic; get final scale numbers on a real laptop.

## Scenario matrix

| Candidate | S1 | S2 | S3 | S4 | S5 | S6 | S7 | S8 | S9 | S10 | S11 | S12 | S13 | S14 | S15 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| stub 0.1.0 | partial | pass | pass | pass | pass | pass | pass | pass | pass | TIMEOUT | pass | pass | pass | pass | pass |
| custom 0.1.0 | pass | pass | partial | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass |
| react-bio-viz 0.3.0 | partial | pass | pass | pass | pass | pass | pass | pass | pass | n/a | pass | pass | pass | partial | TIMEOUT |
| phylotree-js 2.6.0 | partial | pass | partial | pass | pass | pass | pass | pass | pass | TIMEOUT | pass | pass | pass | partial | TIMEOUT |
| tbrowse 2.10.0 | partial | pass | partial | pass | pass | pass | pass | pass | pass | n/a | pass | unsupported | pass | pass | TIMEOUT |
| phylocanvas-gl 1.64.1 | partial | pass | partial | pass | pass | pass | pass | pass | pass | TIMEOUT | pass | pass | pass | pass | partial |
| archaeopteryx-js 3.24.0 | partial | pass | partial | pass | pass | pass | partial | pass | pass | partial | pass | pass | FAIL | partial | pass |

pass = all checks passed; partial = works with a workaround, adapter-derived data, or only some checks pass; FAIL = checks failed; unsupported = adapter reports `no`; n/a = precondition not met (for example the plain wheel does not zoom, so S10 cannot be tested); TIMEOUT = unusable threshold exceeded or the scenario hung; skipped = not run (rule or time cap); `-` = not run. Scenario titles: S1 Load and fit to screen (scale ladder); S2 Click a tip; S3 Click an internal node; S4 Colour clades from React state; S5 Highlight and focus a tip; S6 Tip label as a link; S7 Custom column (bar) aligned to tips; S8 Alignment column; S9 Theming (dark, tokens); S10 Zoom out to the whole tree; S11 Phylogram / cladogram; S12 Radial layout; S13 Two instances, mount/unmount x5; S14 Keyboard and screen reader; S15 Linked view (click clade, colour, map panel).

## Scale table (S1)

Judged on load time, the share of time in frames over 50 ms, main-thread CPU per interaction step and click latency (CONTRACT.md Clarifications 15), not on raw p5. Median fps is the median rAF rate during scripted wheel and drag (mostly idle frames, so about 60 unless the page freezes); p5 is the best of 3 rounds. "Rel fps" is the candidate's best p5 divided by the best p5 of the plain Canvas2D calibration page measured at the start of the same run (1.0 = as smooth as a trivial canvas under the same load). `*` marks rows measured with a 1-minute load average above 4.

| Candidate | Tree | Tips | Fetch ms | Parse ms | First render ms | Median fps | p5 fps (best of 3) | Rel fps | CPU ms/step | Click ms | Heap MB | Load | Status |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| stub | edge-quoted-labels | 5 | 9 | 0 | 43 | 59.9 | 29.9 | 0.50 | 4 | 2 | 4 | 2.2 | pass |
| stub | rich-fish-carangaria-135 | 135 | 16 | 0 | 42 | 59.5 | 20.0 | 0.34 | 6 | 2 | 4 | 2.4 | pass |
| stub | rich-ens-protein-197 | 197 | 9 | 0 | 50 | 59.5 | 20.0 | 0.34 | 10 | 2 | 4 | 2.1 | pass |
| stub | syn-yule-200 | 200 | 9 | 0 | 36 | 59.9 | 20.0 | 0.34 | 9 | 3 | 4 | 2.3 | pass |
| stub | rich-birdtree-0000 | 380 | 40 | 0 | 55 | 59.9 | 20.0 | 0.34 | 13 | 3 | 4 | 2.6 | pass |
| stub | rich-corvoid-680 | 680 | 27 | 0 | 81 | 59.9 | 20.0 | 0.34 | 14 | 4 | 5 | 2.3 | pass |
| stub | otl-1k | 888 | 26 | 0 | 82 | 59.9 | 20.0 | 0.34 | 18 | 4 | 5 | 2.6 | pass |
| stub | syn-caterpillar-1000 | 1000 | 11 | 0 | 97 | 59.9 | 20.0 | 0.34 | 16 | 7 | 5 | 2.4 | pass |
| stub | syn-yule-1000 | 1000 | 12 | 0 | 80 | 59.9 | 20.0 | 0.34 | 22 | 4 | 5 | 2.7 | pass |
| stub | syn-balanced-10000 | 10000 | 26 | 0 | 569 | 59.9 | 3.5 | 0.06 | 129 | 26 | 14 | 3.0 | TIMEOUT (unusable: 67% of the time in frames > 50 ms (best of 3 rounds); 129 ms main-thread CPU per interaction step > ) |
| stub | syn-bushy-10000 | 10000 | 18 | 0 | 487 | 59.9 | 4.6 | 0.08 | 107 | 19 | 11 | 2.5 | TIMEOUT (unusable: 63% of the time in frames > 50 ms (best of 3 rounds); 107 ms main-thread CPU per interaction step > ) |
| stub | syn-caterpillar-10000 | 10000 | 19 | 0 | 636 | 30.0 | 3.0 | 0.05 | 135 | 36 | 14 | 3.1 | TIMEOUT (unusable: 63% of the time in frames > 50 ms (best of 3 rounds); 135 ms main-thread CPU per interaction step > ) |
| stub | syn-yule-10000 | 10000 | 24 | 0 | 579 | 59.9 | 3.3 | 0.06 | 135 | 25 | 16 | 3.1 | TIMEOUT (unusable: 65% of the time in frames > 50 ms (best of 3 rounds); 135 ms main-thread CPU per interaction step > ) |
| stub | otl-10k | 10018 | 27 | 0 | 417 | 59.9 | 3.7 | 0.06 | 94 | 20 | 12 | 2.7 | TIMEOUT (unusable: 65% of the time in frames > 50 ms (best of 3 rounds)) |
| stub | gtdb-10k | 10122 | 17 | 0 | 591 | 59.9 | 4.0 | 0.07 | 149 | 24 | 14 | 2.7 | TIMEOUT (unusable: 58% of the time in frames > 50 ms (best of 3 rounds); 149 ms main-thread CPU per interaction step > ) |
| stub | edge-caterpillar-20000 | 20000 | 16 | 0 | 1316 | 59.9 | 4.0 | 0.07 | 360 | 61 | 24 | 2.6 | TIMEOUT (unusable: 360 ms main-thread CPU per interaction step > 100) |
| stub | otl-91k | 90938 | 45 | 0 | 3660 | 59.9 | 1.3 | 0.02 | 1060 | 220 | 78 | 1.2 | TIMEOUT (unusable: 1060 ms main-thread CPU per interaction step > 100) |
| stub | gtdb-100k | 100000 | 57 | 0 | 5756 | 4.3 | 0.3 | 0.00 | 942 | 269 | 113 | 2.0 | TIMEOUT (unusable: 63% of the time in frames > 50 ms (best of 3 rounds); 942 ms main-thread CPU per interaction step > ) |
| stub | syn-yule-100000 | 100000 | 61 | 0 | 5623 | 59.9 | 0.9 | 0.02 | 1499 | 295 | 108 | 2.1 | TIMEOUT (unusable: 1499 ms main-thread CPU per interaction step > 100) |
| stub | gtdb-190k | 189801 | 97 | 0 | 10935 | 0.8 | 0.1 | 0.00 | 2929 | 793 | 213 | 2.4 | TIMEOUT (unusable: load 10.9 s > 10 s; 60% of the time in frames > 50 ms (best of 3 rounds); 2929 ms main-thread CPU pe) |
| custom | edge-quoted-labels | 5 | 9 | 0 | 77 | 59.9 | 59.9 | 1.01 | 8 | 8 | 12 | 1.2 | pass |
| custom | rich-fish-carangaria-135 | 135 | 11 | 0 | 91 | 59.9 | 59.9 | 1.01 | 9 | 7 | 12 | 1.0 | pass |
| custom | rich-ens-protein-197 | 197 | 25 | 0 | 88 | 59.9 | 59.5 | 1.00 | 9 | 8 | 13 | 1.9 | pass |
| custom | syn-yule-200 | 200 | 10 | 0 | 98 | 59.9 | 59.5 | 1.00 | 9 | 6 | 12 | 1.6 | pass |
| custom | rich-birdtree-0000 | 380 | 41 | 0 | 87 | 59.9 | 59.9 | 1.01 | 9 | 5 | 12 | 1.6 | pass |
| custom | rich-corvoid-680 | 680 | 30 | 0 | 92 | 59.9 | 59.5 | 1.00 | 11 | 8 | 13 | 2.3 | pass |
| custom | otl-1k | 888 | 20 | 0 | 121 | 59.9 | 59.5 | 1.00 | 10 | 8 | 13 | 2.5 | pass |
| custom | syn-caterpillar-1000 | 1000 | 10 | 0 | 87 | 59.9 | 59.5 | 1.00 | 9 | 13 | 13 | 2.7 | pass |
| custom | syn-yule-1000 | 1000 | 9 | 0 | 117 | 59.9 | 59.5 | 1.00 | 10 | 8 | 13 | 2.6 | pass |
| custom | syn-balanced-10000 | 10000 | 24 | 0 | 114 | 59.9 | 59.5 | 1.00 | 14 | 7 | 15 | 2.7 | pass |
| custom | syn-bushy-10000 | 10000 | 33 | 0 | 146 | 59.9 | 59.9 | 1.01 | 15 | 6 | 14 | 3.0 | pass |
| custom | syn-caterpillar-10000 | 10000 | 24 | 0 | 146 | 59.9 | 59.9 | 1.01 | 10 | 10 | 15 | 2.8 | pass |
| custom | syn-yule-10000 | 10000 | 25 | 0 | 141 | 59.9 | 59.5 | 1.00 | 16 | 6 | 17 | 2.4 | pass |
| custom | otl-10k | 10018 | 26 | 0 | 157 | 59.9 | 59.5 | 1.00 | 11 | 7 | 14 | 2.7 | pass |
| custom | gtdb-10k | 10122 | 23 | 0 | 111 | 59.9 | 59.9 | 1.01 | 14 | 7 | 15 | 3.0 | pass |
| custom | edge-caterpillar-20000 | 20000 | 14 | 0 | 174 | 59.9 | 59.9 | 1.01 | 8 | 9 | 17 | 3.0 | pass |
| custom | otl-91k | 90938 | 79 | 0 | 122 | 59.9 | 59.5 | 1.00 | 15 | 7 | 33 | 3.0 | pass |
| custom | gtdb-100k | 100000 | 47 | 0 | 134 | 59.9 | 59.9 | 1.01 | 17 | 7 | 38 | 3.2 | pass |
| custom | syn-yule-100000 | 100000 | 40 | 0 | 144 | 59.9 | 59.9 | 1.01 | 15 | 10 | 36 | 3.3 | pass |
| custom | gtdb-190k | 189801 | 103 | 0 | 189 | 59.9 | 59.9 | 1.01 | 17 | 6 | 62 | 2.8 | pass |
| react-bio-viz | edge-quoted-labels | 5 | 18 | 0 | 49 | 59.9 | 59.9 | 1.01 | 2 | 3 | 6 | 1.5 | pass |
| react-bio-viz | rich-fish-carangaria-135 | 135 | 21 | 3 | 209 | 59.9 | 59.9 | 1.01 | 3 | 3 | 8 | 1.1 | pass |
| react-bio-viz | rich-ens-protein-197 | 197 | 21 | 1 | 181 | 59.9 | 59.9 | 1.01 | 3 | 6 | 9 | 1.1 | pass |
| react-bio-viz | syn-yule-200 | 200 | 11 | 1 | 240 | 59.9 | 59.9 | 1.01 | 3 | 6 | 9 | 1.2 | pass |
| react-bio-viz | rich-birdtree-0000 | 380 | 37 | 2 | 286 | 59.9 | 59.9 | 1.01 | 4 | 9 | 11 | 0.9 | pass |
| react-bio-viz | rich-corvoid-680 | 680 | 23 | 3 | 514 | 59.9 | 59.9 | 1.01 | 3 | 14 | 14 | 0.7 | pass |
| react-bio-viz | otl-1k | 888 | 16 | 5 | 600 | 59.9 | 59.9 | 1.01 | 8 | 15 | 15 | 0.7 | pass |
| react-bio-viz | syn-caterpillar-1000 | 1000 | 11 | 5 | 667 | 59.9 | 59.5 | 1.00 | 11 | 25 | 18 | 1.0 | pass |
| react-bio-viz | syn-yule-1000 | 1000 | 12 | 7 | 740 | 59.9 | 59.9 | 1.01 | 3 | 16 | 19 | 0.6 | pass |
| react-bio-viz | syn-balanced-10000 | 10000 | 30 | 46 | 6158 | 59.9 | 4.6 | 0.08 | 184 | 191 | 127 | 1.5 | TIMEOUT (unusable: 71% of the time in frames > 50 ms (best of 3 rounds); 184 ms main-thread CPU per interaction step > ) |
| react-bio-viz | syn-bushy-10000 | 10000 | 16 | 26 | 4928 | 59.9 | 5.5 | 0.09 | 168 | 192 | 100 | 1.4 | TIMEOUT (unusable: 70% of the time in frames > 50 ms (best of 3 rounds); 168 ms main-thread CPU per interaction step > ) |
| react-bio-viz | syn-caterpillar-10000 | 10000 | - | - | - | - | - | - | - | - | - | 1.5 | FAIL (mount: page.evaluate: RangeError: Maximum call stack size exceeded) |
| react-bio-viz | syn-yule-10000 | 10000 | 22 | 25 | 6441 | 59.9 | 4.3 | 0.07 | 157 | 208 | 128 | 1.6 | TIMEOUT (unusable: 77% of the time in frames > 50 ms (best of 3 rounds); 157 ms main-thread CPU per interaction step > ) |
| react-bio-viz | otl-10k | 10018 | 34 | 23 | 5230 | 59.9 | 4.6 | 0.08 | 42 | 174 | 104 | 1.1 | TIMEOUT (unusable: 57% of the time in frames > 50 ms (best of 3 rounds)) |
| react-bio-viz | gtdb-10k | 10122 | 31 | 55 | 6193 | 59.9 | 4.0 | 0.07 | 172 | 228 | 130 | 0.9 | TIMEOUT (unusable: 72% of the time in frames > 50 ms (best of 3 rounds); 172 ms main-thread CPU per interaction step > ) |
| react-bio-viz | edge-caterpillar-20000 | 20000 | - | - | - | - | - | - | - | - | - | 1.4 | FAIL (mount: page.evaluate: RangeError: Maximum call stack size exceeded) |
| react-bio-viz | otl-91k | 90938 | - | - | - | - | - | - | - | - | - | 1.4 | FAIL (mount: page.evaluate: RangeError: Maximum call stack size exceeded) |
| react-bio-viz | gtdb-100k | 100000 | - | - | - | - | - | - | - | - | - | 1.8 | FAIL (mount: page.evaluate: RangeError: Maximum call stack size exceeded) |
| react-bio-viz | syn-yule-100000 | 100000 | 54 | 206 | 64633 | - | - | - | - | - | - | 1.4 | TIMEOUT (load 64.8 s > 10 s; interaction measures skipped) |
| react-bio-viz | gtdb-190k | 189801 | - | - | - | - | - | - | - | - | - | 1.8 | FAIL (mount: page.evaluate: RangeError: Maximum call stack size exceeded) |
| phylotree-js | edge-quoted-labels | 5 | 16 | 2 | 49 | 59.9 | 59.5 | 0.99 | 5 | 4 | 5 | 1.8 | pass |
| phylotree-js | rich-fish-carangaria-135 | 135 | 15 | 7 | 80 | 59.9 | 59.9 | 1.00 | 13 | 10 | 6 | 1.8 | pass |
| phylotree-js | rich-ens-protein-197 | 197 | 11 | 4 | 81 | 59.9 | 59.5 | 0.99 | 14 | 10 | 6 | 1.4 | pass |
| phylotree-js | syn-yule-200 | 200 | 16 | 9 | 103 | 59.9 | 59.5 | 0.99 | 13 | 10 | 6 | 1.9 | pass |
| phylotree-js | rich-birdtree-0000 | 380 | 35 | 15 | 162 | 59.9 | 59.5 | 0.99 | 22 | 24 | 6 | 2.5 | pass |
| phylotree-js | rich-corvoid-680 | 680 | 23 | 15 | 190 | 59.9 | 59.5 | 0.99 | 34 | 29 | 7 | 2.8 | pass |
| phylotree-js | otl-1k | 888 | 16 | 19 | 206 | 59.9 | 20.0 | 0.33 | 47 | 38 | 8 | 2.7 | pass |
| phylotree-js | syn-caterpillar-1000 | 1000 | 14 | 23 | 235 | 59.9 | 30.0 | 0.50 | 40 | 41 | 8 | 2.0 | pass |
| phylotree-js | syn-yule-1000 | 1000 | 14 | 19 | 209 | 59.9 | 30.0 | 0.50 | 36 | 44 | 9 | 2.0 | pass |
| phylotree-js | syn-balanced-10000 | 10000 | 27 | 65 | 1537 | 30.1 | 3.0 | 0.05 | 202 | 395 | 36 | 1.8 | TIMEOUT (unusable: 76% of the time in frames > 50 ms (best of 3 rounds); 202 ms main-thread CPU per interaction step > ) |
| phylotree-js | syn-bushy-10000 | 10000 | 17 | 82 | 1488 | 59.9 | 5.0 | 0.08 | 155 | 304 | 27 | 1.4 | TIMEOUT (unusable: 71% of the time in frames > 50 ms (best of 3 rounds); 155 ms main-thread CPU per interaction step > ) |
| phylotree-js | syn-caterpillar-10000 | 10000 | - | - | - | - | - | - | - | - | - | 1.8 | FAIL (mount: page.evaluate: Error: phylotree.render() failed: Maximum call stack size exceeded (tree: 10000 tips, de) |
| phylotree-js | syn-yule-10000 | 10000 | 25 | 77 | 1602 | 59.9 | 3.5 | 0.06 | 191 | 429 | 38 | 2.0 | TIMEOUT (unusable: 67% of the time in frames > 50 ms (best of 3 rounds); 191 ms main-thread CPU per interaction step > ) |
| phylotree-js | otl-10k | 10018 | 22 | 94 | 1463 | 51.3 | 2.1 | 0.03 | 288 | - | 28 | 1.3 | TIMEOUT (unusable: 79% of the time in frames > 50 ms (best of 3 rounds); 288 ms main-thread CPU per interaction step > ) |
| phylotree-js | gtdb-10k | 10122 | 22 | 71 | 1624 | 59.9 | 3.3 | 0.06 | 221 | 431 | 37 | 1.3 | TIMEOUT (unusable: 73% of the time in frames > 50 ms (best of 3 rounds); 221 ms main-thread CPU per interaction step > ) |
| phylotree-js | edge-caterpillar-20000 | 20000 | - | - | - | - | - | - | - | - | - | 1.2 | FAIL (mount: page.evaluate: Error: phylotree.render() failed: Maximum call stack size exceeded (tree: 20000 tips, de) |
| phylotree-js | otl-91k | 90938 | 51 | 493 | 9913 | 3.7 | 0.3 | 0.00 | 1657 | - | 217 | 1.1 | TIMEOUT (unusable: load 10.4 s > 10 s; 99% of the time in frames > 50 ms (best of 3 rounds); 1657 ms main-thread CPU pe) |
| phylotree-js | gtdb-100k | 100000 | 61 | 836 | 15654 | 59.9 | 0.6 | 0.01 | 2201 | 3977 | 290 | 1.1 | TIMEOUT (unusable: load 16.5 s > 10 s; 82% of the time in frames > 50 ms (best of 3 rounds); 2201 ms main-thread CPU pe) |
| phylotree-js | syn-yule-100000 | 100000 | 51 | 560 | 14483 | 59.9 | 0.6 | 0.01 | 2161 | 3791 | 284 | 1.3 | TIMEOUT (unusable: load 15.0 s > 10 s; 85% of the time in frames > 50 ms (best of 3 rounds); 2161 ms main-thread CPU pe) |
| phylotree-js | gtdb-190k | 189801 | 87 | 1319 | 26391 | 59.9 | 0.2 | 0.00 | 4448 | 7138 | 547 | 1.3 | TIMEOUT (unusable: load 27.7 s > 10 s; 91% of the time in frames > 50 ms (best of 3 rounds); 4448 ms main-thread CPU pe) |
| tbrowse | edge-quoted-labels | 5 | 13 | 0 | 33 | 59.9 | 59.9 | 1.01 | 2 | 5 | 5 | 1.8 | pass |
| tbrowse | rich-fish-carangaria-135 | 135 | 17 | 0 | 95 | 59.9 | 59.9 | 1.01 | 11 | 8 | 7 | 1.7 | pass |
| tbrowse | rich-ens-protein-197 | 197 | 22 | 1 | 116 | 59.9 | 59.9 | 1.01 | 18 | 10 | 7 | 2.2 | pass |
| tbrowse | syn-yule-200 | 200 | 11 | 1 | 141 | 59.9 | 59.5 | 1.00 | 12 | 9 | 7 | 2.4 | pass |
| tbrowse | rich-birdtree-0000 | 380 | 39 | 4 | 178 | 59.9 | 59.5 | 1.00 | 28 | 10 | 8 | 1.9 | pass |
| tbrowse | rich-corvoid-680 | 680 | 29 | 2 | 279 | 59.9 | 59.5 | 1.00 | 23 | 11 | 9 | 2.2 | pass |
| tbrowse | otl-1k | 888 | 15 | 6 | 390 | 59.9 | 59.5 | 1.00 | 28 | 15 | 9 | 2.5 | pass |
| tbrowse | syn-caterpillar-1000 | 1000 | 22 | 3 | 421 | 59.9 | 30.0 | 0.50 | 28 | 4 | 10 | 2.9 | pass |
| tbrowse | syn-yule-1000 | 1000 | 11 | 5 | 420 | 59.9 | 59.5 | 1.00 | 26 | 13 | 10 | 2.3 | pass |
| tbrowse | syn-balanced-10000 | 10000 | 23 | 18 | 3982 | 59.5 | 2.0 | 0.03 | 562 | 176 | 45 | 2.0 | TIMEOUT (unusable: 94% of the time in frames > 50 ms (best of 3 rounds); 562 ms main-thread CPU per interaction step > ) |
| tbrowse | syn-bushy-10000 | 10000 | 18 | 14 | 3123 | 59.5 | 2.3 | 0.04 | 440 | 142 | 34 | 1.4 | TIMEOUT (unusable: 93% of the time in frames > 50 ms (best of 3 rounds); 440 ms main-thread CPU per interaction step > ) |
| tbrowse | syn-caterpillar-10000 | 10000 | - | - | - | - | - | - | - | - | - | 2.0 | FAIL (mount: page.evaluate: RangeError: Maximum call stack size exceeded) |
| tbrowse | syn-yule-10000 | 10000 | 17 | 32 | 4180 | 59.9 | 2.2 | 0.04 | 553 | 194 | 47 | 3.1 | TIMEOUT (unusable: 92% of the time in frames > 50 ms (best of 3 rounds); 553 ms main-thread CPU per interaction step > ) |
| tbrowse | otl-10k | 10018 | 23 | 14 | 3489 | 30.0 | 2.1 | 0.04 | 502 | 83 | 37 | 1.2 | TIMEOUT (unusable: 94% of the time in frames > 50 ms (best of 3 rounds); 502 ms main-thread CPU per interaction step > ) |
| tbrowse | gtdb-10k | 10122 | 25 | 20 | 3791 | 59.5 | 1.9 | 0.03 | 545 | 169 | 46 | 1.2 | TIMEOUT (unusable: 95% of the time in frames > 50 ms (best of 3 rounds); 545 ms main-thread CPU per interaction step > ) |
| tbrowse | edge-caterpillar-20000 | 20000 | - | - | - | - | - | - | - | - | - | 0.9 | FAIL (mount: page.evaluate: RangeError: Maximum call stack size exceeded) |
| tbrowse | otl-91k | 90938 | 59 | 246 | 89299 | - | - | - | - | - | - | 0.9 | TIMEOUT (load 89.5 s > 10 s; interaction measures skipped) |
| tbrowse | gtdb-100k | 100000 | 46 | 208 | 154839 | - | - | - | - | - | - | 1.0 | TIMEOUT (load 155.0 s > 10 s; interaction measures skipped) |
| tbrowse | syn-yule-100000 | 100000 | 94 | 226 | 153850 | - | - | - | - | - | - | 1.1 | TIMEOUT (load 154.1 s > 10 s; interaction measures skipped) |
| tbrowse | gtdb-190k | 189801 | - | - | - | - | - | - | - | - | - | 1.4 | TIMEOUT (mount: S1 gtdb-190k exceeded 600 s (mount never finished)) |
| phylocanvas-gl | edge-quoted-labels | 5 | 15 | 11 | 345 | 59.9 | 20.0 | 0.34 | 5 | 11 | 10 | 3.6 | pass |
| phylocanvas-gl | rich-fish-carangaria-135 | 135 | 16 | 13 | 1287 | 20.0 | 10.0 | 0.17 | 10 | 5 | 11 | 3.5 | TIMEOUT (unusable: 75% of the time in frames > 50 ms (best of 3 rounds)) |
| phylocanvas-gl | rich-ens-protein-197 | 197 | 10 | 25 | 1272 | 15.0 | 7.5 | 0.13 | 10 | 6 | 12 | 3.4 | TIMEOUT (unusable: 78% of the time in frames > 50 ms (best of 3 rounds)) |
| phylocanvas-gl | syn-yule-200 | 200 | 15 | 26 | 1337 | 20.0 | 7.5 | 0.13 | 10 | 6 | 12 | 3.7 | TIMEOUT (unusable: 82% of the time in frames > 50 ms (best of 3 rounds)) |
| phylocanvas-gl | rich-birdtree-0000 | 380 | 31 | 18 | 1256 | 15.0 | 7.5 | 0.13 | 12 | 5 | 13 | 3.7 | TIMEOUT (unusable: 85% of the time in frames > 50 ms (best of 3 rounds)) |
| phylocanvas-gl | rich-corvoid-680 | 680 | 29 | 29 | 1300 | 29.9 | 6.7 | 0.11 | 21 | 5 | 15 | 3.6 | TIMEOUT (unusable: 87% of the time in frames > 50 ms (best of 3 rounds)) |
| phylocanvas-gl | otl-1k | 888 | 18 | 27 | 934 | 5.0 | 4.0 | 0.07 | 21 | 4 | 18 | 3.5 | TIMEOUT (unusable: 93% of the time in frames > 50 ms (best of 3 rounds)) |
| phylocanvas-gl | syn-caterpillar-1000 | 1000 | 11 | 39 | 1410 | 6.7 | 2.7 | 0.05 | 25 | 11 | 17 | 3.0 | TIMEOUT (unusable: 94% of the time in frames > 50 ms (best of 3 rounds)) |
| phylocanvas-gl | syn-yule-1000 | 1000 | 15 | 38 | 1373 | 7.5 | 3.7 | 0.06 | 28 | 6 | 18 | 3.3 | TIMEOUT (unusable: 91% of the time in frames > 50 ms (best of 3 rounds)) |
| phylocanvas-gl | syn-balanced-10000 | 10000 | 18 | 100 | 2583 | 6.5 | 0.9 | 0.02 | 123 | 31 | 55 | 3.8 | TIMEOUT (unusable: 98% of the time in frames > 50 ms (best of 3 rounds); 123 ms main-thread CPU per interaction step > ) |
| phylocanvas-gl | syn-bushy-10000 | 10000 | 22 | 79 | 2274 | 7.9 | 1.4 | 0.02 | 120 | 28 | 58 | 3.8 | TIMEOUT (unusable: 97% of the time in frames > 50 ms (best of 3 rounds); 120 ms main-thread CPU per interaction step > ) |
| phylocanvas-gl | syn-caterpillar-10000 | 10000 | 23 | 77 | 595 | 7.8 | 0.9 | 0.02 | 111 | 20 | 55 | 3.6 | TIMEOUT (unusable: 98% of the time in frames > 50 ms (best of 3 rounds); 111 ms main-thread CPU per interaction step > ) |
| phylocanvas-gl | syn-yule-10000 | 10000 | 22 | 72 | 2342 | 7.5 | 1.1 | 0.02 | 129 | 33 | 57 | 3.1 | TIMEOUT (unusable: 98% of the time in frames > 50 ms (best of 3 rounds); 129 ms main-thread CPU per interaction step > ) |
| phylocanvas-gl | otl-10k | 10018 | 18 | 72 | 1997 | 8.2 | 1.3 | 0.02 | 128 | 30 | 68 | 3.6 | TIMEOUT (unusable: 97% of the time in frames > 50 ms (best of 3 rounds); 128 ms main-thread CPU per interaction step > ) |
| phylocanvas-gl | gtdb-10k | 10122 | 20 | 118 | 2693 | 5.1 | 1.1 | 0.02 | 133 | 32 | 74 | 3.6 | TIMEOUT (unusable: 98% of the time in frames > 50 ms (best of 3 rounds); 133 ms main-thread CPU per interaction step > ) |
| phylocanvas-gl | edge-caterpillar-20000 | 20000 | 17 | 177 | 3564 | 3.4 | 0.6 | 0.01 | 270 | 52 | 68 | 3.5 | TIMEOUT (unusable: 99% of the time in frames > 50 ms (best of 3 rounds); 270 ms main-thread CPU per interaction step > ) |
| phylocanvas-gl | otl-91k | 90938 | 71 | 519 | 9280 | 0.0 | 0.1 | 0.00 | 0 | 86 | 216 | 3.5 | TIMEOUT (unusable: 100% of the time in frames > 50 ms (best of 3 rounds)) |
| phylocanvas-gl | gtdb-100k | 100000 | 61 | 620 | 3126 | 0.0 | 0.1 | 0.00 | 0 | 25 | 305 | 3.5 | TIMEOUT (unusable: 100% of the time in frames > 50 ms (best of 3 rounds)) |
| phylocanvas-gl | syn-yule-100000 | 100000 | 38 | 659 | 3169 | 0.0 | 0.1 | 0.00 | 0 | 16 | 303 | 3.8 | TIMEOUT (unusable: 100% of the time in frames > 50 ms (best of 3 rounds)) |
| phylocanvas-gl | gtdb-190k | 189801 | 96 | 1236 | 5627 | 0.0 | 0.0 | 0.00 | 0 | 17 | 569 | 3.7 | TIMEOUT (unusable: 100% of the time in frames > 50 ms (best of 3 rounds)) |
| archaeopteryx-js | edge-quoted-labels | 5 | 12 | 6 | 109 | 59.9 | 59.5 | 0.99 | 8 | 3 | 7 | 1.8 | pass |
| archaeopteryx-js | rich-fish-carangaria-135 | 135 | 21 | 10 | 156 | 59.9 | 59.5 | 0.99 | 22 | 4 | 7 | 2.2 | pass |
| archaeopteryx-js | rich-ens-protein-197 | 197 | 12 | 7 | 170 | 59.9 | 59.9 | 1.00 | 29 | 4 | 8 | 2.3 | pass |
| archaeopteryx-js | syn-yule-200 | 200 | 13 | 5 | 158 | 59.9 | 59.5 | 0.99 | 18 | 4 | 8 | 2.5 | pass |
| archaeopteryx-js | rich-birdtree-0000 | 380 | 40 | 10 | 234 | 59.9 | 59.5 | 0.99 | 22 | 3 | 8 | 2.2 | pass |
| archaeopteryx-js | rich-corvoid-680 | 680 | 31 | 20 | 217 | 30.0 | 15.0 | 0.25 | 99 | 5 | 9 | 2.4 | partial (sluggish: 99 ms CPU per step (load 237 ms, median 30.0 fps, best p5 15.0, dropped 13%, CPU/step 99 ms, click 5) |
| archaeopteryx-js | otl-1k | 888 | 20 | 18 | 202 | 30.0 | 8.6 | 0.14 | 142 | 9 | 9 | 3.5 | TIMEOUT (unusable: 142 ms main-thread CPU per interaction step > 100) |
| archaeopteryx-js | syn-caterpillar-1000 | 1000 | 16 | 15 | 208 | 59.9 | 59.9 | 1.00 | 26 | 7 | 8 | 4.2* | pass |
| archaeopteryx-js | syn-yule-1000 | 1000 | 14 | 18 | 260 | 30.0 | 8.6 | 0.14 | 144 | 15 | 10 | 4.3* | TIMEOUT (unusable: 144 ms main-thread CPU per interaction step > 100) |
| archaeopteryx-js | syn-balanced-10000 | 10000 | 22 | 55 | 857 | 5.0 | 0.6 | 0.01 | 2398 | 216 | 24 | 4.7* | TIMEOUT (unusable: 99% of the time in frames > 50 ms (best of 3 rounds); 2398 ms main-thread CPU per interaction step >) |
| archaeopteryx-js | syn-bushy-10000 | 10000 | 21 | 51 | 699 | 3.7 | 0.6 | 0.01 | 1701 | 24 | 21 | 5.1* | TIMEOUT (unusable: 99% of the time in frames > 50 ms (best of 3 rounds); 1701 ms main-thread CPU per interaction step >) |
| archaeopteryx-js | syn-caterpillar-10000 | 10000 | - | - | - | - | - | - | - | - | - | 4.7* | FAIL (mount: page.evaluate: RangeError: Maximum call stack size exceeded) |
| archaeopteryx-js | syn-yule-10000 | 10000 | 17 | 64 | 853 | 4.0 | 0.6 | 0.01 | 1528 | 19 | 23 | 3.8 | TIMEOUT (unusable: 99% of the time in frames > 50 ms (best of 3 rounds); 1528 ms main-thread CPU per interaction step >) |
| archaeopteryx-js | otl-10k | 10018 | 21 | 58 | 762 | 59.9 | 10.0 | 0.17 | 92 | 10 | 18 | 5.1* | partial (sluggish: 36% of the time in frames > 50 ms; 92 ms CPU per step (load 820 ms, median 59.9 fps, best p5 10.0, d) |
| archaeopteryx-js | gtdb-10k | 10122 | 19 | 74 | 1047 | 59.9 | 5.0 | 0.08 | 198 | 14 | 25 | 3.9 | TIMEOUT (unusable: 58% of the time in frames > 50 ms (best of 3 rounds); 198 ms main-thread CPU per interaction step > ) |
| archaeopteryx-js | edge-caterpillar-20000 | 20000 | - | - | - | - | - | - | - | - | - | 3.1 | FAIL (mount: page.evaluate: RangeError: Maximum call stack size exceeded) |
| archaeopteryx-js | otl-91k | 90938 | - | - | - | - | - | - | - | - | - | - | skipped (skipped: unusable at 10k (factor 24x the threshold, rule: skip above 20k tips when the 10k rung is more than 1) |
| archaeopteryx-js | gtdb-100k | 100000 | - | - | - | - | - | - | - | - | - | - | skipped (skipped: unusable at 10k (factor 24x the threshold, rule: skip above 20k tips when the 10k rung is more than 1) |
| archaeopteryx-js | syn-yule-100000 | 100000 | - | - | - | - | - | - | - | - | - | - | skipped (skipped: unusable at 10k (factor 24x the threshold, rule: skip above 20k tips when the 10k rung is more than 1) |
| archaeopteryx-js | gtdb-190k | 189801 | - | - | - | - | - | - | - | - | - | - | skipped (skipped: unusable at 10k (factor 24x the threshold, rule: skip above 20k tips when the 10k rung is more than 1) |

Parse ms is what the candidate reports (adapters that use the shared parser report 0; see `sharedParseMs` in the JSON). First render ms is from handing the input to the adapter to two animation frames after it reports ready.

## Calibration and load

| Candidate | Run | Load start / end | Canvas ref: median fps, best p5, CPU ms/step | Stub at 200 tips: median fps, best p5, CPU ms/step | Noisy |
|---|---|---|---|---|---|
| stub | 20261014-183329 | 1.0 / 2.2 (max 3.1) | 64.9, 59.5, 4.9 | 59.9, 20.0, 8.3 | no |
| stub | 20261014-213301 | 1.0 / 2.0 (max 2.4) | 60.6, 59.9, 4.5 | 59.9, 20.0, 7.2 | no |
| custom | 20261014-185610 | 0.9 / 2.8 (max 3.3) | 151.5, 59.5, 5.0 | 59.9, 29.9, 6.3 | no |
| react-bio-viz | 20261014-190456 | 1.0 / 1.5 (max 1.8) | 60.2, 59.5, 4.4 | 59.9, 20.0, 6.6 | no |
| phylotree-js | 20261014-191714 | 0.9 / 1.8 (max 2.8) | 92.6, 59.9, 4.4 | 59.9, 29.9, 7.5 | no |
| tbrowse | 20261014-194331 | 1.1 / 1.0 (max 3.1) | 60.2, 59.5, 4.1 | 59.9, 29.9, 8.9 | no |
| phylocanvas-gl | 20261014-204430 | 1.0 / 3.8 (max 4.0) | 60.6, 59.5, 4.8 | 59.9, 20.0, 8.5 | no |
| archaeopteryx-js | 20261014-212043 | 1.0 / 2.7 (max 5.1) | 59.9, 59.9, 4.8 | 59.9, 20.0, 6.2 | no |

## Details

### stub 0.1.0 (Apache-2.0)

- Runs: 20261014-183329, 20261014-213301; Chromium 141.0.7390.37; GPU: no.
- Bundle (dist/, minified): JS 217 KB (70 KB gzip), CSS 17 KB (4 KB gzip), total 235 KB (74 KB gzip). Includes the shared shell and React.
- **S1 partial**: syn-yule-10000: timeout (unusable: 65% of the time in frames > 50 ms (best of 3 rounds); 135 ms main-thread CPU per interaction step > 100); syn-caterpillar-10000: timeout (unusable: 63% of the time in frames > 50 ms (best of 3 rounds); 135 ms main-thread CPU per interaction step > 100); syn-balanced-10000: timeout (unusable: 67% of the time in frames > 50 ms (best of 3 rounds); 129 ms main-thread CPU per interaction step > 100); syn-bushy-10000: timeout (unusable: 63% of the time in frames > 50 ms (best of 3 rounds); 107 ms main-thread CPU per interaction step > 100); otl-10k: timeout (unusable: 65% of the time in frames > 50 ms (best of 3 rounds)); gtdb-10k: timeout (unusable: 58% of the t
- **S10 TIMEOUT**: syn-yule-100000: no freeze: longest frame gap < 2 s (2183 ms); while zooming out median 59.9 fps, 71% of the time in frames > 50 ms, DOM nodes 400010, canvases 1 (more than half of the time in slow frames); overviewOrMinimap self-report: no

### custom 0.1.0 (Apache-2.0)

- Runs: 20261014-185610; Chromium 141.0.7390.37; GPU: no.
- Bundle (dist/, minified): JS 264 KB (86 KB gzip), CSS 17 KB (4 KB gzip), total 282 KB (91 KB gzip). Includes the shared shell and React.
- **S3 partial**: syn-yule-1000: tip sets correct but computed by the adapter (source=adapter-derived), not delivered by the library

### react-bio-viz 0.3.0 (MIT)

- Runs: 20261014-190456; Chromium 141.0.7390.37; GPU: no.
- Bundle (dist/, minified): JS 405 KB (132 KB gzip), CSS 17 KB (4 KB gzip), total 423 KB (136 KB gzip). Includes the shared shell and React.
- **S1 partial**: syn-yule-10000: timeout (unusable: 77% of the time in frames > 50 ms (best of 3 rounds); 157 ms main-thread CPU per interaction step > 100); syn-caterpillar-10000: fail (mount: page.evaluate: RangeError: Maximum call stack size exceeded); syn-balanced-10000: timeout (unusable: 71% of the time in frames > 50 ms (best of 3 rounds); 184 ms main-thread CPU per interaction step > 100); syn-bushy-10000: timeout (unusable: 70% of the time in frames > 50 ms (best of 3 rounds); 168 ms main-thread CPU per interaction step > 100); otl-10k: timeout (unusable: 57% of the time in frames > 50 ms (best of 3 rounds)); gtdb-10k: timeout (unusable: 72% of the time in frames > 50 ms (best of 3 rounds); 172 ms m
- **S10 n/a**: syn-yule-100000: wheel zoom-in did not change the view (whole tree stays at the same size and position, so a zoom-out cannot be tested; the viewer may pan or scroll instead of zooming with a plain wheel)
- **S14 partial**: at least one tip-level target (named like a tip) is reachable by Tab (only container-level targets (for example one canvas)); tips were not focusable at the fit view, only after focusTip
- **S15 TIMEOUT**: syn-yule-10000, 969-tip clade: all checks passed; click to React commit 775 ms, to paint 1342 ms (median of 5) > 300 ms (unusable)

### phylotree-js 2.6.0 (MIT (LICENSE file; package.json has no license field))

- Runs: 20261014-191714; Chromium 141.0.7390.37; GPU: no.
- Bundle (dist/, minified): JS 534 KB (176 KB gzip), CSS 17 KB (4 KB gzip), total 552 KB (181 KB gzip). Includes the shared shell and React.
- **S1 partial**: syn-yule-10000: timeout (unusable: 67% of the time in frames > 50 ms (best of 3 rounds); 191 ms main-thread CPU per interaction step > 100; click latency 429 ms > 300 ms); syn-caterpillar-10000: fail (mount: page.evaluate: Error: phylotree.render() failed: Maximum call stack size exceeded (tree: 10000 tips, depth 9999; the library's layout is recursive)); syn-balanced-10000: timeout (unusable: 76% of the time in frames > 50 ms (best of 3 rounds); 202 ms main-thread CPU per interaction step > 100; click latency 395 ms > 300 ms); syn-bushy-10000: timeout (unusable: 71% of the time in frames > 50 ms (best of 3 rounds); 155 ms main-thread CPU per interaction step > 100; click latency 304 ms > 30
- **S3 partial**: syn-yule-1000: tip sets correct but computed by the adapter (source=adapter-derived), not delivered by the library
- **S10 TIMEOUT**: syn-yule-100000: no freeze: longest frame gap < 2 s (2567 ms); while zooming out median 59.9 fps, 93% of the time in frames > 50 ms, DOM nodes 900034, canvases 0 (more than half of the time in slow frames); overviewOrMinimap self-report: no
- **S14 partial**: at least one tip-level target (named like a tip) is reachable by Tab (only container-level targets (for example one canvas)); tips were not focusable at the fit view, only after focusTip
- **S15 TIMEOUT**: syn-yule-10000, 969-tip clade: all checks passed; click to React commit 650 ms, to paint 813 ms (median of 5) > 300 ms (unusable)

### tbrowse 2.10.0 (MIT)

- Runs: 20261014-194331; Chromium 141.0.7390.37; GPU: no.
- Bundle (dist/, minified): JS 355 KB (112 KB gzip), CSS 17 KB (4 KB gzip), total 373 KB (117 KB gzip). Includes the shared shell and React.
- **S1 partial**: syn-yule-10000: timeout (unusable: 92% of the time in frames > 50 ms (best of 3 rounds); 553 ms main-thread CPU per interaction step > 100); syn-caterpillar-10000: fail (mount: page.evaluate: RangeError: Maximum call stack size exceeded); syn-balanced-10000: timeout (unusable: 94% of the time in frames > 50 ms (best of 3 rounds); 562 ms main-thread CPU per interaction step > 100); syn-bushy-10000: timeout (unusable: 93% of the time in frames > 50 ms (best of 3 rounds); 440 ms main-thread CPU per interaction step > 100); otl-10k: timeout (unusable: 94% of the time in frames > 50 ms (best of 3 rounds); 502 ms main-thread CPU per interaction step > 100); gtdb-10k: timeout (unusable: 95% of the 
- **S3 partial**: syn-yule-1000: tip sets correct but computed by the adapter (source=adapter-derived), not delivered by the library
- **S10 n/a**: otl-91k: wheel zoom-in did not change the view (whole tree stays at the same size and position, so a zoom-out cannot be tested; the viewer may pan or scroll instead of zooming with a plain wheel)
- **S12 unsupported**: adapter reports radialLayout=no: rectangular phylogram/cladogram only (TreeZoneState.layoutMode)
- **S15 TIMEOUT**: syn-yule-10000, 969-tip clade: all checks passed; click to React commit 366 ms, to paint 375 ms (median of 5) > 300 ms (unusable)

### phylocanvas-gl 1.64.1 (MIT)

- Runs: 20261014-204430; Chromium 141.0.7390.37; GPU: no.
- Bundle (dist/, minified): JS 1004 KB (294 KB gzip), CSS 17 KB (4 KB gzip), total 1021 KB (298 KB gzip). Includes the shared shell and React.
- **S1 partial**: rich-fish-carangaria-135: timeout (unusable: 75% of the time in frames > 50 ms (best of 3 rounds)); rich-ens-protein-197: timeout (unusable: 78% of the time in frames > 50 ms (best of 3 rounds)); syn-yule-200: timeout (unusable: 82% of the time in frames > 50 ms (best of 3 rounds)); rich-birdtree-0000: timeout (unusable: 85% of the time in frames > 50 ms (best of 3 rounds)); rich-corvoid-680: timeout (unusable: 87% of the time in frames > 50 ms (best of 3 rounds)); otl-1k: timeout (unusable: 93% of the time in frames > 50 ms (best of 3 rounds)); syn-yule-1000: timeout (unusable: 91% of the time in frames > 50 ms (best of 3 rounds)); syn-caterpillar-1000: timeout (unusable: 94% of the time in
- **S3 partial**: syn-yule-1000: tip sets correct but computed by the adapter (source=adapter-derived), not delivered by the library
- **S10 TIMEOUT**: syn-yule-100000: no freeze: longest frame gap < 2 s (6950 ms); while zooming out median 0.2 fps, 100% of the time in frames > 50 ms, DOM nodes 6, canvases 1 (more than half of the time in slow frames); overviewOrMinimap self-report: no
- **S15 partial**: syn-yule-10000, 969-tip clade: all checks passed; click to React commit 39 ms, to paint 164 ms (median of 5) > 120 ms target (spec: about 100 ms)

### archaeopteryx-js 3.24.0 (LGPL-3.0-or-later)

- Runs: 20261014-212043; Chromium 141.0.7390.37; GPU: no.
- Bundle (dist/, minified): JS 982 KB (324 KB gzip), CSS 17 KB (4 KB gzip), total 1000 KB (329 KB gzip). Includes the shared shell and React.
- **S1 partial**: rich-corvoid-680: partial (sluggish: 99 ms CPU per step (load 237 ms, median 30.0 fps, best p5 15.0, dropped 13%, CPU/step 99 ms, click 5 ms)); otl-1k: timeout (unusable: 142 ms main-thread CPU per interaction step > 100); syn-yule-1000: timeout (unusable: 144 ms main-thread CPU per interaction step > 100); syn-yule-10000: timeout (unusable: 99% of the time in frames > 50 ms (best of 3 rounds); 1528 ms main-thread CPU per interaction step > 100); syn-caterpillar-10000: fail (mount: page.evaluate: RangeError: Maximum call stack size exceeded); syn-balanced-10000: timeout (unusable: 99% of the time in frames > 50 ms (best of 3 rounds); 2398 ms main-thread CPU per interaction step > 100); syn-b
- **S3 partial**: syn-yule-1000: tip sets correct but computed by the adapter (source=adapter-derived), not delivered by the library
- **S7 partial**: syn-yule-1000, column occ (kind bar): after zoom and pan: at least 5 tips with a drawn cell (0 of 226 on-screen tips have a cell); after zoom and pan: cell centre within 2px of tip row (0/0 aligned, max dy 0.0px) [n/a: bar width follows value (only 0 cells on screen)]
- **S10 partial**: gtdb-10k: all checks passed; while zooming out median 59.9 fps, 69% of the time in frames > 50 ms, DOM nodes 515, canvases 0 (more than half of the time in slow frames); overviewOrMinimap self-report: yes
- **S13 FAIL**: both instances draw something (ink 0.00% / 14.83%); instance 0 tip locatable; instance 1 survives unmounting instance 0; adapter self-report: multipleInstances=no
- **S14 partial**: at least one tip-level target (named like a tip) is reachable by Tab (only container-level targets (for example one canvas)); tips were not focusable at the fit view, only after focusTip

