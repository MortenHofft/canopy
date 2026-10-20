# Parquet over HTTP range requests for large trees: experiment results (2026-10-20)

Experiment code, converter, reader, Range server and measurement harness: [spikes/parquet-experiment/](../../spikes/parquet-experiment/) (README there says how to reproduce every number; this document is generated from `results/*.json` by `report/build_doc.py`, so the tables are not typed by hand). Question: could trees of up to millions of tips be stored as Parquet and read in the browser with HTTP range requests, so that the viewer loads a small overview first and fetches clades on demand, instead of downloading and parsing the whole Newick?

Evidence levels follow [../evaluation-framework.md](../evaluation-framework.md): **M** measured here, **S** read in source or documentation, **D** documented only, **U** unverified. Anything not measured is marked **unverified**. Versions: hyparquet 1.31.5, hyparquet-compressors 1.1.2, hyparquet-writer 0.17.0, fzstd 0.1.1, hysnappy 1.1.1 (all MIT), pyarrow 26.0.0, Node 22.22.0, Chromium 141 headless (`/opt/pw-browsers/chromium-1194`, `--no-sandbox --disable-gpu`), 4 vCPU machine **shared with other agents** (load average 0.05 to 3.0 during the final pass, up to 6.6 in the earlier passes; recorded for every profile in the JSON); date 2026-10-20.

## 1. Short answer

**Verdict: yes for large trees, no for small ones.** A Parquet layout read with hyparquet over HTTP range requests delivers a usable overview of any tree in two small requests whatever its size, and fetches clades on demand at a cost that grows with the clade, not the tree. It does not make the whole tree smaller, and it needs a new source abstraction in the renderer. All numbers below are measured (M) on a simulated network in headless Chromium, with synthetic metadata, no real CDN and no GPU.

- **Layout** (section 3): `nodes.parquet` (preorder rows, ten numeric columns including the rollups, 16,384 rows per group, zstd, delta and byte-stream-split encodings, no nulls), `tips.parquet` (node id, label) and `tipmeta.parquet` (per-tip metadata) with the same row groups, `overview.parquet` (a pyramid of 2 to 4 levels of at most 2,048 / 8,192 / 32,768 / 131,072 rows, level 0 written last so that level 0 plus footer is one contiguous tail), `spine.parquet` + `open.json` (root-to-tip paths), `labels.parquet` (label to rank), `manifest.json`.
- **Verified** (section 4): every rollup equals the ground truth recomputed from the Newick (independent methods), all 6 trees, plus a tamper test; and for **every row of every overview level** the numbers a triangle needs (leaf range, `X`, `XMAX`, `ROW`) equal what the renderer's own `computeLayout()` derives from the full tree.
- **Sizes** (section 5): the layout is **about 2 times the gzipped Newick** (1M-tip Yule 31.9 MB against 14.6 MB; Open Tree 1.49M tips 26.6 MB against 15.0 MB; GTDB 190k 7.6 against 2.4 MB). `zstd` files are 17 to 34 percent smaller than `snappy` and 2.1 to 6.2 times smaller than uncompressed; the delta and byte-stream-split encodings make the node file 35 to 65 percent smaller than pyarrow's default (dictionary) encodings and 15 to 47 percent smaller than PLAIN. A flat binary with plain zstd is 20 percent larger than Parquet, so Parquet costs little over the simplest alternative.
- **Reader** (section 2.1): hyparquet 1.31.5 (MIT) meets every requirement; with `fzstd` and `hysnappy` the reader is **26 KB gzipped**. It needs REQUIRED (non-null) columns to return typed arrays.
- **First view** (section 6.2): **2 requests, 18 to 62 KB, 0.11 to 0.14 s on wifi, 0.64 to 0.69 s on 4G, 1.7 to 2.0 s on slow 3G, independent of tree size from 10k to 1.49M tips.** The full gzipped Newick (download, inflate, parse, `TreeModel`) takes for 1M tips 5.2 s / 14.6 s / 75 s and for 1.49M tips 5.3 s / 15.1 s / 78 s on the same three profiles (22 to 47 times slower); for 100k tips 0.6 / 1.9 / 8.9 s (2.8 to 5 times slower).
- **A clade** (section 6.3): 1k tips costs 196 KB and 0.34 s on 4G, 10k tips 546 KB and 0.66 s, 100k tips 3.1 MB and 3.0 s (nodes and labels, 16k row groups). Row-group size is the main tuning knob: 64k rows costs 777 KB for the 1k clade, 256k rows 3.1 MB.
- **Break-even** (section 9): for the first view alone overview-first wins above about **9k to 14k tips on slow 3G and 4G** (parity at 10k tips; on wifi the baseline's fixed cost is about equal to ours up to 10k tips); counting one zoom into a 10k-tip clade it wins above about **21k tips (wifi), 46k (4G) and 36k (slow 3G)**. At 100k tips the first view is 2.8 to 4.9 times faster and first view plus one clade 1.6 to 2.3 times; at 1M tips 22 to 42 times and 11 to 17 times.
- **Memory**: overview plus a 100k-tip clade is 7.7 MB of typed arrays and about 35 MB of JS heap (mostly label strings) against 124 MB of typed arrays and 155 MB of JS heap for the full 1M-tip `TreeModel`.
- **Occurrence-page "focus a tip"** (section 6.4): 6 requests, 0.55 MB, 0.22 s wifi / 1.0 s 4G / 4.0 s slow 3G for the path, a clade of at least 1,000 tips and the covering overview level on a 1M-tip tree; label to rank is 2 requests and 150 KB (0.44 s on 4G).
- **Per-tip metadata** (section 7): reading `occurrence_count` for the tips of a 10k-tip clade costs 60 KB in 2 requests (0.36 s on 4G) on the 1M-tip tree, against a 6.8 MB gzipped TSV that has to be downloaded whole. The saving is for subsets: the whole `occurrence_count` column of all 1M tips is 1.75 MB in Parquet, more than the 0.73 MB of a gzipped single-column TSV.
- **Node build** (section 10): hyparquet-writer 0.17.0 writes the same layout from a Node script; the files pass the same verifier and are read by the same reader; 1M tips take 8.4 to 9.4 s in Node against 10.0 s for the Python reference, sizes within a few percent.
- **Integration** (section 8): a `TreeSource` interface makes the in-memory tree its trivial implementation; the refactor is **about 22 to 25 engineer-days** (estimate, unverified).
- **Recommendation** (section 12): worth it for trees above **about 100k tips (roughly 1 MB of gzipped Newick) for mobile and 4G audiences, and clearly above 250k tips for everyone**; not worth it below about 30k to 50k tips, where the plain download is as fast and much simpler. Confidence is medium (about 65 percent): the direction is solid and measured, the thresholds depend on the real network, the real CDN and phones, none of which were measured.

## 2. Components, versions, licences

| Piece | What | Licence |
|---|---|---|
| Reader | `web/reader.js` (about 315 lines): `RangeFile` (byte cache, in-flight de-duplication, coalescing of requests that arrive in the same tick and lie less than 64 KB apart) and `ParquetTreeSource` (`getOverview(level)`, `getRange(lo, hi, columns)`, `getTips`, `getPath`, `focusTip`, `tipRankOf`) on top of hyparquet | ours (Apache-2.0 intended, like the repo) |
| Parquet reading | hyparquet 1.31.5 + fzstd 0.1.1 + hysnappy 1.1.1; bundle 73 KB minified, 26 KB gzip including the reader | MIT |
| Reference converter | Python 3 + numpy + pyarrow 26.0.0 in a scratch venv (`convert/`), iterative, uses `data/real-ladder/scripts/nwk.py` for parsing | Apache-2.0 (pyarrow) |
| Node converter | `node-writer/convert.mjs` with hyparquet-writer 0.17.0 (section 10) | MIT |
| Range server | `server.mjs`: Range, added latency per response, 2 extra latencies per new connection, shared token-bucket bandwidth, request log | ours |
| Harness | `run-browser.mjs` with `playwright-core` from `spikes/node_modules` | Apache-2.0 |

### 2.1 Reader library: hyparquet passes every requirement

| Requirement | Result | Evidence |
|---|---|---|
| Range requests with a custom `AsyncBuffer` | **Pass.** `parquetRead({ file })` only needs `{ byteLength, slice(start, end) }`; our `RangeFile` adds an in-memory byte cache, de-duplication of in-flight requests and coalescing (adjacent or less than 64 KB apart) on top, and hyparquet is unaware of it | M: `test/selftest.mjs`, server log equals reader request count |
| Row-group selection | **Pass.** `rowStart`/`rowEnd` select the row groups; only those column chunks are requested (with 16k rows per group a 1k-tip clade reads 1 to 2 row groups, a 100k-tip clade about 13) | M: request and byte counts in section 6 |
| Column selection | **Pass.** `columns: [...]` requests only those column chunks; selected chunks within 8 KB are merged by hyparquet itself (`columnGapLimit`) and further by our coalescer | M: section 7 |
| Typed arrays | **Pass with a condition.** `INT32`/`FLOAT` columns come back as `Int32Array`/`Float32Array` (zero-copy views) only if the column is REQUIRED (no definition levels) and PLAIN-encoded; `DELTA_BINARY_PACKED` ints come back typed (Int32Array), `BYTE_STREAM_SPLIT` floats come back as Float32Array, dictionary-encoded columns as plain arrays. pyarrow's default is OPTIONAL columns, which hyparquet returns as plain JS arrays of numbers and which were 3 to 10 times slower to decode (M: node benchmark, y100k) | M |
| Snappy and zstd decoding | **Pass, needs two small packages, not `hyparquet-compressors` as a whole.** hyparquet core carries a JS snappy decoder; zstd is not built in. `hyparquet-compressors` 1.1.2 (MIT) bundles brotli (79 KB dictionary), gzip, lz4 and wraps `fzstd` 0.1.1 (MIT, pure JS) and `hysnappy` 1.1.1 (MIT, wasm inlined). Using the two decoders directly gives a 73 KB / 26 KB gzip reader bundle including hyparquet and our code; importing all of `hyparquet-compressors` gives 171 KB / 92 KB gzip | M: esbuild bundles (hyparquet alone 57 KB / 18 KB gzip; hyparquet + fzstd + hysnappy 68 KB / 23 KB gzip) |
| Decode speed 100k to 1M rows | **Pass.** About 25 ms per 100k node rows for the nine numeric columns (zstd, delta/byte-stream-split) in headless Chromium on a loaded 4-core machine, 3 to 5 ms per 100k rows for two columns, 58 ms (Yule) to 124 ms (Open Tree, long labels) per 100k tip labels; a 1M-tip tree (2M node rows) decodes in about 0.5 s if you load everything | M: table in section 6 |
| Licence | hyparquet 1.31.5, hyparquet-compressors 1.1.2, hyparquet-writer 0.17.0, fzstd 0.1.1, hysnappy 1.1.1: all MIT (LICENSE files read in `node_modules`). No GPL/AGPL anywhere in the chain | S |
| Size | hyparquet 520 KB unpacked on disk, 57 KB minified, 18 KB gzip as a bundle | M |

No better pure-JS option was needed (`parquet-wasm` and `duckdb-wasm` ship wasm of several MB or tens of MB; `parquetjs` is Node oriented; none was evaluated, **unverified**). Two things hyparquet does not do for us: it fetches **whole column chunks** per row group unless the file has a page index (`useOffsetIndex`, measured in section 6), and it has no request cache, so `RangeFile` is ours (130 lines).

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

| Tree | Newick gzip | manifest.json | overview.parquet (all levels) | overview level rows | overview tail (level 0 + footer) | nodes.parquet (footer, row groups) | tips.parquet (node, label) | tipmeta.parquet | spine + open.json | labels.parquet |
|---|---|---|---|---|---|---|---|---|---|---|
| yule10k | 0.15 MB | 1.0 KB | 0.04 MB | 2047 | 40 KB | 0.21 MB (3 KB, 2) | 0.06 MB | 0.02 MB | 3 KB | 0.08 MB |
| otl91k | 1.20 MB | 1.1 KB | 0.06 MB | 2048+6226 | 17 KB | 1.10 MB (9 KB, 9) | 1.07 MB | 0.16 MB | 9 KB | 1.31 MB |
| yule100k | 1.46 MB | 1.2 KB | 0.18 MB | 2047+6927 | 49 KB | 2.10 MB (11 KB, 13) | 0.63 MB | 0.18 MB | 11 KB | 0.83 MB |
| gtdb190k | 2.41 MB | 1.4 KB | 0.73 MB | 2047+6480+26357 | 55 KB | 5.47 MB (25 KB, 24) | 1.00 MB | 0.35 MB | 28 KB | 1.06 MB |
| yule1M | 14.54 MB | 2.8 KB | 2.71 MB | 2047+6907+27665+110747 | 59 KB | 21.05 MB (97 KB, 123) | 6.24 MB | 1.82 MB | 88 KB | 8.60 MB |
| otl1.49M | 14.99 MB | 2.6 KB | 0.57 MB | 2048+6147+24610+98492 | 25 KB | 7.60 MB (93 KB, 105) | 15.69 MB | 2.64 MB | 56 KB | 20.76 MB |

## 4. Verification

`convert/verify.py` reads every file back with pyarrow and checks: every node column equals the ground truth recomputed from the Newick (floats compared after casting the ground truth to the stored width); the integer rollups again with **independent** methods that use only the `parent` column (subtree end by a monotonic stack, depth by pointer jumping, tip count and leaf start by prefix sums over tips, `max_depth` and `max_cum` by a sparse-table range maximum over the preorder range, `occ_sum` by prefix sums over `tipmeta.parquet`); `max_cum / root` equals the renderer's `XMAX`; `row` equals the layout row; tips are aligned with node row groups; labels file is sorted and maps back; every overview level has stub and tip rows that **tile the tip range exactly once** with non-negative triangle widths and rows that equal the node table; paths from 2,000 random tips are reproduced from one node row group plus `rg_open`. `test/verify_mutation.py` tampers with one value of five different rollup columns in the sample file and checks that verify fails each time (it does).

| Tree | Checks passed | Result |
|---|---|---|
| gtdb190k | 35 | ALL PASS |
| nodew-yule100k | 31 | ALL PASS |
| nodew-yule1M | 37 | ALL PASS |
| otl1.49M | 31 | ALL PASS |
| otl91k | 27 | ALL PASS |
| yule100k | 31 | ALL PASS |
| yule10k | 28 | ALL PASS |
| yule1M | 37 | ALL PASS |

"A triangle can be drawn from overview rows alone" was checked against the renderer itself, not against my own formulas: `test/overview_vs_layout.mjs` bundles `spikes/custom/src/core/layout.ts` (read only), computes `computeLayout()` on the full tree and compares, for **every row of every overview level**, leaf range, structure, `X`, `XMAX` and `ROW`; for trees without lengths (cladogram) `X` comes from `depth`/`max_depth` and `XMAX` is 1. Tolerance 2e-6 for X and XMAX (float32 storage), 0 mismatches:

```
PASS overview rows=147366 (levels 2047+6907+27665+110747) mode=phylogram mismatches=0 worst |dX|=3.81e-8 |dXMAX|=6.59e-8 |dROW|=0.00e+0
PASS overview rows=131297 (levels 2048+6147+24610+98492) mode=cladogram mismatches=0 worst |dX|=0.00e+0 |dXMAX|=0.00e+0 |dROW|=0.00e+0
PASS overview rows=8274 (levels 2048+6226) mode=cladogram mismatches=0 worst |dX|=0.00e+0 |dXMAX|=0.00e+0 |dROW|=0.00e+0
PASS overview rows=34884 (levels 2047+6480+26357) mode=phylogram mismatches=0 worst |dX|=3.36e-8 |dXMAX|=6.21e-8 |dROW|=0.00e+0
PASS overview rows=8974 (levels 2047+6927) mode=phylogram mismatches=0 worst |dX|=3.81e-8 |dXMAX|=5.00e-8 |dROW|=0.00e+0
PASS overview rows=2047 (levels 2047) mode=phylogram mismatches=0 worst |dX|=3.81e-8 |dXMAX|=3.96e-8 |dROW|=0.00e+0
```

## 5. File sizes

Whole-tree sizes for the four trees of the brief. Newick gzip is `zlib` level 9 (same as `gzip -9` apart from the header); "Parquet total" is nodes + tips + tipmeta + overview (all levels) + spine + open + manifest of the final layout (16,384 rows per group); `labels.parquet` is not included in the total (it is optional, see section 11). The detailed matrices after the first table come from the size sweep (`convert/sizes.py`), which wrote labels, node ids and metadata into a single `tips.parquet` (the split into `tips` + `tipmeta` came later and changes the sum by under 1 percent). Metadata columns are synthetic (heavy-tailed `occurrence_count`, Zipf `country`).

### Whole-tree size (MB; zstd, 16,384 rows per group, f32, `tuned` encodings, rollups + occ_sum)

| Tree | Tips | Newick raw | Newick gzip -9 | Newick brotli | Parquet nodes | Parquet tips + tipmeta (node, label; occurrence_count, country) | overview + spine + open + manifest | Parquet total | total / gzip Newick | labels.parquet (optional) | flat binary zstd (cols) + labels zstd |
|---|---|---|---|---|---|---|---|---|---|---|---|
| yule100k | 100,000 | 4.14 | 1.46 | 1.38 | 2.10 | 0.81 | 0.19 | 3.11 | 2.12x | 0.83 | 2.53 + 0.48 |
| gtdb190k | 189,801 | 9.41 | 2.41 | 2.27 | 5.47 | 1.35 | 0.76 | 7.58 | 3.15x | 1.06 | 6.26 + 0.87 |
| yule1M | 1,000,000 | 41.34 | 14.55 | 13.69 | 21.05 | 8.06 | 2.80 | 31.91 | 2.19x | 8.60 | 25.42 + 4.78 |
| otl1.49M | 1,490,245 | 53.12 | 14.99 | 14.18 | 7.60 | 18.33 | 0.63 | 26.56 | 1.77x | 20.76 | 11.65 + 14.91 |

### yule100k: nodes.parquet bytes (MB) by codec, row group, float width, column set (`tuned` encodings)

| codec | rows/group | f32 base | f32 +rollups | f32 +rollups+occ | f64 base | f64 +rollups | f64 +rollups+occ | gzip of uncompressed (f32 +rollups+occ) |
|---|---|---|---|---|---|---|---|---|
| none | 16k | 1.26 | 3.31 | 4.91 | 2.06 | 5.71 | 7.31 | - |
| none | 64k | 1.26 | 3.30 | 4.90 | 2.06 | 5.70 | 7.30 | 2.04 |
| none | 256k | 1.26 | 3.30 | 4.90 | 2.06 | 5.70 | 7.30 | - |
| snappy | 16k | 1.21 | 2.22 | 2.66 | 1.98 | 4.13 | 4.57 | - |
| snappy | 64k | 1.17 | 2.18 | 2.61 | 1.94 | 4.12 | 4.56 | - |
| snappy | 256k | 1.16 | 2.16 | 2.60 | 1.92 | 4.07 | 4.51 | - |
| zstd | 16k | 1.09 | 1.86 | 2.10 | 1.86 | 3.56 | 3.80 | - |
| zstd | 64k | 1.09 | 1.86 | 2.10 | 1.83 | 3.51 | 3.76 | - |
| zstd | 256k | 1.08 | 1.86 | 2.10 | 1.82 | 3.50 | 3.74 | - |

yule100k: encoding profiles (64k, f32, rollups+occ; nodes MB / tips.parquet MB, the sweep wrote labels, node id and metadata in ONE tips file)

| encoding | none | snappy | zstd |
|---|---|---|---|
| default | 5.02 / 3.33 | 4.73 / 1.57 | 3.92 / 1.02 |
| plain | 8.81 / 3.33 | 4.08 / 1.57 | 2.48 / 1.02 |
| bss | 8.81 / 3.33 | 4.05 / 1.57 | 2.54 / 1.02 |
| tuned | 4.90 / 2.97 | 2.61 / 1.22 | 2.10 / 0.79 |

yule100k: flat binary (same columns, little-endian, no row groups), MB

| float | cols | raw | gzip -9 | zstd | zstd 64k chunks | zstd byte-shuffled |
|---|---|---|---|---|---|---|
| f32 | base | 2.40 | 1.11 | 1.38 | 1.36 | 0.98 |
| f32 | rollups | 6.40 | 1.87 | 2.28 | 2.27 | 1.60 |
| f32 | rollups+occ | 8.00 | 2.12 | 2.53 | 2.51 | 1.78 |
| f64 | base | 3.20 | 1.65 | 1.95 | 1.93 | 1.73 |
| f64 | rollups | 8.80 | 2.90 | 3.39 | 3.38 | 3.22 |
| f64 | rollups+occ | 10.40 | 3.15 | 3.63 | 3.62 | 3.40 |

yule100k: labels flat = raw 2.12 / gzip 0.46 / zstd 0.48; tips.parquet with label dictionary (zstd) 0.97 vs plain 0.79; TSV tip_label+occurrence_count+country raw 2.66 / gzip 0.69; TSV occurrence_count only raw 0.24 / gzip 0.07

### gtdb190k: nodes.parquet bytes (MB) by codec, row group, float width, column set (`tuned` encodings)

| codec | rows/group | f32 base | f32 +rollups | f32 +rollups+occ | f64 base | f64 +rollups | f64 +rollups+occ | gzip of uncompressed (f32 +rollups+occ) |
|---|---|---|---|---|---|---|---|---|
| none | 16k | 4.48 | 8.24 | 11.28 | 7.52 | 14.32 | 17.36 | 5.28 |
| none | 64k | 4.47 | 8.23 | 11.26 | 7.51 | 14.30 | 17.34 | 5.16 |
| none | 256k | 4.47 | 8.22 | 11.26 | 7.51 | 14.30 | 17.34 | 5.10 |
| snappy | 16k | 2.98 | 5.89 | 6.72 | 4.41 | 9.98 | 10.80 | - |
| snappy | 64k | 2.87 | 5.74 | 6.57 | 4.35 | 9.87 | 10.69 | - |
| snappy | 256k | 2.87 | 5.75 | 6.57 | 4.34 | 9.84 | 10.67 | - |
| zstd | 16k | 2.45 | 5.03 | 5.47 | 3.90 | 8.94 | 9.39 | - |
| zstd | 64k | 2.45 | 5.01 | 5.45 | 3.87 | 8.89 | 9.33 | - |
| zstd | 256k | 2.43 | 4.99 | 5.44 | 3.86 | 8.88 | 9.32 | - |

gtdb190k: encoding profiles (64k, f32, rollups+occ; nodes MB / tips.parquet MB, the sweep wrote labels, node id and metadata in ONE tips file)

| encoding | none | snappy | zstd |
|---|---|---|---|
| default | 10.74 / 5.90 | 9.81 / 2.67 | 8.33 / 1.75 |
| plain | 18.83 / 5.90 | 9.72 / 2.67 | 6.52 / 1.75 |
| bss | 18.83 / 5.90 | 9.36 / 2.67 | 6.65 / 1.75 |
| tuned | 11.26 / 5.24 | 6.57 / 1.99 | 5.45 / 1.30 |

gtdb190k: flat binary (same columns, little-endian, no row groups), MB

| float | cols | raw | gzip -9 | zstd | zstd 64k chunks | zstd byte-shuffled |
|---|---|---|---|---|---|---|
| f32 | base | 4.56 | 1.88 | 2.76 | 2.71 | 1.72 |
| f32 | rollups | 12.15 | 4.44 | 5.80 | 5.74 | 4.18 |
| f32 | rollups+occ | 15.18 | 4.90 | 6.26 | 6.19 | 4.52 |
| f64 | base | 6.07 | 2.12 | 2.85 | 2.83 | 3.08 |
| f64 | rollups | 16.70 | 5.48 | 7.63 | 7.64 | 7.98 |
| f64 | rollups+occ | 19.74 | 5.94 | 8.08 | 8.10 | 8.33 |

gtdb190k: labels flat = raw 3.61 / gzip 0.75 / zstd 0.87; tips.parquet with label dictionary (zstd) 1.65 vs plain 1.30; TSV tip_label+occurrence_count+country raw 4.63 / gzip 1.24; TSV occurrence_count only raw 0.45 / gzip 0.14

### yule1M: nodes.parquet bytes (MB) by codec, row group, float width, column set (`tuned` encodings)

| codec | rows/group | f32 base | f32 +rollups | f32 +rollups+occ | f64 base | f64 +rollups | f64 +rollups+occ | gzip of uncompressed (f32 +rollups+occ) |
|---|---|---|---|---|---|---|---|---|
| none | 16k | 12.60 | 33.07 | 49.09 | 20.61 | 57.08 | 73.10 | - |
| none | 64k | 12.58 | 33.00 | 49.02 | 20.58 | 57.01 | 73.02 | 20.31 |
| none | 256k | 12.57 | 32.98 | 48.99 | 20.57 | 56.99 | 73.00 | - |
| snappy | 16k | 12.30 | 22.35 | 26.72 | 19.85 | 40.93 | 45.30 | - |
| snappy | 64k | 11.73 | 21.74 | 26.12 | 19.38 | 40.91 | 45.29 | - |
| snappy | 256k | 11.68 | 21.65 | 26.03 | 19.28 | 40.71 | 45.09 | - |
| zstd | 16k | 10.88 | 18.62 | 21.05 | 18.54 | 35.44 | 37.88 | - |
| zstd | 64k | 10.84 | 18.58 | 21.01 | 18.27 | 34.99 | 37.42 | - |
| zstd | 256k | 10.83 | 18.55 | 20.98 | 18.24 | 34.91 | 37.35 | - |

yule1M: encoding profiles (64k, f32, rollups+occ; nodes MB / tips.parquet MB, the sweep wrote labels, node id and metadata in ONE tips file)

| encoding | none | snappy | zstd |
|---|---|---|---|
| default | 50.21 / 33.28 | 47.28 / 15.71 | 39.53 / 10.23 |
| plain | 88.10 / 33.28 | 40.82 / 15.71 | 24.97 / 10.23 |
| bss | 88.10 / 33.28 | 40.48 / 15.71 | 25.51 / 10.23 |
| tuned | 49.02 / 29.70 | 26.12 / 12.13 | 21.01 / 7.83 |

yule1M: flat binary (same columns, little-endian, no row groups), MB

| float | cols | raw | gzip -9 | zstd | zstd 64k chunks | zstd byte-shuffled |
|---|---|---|---|---|---|---|
| f32 | base | 24.00 | 11.06 | 13.94 | 13.70 | 9.67 |
| f32 | rollups | 64.00 | 18.62 | 22.97 | 22.85 | 15.77 |
| f32 | rollups+occ | 80.00 | 21.10 | 25.42 | 25.29 | 17.62 |
| f64 | base | 32.00 | 16.44 | 19.63 | 19.42 | 17.16 |
| f64 | rollups | 88.00 | 28.92 | 33.97 | 33.91 | 31.79 |
| f64 | rollups+occ | 104.00 | 31.40 | 36.42 | 36.35 | 33.64 |

yule1M: labels flat = raw 21.20 / gzip 4.62 / zstd 4.78; tips.parquet with label dictionary (zstd) 9.65 vs plain 7.83; TSV tip_label+occurrence_count+country raw 26.58 / gzip 6.84; TSV occurrence_count only raw 2.37 / gzip 0.73

### otl1.49M: nodes.parquet bytes (MB) by codec, row group, float width, column set (`tuned` encodings)

| codec | rows/group | f32 base | f32 +rollups | f32 +rollups+occ | f64 base | f64 +rollups | f64 +rollups+occ | gzip of uncompressed (f32 +rollups+occ) |
|---|---|---|---|---|---|---|---|---|
| none | 16k | 17.01 | 33.32 | 47.08 | 23.88 | 53.94 | 67.69 | - |
| none | 64k | 17.00 | 33.28 | 47.03 | 23.87 | 53.89 | 67.64 | 7.22 |
| none | 256k | 16.99 | 33.25 | 47.00 | 23.86 | 53.87 | 67.61 | - |
| snappy | 16k | 6.02 | 8.24 | 11.53 | 6.35 | 9.22 | 12.50 | - |
| snappy | 64k | 6.00 | 8.18 | 11.48 | 6.33 | 9.16 | 12.45 | - |
| snappy | 256k | 5.98 | 8.15 | 11.44 | 6.31 | 9.12 | 12.40 | - |
| zstd | 16k | 4.54 | 5.85 | 7.60 | 4.54 | 5.85 | 7.61 | - |
| zstd | 64k | 4.51 | 5.80 | 7.55 | 4.51 | 5.81 | 7.56 | - |
| zstd | 256k | 4.48 | 5.75 | 7.49 | 4.48 | 5.75 | 7.49 | - |

otl1.49M: encoding profiles (64k, f32, rollups+occ; nodes MB / tips.parquet MB, the sweep wrote labels, node id and metadata in ONE tips file)

| encoding | none | snappy | zstd |
|---|---|---|---|
| default | 32.02 / 65.65 | 27.89 / 33.31 | 21.45 / 22.00 |
| plain | 82.09 / 65.65 | 25.26 / 33.31 | 14.19 / 22.00 |
| bss | 82.09 / 65.65 | 25.26 / 33.31 | 14.19 / 22.00 |
| tuned | 47.03 / 59.94 | 11.48 / 27.54 | 7.55 / 18.19 |

otl1.49M: flat binary (same columns, little-endian, no row groups), MB

| float | cols | raw | gzip -9 | zstd | zstd 64k chunks | zstd byte-shuffled |
|---|---|---|---|---|---|---|
| f32 | base | 20.61 | 3.15 | 5.28 | 5.10 | 1.34 |
| f32 | rollups | 54.96 | 6.00 | 9.92 | 9.79 | 2.33 |
| f32 | rollups+occ | 68.70 | 7.80 | 11.65 | 11.50 | 3.58 |
| f64 | base | 27.48 | 3.16 | 5.28 | 5.10 | 1.34 |
| f64 | rollups | 75.57 | 6.03 | 9.91 | 9.79 | 2.33 |
| f64 | rollups+occ | 89.31 | 7.83 | 11.63 | 11.51 | 3.58 |

otl1.49M: labels flat = raw 47.69 / gzip 13.43 / zstd 14.91; tips.parquet with label dictionary (zstd) 19.65 vs plain 18.19; TSV tip_label+occurrence_count+country raw 55.70 / gzip 17.38; TSV occurrence_count only raw 3.54 / gzip 1.09

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

#### First usable overview: pieces (ms, median of the repetitions)

| Tree | Profile | manifest | overview tail | total | requests | bytes | overview typed arrays KB | afterwards: footers of nodes + tips (2 parallel requests) |
|---|---|---|---|---|---|---|---|---|
| yule10k | none | 5 | 27 | 32 | 2 | 42,107 | 120 | 5 ms, 3 KB |
| yule10k | wifi | 78 | 52 | 130 | 2 | 42,107 | 120 | 64 ms, 3 KB |
| yule10k | 4g | 456 | 199 | 655 | 2 | 42,107 | 120 | 457 ms, 3 KB |
| yule10k | 3g | 1211 | 593 | 1804 | 2 | 42,107 | 120 | 1209 ms, 3 KB |
| otl91k | none | 4 | 23 | 28 | 2 | 18,671 | 120 | 7 ms, 11 KB |
| otl91k | wifi | 66 | 47 | 113 | 2 | 18,671 | 120 | 66 ms, 11 KB |
| otl91k | 4g | 457 | 186 | 643 | 2 | 18,671 | 120 | 456 ms, 11 KB |
| otl91k | 3g | 1210 | 507 | 1718 | 2 | 18,671 | 120 | 1212 ms, 11 KB |
| yule100k | none | 4 | 29 | 33 | 2 | 51,255 | 120 | 6 ms, 14 KB |
| yule100k | wifi | 66 | 59 | 124 | 2 | 51,255 | 120 | 65 ms, 14 KB |
| yule100k | 4g | 456 | 218 | 675 | 2 | 51,255 | 120 | 457 ms, 14 KB |
| yule100k | 3g | 1212 | 673 | 1885 | 2 | 51,255 | 120 | 1207 ms, 14 KB |
| gtdb190k | none | 4 | 26 | 29 | 2 | 58,130 | 128 | 11 ms, 30 KB |
| gtdb190k | wifi | 65 | 55 | 119 | 2 | 58,130 | 128 | 65 ms, 30 KB |
| gtdb190k | 4g | 456 | 222 | 678 | 2 | 58,130 | 128 | 457 ms, 30 KB |
| gtdb190k | 3g | 1209 | 672 | 1882 | 2 | 58,130 | 128 | 1206 ms, 30 KB |
| yule1M | none | 4 | 23 | 28 | 2 | 63,448 | 120 | 27 ms, 122 KB |
| yule1M | wifi | 66 | 58 | 124 | 2 | 63,448 | 120 | 73 ms, 122 KB |
| yule1M | 4g | 456 | 218 | 674 | 2 | 63,448 | 120 | 471 ms, 122 KB |
| yule1M | 3g | 1207 | 670 | 1878 | 2 | 63,448 | 120 | 1291 ms, 122 KB |
| otl1.49M | none | 5 | 22 | 27 | 2 | 28,068 | 120 | 22 ms, 118 KB |
| otl1.49M | wifi | 65 | 50 | 115 | 2 | 28,068 | 120 | 70 ms, 118 KB |
| otl1.49M | 4g | 456 | 187 | 643 | 2 | 28,068 | 120 | 476 ms, 118 KB |
| otl1.49M | 3g | 1209 | 510 | 1719 | 2 | 28,068 | 120 | 1294 ms, 118 KB |



### 6.3 Fetching a clade, and what row-group size does to it

#### Clade fetch: nodes only / nodes + labels (median of repetitions and of the two clades; ms, requests, KB)

| Tree | Profile | target tips | nodes rows | nodes only | nodes + labels |
|---|---|---|---|---|---|
| yule10k | wifi | 1,000 (actual 969, 1153) | 1,937 | 51 ms, 1 req, 91 KB | 59 ms, 2 req, 120 KB |
| yule10k | 4g | 1,000 (actual 969, 1153) | 1,937 | 240 ms, 1 req, 91 KB | 265 ms, 2 req, 120 KB |
| yule10k | 3g | 1,000 (actual 969, 1153) | 1,937 | 866 ms, 1 req, 91 KB | 1013 ms, 2 req, 120 KB |
| otl91k | wifi | 1,000 (actual 994, 999) | 1,669 | 40 ms, 1 req, 53 KB | 82 ms, 2 req, 172 KB |
| otl91k | wifi | 10,000 (actual 10018, 7868) | 14,874 | 39 ms, 1 req, 51 KB | 80 ms, 2 req, 174 KB |
| otl91k | 4g | 1,000 (actual 994, 999) | 1,669 | 202 ms, 1 req, 53 KB | 311 ms, 2 req, 172 KB |
| otl91k | 4g | 10,000 (actual 10018, 7868) | 14,874 | 201 ms, 1 req, 51 KB | 315 ms, 2 req, 174 KB |
| otl91k | 3g | 1,000 (actual 994, 999) | 1,669 | 660 ms, 1 req, 53 KB | 1242 ms, 2 req, 172 KB |
| otl91k | 3g | 10,000 (actual 10018, 7868) | 14,874 | 658 ms, 1 req, 51 KB | 1255 ms, 2 req, 174 KB |
| yule100k | wifi | 1,000 (actual 1007, 1002) | 2,013 | 68 ms, 1 req, 148 KB | 81 ms, 2 req, 195 KB |
| yule100k | wifi | 10,000 (actual 9864, 10123) | 19,727 | 118 ms, 1 req, 315 KB | 142 ms, 2 req, 412 KB |
| yule100k | 4g | 1,000 (actual 1007, 1002) | 2,013 | 294 ms, 1 req, 148 KB | 335 ms, 2 req, 195 KB |
| yule100k | 4g | 10,000 (actual 9864, 10123) | 19,727 | 441 ms, 1 req, 315 KB | 531 ms, 2 req, 412 KB |
| yule100k | 3g | 1,000 (actual 1007, 1002) | 2,013 | 1152 ms, 1 req, 148 KB | 1396 ms, 2 req, 195 KB |
| yule100k | 3g | 10,000 (actual 9864, 10123) | 19,727 | 1981 ms, 1 req, 315 KB | 2474 ms, 2 req, 412 KB |
| gtdb190k | wifi | 1,000 (actual 1000, 999) | 1,999 | 81 ms, 1 req, 206 KB | 90 ms, 2 req, 245 KB |
| gtdb190k | wifi | 10,000 (actual 10126, 10008) | 20,251 | 184 ms, 1 req, 554 KB | 215 ms, 2 req, 657 KB |
| gtdb190k | 4g | 1,000 (actual 1000, 999) | 1,999 | 333 ms, 1 req, 206 KB | 371 ms, 2 req, 245 KB |
| gtdb190k | 4g | 10,000 (actual 10126, 10008) | 20,251 | 663 ms, 1 req, 554 KB | 758 ms, 2 req, 657 KB |
| gtdb190k | 3g | 1,000 (actual 1000, 999) | 1,999 | 1395 ms, 1 req, 206 KB | 1618 ms, 2 req, 245 KB |
| gtdb190k | 3g | 10,000 (actual 10126, 10008) | 20,251 | 3205 ms, 1 req, 554 KB | 3750 ms, 2 req, 657 KB |
| yule1M | wifi | 1,000 (actual 999, 1000) | 1,997 | 69 ms, 1 req, 149 KB | 83 ms, 2 req, 196 KB |
| yule1M | wifi | 10,000 (actual 10026, 9983) | 20,051 | 141 ms, 1 req, 402 KB | 178 ms, 2 req, 524 KB |
| yule1M | wifi | 100,000 (actual 97196, 104601) | 194,391 | 706 ms, 1 req, 2,246 KB | 906 ms, 2 req, 2,915 KB |
| yule1M | 4g | 1,000 (actual 999, 1000) | 1,997 | 293 ms, 1 req, 149 KB | 336 ms, 2 req, 196 KB |
| yule1M | 4g | 10,000 (actual 10026, 9983) | 20,051 | 523 ms, 1 req, 402 KB | 634 ms, 2 req, 524 KB |
| yule1M | 4g | 100,000 (actual 97196, 104601) | 194,391 | 2268 ms, 1 req, 2,246 KB | 2870 ms, 2 req, 2,915 KB |
| yule1M | 3g | 1,000 (actual 999, 1000) | 1,997 | 1153 ms, 1 req, 149 KB | 1391 ms, 2 req, 196 KB |
| yule1M | 3g | 10,000 (actual 10026, 9983) | 20,051 | 2435 ms, 1 req, 402 KB | 3059 ms, 2 req, 524 KB |
| otl1.49M | wifi | 1,000 (actual 1000, 999) | 1,082 | 32 ms, 1 req, 21 KB | 89 ms, 2 req, 168 KB |
| otl1.49M | wifi | 10,000 (actual 10018, 9982) | 14,874 | 36 ms, 1 req, 34 KB | 85 ms, 2 req, 170 KB |
| otl1.49M | wifi | 100,000 (actual 103155, 96477) | 152,913 | 223 ms, 4 req, 545 KB | 674 ms, 6 req, 1,784 KB |
| otl1.49M | 4g | 1,000 (actual 1000, 999) | 1,082 | 176 ms, 1 req, 21 KB | 323 ms, 2 req, 168 KB |
| otl1.49M | 4g | 10,000 (actual 10018, 9982) | 14,874 | 191 ms, 1 req, 34 KB | 325 ms, 2 req, 170 KB |
| otl1.49M | 4g | 100,000 (actual 103155, 96477) | 152,913 | 980 ms, 4 req, 545 KB | 1950 ms, 6 req, 1,784 KB |
| otl1.49M | 3g | 1,000 (actual 1000, 999) | 1,082 | 494 ms, 1 req, 21 KB | 1242 ms, 2 req, 168 KB |
| otl1.49M | 3g | 10,000 (actual 10018, 9982) | 14,874 | 578 ms, 1 req, 34 KB | 1289 ms, 2 req, 170 KB |



hyparquet reads whole column chunks of every row group a range touches, so the cost of a small clade is set by the row-group size, not by the clade. Variants of the 1M-tip Yule tree on the 4G profile (decode column: cache-hot, unthrottled). Rows without "second pass" come from the first measurement pass (overview budget counting nodes, one `tips.parquet`; the node table, which sets the clade bytes, was built the same way); the three "second pass" rows were measured on the final layout:

| Variant (1M-tip Yule) | nodes.parquet MB | decode ms/100k rows (9 cols) | 4G: overview ms | 4G: 1k clade ms, KB, req | 4G: 10k clade ms, KB, req | 4G: 100k clade ms, MB, req |
|---|---|---|---|---|---|---|
| zstd, 64k rows/group (first pass; the reference for the rows below) | 21.0 | 27.1 | 695 | 859, 777.1, 2 | 1232, 1,169.6, 3 | 3226, 3.4, 8 |
| uncompressed, 64k | 49.0 | 12.6 | 707 | 1828, 1,829.2, 2 | 2655, 2,746.3, 3 | 7262, 8.0, 9 |
| snappy, 64k | 26.1 | 16.5 | 684 | 1051, 983.9, 2 | 1504, 1,479.0, 3 | 3991, 4.3, 9 |
| zstd with PLAIN encodings, 64k | 25.0 | 37.3 | 706 | 987, 905.0, 2 | 1398, 1,359.5, 3 | 3683, 3.9, 9 |
| zstd, 256k rows/group | 21.0 | 28.8 | 673 | 3005, 3,118.5, 2 | 2480, 2,535.9, 2 | 5325, 5.8, 4 |
| zstd, 64k rows + 64 KB pages + page index (`useOffsetIndex`) | 21.0 | 25.4 | 699 | 695, 324.7, 6 | 1008, 668.8, 7 | 2749, 2.9, 13 |
| zstd, 16k rows/group (first pass) | 21.1 | 24.1 | 715 | 336, 196.2, 2 | 657, 545.8, 2 | 3025, 3.2, 2 |
| **second pass, final layout:** zstd, 64k rows/group | 21.0 | 24.1 | 672 | 856, 777.1, 2 | 1225, 1,169.6, 3 | 3223, 3.4, 8 |
| **second pass, final layout:** zstd, 16k rows/group (the layout used for all main tables) | 21.1 | 26.1 | 674 | 336, 196.2, 2 | 634, 524.2, 2 | 2870, 3.0, 2 |
| **second pass, final layout:** zstd, 8k rows/group | 21.3 | 24.6 | 676 | 238, 98.5, 2 | 515, 391.8, 2 | 2977, 3.1, 2 |

Reading the table:

- **Row-group size is the main knob.** 16k rows per group cuts the cost of a 1k-tip clade from 777 KB to 196 KB and from 856 ms to 337 ms on 4G (file 0.5 percent larger); 8k rows halves it again (98 KB, 238 ms) at the price of a 196 KB footer (99 KB at 16k, 26 KB at 64k, `results/footer-size-yule1M.txt`; without column statistics 124 KB, 63 KB, 17 KB) and a 1 percent larger file; 256k rows is much worse (3.1 MB for a 1k-tip clade). 16k is the default of the final layout; 8k is worth it only if small clades dominate.
- **Coalescing makes row groups cheap to read in bulk**: a 100k-tip clade is 13 row groups but 2 requests (nodes in one, labels in one), 3.1 MB in 3.0 s on 4G.
- **A page index is not worth it.** 64 KB pages with `useOffsetIndex` read 325 KB for the 1k-tip clade (against 777 KB without) but need 6 to 7 requests instead of 2, which is slower on 4G (695 ms) than 16k row groups (337 ms) with no page index.
- **Codec and encoding**: uncompressed files decode fastest (12.6 ms per 100k node rows) but are 2.3 times larger and 2 to 3 times slower to fetch on every throttled profile; snappy decodes in 16.5 ms against 27 for zstd and is 25 percent larger; PLAIN encodings (no delta, no byte-split) are 19 percent larger than `tuned` and slower to decode in JS (37 ms) because there is more to decompress. zstd with `tuned` encodings wins on every throttled profile.

### 6.4 Decode cost, path, focus, label lookup, memory

#### Decode cost, cache-hot, unthrottled profile (ms per 100k rows; best of 3)

| Tree | all 9 node columns | 2 columns (subtree_end, tip_count) | tip_label (100k tips) | occurrence_count (100k tips) |
|---|---|---|---|---|
| yule10k | 22.0 | 4.5 | 45.0 | 6.0 |
| otl91k | 18.9 | 3.2 | 75.8 | 4.5 |
| yule100k | 23.4 | 4.8 | 58.3 | 4.4 |
| gtdb190k | 22.9 | 4.6 | 54.5 | 4.5 |
| yule1M | 26.1 | 4.5 | 61.5 | 4.7 |
| otl1.49M | 18.6 | 3.6 | 91.9 | 6.7 |



#### Path, focus-a-tip, label lookup (median over 3 tips; ms, requests, KB)

| Tree | Profile | path root to tip | focusTip (path + clade >= 1000 tips + overview level) | label to rank |
|---|---|---|---|---|
| yule10k | wifi | 58 ms, 2 req, 102 KB | 127 ms, 4 req, 291 KB | 72 ms, 2 req, 80 KB |
| yule10k | 4g | 253 ms, 2 req, 102 KB | 572 ms, 4 req, 291 KB | 383 ms, 2 req, 80 KB |
| yule10k | 3g | 908 ms, 2 req, 102 KB | 2261 ms, 4 req, 291 KB | 1155 ms, 2 req, 80 KB |
| otl91k | wifi | 58 ms, 3 req, 48 KB | 128 ms, 6 req, 152 KB | 131 ms, 2 req, 231 KB |
| otl91k | 4g | 343 ms, 3 req, 48 KB | 718 ms, 6 req, 152 KB | 535 ms, 2 req, 231 KB |
| otl91k | 3g | 997 ms, 3 req, 48 KB | 2936 ms, 6 req, 152 KB | 1983 ms, 2 req, 231 KB |
| yule100k | wifi | 76 ms, 3 req, 113 KB | 159 ms, 5 req, 310 KB | 93 ms, 2 req, 134 KB |
| yule100k | 4g | 401 ms, 3 req, 113 KB | 739 ms, 5 req, 310 KB | 443 ms, 2 req, 134 KB |
| yule100k | 3g | 1325 ms, 3 req, 113 KB | 3507 ms, 5 req, 310 KB | 1489 ms, 2 req, 134 KB |
| gtdb190k | wifi | 79 ms, 4 req, 67 KB | 170 ms, 6 req, 319 KB | 93 ms, 2 req, 96 KB |
| gtdb190k | 4g | 475 ms, 4 req, 67 KB | 861 ms, 6 req, 319 KB | 406 ms, 2 req, 96 KB |
| gtdb190k | 3g | 1363 ms, 4 req, 67 KB | 2952 ms, 6 req, 319 KB | 1245 ms, 2 req, 96 KB |
| yule1M | wifi | 98 ms, 3 req, 189 KB | 223 ms, 6 req, 548 KB | 101 ms, 2 req, 150 KB |
| yule1M | 4g | 480 ms, 3 req, 189 KB | 1012 ms, 6 req, 548 KB | 442 ms, 2 req, 150 KB |
| yule1M | 3g | 1756 ms, 3 req, 189 KB | 3960 ms, 6 req, 548 KB | 1493 ms, 2 req, 150 KB |
| otl1.49M | wifi | 69 ms, 3 req, 81 KB | 327 ms, 6 req, 661 KB | 136 ms, 2 req, 241 KB |
| otl1.49M | 4g | 380 ms, 3 req, 81 KB | 1251 ms, 6 req, 661 KB | 538 ms, 2 req, 241 KB |
| otl1.49M | 3g | 1188 ms, 3 req, 81 KB | 4928 ms, 6 req, 661 KB | 2046 ms, 2 req, 241 KB |



#### Memory held after loading (forced GC; JS heap delta and typed-array bytes) vs baseline TreeModel

| Tree | Profile | Parquet: overview level 0 + one clade | JS heap Δ | typed arrays | Baseline TreeModel typed arrays | Baseline JS heap Δ |
|---|---|---|---|---|---|---|
| yule10k | wifi | clade 1,153 tips | 1.6 MB | 0.2 MB | 1.2 MB | 2.1 MB |
| otl91k | wifi | clade 7,868 tips | 2.2 MB | 0.5 MB | 8.7 MB | 15.8 MB |
| yule100k | wifi | clade 10,123 tips | 5.2 MB | 0.9 MB | 12.4 MB | 20.3 MB |
| gtdb190k | wifi | clade 10,008 tips | 5.6 MB | 0.9 MB | 23.5 MB | 36.0 MB |
| yule1M | wifi | clade 104,601 tips | 34.5 MB | 7.7 MB | 124.0 MB | 154.6 MB |
| otl1.49M | wifi | clade 96,477 tips | 15.1 MB | 4.0 MB | 109.0 MB | 137.8 MB |



#### Baseline pieces (median, wifi profile): download / inflate / parse + build (ms)

| Tree | gz MB | fetch | inflate | parse + TreeModel | total |
|---|---|---|---|---|---|
| yule10k (none) | 0.1 | 4 | 5 | 20 | 30 |
| otl91k (none) | 1.2 | 14 | 29 | 102 | 145 |
| yule100k (none) | 1.5 | 13 | 29 | 115 | 156 |
| gtdb190k (none) | 2.4 | 20 | 52 | 231 | 303 |
| yule1M (none) | 14.5 | 89 | 268 | 999 | 1357 |
| otl1.49M (none) | 15.0 | 104 | 491 | 902 | 1497 |

## 7. Per-tip metadata: column and row-group selection against a TSV

A TSV with `tip_label`, `occurrence_count` and `country_code` has to be downloaded whole (gzipped: 0.69 MB for 100k tips, 6.8 MB for 1M, 17.4 MB for the Open Tree tips because of the long labels) and parsed before any value is known. `occurrence_count` alone as TSV is 0.07 MB (100k) to 1.1 MB (1.49M) gzipped, which is the fairest comparison for "the counts of all tips". With `tipmeta.parquet` (separate from the labels, same row groups as the nodes) a viewer reads only the columns and row groups it needs:

| Tree | TSV with all three columns (gzip) | TSV `occurrence_count` only (gzip) | Parquet: `occurrence_count` for the tips of a 10k-tip clade | ... for ALL tips (the whole column) | Parquet: `tip_label` for the 10k clade | Parquet: all 3 columns for the 10k clade |
|---|---|---|---|---|---|---|
| yule10k | - | - | 9 KB (2 req, 316 ms on 4G) | 16 KB (1 req, 169 ms on 4G) | 47 KB (1 req, 189 ms on 4G) | 62 KB (2 req, 207 ms on 4G) |
| otl91k | - | - | 12 KB (2 req, 311 ms on 4G) | 154 KB (1 req, 292 ms on 4G) | 121 KB (1 req, 272 ms on 4G) | 140 KB (2 req, 287 ms on 4G) |
| yule100k | 0.69 MB | 0.07 MB | 25 KB (2 req, 325 ms on 4G) | 174 KB (1 req, 305 ms on 4G) | 97 KB (1 req, 270 ms on 4G) | 126 KB (2 req, 286 ms on 4G) |
| gtdb190k | 1.24 MB | 0.14 MB | 41 KB (2 req, 342 ms on 4G) | 331 KB (1 req, 454 ms on 4G) | 122 KB (1 req, 276 ms on 4G) | 165 KB (2 req, 310 ms on 4G) |
| yule1M | 6.84 MB | 0.73 MB | 60 KB (2 req, 360 ms on 4G) | 1,751 KB (1 req, 1810 ms on 4G) | 147 KB (1 req, 313 ms on 4G) | 190 KB (2 req, 359 ms on 4G) |
| otl1.49M | 17.38 MB | 1.09 MB | 30 KB (2 req, 335 ms on 4G) | 2,551 KB (1 req, 2572 ms on 4G) | 121 KB (1 req, 275 ms on 4G) | 140 KB (2 req, 282 ms on 4G) |

#### Per-tip columns for the tips of one clade (the 10k-tip clade) vs the whole column (ms, requests, KB)

| Tree | Profile | occurrence_count | occurrence_count + country | tip_label | all 3 | occurrence_count of ALL tips |
|---|---|---|---|---|---|---|
| yule10k | wifi | 69 ms, 2 req, 9 KB | 26 ms, 1 req, 14 KB | 36 ms, 1 req, 47 KB | 43 ms, 2 req, 62 KB | 27 ms, 1 req, 16 KB |
| yule10k | 4g | 316 ms, 2 req, 9 KB | 159 ms, 1 req, 14 KB | 189 ms, 1 req, 47 KB | 207 ms, 2 req, 62 KB | 169 ms, 1 req, 16 KB |
| yule10k | 3g | 817 ms, 2 req, 9 KB | 409 ms, 1 req, 14 KB | 578 ms, 1 req, 47 KB | 654 ms, 2 req, 62 KB | 491 ms, 1 req, 16 KB |
| otl91k | wifi | 50 ms, 2 req, 12 KB | 32 ms, 1 req, 18 KB | 71 ms, 1 req, 121 KB | 69 ms, 2 req, 140 KB | 67 ms, 1 req, 154 KB |
| otl91k | 4g | 311 ms, 2 req, 12 KB | 171 ms, 1 req, 18 KB | 272 ms, 1 req, 121 KB | 287 ms, 2 req, 140 KB | 292 ms, 1 req, 154 KB |
| otl91k | 3g | 816 ms, 2 req, 12 KB | 493 ms, 1 req, 18 KB | 998 ms, 1 req, 121 KB | 1086 ms, 2 req, 140 KB | 1150 ms, 1 req, 154 KB |
| yule100k | wifi | 54 ms, 2 req, 25 KB | 42 ms, 1 req, 29 KB | 73 ms, 1 req, 97 KB | 73 ms, 2 req, 126 KB | 75 ms, 1 req, 174 KB |
| yule100k | 4g | 325 ms, 2 req, 25 KB | 174 ms, 1 req, 29 KB | 270 ms, 1 req, 97 KB | 286 ms, 2 req, 126 KB | 305 ms, 1 req, 174 KB |
| yule100k | 3g | 898 ms, 2 req, 25 KB | 492 ms, 1 req, 29 KB | 923 ms, 1 req, 97 KB | 1058 ms, 2 req, 126 KB | 1231 ms, 1 req, 174 KB |
| gtdb190k | wifi | 58 ms, 2 req, 41 KB | 39 ms, 1 req, 43 KB | 87 ms, 1 req, 122 KB | 91 ms, 2 req, 165 KB | 127 ms, 1 req, 331 KB |
| gtdb190k | 4g | 342 ms, 2 req, 41 KB | 189 ms, 1 req, 43 KB | 276 ms, 1 req, 122 KB | 310 ms, 2 req, 165 KB | 454 ms, 1 req, 331 KB |
| gtdb190k | 3g | 981 ms, 2 req, 41 KB | 577 ms, 1 req, 43 KB | 1009 ms, 1 req, 122 KB | 1230 ms, 2 req, 165 KB | 2061 ms, 1 req, 331 KB |
| yule1M | wifi | 63 ms, 2 req, 60 KB | 39 ms, 1 req, 43 KB | 87 ms, 1 req, 147 KB | 90 ms, 2 req, 190 KB | 551 ms, 1 req, 1,751 KB |
| yule1M | 4g | 360 ms, 2 req, 60 KB | 193 ms, 1 req, 43 KB | 313 ms, 1 req, 147 KB | 359 ms, 2 req, 190 KB | 1810 ms, 1 req, 1,751 KB |
| yule1M | 3g | 1071 ms, 2 req, 60 KB | 576 ms, 1 req, 43 KB | 1172 ms, 1 req, 147 KB | 1385 ms, 2 req, 190 KB | 9399 ms, 1 req, 1,751 KB |
| otl1.49M | wifi | 54 ms, 2 req, 30 KB | 30 ms, 1 req, 18 KB | 67 ms, 1 req, 121 KB | 67 ms, 2 req, 140 KB | 823 ms, 1 req, 2,551 KB |
| otl1.49M | 4g | 335 ms, 2 req, 30 KB | 171 ms, 1 req, 18 KB | 275 ms, 1 req, 121 KB | 282 ms, 2 req, 140 KB | 2572 ms, 1 req, 2,551 KB |
| otl1.49M | 3g | 902 ms, 2 req, 30 KB | 491 ms, 1 req, 18 KB | 1010 ms, 1 req, 121 KB | 1092 ms, 2 req, 140 KB | 13504 ms, 1 req, 2,551 KB |



What this shows:

- **For the tips of one clade the saving is large**: on the 1M-tip tree `occurrence_count` of a 10k-tip clade is 60 KB in 2 requests (0.36 s on 4G), against 6.8 MB for the TSV, 110 times less; the clade's labels add 147 KB, all three columns 190 KB. The gain comes from three things: the labels are not shipped with the numbers, only the row groups of the clade are read (about 8,000 tips per group), and zstd.
- **For all tips at once Parquet is not smaller than a single-column TSV**: the whole `occurrence_count` column (plus `country`, which hyparquet's and our coalescing merge into the same request) is 1.75 MB for 1M tips, against 0.73 MB for the gzipped one-column TSV, because decimal text of heavy-tailed small integers compresses better with gzip than a PLAIN int32 column does with zstd (a byte-split or delta encoding for this column was not tried, **unverified**). The case for columns is subsets and not shipping labels, not the whole column.
- **Why the metadata is a separate file.** In the first measurement `tips.parquet` held labels, node ids and metadata together; reading `occurrence_count` for all tips then fetched 7.7 MB (the whole file) because the labels chunk between two `occurrence_count` chunks is smaller than the 64 KB gap that the coalescer bridges to save round trips. Column selection only pays if the unwanted columns are far apart or in another file.
- **Clade rollups in the node table** (`occ_sum`: sum of `occurrence_count` below each node) cost 2.4 MB of the 21 MB node file for 1M tips (zstd), and let a zoomed-out view show clade totals from overview rows without any per-tip read.

## 8. Fit with the renderer: the `TreeSource` proposal

Goal: today's in-memory behaviour is the trivial implementation of one interface, so Parquet is a second `TreeSource`, not a second renderer. The proposal is type-checked (`tsc --strict`) in [spikes/parquet-experiment/proposal/tree-source.ts](../../spikes/parquet-experiment/proposal/tree-source.ts) against the real `TreeData` type of `spikes/custom/src/core/types.ts` (read only; nothing in `spikes/custom` was edited).

```ts
import type { TreeData } from '../../custom/src/core/types.ts';

/** What the renderer reads each frame: today's TreeData plus rollups and stubs. Rows are in PREORDER of the loaded subset, so a loaded
 *  clade is still a contiguous index range and lod.ts keeps jumping with subtreeEnd. */
export interface TreeSnapshot extends TreeData {
  readonly stub: Uint8Array;            // 1 = row stands for a clade whose rows are not loaded: drawn as a triangle, never descended into
  readonly globalId: Int32Array | null; // local row -> preorder id in the FULL tree (public API speaks global ids); null = identity
  readonly depth: Int32Array;
  readonly maxDepth: Int32Array;        // deepest tip below (cladogram X for stubs)
  readonly cumLength: Float32Array | Float64Array;
  readonly maxCum: Float32Array | Float64Array;   // XMAX source
  readonly row: Float32Array | Float64Array;      // layout y; stubs: stored, loaded clades: recomputed from their children
  readonly aggregates?: Readonly<Record<string, Float64Array>>; // per-clade column rollups, e.g. occ_sum
  isTip(i: number): boolean;            // childCount[i] === 0 && !stub[i]
  toLocal(globalId: number): number;    // -1 if not in the snapshot
}

export interface EnsureOptions { signal?: AbortSignal; priority?: number; labels?: boolean }

export interface TreeSource {
  readonly nodeCount: number;
  readonly tipCount: number;
  readonly hasLengths: boolean;
  readonly version: number;                                   // bumps whenever snapshot() would return different rows
  subscribe(listener: (version: number) => void): () => void; // renderer repaints on notification
  snapshot(): TreeSnapshot;                                   // never async; loaded clades in full, everything else as stubs
  ensure(lo: number, hi: number, o?: EnsureOptions): Promise<void>;   // rows [lo, hi) (a clade is [i, subtreeEnd[i])) join the snapshot
  ensureClade(globalId: number, o?: EnsureOptions): Promise<void>;    // open a stub
  ensureTip(rank: number, minTips?: number, o?: EnsureOptions): Promise<{ node: number }>; // occurrence-page case
  tipLabels(r0: number, r1: number): Promise<string[]>;
  tipRankOf(label: string): Promise<number>;
  tipColumn?(id: string, r0: number, r1: number): Promise<Float64Array | Int32Array | string[]>;
  trim?(keep: Array<[number, number]>): void;                 // optional memory cap
  destroy(): void;
}
```

`InMemorySource` (also in the proposal file, 15 lines) wraps today's `TreeModel`: `version` never changes, `ensure*` resolve immediately, `stub` is all zero, `globalId` is `null`, `subscribe` returns a no-op. The renderer therefore needs no `if (partial)` branches: a snapshot without stubs behaves exactly like today.

### What the renderer needs from a partially loaded tree

1. **Stub rows carrying rollups.** A stub is one row with `leafStart`/`leafEnd` (global tip ranks, as today), `tipCount = leafEnd - leafStart`, `depth`, `maxDepth`, `cumLength`, `maxCum`, `row` and optional aggregates. These are exactly the columns the overview pyramid stores, and `test/overview_vs_layout.mjs` shows that for every overview row `X`, `XMAX` and `ROW` equal what `computeLayout()` derives from the full tree (section 4). `computeLayout` therefore takes `X`, `XMAX`, `ROW` of stub rows from the snapshot instead of from its bottom-up passes; for loaded clades it keeps computing them (the node table does not store `row`; `layoutRows()` in the reader recomputes it exactly).
2. **Drawn as triangles until detail arrives.** In `cutRect`/`cutRadial` a stub is always `K_SUMMARY` (never `K_NODE`), whatever its pixel size; `subtreeEnd[i] = i + 1` makes the existing "jump past the subtree" logic work unchanged. The cut additionally records stubs whose on-screen height exceeds a threshold (for example 24 px, or the clade covers more than a third of the viewport) into a small `needDetail` list.
3. **`ensure(lo, hi)` returns a promise.** After each frame the renderer calls `source.ensureClade(globalId, { priority, signal })` for the `needDetail` list (nearest to the viewport centre first, cancelled with the `AbortSignal` when the viewport moves on, at most 4 in flight). Because each clade fetch is one coalesced range request, 4 in flight stay below the browser's 6 connections per host.
4. **Version / notify.** `subscribe(cb)` fires once per batch of arrived rows (not per row group). The renderer rebuilds the compact snapshot-derived arrays (`Layout`, hit index) and calls its existing `invalidate()`. Cost is O(loaded rows); at the measured 10k to 100k loaded rows this is a few milliseconds (it is the same pass `computeLayout` already makes, measured at 0.3 s for 1M nodes in docs/results/custom.md).
5. **Ids.** The public API (`NodeEvent.node`, `setClades`, `focusTip`, `zoomToNode`) keeps speaking global preorder ids; the renderer maps global to local with `toLocal()` (binary search over `globalId`) at the boundary, and `classOf` / highlight arrays are kept per global range (`setClades` already fills `[node, subtreeEnd[node])`, which is a global range, so it is stored as a list of ranges instead of a dense `Uint8Array(nodeCount)` when the source is partial).
6. **Hit testing and the descendant-tip-set contract for stubs.** `hit.ts` builds its grid from the draw list, and a stub is a normal `K_SUMMARY` entry, so hover and click already work. `NodeEvent` carries `tipStart = leafStart[i]`, `tipEnd = leafEnd[i]` which are the global ranks of the clade: **a click on a stub clade still yields the tip range `[leaf_start, leaf_start + tip_count)`** without loading any row. What is *not* available synchronously is the label list: the host calls `await source.tipLabels(tipStart, tipEnd)` (one `tips.parquet` read, for the 10k-tip clade measured in section 6), or, for very large clades, uses the range itself (for example as a server-side filter) rather than 1M labels. This is a contract change for the host: today `descendantTips` is synchronous.
7. **Focus a tip (occurrence page).** `ensureTip(rank, minTips = 1000)`: a tip-label read gives the node id (`node` column of `tips.parquet`; one small read, **not** included in the focus numbers of section 6.4), `getPath(node)` returns the ancestor chain with `tip_count` from one node row group plus `spine.parquet` (measured: section 6), then one range read for the smallest ancestor clade with at least `minTips` tips, and the overview level whose expanded clades are all at least that large (`level_min_tips` in the manifest) so every ancestor above the loaded clade is a regular row with its child stubs. Label to rank: `tipRankOf(label)` reads the footer of `labels.parquet` and one row group of it (measured in section 6).
8. **Keyboard navigation and accessibility.** `ArrowRight` on a stub triggers `ensureClade` and moves to the first child once it arrives; the screen-reader list (`srList`) only lists loaded tips and announces stubs as "clade of N tips, loading".

### What in the current custom renderer assumes everything is in memory

Read from `spikes/custom/src/core/` (line numbers as of the commit this experiment started from):

| Where | Assumption | Change |
|---|---|---|
| `types.ts` `TreeData` | dense typed arrays indexed by preorder id for the whole tree, `tipLabels: string[]` and `labels: string[]` for all nodes, `tipIndex(label)` map over all labels, `heights()` over the whole tree | split into `TreeSnapshot` (rows) and async label/lookup methods on `TreeSource` |
| `layout.ts` `computeLayout` | three whole-tree passes: `X` from `length`, `ROW` bottom-up from `firstChild`/`LAST`, `XMAX` bottom-up; cladogram X needs `heights()` of the whole tree; `Map<boolean, Layout>` cache per `branchLengths` | stub rows take `X/XMAX/ROW` from rollups; recompute per snapshot version (O(loaded)); cache keyed by (version, flag) |
| `lod.ts` `cutRect`/`cutRadial` | `i < n` scan with `childCount[i] === 0` meaning tip; a node is expanded or collapsed by pixel size only | stub always summary; emit `needDetail`; `isTip` via stub flag |
| `hit.ts` `HitIndex` | reads `tree.parent`, `leafStart`, `ROW`, `LAST`, `firstChild` of nodes in the draw list | works on the snapshot unchanged; stubs are summary items |
| `renderer.ts` lines ~217-240 `setClades`, `setHighlighted` | `new Uint8Array(nodeCount)` for clade classes, `hl = new Uint8Array(tipCount)`, `tipIndex(label)` for every highlighted label | ranges over global ids; labels resolved with `tipRankOf` (async) |
| `renderer.ts` ~287-345 `focusTip`, `zoomToNode`, `locateNode` | `tipNode[rank]`, `L.ROW[node]`, `L.X[node]` available for any node | `focusTip` becomes async via `ensureTip`; `zoomToNode` on a stub zooms to the stub's triangle then loads |
| `renderer.ts` ~535, 807, 863, 1156 labels | `tipLabels[rank]` for any visible rank, `labels[node]` for the live-region text | `tipLabels(r0, r1)` fetched for the visible rank window; text falls back to the clade size while loading |
| `renderer.ts` ~1199-1221 keyboard | `parent`, `firstChild`, `leafEnd` of any node | on stubs, load first |
| `columns.ts` `compileColumns` | iterates ALL tips and looks up `spec.values[tipLabels[r]]` once to build bar widths and ranges | per visible-window lazy values; `tipColumn()` for Parquet; stubs draw the clade aggregate (`occ_sum`) |
| `draw.ts` | `K_SUMMARY` fill uses the clade class and the stub triangle geometry from `ROW/XMAX` | stubs use the same code path; optional text "N tips" and aggregate bar for big stubs |
| `columns` / overview strip (`ovList`) | draws the whole tree once into the strip | draws from the snapshot (overview level 0 is enough) |
| React adapter (`adapter.tsx`, `react/`) | prop `tree: TreeModel` | prop `source: TreeSource` (a `tree` prop wraps an `InMemorySource`), loading / error / retry states |

### Refactor size (engineer-days, estimate, **unverified**: no code was written in `spikes/custom`)

| Piece | Days |
|---|---|
| `TreeSnapshot`/`TreeSource` types, `InMemorySource`, adapter so existing props still work | 1.5 |
| `layout.ts` with stub rollups, per-version recompute, tests against the in-memory layout (this experiment's `overview_vs_layout` is the seed) | 2 |
| `lod.ts` stub rule, `needDetail` list, radial variant | 1.5 |
| `renderer.ts`: subscription and repaint, `ensure` scheduling with priority and cancel, id mapping at the API boundary, async `focusTip`, class and highlight ranges, keyboard on stubs, labels for the visible window | 4 |
| `columns.ts` lazy per-window values and clade aggregates on stubs | 2 |
| `hit.ts` and event contract (async tip labels), a11y strings | 1 |
| `ParquetSource` (snapshot builder that merges overview rows and loaded clades into preorder arrays, eviction, abort, errors, retries, request budget) on top of the reader in this folder | 5 |
| Test harness: a latency-injecting mock source, partial-versus-full frame comparison (same viewport must give the same draw list apart from stubs), re-run S1 to S15 | 3 |
| Build pipeline: converter in the site build or the ingestion job, manifest versioning, CDN/CORS checks | 2 to 3 |
| **Total** | **about 22 to 25 days (4.5 to 5 weeks, one engineer)**, range 16 to 32 depending on how much of columns/search/accessibility is in scope |

The renderer-only part (rows 1 to 6) is about 12 to 14 days; the rest is source, tests and pipeline. A cheaper intermediate step (about 5 to 7 days, **unverified**) loads the *whole* tree from Parquet (or chunked flat files) into the existing `TreeModel` in a Worker with a progress bar and no stubs; that gives the byte savings of a binary format but none of the overview-first behaviour.

## 9. Break-even: when does overview-first beat the full download?

Medians of the two repetitions. "First view" compares the time to the first usable overview with the time until the baseline has a parsed `TreeModel`. "Overview + one 10k-tip clade" adds one clade fetch (with labels) to the overview, the minimum for a user who zooms once. The last column is how many 10k-tip clade fetches fit into the time the baseline needs, i.e. how long the user can keep zooming before the full download would have been finished anyway (assuming each zoom is a cold fetch of 10k tips, which is pessimistic: neighbouring clades share row groups).

| Tree | Tips | Profile | Overview-first: s (KB, requests) | Full gz Newick: s (MB) | First view: overview wins by | Overview + one 10k-tip clade (with labels): s | ... wins by | Clade fetches (10k tips each) until the lead is gone |
|---|---|---|---|---|---|---|---|---|
| yule10k | 10,000 | wifi | 0.13 (41, 2) | 0.14 (0.1) | 1.0x | 0.19 | 0.7x | 0 |
| yule10k | 10,000 | 4g | 0.65 (41, 2) | 0.62 (0.1) | 0.9x | 0.92 | 0.7x | -0 |
| yule10k | 10,000 | 3g | 1.80 (41, 2) | 1.98 (0.1) | 1.1x | 2.82 | 0.7x | 0 |
| otl91k | 90,938 | wifi | 0.11 (18, 2) | 0.51 (1.2) | 4.5x | 0.19 | 2.6x | 5 |
| otl91k | 90,938 | 4g | 0.64 (18, 2) | 1.64 (1.2) | 2.6x | 0.96 | 1.7x | 3 |
| otl91k | 90,938 | 3g | 1.72 (18, 2) | 7.34 (1.2) | 4.3x | 2.97 | 2.5x | 4 |
| yule100k | 100,000 | wifi | 0.12 (50, 2) | 0.61 (1.5) | 4.9x | 0.27 | 2.3x | 3 |
| yule100k | 100,000 | 4g | 0.67 (50, 2) | 1.90 (1.5) | 2.8x | 1.21 | 1.6x | 2 |
| yule100k | 100,000 | 3g | 1.88 (50, 2) | 8.69 (1.5) | 4.6x | 4.36 | 2.0x | 3 |
| gtdb190k | 189,801 | wifi | 0.12 (57, 2) | 1.11 (2.4) | 9.3x | 0.33 | 3.3x | 5 |
| gtdb190k | 189,801 | 4g | 0.68 (57, 2) | 2.91 (2.4) | 4.3x | 1.44 | 2.0x | 3 |
| gtdb190k | 189,801 | 3g | 1.88 (57, 2) | 13.49 (2.4) | 7.2x | 5.63 | 2.4x | 3 |
| yule1M | 1,000,000 | wifi | 0.12 (62, 2) | 5.13 (14.5) | 41.5x | 0.30 | 17.0x | 28 |
| yule1M | 1,000,000 | 4g | 0.67 (62, 2) | 14.56 (14.5) | 21.6x | 1.31 | 11.1x | 22 |
| yule1M | 1,000,000 | 3g | 1.88 (62, 2) | 74.93 (14.5) | 39.9x | 4.94 | 15.2x | 24 |
| otl1.49M | 1,490,245 | wifi | 0.11 (27, 2) | 5.38 (15.0) | 46.8x | 0.20 | 26.9x | 62 |
| otl1.49M | 1,490,245 | 4g | 0.64 (27, 2) | 15.34 (15.0) | 23.9x | 0.97 | 15.9x | 45 |
| otl1.49M | 1,490,245 | 3g | 1.72 (27, 2) | 77.84 (15.0) | 45.3x | 3.01 | 25.9x | 59 |

**Where the lead comes from, and what it costs.** The overview request pair is nearly constant in time (3.5 round trips: one for `manifest.json` on a new connection, two of connection set-up, one for the overview tail, plus 18 to 62 KB), so the lead is the full download time minus about 0.12 s (wifi), 0.65 s (4G), 1.8 s (slow 3G). The full download grows linearly with the gzipped size; the fit below (baseline seconds against megabytes of gzipped Newick over the six trees) puts the crossover points at:

| Profile | baseline fit: fixed s + s per MB of gzipped Newick | first view (overview only): s | tips where the full download takes as long | first view + one 10k-tip clade: s | tips where it takes as long |
|---|---|---|---|---|---|
| wifi | 0.13 s + 0.35 s/MB | 0.12 | 0 | 0.23 | 21,356 |
| 4g | 0.49 s + 0.98 s/MB | 0.66 | 13,703 | 1.09 | 45,990 |
| 3g | 1.22 s + 5.09 s/MB | 1.84 | 9,076 | 3.68 | 36,207 |

Reading it: **for a first view the overview wins at about 9k (slow 3G) to 14k (4G) tips; on wifi it is a tie up to about 10k tips** (the baseline's fixed cost of 0.17 s is about our 0.12 s). Counting **one** zoom into a 10k-tip clade (labels included), the crossover moves to about 21k tips on wifi, 46k on 4G and 36k on slow 3G. Above that the lead grows linearly: at 100k tips the first view plus one clade is 1.6 to 2.3 times faster, at 1M tips 11 to 17 times, at 1.49M tips 16 to 27 times, while the baseline's parse-and-build also pins a main-thread task of 0.8 to 1.4 s (unthrottled, measured) and 280 MB of memory at 1M tips (section 6.4).

**What the table does not say.** (1) The lead shrinks with every further clade the user opens; the last column estimates how many 10k-tip clades can be fetched cold before the whole download would have finished (22 to 62 at 1M and 1.49M tips, 2 to 5 at 91k to 190k tips). Real users re-use row groups (neighbouring clades share them), so this is pessimistic for the Parquet side. (2) The baseline numbers include the connection set-up and one download request; a CDN that keeps a warm connection from the page itself would cut about 0.45 s (4G) of the 3.5 round trips from the overview side, while the same would not help the baseline's bandwidth term. (3) Overview-first only helps when the viewer can use a coarse view: the overview is 1,000 to 2,000 triangles at level 0 (about 300 triangles fill a 1,000 px view at the prototype's 3 px minimum) and deeper levels cost 60 KB to 2 MB; the leaf rows always need a clade fetch. (4) For trees below about 30k tips the numbers say "do not bother": 10k Yule tips (0.1 MB gzipped) take 0.14 s on wifi either way.

## 10. Build-time conversion in Node (hyparquet-writer)

Question: can a Node script convert Newick to this layout inside the Vercel site build (`node scripts/build-site.mjs`, `engines.node = 22.x`) without Python or pyarrow? **Yes, measured.**

| Item | Finding | Source |
|---|---|---|
| Package | `hyparquet-writer` 0.17.0, MIT, one dependency (`hyparquet` 1.31.5, same author), 444 KB unpacked, 18 KB gzip as a browser bundle | `npm view`, package files, esbuild bundle (M) |
| Row-group size | `rowGroupSize` is a number or an array (last value repeats; default `[1000, 100000]`). For variable groups (our tip groups are aligned to the node groups) use the `ParquetWriter` class and call `write()` once per group | README, source of `parquet-writer.js` (S) |
| Compression | `codec` option, default `SNAPPY` with a built-in JS snappy encoder. **Any other codec needs `compressors`**: there is no zstd encoder in the package or in `hyparquet-compressors` (decode only). We passed `ZSTD: (input) => zlib.zstdCompressSync(input, { params: { [zlib.constants.ZSTD_c_compressionLevel]: 3 } })` from `node:zlib`, which exists in Node 22.15 and later (it works on the Node 22.22 of this machine; the Vercel Node 22.x patch level is **unverified**; fall back to snappy, 2x to 3x larger, if it is older) | README, source (S), run (M) |
| Encodings | per-column `encoding`: `DELTA_BINARY_PACKED` (INT32/INT64), `BYTE_STREAM_SPLIT` (FLOAT/DOUBLE), PLAIN; dictionary encoding is automatic and kept only while it at least halves the column (`dictionarySize` caps it) | README, source (S); sizes below (M) |
| Nulls | `nullable: false` writes REQUIRED columns, which hyparquet reads back as typed arrays | run (M) |
| Page index | offset index is written by default (`offsetIndex = true`), column index off by default | source (S) |
| Statistics | on by default (`statistics: true`), strings truncated to 16 bytes unless `statisticsTruncateLength` is raised (our `labels.parquet` lookup reads `min_value`/`max_value`; for long common prefixes raise it) | README (S) |

Converter: [spikes/parquet-experiment/node-writer/convert.mjs](../../spikes/parquet-experiment/node-writer/convert.mjs) (about 200 lines: Newick via `spikes/shared/newick.ts` bundled with esbuild, rollups, overview pyramid, spine, label index, manifest). It needs `--meta` only because this experiment's metadata is synthetic and must be identical to the Python run; a product build would read the real metadata itself.

Results (same trees, same metadata, zstd level 3 unless stated, 16,384 rows per group, `tuned` encodings; both on the same machine):

| Tree | Writer | Codec | Parse | Arrays | Write | Total | nodes | tips | tipmeta | overview | labels |
|---|---|---|---|---|---|---|---|---|---|---|---|
| yule100k | pyarrow 26.0 (Python 3.13, reference) | zstd | | 0.6 s (parse + arrays) | 0.3 s | 1.1 s | 2.10 MB | 0.63 MB | 0.18 MB | 0.18 MB | 0.83 MB |
| yule100k | hyparquet-writer 0.17.0 (Node 22.22) | zstd | 0.1 s | 0.1 s | 0.9 s | 1.1 s | 2.12 MB | 0.62 MB | 0.23 MB | 0.19 MB | 0.83 MB |
| yule100k | hyparquet-writer 0.17.0 (Node 22.22) | snappy | 0.1 s | 0.1 s | 0.8 s | 1.0 s | 2.45 MB | 0.95 MB | 0.27 MB | 0.23 MB | 1.23 MB |
| yule1M | pyarrow 26.0 (Python 3.13, reference) | zstd | | 6.5 s (parse + arrays) | 3.2 s | 10.0 s | 21.05 MB | 6.24 MB | 1.82 MB | 2.71 MB | 8.60 MB |
| yule1M | hyparquet-writer 0.17.0 (Node 22.22) | zstd | 0.9 s | 0.4 s | 7.1 s | 8.4 s | 21.20 MB | 6.23 MB | 2.29 MB | 2.92 MB | 8.60 MB |
| yule1M | hyparquet-writer 0.17.0 (Node 22.22) | snappy | 0.8 s | 0.4 s | 8.2 s | 9.4 s | 24.51 MB | 9.45 MB | 2.65 MB | 3.34 MB | 11.91 MB |

- **Files our reader reads: yes.** `convert/verify.py` (pyarrow reading the Node-written files, independent recomputation of every rollup) passes on both Node-written trees (`results/verify-nodew-*.txt`, 32 and 38 checks), `test/selftest.mjs` passes on the 100k output in an earlier run, and Chromium reads the Node-written 100k and 1M trees through the same `ParquetTreeSource` (`results/browser-nodew.json`: first-view bytes within 4 percent of the pyarrow files and clade-fetch bytes within 1 percent, same request counts and no CORS preflight). Label to rank, root-to-tip paths and focus-a-tip returned the same answers on the Node-written files as on the pyarrow files (3 tips per tree). The writer's offset index is ignored by our reader. Its string statistics are truncated to 16 bytes by default; the label lookup relies on them and worked for the 6 lookups, but a systematic test of truncated bounds was not made (**unverified**; set `statisticsTruncateLength: Infinity` for `labels.parquet`).
- **Sizes comparable**: the node file is within 1 percent of pyarrow's (21.20 against 21.05 MB for 1M tips), tips plus metadata 6 percent larger, overview 8 percent larger (its `sel_level` and `depth` columns are INT32 where pyarrow wrote `uint8` and `uint16`), `labels.parquet` identical (8.60 MB). With snappy both writers give the same ratios as the pyarrow sweep (about 25 percent larger than zstd).
- **Time**: converting 1M tips takes 8.4 s in Node (parse 0.9 s, arrays 0.4 s, write 7.1 s) against 10.0 s for the Python reference on the same machine (6.5 s to parse and compute arrays, 3.2 s to write); 100k tips take 1.1 s in both. A tree of 1.49M tips needs the same order (not run through the Node writer). Memory stays below the default heap at 100k; for 1M and above start Node with `--max-old-space-size=4096` or more (I used 8000; peak not measured).
- **Caveats**: (a) the Vercel build installs dependencies per candidate (`scripts/build-site.mjs`), so the converter would need its own `npm install` step; (b) the writer is 0.x software (0.17.0, published the day this experiment ran): pin the version and keep `verify.py` (or a JS port of about 150 lines) in CI; (c) no zstd encoder in the package, see above; (d) Vercel static output size limits, and whether Vercel's CDN serves ranges of a 20 MB file, are **unverified**; a build that emits 60 MB of Parquet per 1M-tip tree also needs the repository's `--max-data-mb` guard in `build-site.mjs` to be considered.

## 11. Risks

| Risk | Why it matters | Status |
|---|---|---|
| Hosting must serve `Range` with CORS | The reader sends `Range: bytes=a-b` (a CORS-safelisted simple range, so **no preflight** was observed in Chromium against the cross-origin test server, section 6) and needs `Access-Control-Allow-Origin`; `Access-Control-Expose-Headers` is not needed because the reader never reads `Content-Range`. A host that ignores `Range` answers 200 with the whole object; `RangeFile` then keeps the whole file (tested with a mock) so it degrades to a full download of that file, which for `nodes.parquet` is 7 to 21 MB | Local server only. **Unverified** for GBIF's archive host, Vercel static hosting, S3, R2 or a CDN |
| CDN behaviour for ranges | Some CDNs cache a range as its own object, some fetch the whole object from origin on the first range (cold start cost), some bill every range as a request; browsers do not cache 206 responses reliably, so a reload re-downloads what was fetched | **Unverified** |
| One file per tree and archive versioning | Parquet files are immutable; a new tree version needs a new prefix (content hash) or cache busting; the manifest ties the files together | Design only |
| Storage is about 2x the gzipped Newick (3 files plus the label index) | Section 5: 2.1x at 100k and 1M Yule tips, 3.1x for GTDB, 1.8x for OTL; with `labels.parquet` for label to rank it is 2.7x (100k Yule), 2.8x (1M Yule), 3.2x (OTL) and 3.6x (GTDB) | Measured |
| Label to rank needs a second copy of all labels | `labels.parquet` is as large as the label column (8.6 MB for 1M Yule tips, 20.8 MB for the Open Tree tree). A hash-based index (8 bytes per tip) would be smaller; not built | Measured / alternative unbuilt |
| Row-group granularity | hyparquet fetches whole column chunks of every touched row group: with 64k rows per group a 1k-tip clade costs 0.8 MB, with 16k rows 0.2 MB (section 6.3) | Measured; smaller groups or a page index change this (section 6.3) |
| Every extra request costs a round trip | The first view is 2 sequential requests (manifest, then overview tail); each zoom is 1 to 3; on slow 3G one RTT is 0.4 s plus a connection setup of 2 more | Measured |
| Preorder numbering must be stable | Row ids are preorder positions; any edit of the tree (new tips, collapsing) changes them. Treat trees as immutable per version; links and annotations must carry the version | Design |
| Unary nodes, polytomies and ties | Overview selection by tip count is ancestor-closed even with ties and unary chains (tested on Open Tree, which has both); polytomies with thousands of children inflate level 0 unless the budget counts rows (it was counting nodes in the first pass; that run is kept as `browser-main-v1-nodebudget.json`) | Measured and fixed |
| Synthetic metadata | `occurrence_count`, `country` and `occ_sum` are generated (heavy-tailed, zero-inflated), not GBIF data; real counts compress differently and sums need `int64` | Stated |
| Python, pyarrow and 0.x JS writer | The reference converter needs numpy and pyarrow; the Node writer is 0.17.0; both outputs verified, but a writer bug would only be caught by `verify` | Mitigated by `verify.py` |
| Browser memory is not the bottleneck any more; main-thread decode is | 25 ms per 100k node rows (nine columns) and 45 to 80 ms per 100k labels is fine per clade, but loading a whole 1M tree through Parquet would take about 0.6 s plus fetch; run decode in a Worker for big clades | Measured |

## 12. Effort to integrate and recommendation

**Effort to integrate** (estimate, **unverified**, details in section 8): about 22 to 25 engineer-days for one engineer (range 16 to 32): 12 to 14 days in the renderer (types and in-memory source, layout from rollups, stub rule in the cut, repaint and `ensure` scheduling, async focus and labels, columns for visible windows), 5 days for the Parquet source on top of the reader in this folder (merge of overview rows and clades into a preorder snapshot, eviction, abort, retries), 3 days for the test harness (latency-injecting mock source, partial-versus-full frame comparison, re-run of S1 to S15) and 2 to 3 days for the build pipeline (the Node converter already exists as a prototype). A cheaper first step (5 to 7 days, **unverified**) is to load the whole tree from Parquet in a Worker with a progress bar, which does not reduce the bytes (the files are about twice the size of the gzipped Newick), so it is not recommended.

**Recommendation.**

1. **Do not build this for trees below about 50k tips.** A gzipped Newick of 0.1 MB (10k tips, 0.04 s unthrottled to inflate and parse; 91k tips 0.16 s) costs about as much as the two overview requests, and the prototype already handles it. Between 50k and 250k tips (1 to 3 MB gzipped) it is a judgement call: on wifi desktop the lead is 0.4 to 1.0 s and the baseline is acceptable if parsing moves to a Worker (section 15 of custom-renderer.md); on 4G or slow 3G and on phones overview-first is 2 to 7 times faster to a first view and one clade, and memory is roughly 6 to 10 times lower with a 10k to 100k-tip clade loaded.
2. **Build it for trees above about 100k tips if mobile or 4G users are a real audience, and for everything above 250k tips regardless**: at 1M tips the baseline needs 5 s on wifi, 15 s on 4G and 75 s on slow 3G plus 0.3 GB of memory, against 0.12 / 0.68 / 1.9 s and 7.7 MB (plus label strings) for the overview and a 100k-tip clade.
3. **Order of work if it is built**: (a) the `TreeSource` interface with the in-memory implementation and the stub-aware layout and cut (useful on its own, no network); (b) the Parquet source using `web/reader.js` as the transport; (c) the build step. Keep the layout decisions the data supports: 16k rows per node row group, zstd level 3, delta and byte-stream-split encodings, REQUIRED columns, labels and metadata in separate files with the same row groups, level 0 of the overview written last, overview budgets counted in rows. Do not use the page index (more round trips), snappy (20 to 50 percent larger, about 40 percent faster to decode) or uncompressed files.
4. **Do not make `labels.parquet` (label to rank) part of the first release unless the occurrence page needs it**: it duplicates all labels (8.6 MB for 1M tips, 20.8 MB for the Open Tree tree); a hash-based index would be smaller but was not built.
5. **Check hosting first** (a one-hour task): `Range` plus CORS on the real archive host, behaviour of the CDN for ranges of a 20 MB object, and whether the object store answers 206 for a plain `bytes=a-b` without a preflight. If it cannot, the fallback is the plain-chunk layout of section 15 of custom-renderer.md (one file per row group of this layout would also work with the same reader logic).

**Confidence.** About 85 percent that overview-first is much faster to a first view for trees above 100k tips on throttled networks (measured, with a simplified network model, the same Chromium, three profiles, two repetitions each); about 65 percent for the thresholds (the crossover moves with the real network, device CPU and CDN; phones were not measured); about 50 percent that the integration estimate is within 30 percent (no code was written in the renderer). Largest unmeasured items are listed in section 13.

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

