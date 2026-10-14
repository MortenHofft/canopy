# Spike results summary

Generated 2026-10-14T14:35:38.758Z by `node spikes/runner/report.mjs` from `spikes/results/*/*.json`. For every scenario (and every S1 tree) the latest run that contains it is used. All numbers are **M** (measured) in headless Chromium **without a GPU** (SwiftShader), so canvas and WebGL FPS are pessimistic; get final scale numbers on a real laptop.

## Scenario matrix

| Candidate | S1 | S2 | S3 | S4 | S5 | S6 | S7 | S8 | S9 | S10 | S11 | S12 | S13 | S14 | S15 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| stub 0.1.0 | partial | pass | pass | pass | pass | pass | pass | pass | pass | TIMEOUT | pass | pass | pass | pass | pass |

pass = all checks passed; partial = works with a workaround or only some checks pass; FAIL = checks failed; unsupported = adapter reports `no`; TIMEOUT = threshold exceeded (load > 10 s, p5 FPS < 20, click latency > 300 ms) or the scenario hung; `-` = not run. Titles: S1 Load and fit to screen (scale ladder); S2 Click a tip; S3 Click an internal node; S4 Colour clades from React state; S5 Highlight and focus a tip; S6 Tip label as a link; S7 Custom column (bar) aligned to tips; S8 Alignment column; S9 Theming (dark, tokens); S10 Zoom out to the whole tree; S11 Phylogram / cladogram; S12 Radial layout; S13 Two instances, mount/unmount x5; S14 Keyboard and screen reader; S15 Linked view (click clade, colour, map panel).

## Scale table (S1)

| Candidate | Tree | Tips | Fetch ms | Parse ms | First render ms | Median fps | p5 fps | Click ms | Heap MB | Status |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| stub | edge-quoted-labels | 5 | 18 | 0 | 24 | 59.5 | 20.0 | 2 | 4 | pass |
| stub | syn-yule-200 | 200 | 16 | 0 | 39 | 59.9 | 20.0 | 2 | 4 | pass |
| stub | otl-1k | 888 | 27 | 0 | 67 | 59.9 | 20.0 | 4 | 5 | pass |
| stub | syn-yule-1000 | 1000 | 12 | 0 | 76 | 59.9 | 20.0 | 4 | 5 | pass |
| stub | syn-yule-10000 | 10000 | 21 | 0 | 622 | 59.9 | 2.4 | 39 | 16 | TIMEOUT (unusable: p5 fps 2.4 < 20) |
| stub | otl-10k | 10018 | 24 | 0 | 551 | 59.9 | 2.9 | 27 | 11 | TIMEOUT (unusable: p5 fps 2.9 < 20) |
| stub | gtdb-10k | 10122 | 20 | 0 | 531 | 59.9 | 1.3 | 27 | 14 | TIMEOUT (unusable: p5 fps 1.3 < 20) |
| stub | otl-91k | 90938 | 64 | 0 | 3761 | 59.9 | 0.9 | 207 | 78 | TIMEOUT (unusable: p5 fps 0.9 < 20) |
| stub | syn-yule-100000 | 100000 | 57 | 0 | 6214 | 59.9 | 0.3 | 380 | 108 | TIMEOUT (unusable: p5 fps 0.3 < 20; click latency 380 ms > 300 ms) |
| stub | gtdb-100k | 100000 | 51 | 0 | 6232 | 59.9 | 0.2 | 287 | 113 | TIMEOUT (unusable: p5 fps 0.2 < 20) |
| stub | gtdb-190k | 189801 | 119 | 0 | 18925 | 0.4 | 0.1 | 953 | 214 | TIMEOUT (unusable: load 18.9 s > 10 s; p5 fps 0.1 < 20; click latency 953 ms > 300 ms) |

Parse ms is what the candidate reports (the stub reports 0 and uses the shared parser; see `sharedParseMs` in the JSON). First render ms is from handing the input to the adapter to two animation frames after it reports ready.

## Details

### stub 0.1.0 (Apache-2.0)

- Runs: 20261014-142419, 20261014-142618, 20261014-142644, 20261014-143455; Chromium 141.0.7390.37; GPU: no.
- Bundle (dist/, minified): JS 217 KB (70 KB gzip), CSS 17 KB (4 KB gzip), total 234 KB (74 KB gzip). Includes the shared shell and React.
- **S1 partial**: syn-yule-10000: timeout (unusable: p5 fps 2.4 < 20); otl-10k: timeout (unusable: p5 fps 2.9 < 20); gtdb-10k: timeout (unusable: p5 fps 1.3 < 20); otl-91k: timeout (unusable: p5 fps 0.9 < 20); syn-yule-100000: timeout (unusable: p5 fps 0.3 < 20; click latency 380 ms > 300 ms); gtdb-100k: timeout (unusable: p5 fps 0.2 < 20); gtdb-190k: timeout (unusable: load 18.9 s > 10 s; p5 fps 0.1 < 20; click latency 953 ms > 300 ms)
- **S10 TIMEOUT**: syn-yule-100000: no freeze: longest frame gap < 2 s (3950 ms); p5 0.3 fps, median 59.9 fps, DOM nodes 400010, canvases 1 (p5 < 20 fps while zooming out); overviewOrMinimap self-report: no

