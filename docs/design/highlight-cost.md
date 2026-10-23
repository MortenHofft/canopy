# What highlighting many tips costs (#58)

Measured 2026-10-22 to decide whether search highlights need a cap. Script: `tests/browser/bench/highlight-bench.mjs` (usage in its header),
against the built test page. Tree: the full OTL synthesis tree, `otl-2m-full.nwk.gz` (2,385,875 tips; see `data/real-ladder/README.md`),
in a 1100 × 640 px viewer. The matches are spread evenly over the tips (every k-th rank), so at the fit view they are all in view, which is
the worst case for drawing.

**Environment.** Headless Chromium 1194 in a cloud sandbox with no GPU (SwiftShader; canvas rasterised in software). The times are the JS
time of the calls, measured with `performance.now()` around `setHighlighted` and around `renderNow()` / `benchmark()`; the raster is not
included, or only partly when Chromium flushes inside a call. So the numbers compare highlight counts with each other and with no
highlights, and before with after; they are not frame rates. A real browser with a GPU will differ (**unverified** how much).

Columns:

- **set**: `setHighlighted(ids)`: resolve ids or labels to ranks, sort, the per-tip flags.
- **next**: the next frame (`renderNow`); with dimming it builds the O(tips) prefix.
- **fit**: a frame redrawn with the highlights unchanged at the fit view (mean of 5), what every pan or zoom frame costs.
- **zoomed**: the same, zoomed in on the middle tip (`focusTip`).

## Before: one band and one ring per match

Node ids, `highlightStyle: 'band'` (the library default), ms:

| layout      | matches | set  | next   | fit    |
| ----------- | ------: | ---: | -----: | -----: |
| rectangular | 0       | 0    | 0      | 9      |
| rectangular | 10k     | 7.6  | 21     | 105    |
| rectangular | 100k    | 22   | 905    | 898    |
| rectangular | 1M      | 95   | 9,168  | 9,351  |
| radial      | 10k     | 6.9  | 16     | 211    |
| radial      | 100k    | 13   | 1,486  | 1,880  |
| radial      | 1M      | 76   | 18,387 | 18,246 |

`drawHighlights` drew a `fillRect` and an `arc` + `stroke` (radial: a ray and a ring) for every match whose row is in view, and at the fit
view of a large tree every row is in view: about 9 µs per match rectangular, 18 µs radial, almost all of it canvas calls for pixels already
painted. Zoomed in, the cost was only the loop over the matches (rectangular 20 ms at 1M). Even the explorer's old 5,000 cap meant about
50 ms per frame in band style. `'dim'` was cheap at every count (below).

## After: bounded by pixels

The bands are merged where they overlap (one `fillRect` per run of rows under 3 px apart), only the matches on rows in view are visited
(binary search, rectangular), a ring within a pixel of the one before is skipped and the rings are stroked as one path, a radial ray within
a pixel of the one before and no wider is skipped. The overview marks every match once per pixel (it marked the first 2,000 ranks). The
ranks are sorted as an `Int32Array`.

| layout      | style | ids or labels | matches | set   | next | fit  | zoomed |
| ----------- | ----- | ------------- | ------: | ----: | ---: | ---: | -----: |
| rectangular | band  | ids           | 0       | 0     | 0    | 8.8  | 0.6    |
| rectangular | band  | ids           | 10k     | 6.6   | 14   | 8.2  | 0.5    |
| rectangular | band  | ids           | 100k    | 20    | 18   | 15   | 0.5    |
| rectangular | band  | ids           | 1M      | 88    | 30   | 30   | 0.4    |
| rectangular | band  | labels        | 100k    | 52    | 17   | 12   | 0.3    |
| rectangular | band  | labels        | 1M      | 338   | 28   | 26   | 0.3    |
| rectangular | dim   | ids           | 1M      | 51    | 18   | 6.5  | 0.3    |
| rectangular | dim   | labels        | 1M      | 325   | 17   | 6.1  | 0.3    |
| radial      | band  | ids           | 0       | 0     | 0    | 7.8  | 1.1    |
| radial      | band  | ids           | 10k     | 8.6   | 20   | 12   | 2.7    |
| radial      | band  | ids           | 100k    | 8.7   | 30   | 26   | 9.3    |
| radial      | band  | ids           | 1M      | 33    | 69   | 69   | 26     |
| radial      | band  | labels        | 1M      | 219   | 66   | 66   | 26     |
| radial      | dim   | ids           | 1M      | 34    | 18   | 6.8  | 1.1    |

A selection; the script prints every combination (both layouts and styles, ids and labels, 0 to 1M).

Reading it:

- **Highlighting is not worth capping** in the library or the examples: 1M matches cost about 0.05 s to set by node id and a frame of
  under 30 ms rectangular, in either style. Dimming costs nothing per match per frame (the prefix is built once, about 10 ms on 2.4M tips).
- **Radial band style at 1M matches** is still about 70 ms per frame at the fit view: the rays have different widths and the rays of
  neighbouring tips rarely land on the same pixel, so most are drawn. Not worth more work for now; dim style is 7 ms.
- **Labels cost more than node ids** to set: each label is looked up (`tipIndices`), about 0.3 µs per label, so 1M labels about 0.3 s. The
  first lookup by label on a tree builds the label index once (about 1.1 s on 2.4M tips, the 10k-labels row of the full output). Apps
  that already know the tips (the explorer) should pass node ids.

## The label scan (proposal 3 of #58)

On the same 2.39M labels: lowercasing them once (what `Search` keeps per tree) about 0.9 s; a full scan with `indexOf` 40 to 70 ms; one
regular expression over the raw labels (the explorer) 75 to 100 ms; for a common query (`a`, 2.2M matches), a rare one (`pseudo`, 34k) and
one matching nothing. `Search` debounces by 100 ms and now always scans every label, to count. This is not a problem worth a worker or an
index yet; the one-off lowercasing on the first keystroke is the largest part (**unverified** on a real browser).
