# Parsing in a Web Worker (#4)

Measured 2026-10-28, after moving the explorer's parse into a worker (`@canopy/io/worker`, see [packages/io/README.md](../../packages/io/README.md)).
The scope is the first of the two options in the issue's comments, chosen by the owner: parse (and layout) in a worker, the cut, drawing
and hit-testing stay on the main thread. Of that, the parse is done; **the layout is not done yet**: it still runs on the main thread in
the explorer's first render of the tree, which is why the acceptance (no main-thread task above about 50 ms during the load) is not met
(about 190 ms on the 2.39M-tip tree). What is left on the main thread, and what would remove it, is at the end.

**Environment.** Headless Chromium 1243 (`/opt/pw-browsers/chromium-1243`) in a cloud sandbox with no GPU, 1280 × 860 px. The explorer
built with `vite build` and served with `vite preview`. "Before" is the explorer of `main` (91621df: fetch, inflate and parse on the main
thread) built against this branch's `@canopy/io`, whose `TreeModel` does the same work; "after" is this branch. Script:
`tests/browser/bench/load.mjs` (usage in its header): every long task (`PerformanceObserver`, type `longtask`, buffered, so tasks over
50 ms) and the longest gap between animation frames, from navigation until the tree is shown plus 3 s. Three runs each. A real browser on
a real device will differ (**unverified** how much); the comparison is of before with after on the same machine.

Trees: the full Open Tree synthesis, `otl-2m-full.nwk.gz` (2,385,875 tips, 24 MB gzipped, 86 MB raw), and the Open Tree metazoa,
`otl-1m-metazoa.nwk.gz` (1,490,245 tips, 15 MB gzipped), both from `data/real-ladder/fetch.sh otl`.

## Long tasks during the load

| tree | | longest task (3 runs) | long tasks | their sum | longest gap between frames | tree shown at | JS heap |
| --- | --- | --- | --- | --- | --- | --- | --- |
| OTL 2.39M | before | 1,152 / 1,154 / 1,174 ms | 5 | 2.2 to 2.3 s | 1,150 to 1,167 ms | 2.4 to 2.5 s | 452 MB |
| OTL 2.39M | after | 192 / 192 / 194 ms | 3 to 5 | 0.31 to 0.42 s | 250 ms | 2.8 to 3.0 s | 515 MB |
| OTL 1.49M | before | 704 / 769 / 787 ms | 5 | 1.4 s | 700 to 800 ms | 1.6 s | 300 MB |
| OTL 1.49M | after | 141 / 151 / 169 ms | 3 to 4 | 0.25 to 0.35 s | 217 to 283 ms | 1.8 to 2.0 s | 325 MB |

Before, the tasks were (from a CPU profile of an unminified build, 2.39M tips): a task of about 0.5 s early in the load, most likely the
text decoding of the inflated 86 MB (**unverified**: the profile did not show it; it is gone once the bytes go to the worker), the parse
(about 1.1 s, with the `TreeModel` built inside it), then the explorer's first render (about 0.35 to 0.4 s). After, the inflate, decode,
parse and `TreeModel` run in the worker; the page keeps drawing frames (the explorer's browser check counts at least 10 frames in 400 ms
while the 2.39M-tip tree parses; it saw 25, the longest gap 17 ms). The tree is shown 0.3 to 0.5 s later than before: the labels arrive in
about 70 messages and the page does other work between them.

## Moving the labels

The typed arrays move without a copy (transferred buffers). The labels cannot: 4.7M strings, about 112M characters. Measured in the same
Chromium with a synthetic set of 4.7M labels like the OTL ones, the time to read (deserialize) the message on the page:

| the labels sent as | read on the page |
| --- | --- |
| one array of 4.7M strings | 444 ms |
| one joined string, Latin-1 only | 66 ms |
| one joined string, a few characters beyond Latin-1 (as in the OTL names) | 850 ms |
| UTF-16 in a transferred `Uint16Array`, then `TextDecoder('utf-16le')` | 936 ms (the decode) |
| UTF-8 in a transferred buffer, `TextDecoder` in slices of 400 kB | 179 ms in all, at most 1.4 ms a slice; but `TextEncoder` took 2.2 s in the worker and cutting the labels out (`slice`) 635 ms on the page |

A message is read in one task, so one message of all the labels was itself a long task of 0.4 to 0.9 s (the first version of this branch
sent them joined: 570 to 684 ms). They are now sent as arrays of 32,768 labels, each a message of its own, a few milliseconds each to
read. The page copies them into one array and builds the `TreeModel` from the arrays and the labels (`unpackTree`, about 25 ms at 2.39M
tips for the tip labels by rank and the model). Most of the 50 to 78 ms long tasks left during the label messages are garbage collection
(the profile shows the collector, not our code), as the heap grows by the labels.

## Frames on the main thread

The cut, draw and hit code is unchanged, so a frame costs what it did. Checked in the explorer on the tree loaded (`load.mjs`, the JS time
of a full frame, `TreeViewer.benchmark`, mean of 15, at the fit view and zoomed 100× on the centre):

| tree | | rect fit | rect zoomed | radial fit | radial zoomed |
| --- | --- | --- | --- | --- | --- |
| OTL 2.39M | before | 5.4 ms | 0.7 ms | 7.0 ms | 0.1 ms |
| OTL 2.39M | after | 5.5 ms | 0.6 ms | 7.0 ms | 0.1 ms |
| OTL 1.49M | before | 5.3 ms | 0.9 ms | 14.5 ms | 0 ms |
| OTL 1.49M | after | 4.8 ms | 0.6 ms | 13.2 ms | 0 ms |

`tests/browser/bench/bench.mjs` and `interaction.mjs` were not rerun: they drive the test page, which parses on the main thread and is not
changed here, so they would measure the same code twice.

## The cut stays on the main thread

The issue's second option, the cut in the worker, was not built (the owner chose the first). Its cost was not measured: every frame would
post the viewport and wait for the draw list, at least one message round trip (**unverified**, of the order of a millisecond or less in an
idle browser) on top of the cut itself, and the worker would need its own copy of the arrays or a `SharedArrayBuffer` (cross-origin
isolation headers on the page). The fit view of the whole 2.39M tree in radial costs 7 ms of JS here, in the explorer's pane; the issue's 37 ms (custom.md, the test
page's viewer, an earlier cut) was not remeasured.

## What is left on the main thread

The longest task after, 141 to 194 ms, is the explorer's first render of the new tree, one React commit (profile at 20 ms resolution,
2.39M tips, unminified build): the explorer's own setup (about 30 ms, among it `identity` of `@canopy/tree-ops` for undo), the viewer's
`computeLayout` (about 70 ms, with `deepestTips` 25 ms), `labelReserve` (about 25 ms) and the first cut and draw (about 40 ms). The issue's
acceptance, no task above about 50 ms during the load, is therefore **not met**. What would meet it, not built:

- the layout in the worker: `computeLayout` is pure on typed arrays (`X`, `ROW`, `XMAX`, `DEEPEST`, `LAST`), so the worker could compute it
  for the initial options (branch lengths, nothing collapsed) and the viewer take it instead of computing it (a viewer option or a
  `setTree` argument; it is cached per `branchLengths` flag, so a change of that flag would compute again on the main thread);
- `labelReserve` (the widest label for the label column) from a value the worker measures, or sampled;
- the explorer's setup after the first frame (an idle callback), or the identity map built lazily.

## Memory while switching trees

The explorer keeps the tree shown (and its viewer) while the next one loads, so Cancel can go back to it. While switching between the
largest trees the page therefore holds about two trees at once, and the worker holds the parse of the second until it posts it: from the
heaps above (about 450 to 515 MB with the 2.39M-tip tree, 300 to 330 MB with the 1.49M one), a peak of the order of 0.8 to 1 GB going from
one to the other (**estimated** from those numbers, not measured). Before, the old tree was dropped when the next load started.

## Parquet and other sources

The worker parses into a whole `TreeModel`, which the viewer wraps in the in-memory source as before (`InMemorySource`), so that source works
unchanged. A Parquet source (`ParquetSource`, on the `research` branch) would use the same packing: decode its row groups in a worker and
transfer the column arrays, with labels in chunks as here; its `snapshot()` and `ensureClade()` would then wait on the worker's messages
instead of on the decoder. Not built or measured.

## Not measured

A real GPU, other browsers, phones and slower machines; the time to first frame on a slow network (the download is unchanged: the bytes are
fetched on the page and transferred to the worker); the worker's own heap (the page's heap after the load is about 60 MB larger than before,
**unverified** why, most likely the label chunks not yet collected); the Vite dev server beyond one load (a 190k-tip tree loaded through the
worker from the TypeScript source).
