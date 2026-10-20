# Parquet over HTTP range requests for large trees: experiment results (2026-10-20)

Experiment code, converter, reader, Range server and measurement harness: [spikes/parquet-experiment/](../../spikes/parquet-experiment/) (README there says how to reproduce every number; this document is generated from `results/*.json` by `report/build_doc.py`, so the tables are not typed by hand). Question: could trees of up to millions of tips be stored as Parquet and read in the browser with HTTP range requests, so that the viewer loads a small overview first and fetches clades on demand, instead of downloading and parsing the whole Newick?

Evidence levels follow [../evaluation-framework.md](../evaluation-framework.md): **M** measured here, **S** read in source or documentation, **D** documented only, **U** unverified. Anything not measured is marked **unverified**. Versions: hyparquet 1.31.5, hyparquet-compressors 1.1.2, hyparquet-writer 0.17.0, fzstd 0.1.1, hysnappy 1.1.1 (all MIT), pyarrow 26.0.0, Node 22.22.0, Chromium 141 headless (`/opt/pw-browsers/chromium-1194`, `--no-sandbox --disable-gpu`), 4 vCPU machine **shared with other agents** (load average 0.05 to 3.0 during the final pass, up to 6.6 in the earlier passes; recorded for every profile in the JSON); date 2026-10-20.

## 1. Short answer

{{SHORT}}

## 2. Components, versions, licences

| Piece | What | Licence |
|---|---|---|
| Reader | `web/reader.js` (about 315 lines): `RangeFile` (byte cache, in-flight de-duplication, coalescing of requests that arrive in the same tick and lie less than 64 KB apart) and `ParquetTreeSource` (`getOverview(level)`, `getRange(lo, hi, columns)`, `getTips`, `getPath`, `focusTip`, `tipRankOf`) on top of hyparquet | ours (Apache-2.0 intended, like the repo) |
| Parquet reading | hyparquet 1.31.5 + fzstd 0.1.1 + hysnappy 1.1.1; bundle 73 KB minified, 26 KB gzip including the reader | MIT |
| Reference converter | Python 3 + numpy + pyarrow 26.0.0 in a scratch venv (`convert/`), iterative, uses `data/real-ladder/scripts/nwk.py` for parsing | Apache-2.0 (pyarrow) |
| Node converter | `node-writer/convert.mjs` with hyparquet-writer 0.17.0 (section 10) | MIT |
| Range server | `server.mjs`: Range, added latency per response, 2 extra latencies per new connection, shared token-bucket bandwidth, request log | ours |
| Harness | `run-browser.mjs` with `playwright-core` from `spikes/node_modules` | Apache-2.0 |

{{HYPARQUET}}

## 3. The layout

Chosen layout (v1, files in one folder per tree; `README.md` in the experiment folder has the column list):

| File | Content | Why |
|---|---|---|
| `manifest.json` | counts, `has_lengths`, file sizes and footer sizes, node and tip row-group boundaries as preorder ranges (`rg_node_start`, `rg_tip_start`), overview levels (`row_budgets`, `level_rows`, `level_min_tips`, `tail_start`) | one small first request; maps a clade `[i, subtree_end)` to row groups by binary search |
| `nodes.parquet` | nodes in preorder, row index = node id. `parent` int32, `subtree_end` int32, `leaf_start` int32, `tip_count` int32, `len` float32 (NaN when missing), `cum_len` float32, `max_cum` float32, `depth`, `max_depth` int32, `occ_sum` int64 (+ `support` float32 and `name` string, nullable, when the tree has them). Row groups of 16,384 rows | the per-node numbers the cut and the triangles need (section 8) plus a clade-level rollup of a metadata column |
| `tips.parquet`, `tipmeta.parquet` | one row per tip in rank order: `node` int32 and `tip_label` (tips); `occurrence_count` int32 and `country` (tipmeta, where more per-tip columns would go). Same row groups in both files: row group g holds exactly the tips of node row group g | labels are most of the tip bytes, so they are separate columns that a topology-only read never touches; `node` gives rank to node id for "focus a tip"; the metadata is in its own file because a metadata read would otherwise be coalesced across the label chunks (first measurement: reading `occurrence_count` for all tips pulled 7.7 MB) |
| `overview.parquet` | pyramid of 2 to 4 levels, one row group each, deepest level first and **level 0 last**; every row carries its node id, all rollups, `row` (layout y, float64) and `sel_level`. Level L is the set of clades expanded at level at most L plus the child stubs of those | the whole-tree view and every triangle are drawn from these rows alone; level 0 plus the footer is one contiguous tail of the file, so the first view is one range request |
| `spine.parquet` + `open.json` | the ancestors of the first node of every node row group | root-to-tip paths with one node row group and one small file; `open.json` is fetched lazily so it is not in the first request |
| `labels.parquet` | tip labels sorted by label with their tip rank, 16,384 rows per group, row-group statistics | label to rank in two requests (footer, one row group) |

Differences from the proposal in the brief, each with the reason:

1. **Labels moved out of the node table** into `tips.parquet`, and per-tip metadata into `tipmeta.parquet`, both aligned with the node row groups (reasons in the table above). The proposal's "label tips only, dictionary encoded" was tested: a dictionary for unique labels is larger (Yule 1M: 9.65 MB with a label dictionary against 7.83 MB plain, zstd) so labels are plain, `country` is a dictionary.
2. **All columns REQUIRED (no nulls)**. pyarrow's default OPTIONAL columns make hyparquet return plain arrays of numbers (3 to 10 times slower to decode, measured on the 100k tree); REQUIRED columns come back as `Int32Array`/`Float32Array`. Missing branch lengths are NaN, not null.
3. **Encodings tuned**, `tuned` in the tables: `DELTA_BINARY_PACKED` for the integer columns (parents, ends, starts are close to their neighbours) and `BYTE_STREAM_SPLIT` for the float columns, zstd level 3. Against pyarrow's defaults (dictionary encoding) the nodes file is 35 to 65 percent smaller (100k Yule: 2.10 MB against 3.92 MB; Yule 1M: 21.0 against 39.5 MB; GTDB 190k 35 percent; Open Tree 65 percent), and 15 to 47 percent smaller than PLAIN.
4. **`row` (the renderer's layout y) added to overview and spine rows, as float64.** The layout puts an internal node at the midpoint of its first and last child, a number the renderer computes bottom-up over the whole tree and a stub cannot recompute. In float32 it is wrong by up to 0.004 rows at 100k tips and 0.06 rows at 1M (measured by `test/overview_vs_layout.mjs`, first run of the check failed on exactly this); float64 reproduces `computeLayout()` exactly. The node table does not store it; a loaded clade recomputes it (`layoutRows()` in the reader).
5. **`occ_sum` is int64**: summed GBIF occurrence counts exceed int32 quickly.
6. **Overview budget counts rows, not expanded nodes, and skips polytomies.** The first pass selected the top-B clades by tip count; on the Open Tree trees (nodes with thousands of children) level 0 then had 63,670 rows (342 KB first request). The final rule fills each level up to 2,048, 8,192, 32,768 and 131,072 rows (kept only while at most one eighth of all nodes), taking clades by tip count, skipping any clade whose children do not fit, which leaves it and everything below it as a stub. The first pass is kept as `results/browser-main-v1-64k-nodebudget.json`.
7. **`open.json` split from the manifest**: path data had made `manifest.json` 37 KB for the Open Tree tree, on the critical path of the first view.
8. **Added**: `labels.parquet` (label to rank), `level_min_tips` (smallest clade expanded per level, used by `focusTip`), `spine.parquet`.
9. **Row groups of 16k rows instead of larger ones**, because of section 6.3.

Sizes of the files of the final layout (zstd, 16,384 rows per group, `tuned` encodings):

{{LAYOUT_SIZES}}

## 4. Verification

`convert/verify.py` reads every file back with pyarrow and checks: every node column equals the ground truth recomputed from the Newick (floats compared after casting the ground truth to the stored width); the integer rollups again with **independent** methods that use only the `parent` column (subtree end by a monotonic stack, depth by pointer jumping, tip count and leaf start by prefix sums over tips, `max_depth` and `max_cum` by a sparse-table range maximum over the preorder range, `occ_sum` by prefix sums over `tipmeta.parquet`); `max_cum / root` equals the renderer's `XMAX`; `row` equals the layout row; tips are aligned with node row groups; labels file is sorted and maps back; every overview level has stub and tip rows that **tile the tip range exactly once** with non-negative triangle widths and rows that equal the node table; paths from 2,000 random tips are reproduced from one node row group plus `rg_open`. `test/verify_mutation.py` tampers with one value of five different rollup columns in the sample file and checks that verify fails each time (it does).

{{VERIFY}}

"A triangle can be drawn from overview rows alone" was checked against the renderer itself, not against my own formulas: `test/overview_vs_layout.mjs` bundles `spikes/custom/src/core/layout.ts` (read only), computes `computeLayout()` on the full tree and compares, for **every row of every overview level**, leaf range, structure, `X`, `XMAX` and `ROW`; for trees without lengths (cladogram) `X` comes from `depth`/`max_depth` and `XMAX` is 1. Tolerance 2e-6 for X and XMAX (float32 storage), 0 mismatches:

{{OVL}}

## 5. File sizes

Whole-tree sizes for the four trees of the brief. Newick gzip is `zlib` level 9 (same as `gzip -9` apart from the header); "Parquet total" is nodes + tips + tipmeta + overview (all levels) + spine + open + manifest of the final layout (16,384 rows per group); `labels.parquet` is not included in the total (it is optional, see section 11). The detailed matrices after the first table come from the size sweep (`convert/sizes.py`), which wrote labels, node ids and metadata into a single `tips.parquet` (the split into `tips` + `tipmeta` came later and changes the sum by under 1 percent). Metadata columns are synthetic (heavy-tailed `occurrence_count`, Zipf `country`).

{{SIZES}}

How to read these tables: (1) **The Parquet layout is about twice the size of the gzipped Newick** because it stores ten numeric columns per node (and a metadata file); it does not save download bytes if the whole tree is wanted. (2) `zstd` files are 17 to 34 percent smaller than `snappy` and 2.1 to 6.2 times smaller than uncompressed (node file, 64k rows); gzip of the uncompressed file (the "gzip on the wire" column) is about the size of zstd but cannot be used with range requests (a CDN would have to compress each range independently and report ranges of the compressed stream; do not rely on it). (3) float64 instead of float32 makes the node file 70 to 80 percent larger for trees with branch lengths and changes nothing for the Open Tree tree, which has none. (4) The rollup columns are the bulk of the node file (Yule 1M with zstd: topology + lengths 10.8 MB, +rollups 18.6 MB, +`occ_sum` 21.0 MB). (5) A hand-rolled flat binary with the same columns is 20 percent larger than Parquet when compressed with zstd per column (25.4 against 21.0 MB, Yule 1M) because plain zstd on raw little-endian arrays cannot use the delta and byte-split encodings; with a byte-shuffle in front it would be 17.6 MB, smaller than Parquet, at the price of a custom format and reader. So Parquet's cost relative to the simplest alternative is small, and its benefits are the standard footer, row-group statistics, column selection and existing readers and writers (section 6.3, section 10).

## 6. Browser measurements

### 6.1 Method

- Server: `server.mjs`, profiles **wifi** 30 Mbit/s and 20 ms, **4G** 9 Mbit/s and 150 ms, **slow 3G** 1.6 Mbit/s and 400 ms. Latency is added to every response (one round trip); every new TCP connection costs two more latencies once (TCP + TLS); all response bytes plus 400 bytes of header per response share one bandwidth bucket. Not modelled: slow start, loss, HTTP/2 multiplexing, CDN misses, DNS. Because the model charges the connection set-up per TCP connection, the first parallel requests each pay it (the footer pair and the label request cost an extra 0.3 s on 4G that one multiplexed HTTP/2 connection would not): **a bias against the Parquet side**. The page (port 5310) and the data (port 5210) are different origins, so the Range requests are real cross-origin fetches: **no CORS preflight was sent** (the server logs OPTIONS requests; none appeared in any of the logged first views) because a simple `bytes=a-b` range is CORS-safelisted.
- Chromium 141 headless via Playwright; a fresh context for every repetition; 2 repetitions per cell (1 for slow 3G where a cell takes minutes), median reported; `uptime` load average recorded at the start and end of every profile in the JSON. The `none` profile (no throttling) is used for decode costs.
- Baseline = what the prototype does today: fetch the gzipped Newick, inflate with `DecompressionStream`, parse with `spikes/shared/newick.ts` (`parseNewick`, which also builds the `TreeModel`), in the same page. Time is wall time until the TreeModel exists.
- Overview-first = fresh `ParquetTreeSource`: `manifest.json`, then one range request for the tail of `overview.parquet` (level 0 and the footer), decode of level 0 into typed arrays. "Usable" means those arrays exist; drawing 1,000 to 2,000 triangles from them is a few milliseconds (Canvas2D, not measured here).
- Clade fetch = a clade of about 1k, 10k or 100k tips (the two nodes closest to the target in the first and the second half of the tree), from a cold byte cache but with the footers of `nodes.parquet` and `tips.parquet` already read (they are fetched in parallel with the first interaction; their cost is the last column of the table in section 6.2). "With labels" adds the tip labels of the clade (`tips.parquet`, one extra request in parallel).
- Bytes and requests are counted by the reader and cross-checked against the server log for the first view (`serverLog` in the JSON).

### 6.2 First usable overview

{{FIRSTVIEW}}

### 6.3 Fetching a clade, and what row-group size does to it

{{CLADES}}

hyparquet reads whole column chunks of every row group a range touches, so the cost of a small clade is set by the row-group size, not by the clade. Variants of the 1M-tip Yule tree on the 4G profile (decode column: cache-hot, unthrottled). Rows without "second pass" come from the first measurement pass (overview budget counting nodes, one `tips.parquet`; the node table, which sets the clade bytes, was built the same way); the three "second pass" rows were measured on the final layout:

{{VARIANTS}}

Reading the table:

- **Row-group size is the main knob.** 16k rows per group cuts the cost of a 1k-tip clade from 777 KB to 196 KB and from 856 ms to 337 ms on 4G (file 0.5 percent larger); 8k rows halves it again (98 KB, 238 ms) at the price of a 196 KB footer (99 KB at 16k, 26 KB at 64k, `results/footer-size-yule1M.txt`; without column statistics 124 KB, 63 KB, 17 KB) and a 1 percent larger file; 256k rows is much worse (3.1 MB for a 1k-tip clade). 16k is the default of the final layout; 8k is worth it only if small clades dominate.
- **Coalescing makes row groups cheap to read in bulk**: a 100k-tip clade is 13 row groups but 2 requests (nodes in one, labels in one), 3.1 MB in 3.0 s on 4G.
- **A page index is not worth it.** 64 KB pages with `useOffsetIndex` read 325 KB for the 1k-tip clade (against 777 KB without) but need 6 to 7 requests instead of 2, which is slower on 4G (695 ms) than 16k row groups (337 ms) with no page index.
- **Codec and encoding**: uncompressed files decode fastest (12.6 ms per 100k node rows) but are 2.3 times larger and 2 to 3 times slower to fetch on every throttled profile; snappy decodes in 16.5 ms against 27 for zstd and is 25 percent larger; PLAIN encodings (no delta, no byte-split) are 19 percent larger than `tuned` and slower to decode in JS (37 ms) because there is more to decompress. zstd with `tuned` encodings wins on every throttled profile.

### 6.4 Decode cost, path, focus, label lookup, memory

{{OTHER}}

## 7. Per-tip metadata: column and row-group selection against a TSV

A TSV with `tip_label`, `occurrence_count` and `country_code` has to be downloaded whole (gzipped: 0.69 MB for 100k tips, 6.8 MB for 1M, 17.4 MB for the Open Tree tips because of the long labels) and parsed before any value is known. `occurrence_count` alone as TSV is 0.07 MB (100k) to 1.1 MB (1.49M) gzipped, which is the fairest comparison for "the counts of all tips". With `tipmeta.parquet` (separate from the labels, same row groups as the nodes) a viewer reads only the columns and row groups it needs:

{{TIPSAVING}}

What this shows:

- **For the tips of one clade the saving is large**: on the 1M-tip tree `occurrence_count` of a 10k-tip clade is 60 KB in 2 requests (0.36 s on 4G), against 6.8 MB for the TSV, 110 times less; the clade's labels add 147 KB, all three columns 190 KB. The gain comes from three things: the labels are not shipped with the numbers, only the row groups of the clade are read (about 8,000 tips per group), and zstd.
- **For all tips at once Parquet is not smaller than a single-column TSV**: the whole `occurrence_count` column (plus `country`, which hyparquet's and our coalescing merge into the same request) is 1.75 MB for 1M tips, against 0.73 MB for the gzipped one-column TSV, because decimal text of heavy-tailed small integers compresses better with gzip than a PLAIN int32 column does with zstd (a byte-split or delta encoding for this column was not tried, **unverified**). The case for columns is subsets and not shipping labels, not the whole column.
- **Why the metadata is a separate file.** In the first measurement `tips.parquet` held labels, node ids and metadata together; reading `occurrence_count` for all tips then fetched 7.7 MB (the whole file) because the labels chunk between two `occurrence_count` chunks is smaller than the 64 KB gap that the coalescer bridges to save round trips. Column selection only pays if the unwanted columns are far apart or in another file.
- **Clade rollups in the node table** (`occ_sum`: sum of `occurrence_count` below each node) cost 2.4 MB of the 21 MB node file for 1M tips (zstd), and let a zoomed-out view show clade totals from overview rows without any per-tip read.

{{TREESOURCE}}

## 9. Break-even: when does overview-first beat the full download?

Medians of the two repetitions. "First view" compares the time to the first usable overview with the time until the baseline has a parsed `TreeModel`. "Overview + one 10k-tip clade" adds one clade fetch (with labels) to the overview, the minimum for a user who zooms once. The last column is how many 10k-tip clade fetches fit into the time the baseline needs, i.e. how long the user can keep zooming before the full download would have been finished anyway (assuming each zoom is a cold fetch of 10k tips, which is pessimistic: neighbouring clades share row groups).

{{BREAKEVEN}}

{{BREAKEVEN_TEXT}}

{{NODEW_SECTION}}

{{RISKS}}

## 12. Effort to integrate and recommendation

{{RECOMMENDATION}}

## 13. What was not measured (all **unverified**)

- Real CDN or object-store behaviour: Range support, CORS configuration and caching for GBIF's archive host, Vercel static hosting (including whether its CDN serves ranges of a 20 MB file without fetching the whole object), S3, R2. HTTP/2 multiplexing and TLS resumption (the model charges two round trips per new connection and nothing for slow start).
- Real GPU and real frame rates (the sandbox has none); no drawing was done from the Parquet data, only the numbers the renderer needs were compared (section 4).
- Real devices: phones. Decode costs are from a loaded desktop-class vCPU in headless Chromium; mid-range phones are commonly 3 to 6 times slower in JS (an assumption, not measured).
- Real GBIF data: tip metadata is synthetic; real tip labels are the join key to GBIF taxa and their compression will differ; no tree with a real occurrence rollup was built.
- Browser HTTP caching of range responses and repeat visits; Safari and Firefox behaviour (DuckDB-WASM notes in custom-renderer.md mention Firefox range problems for pre-signed S3 URLs; not tested here).
- Search by label beyond exact match (prefix, fuzzy, name matching against GBIF), and a hash-based label index.
- Smaller row groups than 16k, adaptive row groups, and compressing with a codec other than zstd level 3 (higher levels would shrink files further at conversion cost).
- Multi-tree files, trees that change between versions, collapsed or edited trees.
- Behaviour under concurrent users and CDN cold caches.

## 14. Files

All in [spikes/parquet-experiment/](../../spikes/parquet-experiment/): `README.md`, `results/` (raw JSON: `sizes-*.json`, `browser-main.json`, `browser-variant-*.json`, `browser-nodew.json`, `node-writer-*.json`, `layout-sizes.json`, `python-convert-times.txt`, `footer-size-yule1M.txt`, the earlier passes `browser-main-v1-64k-nodebudget.json` and `browser-main-v2a-single-tips-file.json`, `verify-*.txt`, `overview-vs-layout.txt`), `proposal/tree-source.ts`, `sample/yule1k/` (65 KB committed sample layout for tests). Generated Parquet files are not committed.
