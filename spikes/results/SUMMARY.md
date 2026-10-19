# Spike results summary

Generated 2026-10-19T16:18:48.834Z by `node spikes/runner/report.mjs` from `spikes/results/*/*.json` (runs listed in FINAL.json only). All numbers are **M** (measured) in headless Chromium **without a GPU** (SwiftShader), 4 vCPU, one candidate at a time. Canvas and WebGL FPS are pessimistic; get final scale numbers on a real laptop.

## Scenario matrix

| Candidate | S1 | S2 | S3 | S4 | S5 | S6 | S7 | S8 | S9 | S10 | S11 | S12 | S13 | S14 | S15 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| stub 0.1.0 | partial | pass | pass | pass | pass | pass | pass | pass | pass | TIMEOUT | pass | pass | pass | pass | partial |
| custom 0.1.0 | pass | pass | partial | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass |
| react-bio-viz 0.3.0 | partial | pass | pass | pass | pass | pass | pass | pass | pass | n/a | pass | pass | pass | partial | TIMEOUT |
| phylotree-js 2.6.0 | partial | pass | partial | pass | pass | pass | pass | pass | pass | TIMEOUT | pass | pass | pass | partial | TIMEOUT |
| tbrowse 2.10.0 | partial | pass | partial | pass | pass | pass | pass | pass | pass | n/a | pass | unsupported | pass | pass | TIMEOUT |
| phylocanvas-gl 1.64.1 (noisy) | partial | pass | partial | pass | pass | pass | pass | pass | pass | TIMEOUT | pass | pass | pass | pass | partial |
| archaeopteryx-js 3.24.0 (noisy) | partial | pass | partial | pass | pass | pass | partial | pass | pass | partial | pass | pass | FAIL | partial | partial |
| taxonium 2.1.24 (noisy) | TIMEOUT | pass | partial | pass | pass | pass | unsupported | unsupported | pass | TIMEOUT | pass | unsupported | FAIL | partial | TIMEOUT |
| reactree 1.0.3 | partial | pass | partial | partial | pass | pass | partial | partial | pass | n/a | pass | FAIL | pass | partial | TIMEOUT |
| heat-tree 0.3.1 | partial | pass | partial | pass | pass | pass | partial | unsupported | pass | n/a | pass | pass | pass | partial | pass |

pass = all checks passed; partial = works with a workaround, adapter-derived data, or only some checks pass; FAIL = checks failed; unsupported = adapter reports `no`; n/a = precondition not met (for example the plain wheel does not zoom, so S10 cannot be tested); TIMEOUT = unusable threshold exceeded or the scenario hung; skipped = not run (rule or time cap); `-` = not run. Scenario titles: S1 Load and fit to screen (scale ladder); S2 Click a tip; S3 Click an internal node; S4 Colour clades from React state; S5 Highlight and focus a tip; S6 Tip label as a link; S7 Custom column (bar) aligned to tips; S8 Alignment column; S9 Theming (dark, tokens); S10 Zoom out to the whole tree; S11 Phylogram / cladogram; S12 Radial layout; S13 Two instances, mount/unmount x5; S14 Keyboard and screen reader; S15 Linked view (click clade, colour, map panel).

## Scale table (S1)

Judged on load time, the share of time in frames over 50 ms, main-thread CPU per interaction step and click latency (CONTRACT.md Clarifications 15), not on raw p5. Median fps is the median rAF rate during scripted wheel and drag (mostly idle frames, so about 60 unless the page freezes); p5 is the best of 3 rounds. "Rel fps" is the candidate's best p5 divided by the best p5 of the plain Canvas2D calibration page measured at the start of the same run (1.0 = as smooth as a trivial canvas under the same load). `*` marks rows measured with a 1-minute load average above 4.

| Candidate | Tree | Tips | Fetch ms | Parse ms | First render ms | Median fps | p5 fps (best of 3) | Rel fps | CPU ms/step | Click ms | Heap MB | Load | Status |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| stub | edge-quoted-labels | 5 | 13 | 0 | 45 | 30.0 | 20.0 | 0.67 | 6 | 2 | 4 | 3.6 | pass |
| stub | rich-fish-carangaria-135 | 135 | 14 | 0 | 81 | 30.0 | 20.0 | 0.66 | 8 | 3 | 4 | 3.7 | pass |
| stub | rich-ens-protein-197 | 197 | 12 | 0 | 73 | 48.8 | 15.0 | 0.50 | 10 | 3 | 4 | 3.9 | pass |
| stub | syn-yule-200 | 200 | 14 | 0 | 47 | 59.9 | 20.0 | 0.66 | 8 | 4 | 4 | 3.6 | pass |
| stub | rich-birdtree-0000 | 380 | 48 | 0 | 85 | 59.5 | 20.0 | 0.67 | 18 | 4 | 4 | 3.5 | pass |
| stub | rich-corvoid-680 | 680 | 30 | 0 | 93 | 30.0 | 15.0 | 0.50 | 16 | 4 | 5 | 3.8 | pass |
| stub | otl-1k | 888 | 18 | 0 | 85 | 59.9 | 20.0 | 0.67 | 18 | 4 | 5 | 3.9 | pass |
| stub | syn-caterpillar-1000 | 1000 | 15 | 0 | 103 | 30.0 | 15.0 | 0.50 | 35 | 9 | 5 | 3.2 | partial (sluggish: 30% of the time in frames > 50 ms (load 103 ms, median 30.0 fps, best p5 15.0, dropped 30%, CPU/step) |
| stub | syn-yule-1000 | 1000 | 19 | 0 | 111 | 59.9 | 15.0 | 0.50 | 32 | 5 | 5 | 3.3 | pass |
| stub | syn-balanced-10000 | 10000 | 21 | 0 | 763 | 59.9 | 3.2 | 0.11 | 222 | 54 | 14 | 2.8 | TIMEOUT (unusable: 71% of the time in frames > 50 ms (best of 3 rounds); 222 ms main-thread CPU per interaction step > ) |
| stub | syn-bushy-10000 | 10000 | 15 | 0 | 499 | 59.9 | 3.5 | 0.12 | 160 | 30 | 11 | 3.1 | TIMEOUT (unusable: 69% of the time in frames > 50 ms (best of 3 rounds); 160 ms main-thread CPU per interaction step > ) |
| stub | syn-caterpillar-10000 | 10000 | 27 | 0 | 959 | 59.9 | 4.6 | 0.15 | 192 | 41 | 14 | 3.3 | TIMEOUT (unusable: 192 ms main-thread CPU per interaction step > 100) |
| stub | syn-yule-10000 | 10000 | 30 | 0 | 766 | 59.9 | 5.0 | 0.17 | 250 | 43 | 16 | 4.0 | TIMEOUT (unusable: 250 ms main-thread CPU per interaction step > 100) |
| stub | otl-10k | 10018 | 31 | 0 | 632 | 59.9 | 2.9 | 0.10 | 176 | 48 | 12 | 3.6 | TIMEOUT (unusable: 62% of the time in frames > 50 ms (best of 3 rounds); 176 ms main-thread CPU per interaction step > ) |
| stub | gtdb-10k | 10122 | 45 | 0 | 889 | 59.9 | 4.3 | 0.14 | 249 | 43 | 15 | 3.4 | TIMEOUT (unusable: 249 ms main-thread CPU per interaction step > 100) |
| stub | edge-caterpillar-20000 | 20000 | 21 | 0 | 1677 | 59.9 | 2.6 | 0.09 | 544 | 107 | 25 | 2.5 | TIMEOUT (unusable: 544 ms main-thread CPU per interaction step > 100) |
| stub | otl-91k | 90938 | 69 | 0 | 4841 | 59.9 | 0.8 | 0.03 | 1628 | 269 | 82 | 2.4 | TIMEOUT (unusable: 1628 ms main-thread CPU per interaction step > 100) |
| stub | gtdb-100k | 100000 | 69 | 0 | 7627 | 2.7 | 0.2 | 0.01 | 2362 | 554 | 113 | 2.2 | TIMEOUT (unusable: 60% of the time in frames > 50 ms (best of 3 rounds); 2362 ms main-thread CPU per interaction step >) |
| stub | syn-yule-100000 | 100000 | 81 | 0 | 8057 | 59.9 | 0.6 | 0.02 | 1995 | 406 | 108 | 2.4 | TIMEOUT (unusable: 1995 ms main-thread CPU per interaction step > 100; click latency 406 ms > 300 ms) |
| stub | gtdb-190k | 189801 | 132 | 0 | 15645 | 0.6 | 0.1 | 0.00 | 4865 | 1222 | 213 | 2.1 | TIMEOUT (unusable: load 15.6 s > 10 s; 63% of the time in frames > 50 ms (best of 3 rounds); 4865 ms main-thread CPU pe) |
| stub | syn-yule-1000000 | 1000000 | - | - | - | - | - | - | - | - | - | 2.9 | TIMEOUT (mount: S1 syn-yule-1000000 exceeded 600 s (mount never finished)) |
| custom | edge-quoted-labels | 5 | 12 | 0 | 126 | 59.9 | 30.0 | 1.50 | 11 | 15 | 12 | 1.7 | pass |
| custom | rich-fish-carangaria-135 | 135 | 18 | 0 | 103 | 59.9 | 29.9 | 1.50 | 11 | 13 | 12 | 3.0 | pass |
| custom | rich-ens-protein-197 | 197 | 18 | 0 | 156 | 59.9 | 30.0 | 1.50 | 12 | 11 | 13 | 3.1 | pass |
| custom | syn-yule-200 | 200 | 12 | 0 | 110 | 59.9 | 30.0 | 1.50 | 12 | 8 | 12 | 2.9 | pass |
| custom | rich-birdtree-0000 | 380 | 49 | 0 | 100 | 59.9 | 30.0 | 1.50 | 13 | 10 | 12 | 3.3 | pass |
| custom | rich-corvoid-680 | 680 | 29 | 0 | 101 | 59.9 | 29.9 | 1.50 | 15 | 7 | 13 | 2.6 | pass |
| custom | otl-1k | 888 | 23 | 0 | 118 | 59.9 | 29.9 | 1.50 | 12 | 8 | 13 | 2.5 | pass |
| custom | syn-caterpillar-1000 | 1000 | 17 | 0 | 129 | 59.9 | 20.0 | 1.00 | 13 | 17 | 13 | 2.4 | pass |
| custom | syn-yule-1000 | 1000 | 28 | 0 | 128 | 59.9 | 30.0 | 1.50 | 16 | 11 | 13 | 2.0 | pass |
| custom | syn-balanced-10000 | 10000 | 19 | 0 | 99 | 59.9 | 29.9 | 1.50 | 13 | 9 | 15 | 3.0 | pass |
| custom | syn-bushy-10000 | 10000 | 20 | 0 | 139 | 59.9 | 29.9 | 1.50 | 14 | 10 | 14 | 2.7 | pass |
| custom | syn-caterpillar-10000 | 10000 | 22 | 0 | 163 | 59.9 | 30.0 | 1.50 | 14 | 17 | 15 | 2.6 | pass |
| custom | syn-yule-10000 | 10000 | 34 | 0 | 208 | 59.9 | 29.9 | 1.50 | 14 | 10 | 17 | 3.1 | pass |
| custom | otl-10k | 10018 | 22 | 0 | 172 | 59.9 | 29.9 | 1.50 | 11 | 12 | 14 | 2.5 | pass |
| custom | gtdb-10k | 10122 | 36 | 0 | 117 | 59.9 | 30.0 | 1.50 | 17 | 8 | 15 | 2.8 | pass |
| custom | edge-caterpillar-20000 | 20000 | 21 | 0 | 235 | 59.9 | 29.9 | 1.50 | 12 | 8 | 17 | 2.7 | pass |
| custom | otl-91k | 90938 | 87 | 0 | 168 | 59.9 | 29.9 | 1.50 | 17 | 10 | 33 | 2.5 | pass |
| custom | gtdb-100k | 100000 | 71 | 0 | 216 | 59.9 | 20.0 | 1.00 | 21 | 9 | 39 | 2.5 | pass |
| custom | syn-yule-100000 | 100000 | 53 | 0 | 152 | 59.9 | 20.0 | 1.00 | 18 | 11 | 36 | 2.2 | pass |
| custom | gtdb-190k | 189801 | 131 | 0 | 483 | 59.9 | 29.9 | 1.50 | 21 | 9 | 63 | 2.9 | pass |
| custom | syn-yule-1000000 | 1000000 | 389 | 0 | 661 | 59.9 | 15.0 | 0.50 | 22 | 11 | 252 | 1.5 | pass |
| react-bio-viz | edge-quoted-labels | 5 | 11 | 0 | 63 | 59.9 | 59.9 | 1.99 | 3 | 3 | 6 | 3.2 | pass |
| react-bio-viz | rich-fish-carangaria-135 | 135 | 18 | 4 | 178 | 59.9 | 59.9 | 1.99 | 3 | 6 | 8 | 2.3 | pass |
| react-bio-viz | rich-ens-protein-197 | 197 | 14 | 7 | 264 | 59.9 | 59.9 | 1.99 | 3 | 9 | 9 | 1.8 | pass |
| react-bio-viz | syn-yule-200 | 200 | 16 | 5 | 332 | 59.9 | 59.9 | 1.99 | 5 | 7 | 9 | 1.8 | pass |
| react-bio-viz | rich-birdtree-0000 | 380 | 54 | 3 | 414 | 59.9 | 59.9 | 1.99 | 4 | 12 | 11 | 1.8 | pass |
| react-bio-viz | rich-corvoid-680 | 680 | 43 | 3 | 736 | 59.9 | 59.5 | 1.98 | 4 | 21 | 14 | 1.3 | pass |
| react-bio-viz | otl-1k | 888 | 27 | 7 | 786 | 59.9 | 29.9 | 0.99 | 12 | 30 | 15 | 1.0 | pass |
| react-bio-viz | syn-caterpillar-1000 | 1000 | 15 | 7 | 1004 | 59.9 | 20.0 | 0.67 | 14 | 44 | 18 | 0.7 | pass |
| react-bio-viz | syn-yule-1000 | 1000 | 14 | 7 | 1172 | 59.9 | 29.9 | 0.99 | 5 | 32 | 19 | 0.8 | pass |
| react-bio-viz | syn-balanced-10000 | 10000 | 39 | 61 | 9821 | 59.9 | 3.3 | 0.11 | 244 | 314 | 127 | 1.2 | TIMEOUT (unusable: 82% of the time in frames > 50 ms (best of 3 rounds); 244 ms main-thread CPU per interaction step > ) |
| react-bio-viz | syn-bushy-10000 | 10000 | 18 | 34 | 7649 | 59.9 | 3.5 | 0.12 | 244 | 225 | 101 | 0.9 | TIMEOUT (unusable: 76% of the time in frames > 50 ms (best of 3 rounds); 244 ms main-thread CPU per interaction step > ) |
| react-bio-viz | syn-caterpillar-10000 | 10000 | - | - | - | - | - | - | - | - | - | 1.2 | FAIL (mount: page.evaluate: RangeError: Maximum call stack size exceeded) |
| react-bio-viz | syn-yule-10000 | 10000 | 26 | 43 | 8236 | 59.9 | 2.3 | 0.08 | 212 | 415 | 128 | 0.8 | TIMEOUT (unusable: 87% of the time in frames > 50 ms (best of 3 rounds); 212 ms main-thread CPU per interaction step > ) |
| react-bio-viz | otl-10k | 10018 | 28 | 36 | 6886 | 59.9 | 3.2 | 0.10 | 20 | 283 | 104 | 1.1 | TIMEOUT (unusable: 65% of the time in frames > 50 ms (best of 3 rounds)) |
| react-bio-viz | gtdb-10k | 10122 | 36 | 54 | 8646 | 59.9 | 3.0 | 0.10 | 190 | 310 | 133 | 1.7 | TIMEOUT (unusable: 84% of the time in frames > 50 ms (best of 3 rounds); 190 ms main-thread CPU per interaction step > ) |
| react-bio-viz | edge-caterpillar-20000 | 20000 | - | - | - | - | - | - | - | - | - | 1.7 | FAIL (mount: page.evaluate: RangeError: Maximum call stack size exceeded) |
| react-bio-viz | otl-91k | 90938 | - | - | - | - | - | - | - | - | - | 1.7 | FAIL (mount: page.evaluate: RangeError: Maximum call stack size exceeded) |
| react-bio-viz | gtdb-100k | 100000 | - | - | - | - | - | - | - | - | - | 1.8 | FAIL (mount: page.evaluate: RangeError: Maximum call stack size exceeded) |
| react-bio-viz | syn-yule-100000 | 100000 | 52 | 247 | 160547 | - | - | - | - | - | - | 1.7 | TIMEOUT (load 160.8 s > 10 s; interaction measures skipped) |
| react-bio-viz | gtdb-190k | 189801 | - | - | - | - | - | - | - | - | - | 1.7 | FAIL (mount: page.evaluate: RangeError: Maximum call stack size exceeded) |
| phylotree-js | edge-quoted-labels | 5 | 23 | 2 | 61 | 59.9 | 29.9 | 1.00 | 5 | 4 | 5 | 3.3 | pass |
| phylotree-js | rich-fish-carangaria-135 | 135 | 28 | 6 | 118 | 59.9 | 29.9 | 1.00 | 14 | 10 | 6 | 2.8 | pass |
| phylotree-js | rich-ens-protein-197 | 197 | 19 | 5 | 115 | 59.9 | 29.9 | 1.00 | 21 | 14 | 6 | 3.0 | pass |
| phylotree-js | syn-yule-200 | 200 | 13 | 6 | 120 | 59.9 | 29.9 | 1.00 | 19 | 21 | 6 | 2.6 | pass |
| phylotree-js | rich-birdtree-0000 | 380 | 54 | 11 | 211 | 59.9 | 20.0 | 0.67 | 41 | 28 | 6 | 2.6 | pass |
| phylotree-js | rich-corvoid-680 | 680 | 25 | 24 | 277 | 59.9 | 20.0 | 0.67 | 59 | 58 | 8 | 2.9 | partial (sluggish: 59 ms CPU per step (load 301 ms, median 59.9 fps, best p5 20.0, dropped 6%, CPU/step 59 ms, click 58) |
| phylotree-js | otl-1k | 888 | 13 | 28 | 333 | 59.9 | 12.0 | 0.40 | 70 | 68 | 8 | 2.5 | partial (sluggish: 70 ms CPU per step (load 361 ms, median 59.9 fps, best p5 12.0, dropped 17%, CPU/step 70 ms, click 6) |
| phylotree-js | syn-caterpillar-1000 | 1000 | 12 | 38 | 306 | 59.9 | 17.7 | 0.59 | 43 | 54 | 8 | 2.5 | pass |
| phylotree-js | syn-yule-1000 | 1000 | 12 | 16 | 317 | 59.9 | 20.0 | 0.67 | 81 | 57 | 9 | 2.2 | partial (sluggish: 81 ms CPU per step (load 333 ms, median 59.9 fps, best p5 20.0, dropped 4%, CPU/step 81 ms, click 57) |
| phylotree-js | syn-balanced-10000 | 10000 | 23 | 121 | 2157 | 30.0 | 2.5 | 0.08 | 505 | 571 | 36 | 1.8 | TIMEOUT (unusable: 85% of the time in frames > 50 ms (best of 3 rounds); 505 ms main-thread CPU per interaction step > ) |
| phylotree-js | syn-bushy-10000 | 10000 | 19 | 77 | 1693 | 44.2 | 3.0 | 0.10 | 416 | 477 | 27 | 1.4 | TIMEOUT (unusable: 77% of the time in frames > 50 ms (best of 3 rounds); 416 ms main-thread CPU per interaction step > ) |
| phylotree-js | syn-caterpillar-10000 | 10000 | - | - | - | - | - | - | - | - | - | 1.8 | FAIL (mount: page.evaluate: Error: phylotree.render() failed: Maximum call stack size exceeded (tree: 10000 tips, de) |
| phylotree-js | syn-yule-10000 | 10000 | 38 | 93 | 2494 | 30.0 | 2.7 | 0.09 | 610 | 597 | 36 | 2.8 | TIMEOUT (unusable: 79% of the time in frames > 50 ms (best of 3 rounds); 610 ms main-thread CPU per interaction step > ) |
| phylotree-js | otl-10k | 10018 | 27 | 96 | 1805 | 15.0 | 1.2 | 0.04 | 507 | - | 28 | 1.8 | TIMEOUT (unusable: 94% of the time in frames > 50 ms (best of 3 rounds); 507 ms main-thread CPU per interaction step > ) |
| phylotree-js | gtdb-10k | 10122 | 29 | 85 | 2195 | 59.5 | 2.3 | 0.08 | 564 | 558 | 37 | 1.7 | TIMEOUT (unusable: 79% of the time in frames > 50 ms (best of 3 rounds); 564 ms main-thread CPU per interaction step > ) |
| phylotree-js | edge-caterpillar-20000 | 20000 | - | - | - | - | - | - | - | - | - | 1.6 | FAIL (mount: page.evaluate: Error: phylotree.render() failed: Maximum call stack size exceeded (tree: 20000 tips, de) |
| phylotree-js | otl-91k | 90938 | 82 | 796 | 14934 | 6.7 | 0.2 | 0.01 | 2557 | - | 209 | 1.6 | TIMEOUT (unusable: load 15.7 s > 10 s; 99% of the time in frames > 50 ms (best of 3 rounds); 2557 ms main-thread CPU pe) |
| phylotree-js | gtdb-100k | 100000 | 79 | 858 | 22629 | 59.9 | 0.4 | 0.01 | 3496 | 5964 | 303 | 1.3 | TIMEOUT (unusable: load 23.5 s > 10 s; 86% of the time in frames > 50 ms (best of 3 rounds); 3496 ms main-thread CPU pe) |
| phylotree-js | syn-yule-100000 | 100000 | 64 | 745 | 22508 | 59.9 | 0.3 | 0.01 | 4125 | 6931 | 297 | 1.0 | TIMEOUT (unusable: load 23.3 s > 10 s; 90% of the time in frames > 50 ms (best of 3 rounds); 4125 ms main-thread CPU pe) |
| phylotree-js | gtdb-190k | 189801 | 114 | 2267 | 44444 | - | - | - | - | 12485 | - | 1.6 | TIMEOUT (pan/zoom: S1 gtdb-190k exceeded 600 s) |
| tbrowse | edge-quoted-labels | 5 | 10 | 0 | 67 | 59.9 | 59.9 | 2.00 | 3 | 6 | 5 | 2.9 | pass |
| tbrowse | rich-fish-carangaria-135 | 135 | 14 | 1 | 126 | 59.9 | 29.9 | 1.00 | 20 | 10 | 7 | 3.0 | pass |
| tbrowse | rich-ens-protein-197 | 197 | 10 | 2 | 155 | 59.9 | 30.0 | 1.00 | 31 | 15 | 7 | 2.3 | pass |
| tbrowse | syn-yule-200 | 200 | 12 | 1 | 169 | 59.9 | 29.9 | 1.00 | 23 | 11 | 7 | 2.4 | pass |
| tbrowse | rich-birdtree-0000 | 380 | 42 | 5 | 285 | 59.9 | 29.9 | 1.00 | 34 | 17 | 8 | 2.4 | pass |
| tbrowse | rich-corvoid-680 | 680 | 29 | 3 | 335 | 59.9 | 20.0 | 0.67 | 29 | 16 | 9 | 2.5 | pass |
| tbrowse | otl-1k | 888 | 19 | 9 | 452 | 59.9 | 20.0 | 0.67 | 19 | 19 | 9 | 2.3 | pass |
| tbrowse | syn-caterpillar-1000 | 1000 | 15 | 4 | 572 | 59.9 | 29.9 | 1.00 | 41 | 5 | 10 | 2.4 | pass |
| tbrowse | syn-yule-1000 | 1000 | 22 | 6 | 490 | 59.9 | 20.0 | 0.67 | 40 | 19 | 11 | 2.1 | pass |
| tbrowse | syn-balanced-10000 | 10000 | 24 | 49 | 6809 | 2.0 | 1.1 | 0.04 | 890 | 344 | 45 | 1.6 | TIMEOUT (unusable: 97% of the time in frames > 50 ms (best of 3 rounds); 890 ms main-thread CPU per interaction step > ) |
| tbrowse | syn-bushy-10000 | 10000 | 44 | 21 | 5027 | 4.6 | 1.7 | 0.06 | 517 | 261 | 34 | 1.6 | TIMEOUT (unusable: 97% of the time in frames > 50 ms (best of 3 rounds); 517 ms main-thread CPU per interaction step > ) |
| tbrowse | syn-caterpillar-10000 | 10000 | - | - | - | - | - | - | - | - | - | 1.6 | FAIL (mount: page.evaluate: RangeError: Maximum call stack size exceeded) |
| tbrowse | syn-yule-10000 | 10000 | 25 | 31 | 6037 | 59.9 | 1.4 | 0.05 | 1 | 241 | 48 | 2.7 | TIMEOUT (unusable: 89% of the time in frames > 50 ms (best of 3 rounds)) |
| tbrowse | otl-10k | 10018 | 44 | 17 | 5442 | 59.9 | 1.5 | 0.05 | 288 | 126 | 38 | 1.8 | TIMEOUT (unusable: 88% of the time in frames > 50 ms (best of 3 rounds); 288 ms main-thread CPU per interaction step > ) |
| tbrowse | gtdb-10k | 10122 | 25 | 23 | 6672 | 3.8 | 1.5 | 0.05 | 738 | 224 | 46 | 1.1 | TIMEOUT (unusable: 96% of the time in frames > 50 ms (best of 3 rounds); 738 ms main-thread CPU per interaction step > ) |
| tbrowse | edge-caterpillar-20000 | 20000 | - | - | - | - | - | - | - | - | - | 1.2 | FAIL (mount: page.evaluate: RangeError: Maximum call stack size exceeded) |
| tbrowse | otl-91k | 90938 | 58 | 205 | 176003 | - | - | - | - | - | - | 1.2 | TIMEOUT (load 176.2 s > 10 s; interaction measures skipped) |
| tbrowse | gtdb-100k | 100000 | 75 | 389 | 260185 | - | - | - | - | - | - | 1.4 | TIMEOUT (load 260.6 s > 10 s; interaction measures skipped) |
| tbrowse | syn-yule-100000 | 100000 | 65 | 312 | 316988 | - | - | - | - | - | - | 1.1 | TIMEOUT (load 317.3 s > 10 s; interaction measures skipped) |
| tbrowse | gtdb-190k | 189801 | - | - | - | - | - | - | - | - | - | 1.0 | TIMEOUT (mount: S1 gtdb-190k exceeded 600 s (mount never finished)) |
| phylocanvas-gl | edge-quoted-labels | 5 | 15 | 26 | 1874 | 30.0 | 20.0 | 0.66 | 7 | 11 | 10 | 2.5 | pass |
| phylocanvas-gl | rich-fish-carangaria-135 | 135 | 26 | 33 | 1933 | 12.0 | 4.3 | 0.14 | 9 | 11 | 11 | 3.3 | TIMEOUT (unusable: 85% of the time in frames > 50 ms (best of 3 rounds)) |
| phylocanvas-gl | rich-ens-protein-197 | 197 | 11 | 10 | 382 | 29.9 | 5.5 | 0.18 | 14 | 7 | 12 | 3.4 | TIMEOUT (unusable: 84% of the time in frames > 50 ms (best of 3 rounds)) |
| phylocanvas-gl | syn-yule-200 | 200 | 10 | 24 | 1990 | 30.0 | 5.5 | 0.18 | 11 | 10 | 11 | 3.7 | TIMEOUT (unusable: 86% of the time in frames > 50 ms (best of 3 rounds)) |
| phylocanvas-gl | rich-birdtree-0000 | 380 | 45 | 26 | 365 | 20.0 | 6.0 | 0.20 | 16 | 7 | 13 | 4.2* | TIMEOUT (unusable: 90% of the time in frames > 50 ms (best of 3 rounds)) |
| phylocanvas-gl | rich-corvoid-680 | 680 | 29 | 20 | 2305 | 7.5 | 2.6 | 0.09 | 20 | 10 | 15 | 3.5 | TIMEOUT (unusable: 93% of the time in frames > 50 ms (best of 3 rounds)) |
| phylocanvas-gl | otl-1k | 888 | 19 | 57 | 1693 | 5.0 | 2.2 | 0.07 | 23 | 8 | 18 | 3.5 | TIMEOUT (unusable: 93% of the time in frames > 50 ms (best of 3 rounds)) |
| phylocanvas-gl | syn-caterpillar-1000 | 1000 | 17 | 33 | 2183 | 4.3 | 1.8 | 0.06 | 31 | 23 | 17 | 3.3 | TIMEOUT (unusable: 97% of the time in frames > 50 ms (best of 3 rounds)) |
| phylocanvas-gl | syn-yule-1000 | 1000 | 23 | 54 | 2272 | 4.3 | 3.3 | 0.11 | 36 | 9 | 18 | 3.1 | TIMEOUT (unusable: 94% of the time in frames > 50 ms (best of 3 rounds)) |
| phylocanvas-gl | syn-balanced-10000 | 10000 | 20 | 117 | 871 | 3.8 | 0.7 | 0.02 | 235 | 7 | 55 | 4.2* | TIMEOUT (unusable: 98% of the time in frames > 50 ms (best of 3 rounds); 235 ms main-thread CPU per interaction step > ) |
| phylocanvas-gl | syn-bushy-10000 | 10000 | 24 | 104 | 2903 | 5.9 | 0.9 | 0.03 | 153 | 12 | 47 | 4.0 | TIMEOUT (unusable: 98% of the time in frames > 50 ms (best of 3 rounds); 153 ms main-thread CPU per interaction step > ) |
| phylocanvas-gl | syn-caterpillar-10000 | 10000 | 35 | 117 | 1006 | 4.3 | 0.6 | 0.02 | 159 | 54 | 42 | 3.8 | TIMEOUT (unusable: 99% of the time in frames > 50 ms (best of 3 rounds); 159 ms main-thread CPU per interaction step > ) |
| phylocanvas-gl | syn-yule-10000 | 10000 | 36 | 121 | 1064 | 4.5 | 0.7 | 0.02 | 127 | 12 | 57 | 3.4 | TIMEOUT (unusable: 99% of the time in frames > 50 ms (best of 3 rounds); 127 ms main-thread CPU per interaction step > ) |
| phylocanvas-gl | otl-10k | 10018 | 32 | 120 | 816 | 5.2 | 1.1 | 0.04 | 200 | 16 | 68 | 3.6 | TIMEOUT (unusable: 98% of the time in frames > 50 ms (best of 3 rounds); 200 ms main-thread CPU per interaction step > ) |
| phylocanvas-gl | gtdb-10k | 10122 | 33 | 114 | 858 | 4.9 | 1.0 | 0.03 | 254 | 11 | 47 | 3.2 | TIMEOUT (unusable: 98% of the time in frames > 50 ms (best of 3 rounds); 254 ms main-thread CPU per interaction step > ) |
| phylocanvas-gl | edge-caterpillar-20000 | 20000 | 29 | 280 | 1433 | 2.4 | 0.4 | 0.01 | 431 | 48 | 67 | 3.0 | TIMEOUT (unusable: 99% of the time in frames > 50 ms (best of 3 rounds); 431 ms main-thread CPU per interaction step > ) |
| phylocanvas-gl | otl-91k | 90938 | 64 | 741 | 3582 | 0.0 | 3.6 | 0.12 | 0 | 11 | 215 | 3.4 | TIMEOUT (unusable: 100% of the time in frames > 50 ms (best of 3 rounds)) |
| phylocanvas-gl | gtdb-100k | 100000 | 88 | 981 | 5165 | 0.0 | 0.1 | 0.00 | 280 | 1029 | 305 | 4.0* | TIMEOUT (unusable: 100% of the time in frames > 50 ms (best of 3 rounds); 280 ms main-thread CPU per interaction step >) |
| phylocanvas-gl | syn-yule-100000 | 100000 | 62 | 886 | 5252 | 0.0 | 0.1 | 0.00 | 0 | 32 | 303 | 3.8 | TIMEOUT (unusable: 100% of the time in frames > 50 ms (best of 3 rounds)) |
| phylocanvas-gl | gtdb-190k | 189801 | - | - | - | - | - | - | - | - | - | - | skipped (skipped: run time cap reached before this tree) |
| phylocanvas-gl | syn-yule-1000000 | 1000000 | 357 | 9710 | 57039 | - | - | - | - | - | - | 1.4 | TIMEOUT (mount: page unresponsive after mount (page.screenshot: Timeout 30000ms exceeded.)) |
| archaeopteryx-js | edge-quoted-labels | 5 | 19 | 10 | 155 | 59.9 | 29.9 | 1.00 | 11 | 15 | 7 | 3.0 | pass |
| archaeopteryx-js | rich-fish-carangaria-135 | 135 | 34 | 10 | 200 | 59.9 | 29.9 | 1.00 | 29 | 6 | 8 | 3.6 | pass |
| archaeopteryx-js | rich-ens-protein-197 | 197 | 14 | 6 | 192 | 59.9 | 29.9 | 1.00 | 56 | 5 | 8 | 4.8* | partial (sluggish: 56 ms CPU per step (load 198 ms, median 59.9 fps, best p5 29.9, dropped 0%, CPU/step 56 ms, click 5 ) |
| archaeopteryx-js | syn-yule-200 | 200 | 11 | 7 | 197 | 59.9 | 29.9 | 1.00 | 30 | 10 | 8 | 4.2* | pass |
| archaeopteryx-js | rich-birdtree-0000 | 380 | 56 | 8 | 203 | 59.9 | 20.0 | 0.67 | 29 | 6 | 8 | 4.2* | pass |
| archaeopteryx-js | rich-corvoid-680 | 680 | 41 | 20 | 251 | 29.9 | 7.5 | 0.25 | 131 | 10 | 9 | 3.9 | TIMEOUT (unusable: 131 ms main-thread CPU per interaction step > 100) |
| archaeopteryx-js | otl-1k | 888 | 20 | 20 | 334 | 20.0 | 4.6 | 0.15 | 185 | 9 | 9 | 4.2* | TIMEOUT (unusable: 64% of the time in frames > 50 ms (best of 3 rounds); 185 ms main-thread CPU per interaction step > ) |
| archaeopteryx-js | syn-caterpillar-1000 | 1000 | 16 | 38 | 335 | 59.9 | 29.9 | 1.00 | 35 | 18 | 9 | 4.5* | pass |
| archaeopteryx-js | syn-yule-1000 | 1000 | 12 | 17 | 277 | 29.9 | 6.0 | 0.20 | 204 | 23 | 10 | 4.4* | TIMEOUT (unusable: 204 ms main-thread CPU per interaction step > 100) |
| archaeopteryx-js | syn-balanced-10000 | 10000 | 23 | 78 | 1487 | 3.0 | 0.4 | 0.01 | 3556 | 278 | 24 | 4.3* | TIMEOUT (unusable: 100% of the time in frames > 50 ms (best of 3 rounds); 3556 ms main-thread CPU per interaction step ) |
| archaeopteryx-js | syn-bushy-10000 | 10000 | 26 | 61 | 954 | 2.3 | 0.4 | 0.01 | 2016 | 14 | 21 | 4.3* | TIMEOUT (unusable: 100% of the time in frames > 50 ms (best of 3 rounds); 2016 ms main-thread CPU per interaction step ) |
| archaeopteryx-js | syn-caterpillar-10000 | 10000 | - | - | - | - | - | - | - | - | - | 4.6* | FAIL (mount: page.evaluate: RangeError: Maximum call stack size exceeded) |
| archaeopteryx-js | syn-yule-10000 | 10000 | 31 | 74 | 1301 | 2.6 | 0.3 | 0.01 | 2277 | 32 | 23 | 3.9 | TIMEOUT (unusable: 100% of the time in frames > 50 ms (best of 3 rounds); 2277 ms main-thread CPU per interaction step ) |
| archaeopteryx-js | otl-10k | 10018 | 24 | 61 | 1227 | 59.9 | 6.0 | 0.20 | 165 | 12 | 18 | 5.3* | TIMEOUT (unusable: 165 ms main-thread CPU per interaction step > 100) |
| archaeopteryx-js | gtdb-10k | 10122 | 31 | 100 | 1714 | 30.0 | 2.9 | 0.10 | 291 | 21 | 26 | 3.5 | TIMEOUT (unusable: 67% of the time in frames > 50 ms (best of 3 rounds); 291 ms main-thread CPU per interaction step > ) |
| archaeopteryx-js | edge-caterpillar-20000 | 20000 | - | - | - | - | - | - | - | - | - | 3.9 | FAIL (mount: page.evaluate: RangeError: Maximum call stack size exceeded) |
| archaeopteryx-js | otl-91k | 90938 | - | - | - | - | - | - | - | - | - | - | skipped (skipped: unusable at 10k (factor 36x the threshold, rule: skip above 20k tips when the 10k rung is more than 1) |
| archaeopteryx-js | gtdb-100k | 100000 | - | - | - | - | - | - | - | - | - | - | skipped (skipped: unusable at 10k (factor 36x the threshold, rule: skip above 20k tips when the 10k rung is more than 1) |
| archaeopteryx-js | syn-yule-100000 | 100000 | - | - | - | - | - | - | - | - | - | - | skipped (skipped: unusable at 10k (factor 36x the threshold, rule: skip above 20k tips when the 10k rung is more than 1) |
| archaeopteryx-js | gtdb-190k | 189801 | - | - | - | - | - | - | - | - | - | - | skipped (skipped: unusable at 10k (factor 36x the threshold, rule: skip above 20k tips when the 10k rung is more than 1) |
| taxonium | edge-quoted-labels | 5 | 21 | 0 | 2505 | 59.9 | 3.0 | 0.10 | 41 | 493 | 20 | 2.2 | TIMEOUT (unusable: 50% of the time in frames > 50 ms (best of 3 rounds); click latency 493 ms > 300 ms) |
| taxonium | rich-fish-carangaria-135 | 135 | 60 | 1 | 2114 | 59.9 | 6.7 | 0.22 | 41 | 337 | 21 | 3.0 | TIMEOUT (unusable: 73% of the time in frames > 50 ms (best of 3 rounds); click latency 337 ms > 300 ms) |
| taxonium | rich-ens-protein-197 | 197 | 45 | 1 | 2565 | 59.9 | 1.9 | 0.06 | 25 | 178 | 21 | 2.9 | TIMEOUT (unusable: 78% of the time in frames > 50 ms (best of 3 rounds)) |
| taxonium | syn-yule-200 | 200 | 11 | 1 | 2210 | 59.9 | 6.0 | 0.20 | 44 | 150 | 21 | 3.6 | TIMEOUT (unusable: 72% of the time in frames > 50 ms (best of 3 rounds)) |
| taxonium | rich-birdtree-0000 | 380 | 41 | 1 | 2080 | 59.9 | 4.0 | 0.13 | 35 | 421 | 22 | 3.8 | TIMEOUT (unusable: 81% of the time in frames > 50 ms (best of 3 rounds); click latency 421 ms > 300 ms) |
| taxonium | rich-corvoid-680 | 680 | 35 | 4 | 2171 | 59.9 | 3.2 | 0.11 | 27 | 550 | 23 | 3.9 | TIMEOUT (unusable: 86% of the time in frames > 50 ms (best of 3 rounds); click latency 550 ms > 300 ms) |
| taxonium | otl-1k | 888 | 50 | 3 | 2260 | 59.5 | 1.5 | 0.05 | 27 | 683 | 25 | 4.0* | TIMEOUT (unusable: 88% of the time in frames > 50 ms (best of 3 rounds); click latency 683 ms > 300 ms) |
| taxonium | syn-caterpillar-1000 | 1000 | 25 | 4 | 2577 | 44.8 | 1.9 | 0.06 | 33 | 1449 | 25 | 3.5 | TIMEOUT (unusable: 93% of the time in frames > 50 ms (best of 3 rounds); click latency 1449 ms > 300 ms) |
| taxonium | syn-yule-1000 | 1000 | 14 | 4 | 2068 | 59.9 | 1.6 | 0.05 | 26 | 972 | 25 | 3.5 | TIMEOUT (unusable: 90% of the time in frames > 50 ms (best of 3 rounds); click latency 972 ms > 300 ms) |
| taxonium | syn-balanced-10000 | 10000 | 21 | 22 | 1980 | 15.0 | 0.7 | 0.02 | 0 | 1637 | 37 | 4.4* | TIMEOUT (unusable: 98% of the time in frames > 50 ms (best of 3 rounds); click latency 1637 ms > 300 ms) |
| taxonium | syn-bushy-10000 | 10000 | 32 | 27 | 2072 | 29.9 | 1.1 | 0.04 | 24 | 1502 | 31 | 4.3* | TIMEOUT (unusable: 97% of the time in frames > 50 ms (best of 3 rounds); click latency 1502 ms > 300 ms) |
| taxonium | syn-caterpillar-10000 | 10000 | 18 | 19 | 2447 | 30.0 | 0.5 | 0.02 | 69 | 2682 | 42 | 4.6* | TIMEOUT (unusable: 96% of the time in frames > 50 ms (best of 3 rounds); click latency 2682 ms > 300 ms) |
| taxonium | syn-yule-10000 | 10000 | 34 | 32 | 2418 | 20.0 | 0.7 | 0.02 | 81 | 2066 | 40 | 3.9 | TIMEOUT (unusable: 98% of the time in frames > 50 ms (best of 3 rounds); click latency 2066 ms > 300 ms) |
| taxonium | otl-10k | 10018 | 33 | 19 | 2087 | 59.9 | 1.1 | 0.04 | 0 | 1258 | 34 | 3.9 | TIMEOUT (unusable: 94% of the time in frames > 50 ms (best of 3 rounds); click latency 1258 ms > 300 ms) |
| taxonium | gtdb-10k | 10122 | 26 | 22 | 2196 | 30.0 | 0.4 | 0.01 | 0 | 3523 | 50 | 3.9 | TIMEOUT (unusable: 99% of the time in frames > 50 ms (best of 3 rounds); click latency 3523 ms > 300 ms) |
| taxonium | edge-caterpillar-20000 | 20000 | 17 | 34 | 2130 | 37.3 | 0.3 | 0.01 | 67 | 3971 | 51 | 4.2* | TIMEOUT (unusable: 99% of the time in frames > 50 ms (best of 3 rounds); click latency 3971 ms > 300 ms) |
| taxonium | otl-91k | 90938 | - | - | - | - | - | - | - | - | - | - | skipped (skipped: unusable at 10k (factor 12x the threshold, rule: skip above 20k tips when the 10k rung is more than 1) |
| taxonium | gtdb-100k | 100000 | - | - | - | - | - | - | - | - | - | - | skipped (skipped: unusable at 10k (factor 12x the threshold, rule: skip above 20k tips when the 10k rung is more than 1) |
| taxonium | syn-yule-100000 | 100000 | 58 | 169 | 6053 | 40.8 | 0.6 | 0.02 | 0 | 3101 | 117 | 1.7 | TIMEOUT (unusable: 98% of the time in frames > 50 ms (best of 3 rounds); click latency 3101 ms > 300 ms) |
| taxonium | gtdb-190k | 189801 | - | - | - | - | - | - | - | - | - | - | skipped (skipped: unusable at 10k (factor 12x the threshold, rule: skip above 20k tips when the 10k rung is more than 1) |
| taxonium | syn-yule-1000000 | 1000000 | 317 | 2192 | 23521 | 30.0 | 1.1 | 0.04 | 105 | 4617 | 725 | 4.0* | TIMEOUT (unusable: load 25.7 s > 10 s; 97% of the time in frames > 50 ms (best of 3 rounds); 105 ms main-thread CPU per) |
| reactree | edge-quoted-labels | 5 | 13 | 0 | 376 | - | - | - | - | - | - | 2.4 | FAIL (library reports 2 tips, expected 5) |
| reactree | rich-fish-carangaria-135 | 135 | 13 | 0 | 492 | 59.9 | 59.5 | 1.98 | 15 | 26 | 6 | 2.4 | pass |
| reactree | rich-ens-protein-197 | 197 | 15 | 0 | 562 | 59.9 | 29.9 | 1.00 | 20 | 30 | 6 | 2.6 | pass |
| reactree | syn-yule-200 | 200 | 25 | 0 | 591 | 59.9 | 59.9 | 1.99 | 20 | 43 | 6 | 2.4 | pass |
| reactree | rich-birdtree-0000 | 380 | 44 | 0 | 688 | 59.9 | 29.9 | 1.00 | 37 | 55 | 7 | 2.1 | pass |
| reactree | rich-corvoid-680 | 680 | 38 | 0 | 913 | 59.9 | 15.0 | 0.50 | 53 | 87 | 9 | 2.4 | partial (sluggish: 53 ms CPU per step (load 913 ms, median 59.9 fps, best p5 15.0, dropped 9%, CPU/step 53 ms, click 87) |
| reactree | otl-1k | 888 | 20 | 0 | 1129 | 59.9 | 10.0 | 0.33 | 49 | 105 | 9 | 2.3 | partial (sluggish: 28% of the time in frames > 50 ms (load 1129 ms, median 59.9 fps, best p5 10.0, dropped 28%, CPU/ste) |
| reactree | syn-caterpillar-1000 | 1000 | 12 | 0 | 1679 | 59.9 | 12.0 | 0.40 | 106 | 197 | 30 | 1.9 | TIMEOUT (unusable: 106 ms main-thread CPU per interaction step > 100) |
| reactree | syn-yule-1000 | 1000 | 14 | 0 | 1773 | 59.9 | 10.0 | 0.33 | 89 | 124 | 11 | 2.3 | partial (sluggish: 49% of the time in frames > 50 ms; 89 ms CPU per step (load 1773 ms, median 59.9 fps, best p5 10.0, ) |
| reactree | syn-balanced-10000 | 10000 | 20 | 0 | 60339 | - | - | - | - | - | - | 1.8 | TIMEOUT (load 60.3 s > 10 s; interaction measures skipped) |
| reactree | syn-bushy-10000 | 10000 | 16 | 0 | 9214 | 29.9 | 1.5 | 0.05 | 414 | 1021 | 44 | 1.4 | TIMEOUT (unusable: 93% of the time in frames > 50 ms (best of 3 rounds); 414 ms main-thread CPU per interaction step > ) |
| reactree | syn-caterpillar-10000 | 10000 | - | - | - | - | - | - | - | - | - | 1.3 | FAIL (mount: page.evaluate: RangeError: Maximum call stack size exceeded) |
| reactree | syn-yule-10000 | 10000 | 18 | 0 | 46730 | 12.0 | 1.3 | 0.04 | 33 | 1670 | 65 | 1.9 | TIMEOUT (unusable: load 46.7 s > 10 s; 94% of the time in frames > 50 ms (best of 3 rounds); click latency 1670 ms > 30) |
| reactree | otl-10k | 10018 | 41 | 0 | 15454 | 20.0 | 1.2 | 0.04 | 441 | - | 43 | 1.3 | TIMEOUT (unusable: load 15.5 s > 10 s; 95% of the time in frames > 50 ms (best of 3 rounds); 441 ms main-thread CPU per) |
| reactree | gtdb-10k | 10122 | 34 | 0 | 562 | - | - | - | - | - | - | 2.1 | FAIL (library reports 10 tips, expected 10122) |
| reactree | edge-caterpillar-20000 | 20000 | - | - | - | - | - | - | - | - | - | 2.1 | FAIL (mount: page.evaluate: RangeError: Maximum call stack size exceeded) |
| reactree | otl-91k | 90938 | - | - | - | - | - | - | - | - | - | 2.1 | FAIL (mount: page.evaluate: RangeError: Maximum call stack size exceeded) |
| reactree | gtdb-100k | 100000 | 60 | 0 | 1758 | - | - | - | - | - | - | 2.8 | FAIL (library reports 989 tips, expected 100000) |
| reactree | syn-yule-100000 | 100000 | - | - | - | - | - | - | - | - | - | 2.0 | FAIL (mount: page.evaluate: RangeError: Maximum call stack size exceeded) |
| reactree | gtdb-190k | 189801 | 103 | 0 | 2757 | - | - | - | - | - | - | 2.8 | FAIL (library reports 1436 tips, expected 189801) |
| heat-tree | edge-quoted-labels | 5 | - | - | - | - | - | - | - | - | - | 2.9 | FAIL (mount: page.evaluate: Error: Unexpected character at position 61: ',') |
| heat-tree | rich-fish-carangaria-135 | 135 | 16 | 121 | 209 | 59.9 | 29.9 | 1.00 | 16 | 5 | 5 | 2.9 | pass |
| heat-tree | rich-ens-protein-197 | 197 | 11 | 212 | 306 | 59.9 | 29.9 | 1.00 | 18 | 5 | 6 | 2.7 | pass |
| heat-tree | syn-yule-200 | 200 | 25 | 151 | 247 | 59.9 | 30.0 | 1.00 | 20 | 4 | 6 | 2.9 | pass |
| heat-tree | rich-birdtree-0000 | 380 | 48 | 473 | 734 | 59.9 | 29.9 | 1.00 | 30 | 7 | 6 | 2.7 | pass |
| heat-tree | rich-corvoid-680 | 680 | 26 | 567 | 814 | 59.9 | 20.0 | 0.67 | 43 | 10 | 8 | 2.6 | pass |
| heat-tree | otl-1k | 888 | 28 | 1239 | 2205 | 59.9 | 10.0 | 0.33 | 88 | 8 | 9 | 3.3 | partial (sluggish: 42% of the time in frames > 50 ms; 88 ms CPU per step (load 3444 ms, median 59.9 fps, best p5 10.0, ) |
| heat-tree | syn-caterpillar-1000 | 1000 | 15 | 929 | 1272 | 59.9 | 12.0 | 0.40 | 59 | 20 | 10 | 3.0 | partial (sluggish: 23% of the time in frames > 50 ms; 59 ms CPU per step (load 2200 ms, median 59.9 fps, best p5 12.0, ) |
| heat-tree | syn-yule-1000 | 1000 | 15 | 804 | 1166 | 59.9 | 20.0 | 0.66 | 76 | 11 | 10 | 2.5 | partial (sluggish: 76 ms CPU per step (load 1971 ms, median 59.9 fps, best p5 20.0, dropped 10%, CPU/step 76 ms, click ) |
| heat-tree | syn-balanced-10000 | 10000 | 47 | 154081 | 158442 | - | - | - | - | - | - | 1.1 | TIMEOUT (load 312.5 s > 10 s; interaction measures skipped) |
| heat-tree | syn-bushy-10000 | 10000 | 25 | 45409 | 48330 | - | - | - | - | - | - | 1.2 | TIMEOUT (load 93.7 s > 10 s; interaction measures skipped) |
| heat-tree | syn-caterpillar-10000 | 10000 | - | - | - | - | - | - | - | - | - | 1.1 | FAIL (mount: page.evaluate: RangeError: Maximum call stack size exceeded) |
| heat-tree | syn-yule-10000 | 10000 | 23 | 163204 | 166657 | - | - | - | - | - | - | 2.7 | TIMEOUT (load 329.9 s > 10 s; interaction measures skipped) |
| heat-tree | otl-10k | 10018 | 27 | 54077 | 107820 | - | - | - | - | - | - | 1.4 | TIMEOUT (load 161.9 s > 10 s; interaction measures skipped) |
| heat-tree | gtdb-10k | 10122 | 22 | 171072 | 175798 | - | - | - | - | - | - | 1.7 | TIMEOUT (load 346.9 s > 10 s; interaction measures skipped) |
| heat-tree | edge-caterpillar-20000 | 20000 | - | - | - | - | - | - | - | - | - | 1.5 | FAIL (mount: page.evaluate: RangeError: Maximum call stack size exceeded) |
| heat-tree | otl-91k | 90938 | - | - | - | - | - | - | - | - | - | - | skipped (skipped: unusable at 10k (factor 35x the threshold, rule: skip above 20k tips when the 10k rung is more than 1) |
| heat-tree | gtdb-100k | 100000 | - | - | - | - | - | - | - | - | - | - | skipped (skipped: unusable at 10k (factor 35x the threshold, rule: skip above 20k tips when the 10k rung is more than 1) |
| heat-tree | syn-yule-100000 | 100000 | - | - | - | - | - | - | - | - | - | - | skipped (skipped: unusable at 10k (factor 35x the threshold, rule: skip above 20k tips when the 10k rung is more than 1) |
| heat-tree | gtdb-190k | 189801 | - | - | - | - | - | - | - | - | - | - | skipped (skipped: unusable at 10k (factor 35x the threshold, rule: skip above 20k tips when the 10k rung is more than 1) |

Parse ms is what the candidate reports (adapters that use the shared parser report 0; see `sharedParseMs` in the JSON). First render ms is from handing the input to the adapter to two animation frames after it reports ready.

## Calibration and load

| Candidate | Run | Load start / end | Canvas ref: median fps, best p5, CPU ms/step | Stub at 200 tips: median fps, best p5, CPU ms/step | Noisy |
|---|---|---|---|---|---|
| stub | 20261019-114304 | 1.4 / 2.6 (max 4.0) | 357.1, 30.0, 7.0 | 30.0, 20.0, 9.9 | no |
| stub | 20261019-121211 | 1.0 / 0.1 (max 2.9) | 60.2, 29.9, 5.9 | 30.0, 15.0, 10.1 | no |
| custom | 20261019-122251 | 0.4 / 2.5 (max 3.3) | 103.1, 20.0, 7.3 | 30.0, 12.0, 14.2 | no |
| custom | 20261019-123159 | 0.9 / 2.0 (max 2.0) | 60.6, 29.9, 6.8 | 30.0, 15.0, 13.6 | no |
| react-bio-viz | 20261019-123353 | 1.0 / 1.3 (max 3.2) | 83.3, 30.1, 7.2 | 30.0, 15.0, 10.7 | no |
| phylotree-js | 20261019-124844 | 1.0 / 1.6 (max 3.3) | 60.2, 29.9, 6.9 | 30.0, 20.0, 11.4 | no |
| tbrowse | 20261019-132449 | 0.9 / 1.0 (max 3.0) | 63.7, 29.9, 6.8 | 30.0, 15.0, 13.7 | no |
| phylocanvas-gl | 20261019-140329 | 1.0 / 3.7 (max 4.2) | 60.2, 30.0, 7.6 | 30.0, 15.0, 11.9 | no |
| phylocanvas-gl | 20261019-160412 | 0.8 / 4.5 (max 4.5) | 142.9, 30.0, 7.7 | 30.0, 15.0, 13.2 | yes |
| archaeopteryx-js | 20261019-145213 | 1.3 / 4.1 (max 5.3) | 137.0, 30.0, 7.7 | 30.0, 15.0, 12.9 | yes |
| taxonium | 20261019-150710 | 0.9 / 4.1 (max 4.6) | 59.9, 29.9, 6.5 | 30.0, 15.0, 11.0 | yes |
| taxonium | 20261019-160949 | 1.0 / 4.1 (max 4.1) | 59.9, 30.0, 6.2 | 30.0, 15.0, 11.5 | yes |
| reactree | 20261019-153119 | 0.9 / 2.3 (max 2.8) | 60.2, 30.0, 6.0 | 30.0, 20.0, 9.7 | no |
| reactree | 20261019-161830 | 0.8 / 1.1 (max 1.1) | n/a | n/a | no |
| heat-tree | 20261019-154510 | 1.0 / 1.6 (max 3.3) | 232.6, 30.0, 6.3 | 30.0, 20.0, 10.4 | no |

## Details

### stub 0.1.0 (Apache-2.0)

- Runs: 20261019-114304, 20261019-121211; Chromium 141.0.7390.37; GPU: no.
- Bundle (dist/, minified): JS 220 KB (70 KB gzip), CSS 17 KB (4 KB gzip), total 237 KB (75 KB gzip). Includes the shared shell and React.
- **S1 partial**: syn-caterpillar-1000: partial (sluggish: 30% of the time in frames > 50 ms (load 103 ms, median 30.0 fps, best p5 15.0, dropped 30%, CPU/step 35 ms, click 9 ms)); syn-yule-10000: timeout (unusable: 250 ms main-thread CPU per interaction step > 100); syn-caterpillar-10000: timeout (unusable: 192 ms main-thread CPU per interaction step > 100); syn-balanced-10000: timeout (unusable: 71% of the time in frames > 50 ms (best of 3 rounds); 222 ms main-thread CPU per interaction step > 100); syn-bushy-10000: timeout (unusable: 69% of the time in frames > 50 ms (best of 3 rounds); 160 ms main-thread CPU per interaction step > 100); otl-10k: timeout (unusable: 62% of the time in frames > 50 ms (best o
- **S10 TIMEOUT**: syn-yule-100000: no freeze: longest frame gap < 2 s (3300 ms); while zooming out median 59.9 fps, 75% of the time in frames > 50 ms, DOM nodes 400010 (shadow DOM included), canvases 1 (more than half of the time in slow frames); overviewOrMinimap self-report: no
- **S15 partial**: syn-yule-10000, 969-tip clade: all checks passed; click to React commit 52 ms, to paint 170 ms (median of 5) > 120 ms target (spec: about 100 ms)

### custom 0.1.0 (Apache-2.0)

- Runs: 20261019-122251, 20261019-123159; Chromium 141.0.7390.37; GPU: no.
- Bundle (dist/, minified): JS 267 KB (87 KB gzip), CSS 17 KB (4 KB gzip), total 284 KB (91 KB gzip). Includes the shared shell and React.
- **S3 partial**: syn-yule-1000: tip sets correct but computed by the adapter (source=adapter-derived), not delivered by the library

### react-bio-viz 0.3.0 (MIT)

- Runs: 20261019-123353; Chromium 141.0.7390.37; GPU: no.
- Bundle (dist/, minified): JS 408 KB (133 KB gzip), CSS 17 KB (4 KB gzip), total 426 KB (137 KB gzip). Includes the shared shell and React.
- **S1 partial**: syn-yule-10000: timeout (unusable: 87% of the time in frames > 50 ms (best of 3 rounds); 212 ms main-thread CPU per interaction step > 100; click latency 415 ms > 300 ms); syn-caterpillar-10000: fail (mount: page.evaluate: RangeError: Maximum call stack size exceeded); syn-balanced-10000: timeout (unusable: 82% of the time in frames > 50 ms (best of 3 rounds); 244 ms main-thread CPU per interaction step > 100; click latency 314 ms > 300 ms); syn-bushy-10000: timeout (unusable: 76% of the time in frames > 50 ms (best of 3 rounds); 244 ms main-thread CPU per interaction step > 100); otl-10k: timeout (unusable: 65% of the time in frames > 50 ms (best of 3 rounds)); gtdb-10k: timeout (unusable: 
- **S10 n/a**: gtdb-10k: wheel zoom-in did not change the view (whole tree stays at the same size and position, so a zoom-out cannot be tested; the viewer may pan or scroll instead of zooming with a plain wheel)
- **S14 partial**: at least one tip-level target (named like a tip) is reachable by Tab (only container-level targets (for example one canvas)); tips were not focusable at the fit view, only after focusTip
- **S15 TIMEOUT**: syn-yule-10000, 969-tip clade: all checks passed; click to React commit 932 ms, to paint 1610 ms (median of 5) > 300 ms (unusable)

### phylotree-js 2.6.0 (MIT (LICENSE file; package.json has no license field))

- Runs: 20261019-124844; Chromium 141.0.7390.37; GPU: no.
- Bundle (dist/, minified): JS 537 KB (177 KB gzip), CSS 17 KB (4 KB gzip), total 555 KB (182 KB gzip). Includes the shared shell and React.
- **S1 partial**: rich-corvoid-680: partial (sluggish: 59 ms CPU per step (load 301 ms, median 59.9 fps, best p5 20.0, dropped 6%, CPU/step 59 ms, click 58 ms)); otl-1k: partial (sluggish: 70 ms CPU per step (load 361 ms, median 59.9 fps, best p5 12.0, dropped 17%, CPU/step 70 ms, click 68 ms)); syn-yule-1000: partial (sluggish: 81 ms CPU per step (load 333 ms, median 59.9 fps, best p5 20.0, dropped 4%, CPU/step 81 ms, click 57 ms)); syn-yule-10000: timeout (unusable: 79% of the time in frames > 50 ms (best of 3 rounds); 610 ms main-thread CPU per interaction step > 100; click latency 597 ms > 300 ms); syn-caterpillar-10000: fail (mount: page.evaluate: Error: phylotree.render() failed: Maximum call stack size
- **S3 partial**: syn-yule-1000: tip sets correct but computed by the adapter (source=adapter-derived), not delivered by the library
- **S10 TIMEOUT**: syn-yule-100000: no freeze: longest frame gap < 2 s (3483 ms); while zooming out median 59.9 fps, 97% of the time in frames > 50 ms, DOM nodes 900034 (shadow DOM included), canvases 0 (more than half of the time in slow frames); overviewOrMinimap self-report: no
- **S14 partial**: at least one tip-level target (named like a tip) is reachable by Tab (only container-level targets (for example one canvas)); tips were not focusable at the fit view, only after focusTip
- **S15 TIMEOUT**: syn-yule-10000, 969-tip clade: all checks passed; click to React commit 916 ms, to paint 1183 ms (median of 5) > 300 ms (unusable)

### tbrowse 2.10.0 (MIT)

- Runs: 20261019-132449; Chromium 141.0.7390.37; GPU: no.
- Bundle (dist/, minified): JS 358 KB (113 KB gzip), CSS 17 KB (4 KB gzip), total 376 KB (118 KB gzip). Includes the shared shell and React.
- **S1 partial**: syn-yule-10000: timeout (unusable: 89% of the time in frames > 50 ms (best of 3 rounds)); syn-caterpillar-10000: fail (mount: page.evaluate: RangeError: Maximum call stack size exceeded); syn-balanced-10000: timeout (unusable: 97% of the time in frames > 50 ms (best of 3 rounds); 890 ms main-thread CPU per interaction step > 100; click latency 344 ms > 300 ms); syn-bushy-10000: timeout (unusable: 97% of the time in frames > 50 ms (best of 3 rounds); 517 ms main-thread CPU per interaction step > 100); otl-10k: timeout (unusable: 88% of the time in frames > 50 ms (best of 3 rounds); 288 ms main-thread CPU per interaction step > 100); gtdb-10k: timeout (unusable: 96% of the time in frames > 50 
- **S3 partial**: syn-yule-1000: tip sets correct but computed by the adapter (source=adapter-derived), not delivered by the library
- **S10 n/a**: gtdb-10k: wheel zoom-in did not change the view (whole tree stays at the same size and position, so a zoom-out cannot be tested; the viewer may pan or scroll instead of zooming with a plain wheel)
- **S12 unsupported**: adapter reports radialLayout=no: rectangular phylogram/cladogram only (TreeZoneState.layoutMode)
- **S15 TIMEOUT**: syn-yule-10000, 969-tip clade: all checks passed; click to React commit 491 ms, to paint 505 ms (median of 5) > 300 ms (unusable)

### phylocanvas-gl 1.64.1 (MIT)

- Runs: 20261019-140329, 20261019-160412; Chromium 141.0.7390.37; GPU: no.
- Bundle (dist/, minified): JS 1006 KB (295 KB gzip), CSS 17 KB (4 KB gzip), total 1024 KB (299 KB gzip). Includes the shared shell and React.
- **S1 partial**: rich-fish-carangaria-135: timeout (unusable: 85% of the time in frames > 50 ms (best of 3 rounds)); rich-ens-protein-197: timeout (unusable: 84% of the time in frames > 50 ms (best of 3 rounds)); syn-yule-200: timeout (unusable: 86% of the time in frames > 50 ms (best of 3 rounds)); rich-birdtree-0000: timeout (unusable: 90% of the time in frames > 50 ms (best of 3 rounds)); rich-corvoid-680: timeout (unusable: 93% of the time in frames > 50 ms (best of 3 rounds)); otl-1k: timeout (unusable: 93% of the time in frames > 50 ms (best of 3 rounds)); syn-yule-1000: timeout (unusable: 94% of the time in frames > 50 ms (best of 3 rounds)); syn-caterpillar-1000: timeout (unusable: 97% of the time in
- **S3 partial**: syn-yule-1000: tip sets correct but computed by the adapter (source=adapter-derived), not delivered by the library
- **S10 TIMEOUT**: syn-yule-100000: no freeze: longest frame gap < 2 s (9666 ms); while zooming out median 0.1 fps, 100% of the time in frames > 50 ms, DOM nodes 6 (shadow DOM included), canvases 1 (more than half of the time in slow frames); overviewOrMinimap self-report: no
- **S15 partial**: syn-yule-10000, 969-tip clade: all checks passed; click to React commit 48 ms, to paint 187 ms (median of 5) > 120 ms target (spec: about 100 ms)

### archaeopteryx-js 3.24.0 (LGPL-3.0-or-later)

- Runs: 20261019-145213; Chromium 141.0.7390.37; GPU: no.
- Bundle (dist/, minified): JS 984 KB (325 KB gzip), CSS 17 KB (4 KB gzip), total 1002 KB (330 KB gzip). Includes the shared shell and React.
- **S1 partial**: rich-ens-protein-197: partial (sluggish: 56 ms CPU per step (load 198 ms, median 59.9 fps, best p5 29.9, dropped 0%, CPU/step 56 ms, click 5 ms)); rich-corvoid-680: timeout (unusable: 131 ms main-thread CPU per interaction step > 100); otl-1k: timeout (unusable: 64% of the time in frames > 50 ms (best of 3 rounds); 185 ms main-thread CPU per interaction step > 100); syn-yule-1000: timeout (unusable: 204 ms main-thread CPU per interaction step > 100); syn-yule-10000: timeout (unusable: 100% of the time in frames > 50 ms (best of 3 rounds); 2277 ms main-thread CPU per interaction step > 100); syn-caterpillar-10000: fail (mount: page.evaluate: RangeError: Maximum call stack size exceeded); syn-
- **S3 partial**: syn-yule-1000: tip sets correct but computed by the adapter (source=adapter-derived), not delivered by the library
- **S7 partial**: syn-yule-1000, column occ (kind bar): after zoom and pan: at least 5 tips with a drawn cell (0 of 226 on-screen tips have a cell); after zoom and pan: cell centre within 2px of tip row (0/0 aligned, max dy 0.0px) [n/a: bar width follows value (only 0 cells on screen)]
- **S10 partial**: gtdb-10k: all checks passed; while zooming out median 59.9 fps, 82% of the time in frames > 50 ms, DOM nodes 515 (shadow DOM included), canvases 0 (more than half of the time in slow frames); overviewOrMinimap self-report: yes
- **S13 FAIL**: both instances draw something (ink 0.00% / 14.83%); instance 0 tip locatable; instance 1 survives unmounting instance 0; adapter self-report: multipleInstances=no
- **S14 partial**: at least one tip-level target (named like a tip) is reachable by Tab (only container-level targets (for example one canvas)); tips were not focusable at the fit view, only after focusTip
- **S15 partial**: syn-yule-10000, 969-tip clade: all checks passed; click to React commit 29 ms, to paint 170 ms (median of 5) > 120 ms target (spec: about 100 ms)

### taxonium 2.1.24 (GPL-3.0)

- Runs: 20261019-150710, 20261019-160949; Chromium 141.0.7390.37; GPU: no.
- Bundle (dist/, minified): JS 9072 KB (2794 KB gzip), CSS 17 KB (4 KB gzip), total 9090 KB (2799 KB gzip). Includes the shared shell and React.
- **S1 TIMEOUT**: edge-quoted-labels: timeout (unusable: 50% of the time in frames > 50 ms (best of 3 rounds); click latency 493 ms > 300 ms); rich-fish-carangaria-135: timeout (unusable: 73% of the time in frames > 50 ms (best of 3 rounds); click latency 337 ms > 300 ms); rich-ens-protein-197: timeout (unusable: 78% of the time in frames > 50 ms (best of 3 rounds)); syn-yule-200: timeout (unusable: 72% of the time in frames > 50 ms (best of 3 rounds)); rich-birdtree-0000: timeout (unusable: 81% of the time in frames > 50 ms (best of 3 rounds); click latency 421 ms > 300 ms); rich-corvoid-680: timeout (unusable: 86% of the time in frames > 50 ms (best of 3 rounds); click latency 550 ms > 300 ms); otl-1k: time
- **S3 partial**: syn-yule-1000: tip sets correct but computed by the adapter (source=adapter-derived), not delivered by the library
- **S7 unsupported**: adapter reports customColumns=no: No aligned per-tip columns. Metadata TSV columns only appear in the hover tooltip, the side panel and as a colour-by field
- **S8 unsupported**: adapter reports alignmentColumn=no: No alignment column (the JBrowse panel is for mutation-annotated trees of the Treenome kind, not for sequences from a FASTA)
- **S10 TIMEOUT**: edge-caterpillar-20000: no freeze: longest frame gap < 2 s (2883 ms); while zooming out median 59.9 fps, 96% of the time in frames > 50 ms, DOM nodes 89 (shadow DOM included), canvases 1 (more than half of the time in slow frames); overviewOrMinimap self-report: yes
- **S12 unsupported**: adapter reports radialLayout=no: Rectangular only: the layers are horizontal and vertical lines on an orthographic view (useLayers.tsx)
- **S13 FAIL**: click in instance 0 reaches only instance 0 (events 0/0); adapter self-report: multipleInstances=no
- **S14 partial**: Tab reaches at least 3 DISTINCT focusable elements inside the tree (2 distinct elements (div, button)); at least one tip-level target (named like a tip) is reachable by Tab (only container-level targets (for example one canvas)); focusable elements have accessible names (0/2 named); tips were not focusable at the fit view, only after focusTip
- **S15 TIMEOUT**: syn-yule-10000, 969-tip clade: all checks passed; click to React commit 1513 ms, to paint 3698 ms (median of 5) > 300 ms (unusable)

### reactree 1.0.3 (MIT)

- Runs: 20261019-153119, 20261019-161830; Chromium 141.0.7390.37; GPU: no.
- Bundle (dist/, minified): JS 1115 KB (346 KB gzip), CSS 49 KB (9 KB gzip), total 1164 KB (355 KB gzip). Includes the shared shell and React.
- **S1 partial**: edge-quoted-labels: fail (library reports 2 tips, expected 5); rich-corvoid-680: partial (sluggish: 53 ms CPU per step (load 913 ms, median 59.9 fps, best p5 15.0, dropped 9%, CPU/step 53 ms, click 87 ms)); otl-1k: partial (sluggish: 28% of the time in frames > 50 ms (load 1129 ms, median 59.9 fps, best p5 10.0, dropped 28%, CPU/step 49 ms, click 105 ms)); syn-yule-1000: partial (sluggish: 49% of the time in frames > 50 ms; 89 ms CPU per step (load 1773 ms, median 59.9 fps, best p5 10.0, dropped 49%, CPU/step 89 ms, click 124 ms)); syn-caterpillar-1000: timeout (unusable: 106 ms main-thread CPU per interaction step > 100); syn-yule-10000: timeout (unusable: load 46.7 s > 10 s; 94% of the tim
- **S3 partial**: syn-yule-1000: tip sets correct but computed by the adapter (source=adapter-derived), not delivered by the library
- **S4 partial**: syn-yule-1000: no layout change when colouring (6 probe tips compared)
- **S7 partial**: syn-yule-1000, column aln (kind alignment: the library cannot draw bars, tested with its supported kind): all checks passed
- **S8 partial**: rich-ens-protein-197: cell is actually painted (pixels change when the column is removed) (5% of the cell rect changes); alignment cell shows several residue colours (2 colour groups)
- **S10 n/a**: gtdb-10k: wheel zoom-in did not change the view (whole tree stays at the same size and position, so a zoom-out cannot be tested; the viewer may pan or scroll instead of zooming with a plain wheel)
- **S12 FAIL**: syn-yule-1000 radial: radial S2: tipClick event for Domefaodon_paraborealis (got tipClick n294); radial S2: tipIds=[tip] for Domefaodon_paraborealis (["Vukarea_meganigra"]); radial S2: React last-event shows tip Domefaodon_paraborealis (tipClick n294 tips=1 source=adapter-derived); radial S2: metadata row shown for Domefaodon_paraborealis (Vukarea_meganigra: occurrence_count=188 country_code=US trait_value=5.4655); radial S2: tipClick event for Cherikoina_megagracilis (got tipClick n900); radial S2: tipIds=[tip] for Cherikoina_megagracilis (["Magogoella_microrobusta"]); radial S2: React last-event shows tip Cherikoina_megagracilis (tipClick n900 tips=1 source=adapter-derived); radial S2: met
- **S14 partial**: at least one tip-level target (named like a tip) is reachable by Tab (only container-level targets (for example one canvas)); tree container exposes a role/label or a text fallback ({"roles":[],"labelled":false,"textFallback":false}); tips were not focusable at the fit view, only after focusTip
- **S15 TIMEOUT**: syn-yule-1000, 305-tip clade (fallback tree: fallback: syn-yule-10000 did not mount within 10 s in S1 (timeout, load 46.7 s)): all checks passed; click to React commit 213 ms, to paint 705 ms (median of 5) > 300 ms (unusable)

### heat-tree 0.3.1 (MIT (declared; no LICENSE file in tarball))

- Runs: 20261019-154510; Chromium 141.0.7390.37; GPU: no.
- Bundle (dist/, minified): JS 401 KB (123 KB gzip), CSS 17 KB (4 KB gzip), total 419 KB (128 KB gzip). Includes the shared shell and React.
- **S1 partial**: edge-quoted-labels: fail (mount: page.evaluate: Error: Unexpected character at position 61: ','); otl-1k: partial (sluggish: 42% of the time in frames > 50 ms; 88 ms CPU per step (load 3444 ms, median 59.9 fps, best p5 10.0, dropped 42%, CPU/step 88 ms, click 8 ms)); syn-yule-1000: partial (sluggish: 76 ms CPU per step (load 1971 ms, median 59.9 fps, best p5 20.0, dropped 10%, CPU/step 76 ms, click 11 ms)); syn-caterpillar-1000: partial (sluggish: 23% of the time in frames > 50 ms; 59 ms CPU per step (load 2200 ms, median 59.9 fps, best p5 12.0, dropped 23%, CPU/step 59 ms, click 20 ms)); syn-yule-10000: timeout (load 329.9 s > 10 s; interaction measures skipped); syn-caterpillar-10000: fail
- **S3 partial**: syn-yule-1000: tip sets correct but computed by the adapter (source=adapter-derived), not delivered by the library
- **S7 partial**: syn-yule-1000, column country (kind text: the library cannot draw bars, tested with its supported kind): all checks passed
- **S8 unsupported**: adapter reports alignmentColumn=no: No sequence or alignment rendering; only label colour, size, font, style and text can be mapped to metadata.
- **S10 n/a**: syn-bushy-10000: wheel zoom-in did not change the view (whole tree stays at the same size and position, so a zoom-out cannot be tested; the viewer may pan or scroll instead of zooming with a plain wheel)
- **S14 partial**: Tab reaches at least 3 DISTINCT focusable elements inside the tree (1 distinct elements (div)); at least one tip-level target (named like a tip) is reachable by Tab (only container-level targets (for example one canvas)); focusable elements have accessible names (0/1 named); tips were not focusable at the fit view, only after focusTip

