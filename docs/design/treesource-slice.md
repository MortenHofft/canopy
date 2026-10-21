# TreeSource slice for the custom renderer: in-memory behind an interface, and a Parquet source that loads the overview only

Date 2026-10-20. Code: `spikes/custom/src/core/source.ts` (interface, `InMemorySource`), `spikes/custom/src/parquet/` (`ParquetSource`, dev page), `spikes/custom/scripts/check-parquet-source.mjs` (functional check). Starting point: the proposal in `spikes/parquet-experiment/proposal/tree-source.ts` and section 8 of [parquet-experiment.md](parquet-experiment.md). Evidence levels: **M** measured here (headless Chromium 141, no GPU, 4 cores, shared sandbox), **S** read from source, **E** estimate (unverified).

## 1. Short answer

* Step 1 (no behaviour change) is done: the renderer reads the tree through `source.snapshot()`; `<TreeView tree={...}>` is unchanged and `source` is a new optional prop. typecheck, build, `check-radial-cut`, `check-radial-ui` pass. Per-frame JS time is the same within noise (**M**, interleaved A/B, section 3).
* Step 2 is a working proof of concept, not a finished source. On the real OTL trees (1.49M and 2.39M tips) the first view is drawn from the overview alone: **2 requests, 28,068 bytes (1.49M) and 19,848 bytes (2.39M)**, 2,048 rows, 1,452 / 460 of them stubs drawn as triangles, JS heap 27 / 34 MB instead of about 570 MB for the whole tree in memory (**M**). A click on a stub returns the true tip range (checked against the full tree for every click). Zooming into a stub **does** open it: a clade up to 65,536 rows is read from `nodes.parquet`, a bigger one makes the next overview level part of the snapshot. Every row of every snapshot was compared with `computeLayout()` of the full tree: X, XMAX, ROW, tip range and parent are identical (worst difference 0).
* Not built: tip labels in the snapshot (no labels are drawn in partial mode), label search, per-tip columns, eviction, retries and error states, `ensureTip` (occurrence-page case), worker decoding, keyboard navigation into stubs beyond a guard. Details in section 6.

## 2. What was built

| Piece | Where | Change |
|---|---|---|
| Interface | `core/source.ts`, `core/types.ts` | `TreeSource`, `TreeSnapshot` (= `TreeData` + `stub`, `globalId`, `rollup`, `toLocal`), `RollupData`, `InMemorySource` (version 0, no stubs, `ensureClade` resolves, `subscribe` no-op). `InMemorySource` does not copy: the typed arrays are shared with the `TreeModel`. |
| Renderer | `core/renderer.ts` | holds a `TreeSource`; `this.tree` is the snapshot of the last seen `source.version`, refreshed by `syncSource()` (called from the subscription and at the start of `render()`: one integer compare). A new version rebuilds layout, hit index and clade classes. Public ids (events, `zoomToNode`, `locateNode`, `nodeBounds`, `setClades`) are preorder ids of the full tree and are mapped to snapshot rows at the boundary (`rowOf`, `mkEvent`). `requestDetail()` after a full-quality frame asks the source to open stubs (section 4). |
| Cut | `core/lod.ts` | a stub row is always a summary (`K_SUMMARY`, or `K_STUB` without summaries), never descended; `forced` does not count stubs. One extra `stub !== null` test per visited row. |
| Layout | `core/layout.ts` | `layoutFromRollup`: X, XMAX from `cumLength / maxCum` (phylogram, normalised by the root's `maxCum`, not by what is loaded) or from `depth / maxDepth` (cladogram); ROW from the source. The existing passes are untouched for in-memory snapshots. |
| Draw, hit, columns | `core/draw.ts`, `hit.ts`, `columns.ts` | types only, plus `?? ''` where a tip label can be missing (three places). Triangles for stubs use the existing summary drawing from `leafStart/leafEnd`, X, XMAX, ROW. |
| React | `react/TreeView.tsx` | `tree?` or `source?` prop (`source` wins); `TreeNodeEvent.tipLabels(): Promise<string[]>` next to the synchronous `tipIds()`. `adapter.tsx` is unchanged. |
| ParquetSource | `parquet/ParquetSource.ts` | on top of `spikes/parquet-experiment/web/reader.js` (imported read-only, with a `declare module` shim). |
| Dev page | `spikes/custom/parquet.html`, `src/parquet/page.tsx` | `/parquet.html?url=<folder>[&layout=radial][&level=0]`, dev server only: `parquet.html` is not a Vite input, so the production build and the comparison site do not contain it (`grep hyparquet dist/assets/*.js` finds nothing, **M**). |

## 3. Step 1: no regression

Checks (all after the change): `npm run typecheck` clean; `npm run build` ok (JS 285.87 kB before, 290.01 kB after, +4 kB, gzip 93.89 to 95.23 kB); `node --experimental-transform-types scripts/check-radial-cut.mjs` OK; `node scripts/check-radial-ui.mjs` OK (build served on 5306).

JS time per frame, `bench/bench.mjs --frames 60` (cut + draw, no raster), production builds of the old (HEAD) and new code served side by side and run **alternately** four times each on the same machine to cancel drift; median of four, load average 1.5 at start and 2.8 at end (the bench itself plus Chromium; the machine was otherwise idle apart from a Vite dev server and a static server):

| Tree (tips) | Layout | View | Before ms | After ms | Change |
|---|---|---|---|---|---|
| Yule 1M | rect | fit | 1.44 | 1.35 | -6% |
| Yule 1M | radial | fit | 3.93 | 3.43 | -13% |
| OTL vertebrata 91k | rect | fit | 3.64 | 3.89 | +7% |
| OTL vertebrata 91k | radial | fit | 5.15 | 5.34 | +4% |
| GTDB 190k | rect | fit | 4.10 | 4.12 | 0% |
| GTDB 190k | radial | fit | 3.09 | 3.13 | +1% |
| Caterpillar 10k | rect | fit | 3.67 | 3.47 | -6% |
| Caterpillar 10k | radial | fit | 5.90 | 6.06 | +3% |

The 3% windows (0.04 to 2.2 ms) moved between -18% and +5% in the same direction as noise; the single +61% (Yule 1M radial, 0.04 to 0.06 ms) is two hundredths of a millisecond. The individual runs scatter by 10 to 25% (for example OTL 91k rect fit, new: 4.34, 4.07, 3.59, 3.71), so **a difference below about 10% cannot be told from noise here**; the sign is not consistent, which is what no change looks like. An earlier before/after taken sequentially (the old build twice, then the new one twice and once more) had shown fit views up to +60% on single runs (OTL 91k radial: 4.20 and 5.33 ms before, 6.86, 5.90 and 5.97 after); the interleaved run does not reproduce it, so I attribute it to machine drift (**M**, and it shows how weak a sequential comparison is on this box). A Node microbenchmark of only `searchCut` (no browser, three alternating rounds, median of 200) agrees: for example OTL 91k radial 5.5 to 7.1 ms before and 4.6 to 5.0 ms after, caterpillar radial 14.9 to 15.9 before and 16.4 to 16.6 after (+3 to 11%, the one place where a small real cost from the extra `stub` test could hide; **unverified**, within noise of the other rounds).

Shared runner smoke (`node runner/run.mjs --candidate custom --trees smoke`): see section 3.1.

### 3.1 Runner smoke

`node runner/run.mjs --candidate custom --trees smoke --port 5206 --max-minutes 12 --out <scratch dir>` (the command of [custom.md](custom.md), with `--out` so that nothing under `spikes/results/` changed), 2 min 20 s, run on the changed code (run id `20261020-121515`, JSON not kept): S2, S4 to S15 pass, S3 `partial` by the runner's rule (tip sets are `adapter-derived`, as in every earlier custom run), S1 pass on the three smoke trees (5, 200, 1,000 tips; median 59.9 fps). The same statuses as the earlier custom smoke runs listed in custom.md (**M**). This covers the in-memory path through the new `InMemorySource` and the React adapter; it says nothing about the Parquet path.

## 4. Step 2: what the Parquet source does

**Files.** Converted with the experiment's Python converter (`convert/convert.py`, pyarrow 26, 15 s and 23 s) into the git-ignored `data/real-ladder/fetched/parquet/<name>/`:

| Tree | Nodes | Tips | Level rows (0..3) | manifest | overview tail (level 0 + footer) | nodes.parquet | tips.parquet |
|---|---|---|---|---|---|---|---|
| `otl-1m-metazoa` | 1,717,413 | 1,490,245 | 2,048 / 6,147 / 24,610 / 98,492 | 2,644 B | 25,424 B | 7.6 MB | 15.7 MB |
| `otl-2m-full` | 2,725,682 | 2,385,875 | 2,048 / 6,161 / 24,599 / 98,408 | 3,642 B | 16,206 B | 11.5 MB | 25.2 MB |

Neither tree has branch lengths, so both are drawn as cladograms (the phylogram branch of `layoutFromRollup` is written but not exercised by these two trees; the experiment's `overview_vs_layout` test covers the numbers for Yule trees, but the new layout function itself is untested with lengths: **unverified**).

**First view (M, `scripts/check-parquet-source.mjs`, localhost, no latency).** The browser sees exactly `manifest.json` and one range of `overview.parquet`: 2 requests, 28,068 bytes (1.49M) and 19,848 bytes (2.39M), counted both by the reader and by the Playwright request listener. 2,048 rows, 1,452 stubs (460), 296 (129) summaries in the frame, first frame cut 0.3 to 0.5 ms and draw 0.6 to 1.3 ms (the very first frame can be 10 to 40 ms: cold JIT). Snapshot build 4 to 6 ms warm (the 2,048 rows themselves are trivial; the rank-indexed `tipNode` allocation is the likely cost, not profiled), 40 to 60 ms the first time. With the experiment's network model (`server.mjs`, `/__cfg`): time from `ParquetSource.open()` to the first snapshot 37 / 38 ms (no latency), 201 / 206 ms (wifi: 20 ms, 30 Mbit/s), 652 / 641 ms (4g: 150 ms, 9 Mbit/s); that is the two sequential round trips (the manifest names `tail_start`) plus connection set-up. JS heap after gc 27 MB (1.49M) and 34 MB (2.39M) with the overview only; the whole 2.39M tree in memory is 569 MB (rectangular, [custom.md](custom.md) stress test).

**Stubs as triangles.** A stub row has `childCount` 1 (so it is not taken for a tip), no children rows, `subtreeEnd = i + 1`, and the rollups of its clade. The cut emits it as a summary; the existing summary drawing makes the triangle from `leafStart/leafEnd`, X, XMAX, ROW. Rectangular and radial both draw them (radial first view: 328 / 132 fans, 2 requests). Every one of the 2,048 overview rows has X, XMAX, ROW, `leafStart`, `leafEnd` and parent equal to what `computeLayout(fullTree, false)` gives (worst difference 0.0, **M**).

**Click on a stub.** The test clicks inside the triangle with a real mouse event (a stub of 40,592 tips, 371 x 19 px at the fit view). The event is `kind: 'summary'`, `node` is the stub's preorder id in the FULL tree, `tipRange` equals `[leafStart, leafEnd)` of the full tree (checked for the node the event reports, not only for the one aimed at). No request is needed for the range. The labels need one: `source.tipLabels(r0, r1)` read the first three labels of that clade from `tips.parquet`: 2 requests, 174,000 bytes (1.49M) and 189,893 bytes (2.39M) (footer + one 16k-tip row group; the experiment measured the same order for a 10k-tip clade), and they equal the true labels. One finding: reading the labels of a whole stub of 240k tips would be tens of MB, so the host has to work with the range and fetch labels for a window, not for the clade (section 6 of the experiment already said so; it is now visible in the event: `tipLabels()` is async while `tipIds()` is synchronous and returns only what is loaded).

**Zoom into a stub.** `requestDetail()` (renderer) collects the stubs in the draw list that are at least 40 px tall (rectangular: rows x row height; radial: arc length), biggest first, at most 4 requests in flight, cancels (AbortController) requests for stubs that left the draw list, and never asks again for an id until the source version moves if the source answered without changing anything. Two rules that the proposal did not have turned out to be necessary:

* **Nothing opens while the view is still the fitted view.** At the fit view of 1.49M tips one tip is 0.00048 px, so a 40 px stub is any clade of about 83,000 tips or more, and the overview has such stubs: the pixel rule alone would pull the biggest clades (arithmetic, **S**: I did not run that variant) into the first view and defeat "overview first". Opening starts with the first zoom or pan.
* **A clade that costs many rows must fill a third of the view first** (`openCost()` > 20,000 rows).

`ParquetSource.ensureClade(id)`: a clade of at most 65,536 rows is read from `nodes.parquet` (`getRange`, coalesced by the reader's `RangeFile`); a bigger one is answered by `setLevel(level + 1)`, i.e. the next overview level is merged in. Results (M, same script):

| | 1.49M tips | 2.39M tips |
|---|---|---|
| zoom into a 302 / 329-tip stub (433 / 348 rows) | 2 requests, 136,011 B; 3 clades opened (the neighbours that became tall enough open too); 2,048 to 3,977 rows; tips drawn 335 | 2 requests, 170,401 B; 2,048 to 4,791 rows; tips drawn 370 |
| zoom into the biggest stub (240,987 tips, 268,866 rows) | overview level 0 to 2 and 7 clades, 6 requests, 390,705 B; 104,481 rows (27,469 stubs); frame cut 2.2 ms, draw 3.3 ms | level 0 to 2 and 5 clades, 4 requests, 256,982 B; 67,631 rows (16,878 stubs) |
| snapshot rebuild | 38 ms first, 105 ms for 104k rows (cold) | 52 ms, 89 ms (cold) |

After each load, all rows of the snapshot (3,977 / 104,481 rows and so on) were compared with the full tree's layout: identical. Warm rebuild times measured separately in the page: 4 to 5 ms at 2,048 rows, 17 to 24 ms at 131,072 rows (level 3 loaded); a frame at fit with 131k rows costs 41 to 56 ms the first time (cut 9 to 13 ms, draw 12 to 15 ms, layout 2.6 to 4.6 ms; **M**, single run).

## 5. Where the proposal was wrong or harder than it said

1. **The overview levels are not nested supersets.** `select_overview` writes, per level, only the nodes that become expanded at that level plus their child stubs. The reader's `getOverview(level)` concatenates levels 0..level, so a node can appear twice (as a stub of the level that expanded its parent and as an expanded row). Merging needs a dedupe by `sel_level` (smaller wins) and a sort by node id; not mentioned in section 8. Done in `ParquetSource.setLevel`.
2. **A pixel threshold alone opens the wrong things** (section 4): the proposal's "taller than 24 px" would open the biggest clades at the fit view. Needs a "not while fitted" rule and a cost rule, and the cost rule needs a size the renderer can ask for (`openCost`), which is a method the interface did not have.
3. **One clade fetch is the wrong tool above about 65k rows.** The experiment measured clades of 10k tips. The OTL stubs at level 0 go up to 241k tips and 269k rows; reading those from `nodes.parquet` is 17 row groups. The pyramid is the answer (next level, 30 to 386 KB), but it is global: zooming into one big clade also expands every other part of the tree by one level.
4. **`nodeCount` means two things.** The proposal's `TreeSource.nodeCount` (full tree) and the `TreeData.nodeCount` inherited by the snapshot (array length) must differ in a partial tree. In this slice the snapshot's is the row count and the source's is the full tree's; `TreeView` needed the source's for id parsing.
5. **`tipNode` and `tipRank` are indexed by rank, not by row.** `globalId` does not cover them. The PoC keeps a dense `tipNode` of `tipCount` entries per snapshot (4 B per tip: 9.5 MB at 2.39M, rebuilt per version; probably most of the 4 to 6 ms warm rebuild at 2,048 rows, not profiled). Fine for a PoC, wrong for the memory goal; a sparse or searchable structure is needed.
6. **Rollup arrays do not belong on every snapshot.** The proposal made `depth`, `maxDepth`, `cumLength`, `maxCum`, `row`, `aggregates` required fields; in memory that would be 5 more arrays per node (32 B per node with a float64 `row`, 87 MB at 2.7M nodes, **S**) for nothing. Here they are one optional `rollup` object (null in memory), and `stub` is `Uint8Array | null` (null in memory) so an in-memory frame pays no per-node read of it. The `aggregates` field and `isTip()` of the proposal were not needed yet (`childCount === 0` still means tip because stubs get `childCount` 1).
7. **`ROW` is computed by the source, not by `computeLayout`.** The proposal said loaded clades keep the layout's bottom-up pass. It is simpler to have the source produce one consistent `row` array (stub rows from the file, loaded rows by the midpoint rule, same as `layoutRows()` in the reader) and let `layoutFromRollup` only copy it.
8. **Snapshots are rebuilt, not patched.** Every version change rebuilds all arrays of the snapshot (O(rows loaded)), then layout and hit index. 4 to 24 ms for 2k to 131k rows warm, fine for the sizes tested; it will matter at the 10^5 to 10^6 rows of an uncapped session, so eviction (`trim`) and incremental splice are linked.
9. Smaller things: the cut accepts a plain `TreeData` (no `stub` field) because `check-radial-cut.mjs` passes the raw model; the renderer's keyboard `ArrowRight` needed a guard because a stub has no first child; `labelReserve()` loops over all tip labels and would hit 2.4M empty slots, so it uses a constant when stubs exist.

## 6. What does not work or is not built

* **Tip labels.** `tipLabels` of the snapshot is an empty array: in partial mode no tip label is drawn, no tooltip shows a tip name for a tip that was never read (`tipId` is null), highlighting by label does nothing, `tipIndex()` returns -1. `source.tipLabels(r0, r1)` works (async, tested) but the renderer does not call it for the visible window. Needed for any real use.
* **Label to rank / focus a tip / occurrence page.** `ensureTip`, `getPath`-based focus and `tipRankOf` exist in the reader but are not in the `TreeSource` of this slice.
* **Per-tip columns** (`compileColumns` still iterates all tips by label) and clade aggregates on stubs.
* **Eviction.** Loaded clades are never dropped; the snapshot grows with browsing (104k rows after one big zoom).
* **Errors and retries.** A failed `ensureClade` is logged and not retried; there is no loading indicator on stubs being opened.
* **Hover, keyboard, screen reader on stubs.** Hover and click work (stubs are normal summary items). `ArrowRight` on a stub does not open it; the live-region text says "Clade of N tips" for a stub as for any clade; the visible-tips list only holds loaded tips.
* **Decoding runs on the main thread** (hyparquet and fzstd); at 100k rows the opening of a clade is a 17 to 105 ms rebuild plus the decode time, which was not measured separately here.
* **Phylogram trees** through `layoutFromRollup` are untested (no OTL tree has lengths).
* **Latency under zoom** was not measured (the Parquet server ran without latency for the zoom tests; only the open was measured under the 4g and wifi profiles).
* **Production build and site**: `parquet.html` is dev-only; shipping it needs the reader and its three dependencies as a real dependency of `spikes/custom` (today it imports `../../../parquet-experiment/web/reader.js` and resolves `hyparquet`, `fzstd`, `hysnappy` from that folder's `node_modules`).

## 7. Effort for the rest (estimate, unverified)

Section 8 of the experiment estimated 22 to 25 engineer-days (range 16 to 32). What this slice covered, against that table: types, `InMemorySource` and the adapter (1.5 d line), most of the `layout.ts` stub rollups (the in-memory comparison test of `overview_vs_layout` was reused as `check-parquet-source.mjs`), the `lod.ts` stub rule, the subscribe/repaint/ensure scheduling with priority, cancel and a request budget, id mapping at the event boundary, and a first `ParquetSource` with overview merge, clade loading, level expansion and snapshot builder. I did not time it separately; it took one working session, which is below the 9 to 11 days the same rows add up to in that table, but the table assumed production quality (tests, errors, eviction), which this is not.

My estimate for what remains, from what was actually hard here: labels for the visible window with an async fetch and redraw (3 d, includes the label overlay and tooltip), `ensureTip` and label to rank in the source plus async `focusTip` (3 d), global id handling for `setClades` as ranges and highlight by rank (2 d), per-tip columns and clade aggregates (2 d), eviction with a memory cap and an incremental snapshot splice (3 d), errors, retries, loading states, abort of the reader's requests (reader change; 2 d), decode in a worker (2 to 3 d), a mock source with injected latency and a partial-versus-full draw-list comparison test (3 d), keyboard and screen-reader behaviour on stubs (1 d), build pipeline and CDN checks (2 to 3 d). That is about **19 to 22 days**, i.e. the total stays close to the original 22 to 25, because the part that turned out harder than assumed (clade size policy, overview merging, rank-indexed arrays, rebuild cost) is offset by what turned out easier (hit testing, drawing and the cut needed almost nothing). The cheaper intermediate step of the experiment (whole tree from Parquet into `TreeModel`, 5 to 7 days) is unchanged by this work. All of this is an estimate from one developer's first pass on two trees; treat the range as plus or minus 30%.

## 8. Reproduce

```
# conversion (git-ignored output; the Python converter needs numpy + pyarrow in a scratch venv)
python3 -m venv $SCR/venv && $SCR/venv/bin/pip install pyarrow numpy
for t in otl-1m-metazoa otl-2m-full; do
  $SCR/venv/bin/python -I spikes/parquet-experiment/convert/convert.py data/real-ladder/fetched/$t.nwk.gz data/real-ladder/fetched/parquet/$t --cache $SCR/cache --rg 16384 --codec zstd --enc tuned
done
# the fetched Newick files come from data/real-ladder/fetch.sh (git-ignored)

# serve with Range support, and the dev server (parquet.html is not in the production build)
node spikes/parquet-experiment/server.mjs --root data/real-ladder/fetched/parquet --port 5210 &
(cd spikes/custom && npx vite --port 5307 --strictPort) &
# look: http://127.0.0.1:5307/parquet.html?url=http://127.0.0.1:5210/otl-1m-metazoa[&layout=radial]

# the check (parses the Newick as ground truth, needs Playwright from spikes/runner and the Chromium in /opt/pw-browsers)
cd spikes/custom && node --experimental-transform-types scripts/check-parquet-source.mjs --name otl-1m-metazoa
cd spikes/custom && node --experimental-transform-types scripts/check-parquet-source.mjs --name otl-2m-full
```

Step 1 checks: `cd spikes/custom && npm run typecheck && npm run build && node --experimental-transform-types scripts/check-radial-cut.mjs && node scripts/check-radial-ui.mjs` (build on port 5306, `npm run preview -- --port 5306 --strictPort`), `node bench/bench.mjs --tree <file> --label <id> --treeid <id from spikes/shared/trees.json> --frames 60`.
