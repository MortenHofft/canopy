# Spike results summary

Generated 2026-10-14T14:13:10.782Z by `node spikes/runner/report.mjs` from `spikes/results/*/*.json`. For every scenario (and every S1 tree) the latest run that contains it is used. All numbers are **M** (measured) in headless Chromium **without a GPU** (SwiftShader), so canvas and WebGL FPS are pessimistic; get final scale numbers on a real laptop.

## Scenario matrix

| Candidate | S1 | S2 | S3 | S4 | S5 | S6 | S7 | S8 | S9 | S10 | S11 | S12 | S13 | S14 | S15 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| stub 0.1.0 | partial | pass | pass | pass | pass | pass | pass | pass | pass | TIMEOUT | pass | pass | partial | pass | pass |

pass = all checks passed; partial = works with a workaround or only some checks pass; FAIL = checks failed; unsupported = adapter reports `no`; TIMEOUT = threshold exceeded (load > 10 s, p5 FPS < 20, click latency > 300 ms) or the scenario hung; `-` = not run. Titles: S1 Load and fit to screen (scale ladder); S2 Click a tip; S3 Click an internal node; S4 Colour clades from React state; S5 Highlight and focus a tip; S6 Tip label as a link; S7 Custom column (bar) aligned to tips; S8 Alignment column; S9 Theming (dark, tokens); S10 Zoom out to the whole tree; S11 Phylogram / cladogram; S12 Radial layout; S13 Two instances, mount/unmount x5; S14 Keyboard and screen reader; S15 Linked view (click clade, colour, map panel).

## Scale table (S1)

| Candidate | Tree | Tips | Fetch ms | Parse ms | First render ms | Median fps | p5 fps | Click ms | Heap MB | Status |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| stub | edge-quoted-labels | 5 | 10 | 0 | 34 | 59.9 | 29.9 | 2 | 3 | pass |
| stub | syn-yule-200 | 200 | 13 | 0 | 59 | 59.9 | 29.9 | 2 | 4 | pass |
| stub | otl-1k | 888 | 21 | 0 | 72 | 59.9 | 20.0 | 4 | 4 | pass |
| stub | syn-yule-1000 | 1000 | 15 | 0 | 89 | 59.9 | 20.0 | 4 | 5 | pass |
| stub | syn-yule-10000 | 10000 | 33 | 0 | 749 | 59.9 | 3.3 | 33 | 15 | TIMEOUT (unusable: p5 fps 3.3 < 20) |
| stub | otl-10k | 10018 | 28 | 0 | 602 | 59.9 | 5.0 | 20 | 11 | TIMEOUT (unusable: p5 fps 5.0 < 20) |
| stub | gtdb-10k | 10122 | 29 | 0 | 603 | 59.9 | 3.2 | 33 | 14 | TIMEOUT (unusable: p5 fps 3.2 < 20) |
| stub | otl-91k | 90938 | 90 | 0 | 8799 | 59.9 | 59.5 | 224 | 78 | pass |
| stub | syn-yule-100000 | 100000 | 43 | 0 | 7633 | 59.9 | 59.5 | 312 | 108 | TIMEOUT (unusable: click latency 312 ms > 300 ms) |
| stub | gtdb-100k | 100000 | 60 | 0 | 7044 | 59.9 | 7.5 | 422 | 113 | TIMEOUT (unusable: p5 fps 7.5 < 20; click latency 422 ms > 300 ms) |
| stub | gtdb-190k | 189801 | 81 | 0 | 18404 | 59.9 | 59.5 | 806 | 213 | TIMEOUT (unusable: load 18.4 s > 10 s; click latency 806 ms > 300 ms) |

Parse ms is what the candidate reports (the stub reports 0 and uses the shared parser; see `sharedParseMs` in the JSON). First render ms is from handing the input to the adapter to two animation frames after it reports ready.

## Details

### stub 0.1.0 (Apache-2.0)

- Runs: 20261014-135808, 20261014-140507, 20261014-140750; Chromium 141.0.7390.37; GPU: no.
- Bundle (dist/, minified): JS 199 KB (64 KB gzip), CSS 17 KB (4 KB gzip), total 216 KB (69 KB gzip). Includes the shared shell and React.
- **S1 partial**: syn-yule-10000: timeout (unusable: p5 fps 3.3 < 20); otl-10k: timeout (unusable: p5 fps 5.0 < 20); gtdb-10k: timeout (unusable: p5 fps 3.2 < 20); syn-yule-100000: timeout (unusable: click latency 312 ms > 300 ms); gtdb-100k: timeout (unusable: p5 fps 7.5 < 20; click latency 422 ms > 300 ms); gtdb-190k: timeout (unusable: load 18.4 s > 10 s; click latency 806 ms > 300 ms)
- **S10 TIMEOUT**: syn-yule-100000: no freeze: longest frame gap < 2 s (3467 ms); p5 59.5 fps, median 59.9 fps, DOM nodes 400010, canvases 1; overviewOrMinimap self-report: no
- **S13 partial**: no page errors (console.error: Failed to load resource: net::ERR_FAILED)

