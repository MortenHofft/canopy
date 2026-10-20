# Parquet over HTTP range requests for large trees: experiment results (2026-10-20)

Experiment code, converter, reader, Range server and measurement harness: [spikes/parquet-experiment/](../../spikes/parquet-experiment/) (README there says how to reproduce every number; this document is generated from `results/*.json` by `report/build_doc.py`, so the tables are not typed by hand). Question: could trees of up to millions of tips be stored as Parquet and read in the browser with HTTP range requests, so that the viewer loads a small overview first and fetches clades on demand, instead of downloading and parsing the whole Newick?

Evidence levels follow [../evaluation-framework.md](../evaluation-framework.md): **M** measured here, **S** read in source or documentation, **D** documented only, **U** unverified. Anything not measured is marked **unverified**. Versions: hyparquet 1.31.5, hyparquet-compressors 1.1.2, hyparquet-writer 0.17.0, fzstd 0.1.1, hysnappy 1.1.1 (all MIT), pyarrow 26.0.0, Node 22.22.0, Chromium 141 headless (`/opt/pw-browsers/chromium-1194`, `--no-sandbox --disable-gpu`), 4 vCPU machine **shared with other agents** (load average 2.4 to 6.5 during the runs, recorded per measurement in the JSON); date 2026-10-20.

## 1. Short answer

SHORT_ANSWER

## 2. Components, versions, licences

| Piece | What | Licence |
|---|---|---|
| Reader | `web/reader.js` (about 330 lines): `RangeFile` (byte cache, in-flight de-duplication, coalescing of requests that arrive in the same tick and lie less than 64 KB apart) and `ParquetTreeSource` (`getOverview(level)`, `getRange(lo, hi, columns)`, `getTips`, `getPath`, `focusTip`, `tipRankOf`) on top of hyparquet | ours (Apache-2.0 intended, like the repo) |
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
| `tips.parquet` | one row per tip in rank order: `node` int32, `tip_label`, `occurrence_count` int32, `country`. Row group g holds exactly the tips of node row group g | labels are half of the rows and most of the bytes, so they are separate columns that a topology-only read never touches; `node` gives rank to node id for "focus a tip" |
| `overview.parquet` | pyramid of 2 to 4 levels, one row group each, deepest level first and **level 0 last**; every row carries its node id, all rollups, `row` (layout y, float64) and `sel_level`. Level L is the set of clades expanded at level at most L plus the child stubs of those | the whole-tree view and every triangle are drawn from these rows alone; level 0 plus the footer is one contiguous tail of the file, so the first view is one range request |
| `spine.parquet` + `open.json` | the ancestors of the first node of every node row group | root-to-tip paths with one node row group and one small file; `open.json` is fetched lazily so it is not in the first request |
| `labels.parquet` | tip labels sorted by label with their tip rank, 16,384 rows per group, row-group statistics | label to rank in two requests (footer, one row group) |

Differences from the proposal in the brief, each with the reason:

1. **Labels moved out of the node table** into `tips.parquet`, aligned with the node row groups (size and column-selection reasons above). The proposal's "label tips only, dictionary encoded" was tested: a dictionary for unique labels is larger (Yule 1M: 9.65 MB with a label dictionary against 7.83 MB plain, zstd) so labels are plain, `country` is a dictionary.
2. **All columns REQUIRED (no nulls)**. pyarrow's default OPTIONAL columns make hyparquet return plain arrays of numbers (3 to 10 times slower to decode, measured on the 100k tree); REQUIRED columns come back as `Int32Array`/`Float32Array`. Missing branch lengths are NaN, not null.
3. **Encodings tuned**, `tuned` in the tables: `DELTA_BINARY_PACKED` for the integer columns (parents, ends, starts are close to their neighbours) and `BYTE_STREAM_SPLIT` for the float columns, zstd level 3. Against pyarrow's defaults the nodes file is 47 percent smaller (100k Yule: 2.10 MB against 3.92 MB; Yule 1M: 21.0 against 39.5 MB).
4. **`row` (the renderer's layout y) added to overview and spine rows, as float64.** The layout puts an internal node at the midpoint of its first and last child, a number the renderer computes bottom-up over the whole tree and a stub cannot recompute. In float32 it is wrong by up to 0.004 rows at 100k tips and 0.06 rows at 1M (measured by `test/overview_vs_layout.mjs`, first run of the check failed on exactly this); float64 reproduces `computeLayout()` exactly. The node table does not store it; a loaded clade recomputes it (`layoutRows()` in the reader).
5. **`occ_sum` is int64**: summed GBIF occurrence counts exceed int32 quickly.
6. **Overview budget counts rows, not expanded nodes, and skips polytomies.** The first pass selected the top-B clades by tip count; on the Open Tree trees (nodes with thousands of children) level 0 then had 63,670 rows (342 KB first request). The final rule fills each level up to 2,048, 8,192, 32,768 and 131,072 rows (kept only while at most one eighth of all nodes), taking clades by tip count, skipping any clade whose children do not fit, which leaves it and everything below it as a stub. The first pass is kept as `results/browser-main-v1-64k-nodebudget.json`.
7. **`open.json` split from the manifest**: path data had made `manifest.json` 37 KB for the Open Tree tree, on the critical path of the first view.
8. **Added**: `labels.parquet` (label to rank), `level_min_tips` (smallest clade expanded per level, used by `focusTip`), `spine.parquet`.
9. **Row groups of 16k rows instead of larger ones**, because of section 6.3.

Sizes of the files of the final layout (zstd, 16,384 rows per group, `tuned` encodings):

{{LAYOUT_SIZES}}

## 4. Verification

`convert/verify.py` reads every file back with pyarrow and checks: every node column equals the ground truth recomputed from the Newick (floats compared after casting the ground truth to the stored width); the integer rollups again with **independent** methods that use only the `parent` column (subtree end by a monotonic stack, depth by pointer jumping, tip count and leaf start by prefix sums over tips, `max_depth` and `max_cum` by a sparse-table range maximum over the preorder range, `occ_sum` by prefix sums over `tips.parquet`); `max_cum / root` equals the renderer's `XMAX`; `row` equals the layout row; tips are aligned with node row groups; labels file is sorted and maps back; every overview level has stub and tip rows that **tile the tip range exactly once** with non-negative triangle widths and rows that equal the node table; paths from 2,000 random tips are reproduced from one node row group plus `rg_open`. `test/verify_mutation.py` tampers with one value of five different rollup columns in the sample file and checks that verify fails each time (it does).

{{VERIFY}}

"A triangle can be drawn from overview rows alone" was checked against the renderer itself, not against my own formulas: `test/overview_vs_layout.mjs` bundles `spikes/custom/src/core/layout.ts` (read only), computes `computeLayout()` on the full tree and compares, for **every row of every overview level**, leaf range, structure, `X`, `XMAX` and `ROW`; for trees without lengths (cladogram) `X` comes from `depth`/`max_depth` and `XMAX` is 1. Tolerance 2e-6 for X and XMAX (float32 storage), 0 mismatches:

{{OVL}}

## 5. File sizes

Whole-tree sizes for the four trees of the brief. Newick gzip is `zlib` level 9 (same as `gzip -9` apart from the header); "Parquet total" is nodes + tips + overview + spine + manifest at 64k rows per group (row-group size changes the total by under 0.5 percent, tables below); `labels.parquet` is not included in the total (it is optional, see section 11). Metadata columns are synthetic (heavy-tailed `occurrence_count`, Zipf `country`).

{{SIZES}}

How to read these tables: (1) **The Parquet layout is about twice the size of the gzipped Newick** because it stores ten numeric columns per node (and a metadata file); it does not save download bytes if the whole tree is wanted. (2) `zstd` is 25 to 45 percent smaller than `snappy` and 2.3 to 4 times smaller than uncompressed; gzip of the uncompressed file (the "gzip on the wire" column) is about the size of zstd but cannot be used with range requests (a CDN would have to compress each range independently and report ranges of the compressed stream; do not rely on it). (3) float64 instead of float32 costs 40 to 80 percent more on the node file for trees with branch lengths and nothing for trees without. (4) The rollup columns are the bulk of the node file (Yule 1M with zstd: topology + lengths 10.8 MB, +rollups 18.6 MB, +`occ_sum` 21.0 MB). (5) A hand-rolled flat binary with the same columns is 20 percent larger than Parquet when compressed with zstd per column (25.4 against 21.0 MB, Yule 1M) because plain zstd on raw little-endian arrays cannot use the delta and byte-split encodings; with a byte-shuffle in front it would be 17.6 MB, smaller than Parquet, at the price of a custom format and reader. So Parquet's cost relative to the simplest alternative is small, and its benefits are the standard footer, row-group statistics, column selection and existing readers and writers (section 6.3, section 10).

## 6. Browser measurements

### 6.1 Method

- Server: `server.mjs`, profiles **wifi** 30 Mbit/s and 20 ms, **4G** 9 Mbit/s and 150 ms, **slow 3G** 1.6 Mbit/s and 400 ms. Latency is added to every response (one round trip); every new TCP connection costs two more latencies once (TCP + TLS); all response bytes plus 400 bytes of header per response share one bandwidth bucket. Not modelled: slow start, loss, HTTP/2 multiplexing, CDN misses, DNS. The page (port 5310) and the data (port 5210) are different origins, so the Range requests are real cross-origin fetches: **no CORS preflight was sent** (the server logs OPTIONS; none appeared) because a simple `bytes=a-b` range is CORS-safelisted.
- Chromium 141 headless via Playwright; a fresh context for every repetition; 2 repetitions per cell (1 for slow 3G where a cell takes minutes), median reported; `uptime` load average recorded at the start and end of every profile in the JSON. The `none` profile (no throttling) is used for decode costs.
- Baseline = what the prototype does today: fetch the gzipped Newick, inflate with `DecompressionStream`, parse with `spikes/shared/newick.ts` (`parseNewick`, which also builds the `TreeModel`), in the same page. Time is wall time until the TreeModel exists.
- Overview-first = fresh `ParquetTreeSource`: `manifest.json`, then one range request for the tail of `overview.parquet` (level 0 and the footer), decode of level 0 into typed arrays. "Usable" means those arrays exist; drawing 1,000 to 2,000 triangles from them is a few milliseconds (Canvas2D, not measured here).
- Clade fetch = a clade of about 1k, 10k or 100k tips (the two nodes closest to the target in the first and the second half of the tree), from a cold byte cache but with the footers of `nodes.parquet` and `tips.parquet` already read (they are fetched in parallel with the first interaction; their cost is in section 6.2). "With labels" adds the tip labels of the clade (`tips.parquet`, one extra request in parallel).
- Bytes and requests are counted by the reader and cross-checked against the server log for the first view (`serverLog` in the JSON).

### 6.2 First usable overview

{{FIRSTVIEW}}

### 6.3 Fetching a clade, and what row-group size does to it

{{CLADES}}

hyparquet reads whole column chunks of every row group a range touches, so the cost of a small clade is set by the row-group size, not by the clade. Variants of the 1M-tip Yule tree (first measurement pass, overview budget v1 and 64k rows for all rows except the row-group variants; granularity comparison on the 4G profile; "main" is the 64k tree of the first pass):

{{VARIANTS}}

Reading the table: **16k rows per group cuts the cost of a 1k-tip clade from 777 KB to 196 KB and from 859 ms to 336 ms on 4G, for a 0.5 percent larger file**; 256k rows is much worse for small clades. A page index (64 KB pages, `useOffsetIndex`) reduces bytes further (325 KB for the 1k-tip clade) but adds round trips (6 to 7 requests instead of 2), so it is slower on 4G than 16k row groups and is not worth it. Smaller than 16k rows was not measured (footer size grows with the number of groups: 26 KB at 64k, about 100 KB at 16k for 1M tips, **unverified** beyond that). Uncompressed files are fastest to decode (12.6 ms per 100k rows) but 2.3 times larger, which loses on every throttled profile; snappy decodes in 16.5 ms per 100k rows against 27 for zstd and is 25 percent larger; PLAIN encodings (no delta, no byte-split) are 19 percent larger than `tuned` and decode slower in JS (37 ms per 100k rows) because there is more data to decompress.

### 6.4 Decode cost, path, focus, label lookup, memory

{{OTHER}}

## 7. Per-tip metadata: column and row-group selection against a TSV

A TSV with `tip_label`, `occurrence_count` and `country_code` has to be downloaded whole (gzipped: 0.69 MB for 100k tips, 6.8 MB for 1M, 17.4 MB for the Open Tree tips because of the long labels) and parsed before any value is known. `occurrence_count` alone as TSV is 0.07 MB (100k) to 1.1 MB (1.49M) gzipped, which is the fairest comparison for "only the counts of the visible tips". With `tips.parquet`:

{{TIPSAVING}}

## 8 onwards

{{TREESOURCE}}

## 9. Break-even: when does overview-first beat the full download?

Medians of the two repetitions. "First view" compares the time to the first usable overview with the time until the baseline has a parsed `TreeModel`. "Overview + one 10k-tip clade" adds one clade fetch (with labels) to the overview, the minimum for a user who zooms once. The last column is how many 10k-tip clade fetches fit into the time the baseline needs, i.e. how long the user can keep zooming before the full download would have been finished anyway (assuming each zoom is a cold fetch of 10k tips, which is pessimistic: neighbouring clades share row groups).

{{BREAKEVEN}}

BREAKEVEN_TEXT

{{NODEW_SECTION}}

{{RISKS}}

## 12. Effort to integrate and recommendation

RECOMMENDATION

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

All in [spikes/parquet-experiment/](../../spikes/parquet-experiment/): `README.md`, `results/` (raw JSON: `sizes-*.json`, `browser-main.json`, `browser-variant-*.json`, `browser-nodew.json`, `node-writer-*.json`, `layout-sizes.json`, the first-pass `browser-main-v1-64k-nodebudget.json`, `verify-*.txt`, `overview-vs-layout.txt`), `proposal/tree-source.ts`, `sample/yule1k/` (57 KB committed sample layout for tests). Generated Parquet files are not committed.
