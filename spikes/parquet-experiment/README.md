# Parquet over HTTP range requests for large trees (experiment)

Question: can a tree of up to millions of tips be stored as Parquet and read in the browser with HTTP range requests, so that a viewer
loads a small overview first and fetches clades on demand? Results, tables and the recommendation are in
[../../docs/results/parquet-experiment.md](../../docs/results/parquet-experiment.md). This folder holds everything needed to reproduce
every number. Nothing here is product code; `spikes/custom`, `spikes/shared` and `spikes/runner` are used read-only.

## Layout of the files this experiment writes (v1)

| File | Content |
|---|---|
| `nodes.parquet` | one row per node in preorder (row index = node id): `parent`, `subtree_end`, `leaf_start`, `tip_count`, `len`, `cum_len`, `max_cum`, `depth`, `max_depth`, `occ_sum` (+ `support`, `name` when present). Row groups of 16,384 rows. All columns REQUIRED (no nulls) so that hyparquet returns typed arrays |
| `tips.parquet`, `tipmeta.parquet` | one row per tip in rank order: `node`, `tip_label` (tips) and `occurrence_count`, `country` (tipmeta, where further per-tip columns would go). Same row groups in both files, and row group g holds exactly the tips of node row group g. Separate files because a metadata read would otherwise be coalesced across the label chunks |
| `overview.parquet` | pyramid: one row group per level, deepest level first and **level 0 last** (level 0 + footer = one contiguous tail). Rows carry `node`, all rollups, `row` (layout y, float64) and `sel_level`. Level budgets are ROWS (2,048 / 8,192 / 32,768 / 131,072) |
| `spine.parquet`, `open.json` | the ancestors of the first node of every node row group (root-to-tip paths from one node row group + these); `open.json` is fetched lazily |
| `labels.parquet` | tip labels sorted by label with their tip rank (label to rank in a footer + one row group) |
| `manifest.json` | counts, file sizes and footer sizes, node/tip row-group boundaries as preorder ranges, overview levels (`row_budgets`, `level_rows`, `level_min_tips`, `tail_start`) |

## Reproduce

Needs Python 3 with numpy + pyarrow (scratch venv), Node 22 (zstd in `node:zlib` for the Node writer), the Chromium in `/opt/pw-browsers`.

```
SCR=/some/scratch                                # all generated data lives here, nothing generated is committed
python3 -m venv $SCR/venv && $SCR/venv/bin/pip install pyarrow numpy
npm install --ignore-scripts                     # exact pins in package.json (hyparquet 1.31.5, hyparquet-compressors 1.1.2, hyparquet-writer 0.17.0, esbuild)
./build.sh                                       # bundles web/reader.js + harness into web/dist/ (ignored)

# inputs: synthetic Yule trees and the OTL 1.49M tree are generated / fetched into $SCR (see ../../data/README.md)
python3 -I ../../data/synthetic/generate.py --out $SCR/syn --sizes 100000,1000000 --shapes yule
#   OTL: curl the file named in ../../data/real-ladder/fetch.sh into $SCR/otl/cache/opentree16.1/, then
#   CACHE=$SCR/otl/cache OUT=$SCR/otl/out python3 -I ../../data/real-ladder/scripts/ladder.py $SCR/otl/cache $SCR/otl/out otl-1m-metazoa

SCR=$SCR ./convert/prepare_all.sh                # six trees (+ codec / row-group / page variants of the 1M tree) into $SCR/serve, with verify
SCR=$SCR ./run-v2.sh                             # the final pass: prepare, overview checks, Node writer, main browser run (run-all.sh was the first pass)
$SCR/venv/bin/python -I convert/verify.py TREE.nwk $SCR/serve/NAME --cache $SCR/cache    # ground-truth check of every rollup
SCR=$SCR ./run-sizes.sh                          # size matrices -> results/sizes-*.json
SERVE=$SCR/serve nice -n 19 node run-browser.mjs --trees yule100k --profiles none,wifi,4g,3g --out results/browser-yule100k.json
python3 -I report/make_tables.py sizes           # markdown tables (also: breakeven, crossings, other, variants)

# row-group experiment (rg8k variant): convert, put clades.json and the gz Newick next to it, run on none + 4g
$SCR/venv/bin/python -I convert/convert.py $SCR/syn/newick/yule_1000000.nwk $SCR/serve/yule1M__rg8k --cache $SCR/cache --rg 8192
$SCR/venv/bin/python -I convert/footer_size.py $SCR/syn/newick/yule_1000000.nwk $SCR/cache   # footer size with / without statistics
python3 -I report/build_doc.py                   # regenerates ../../docs/results/parquet-experiment.md from results/
```

Tests: `node test/selftest.mjs` (reader against the Range server on port 5210, uses the committed 65 KB sample in `sample/yule1k`), `node test/rangefile.test.mjs` (coalescing, mock fetch), `node test/overview_vs_layout.mjs TREE LAYOUT` (every overview row against the renderer's `computeLayout()`),
`python3 -I test/verify_mutation.py` (tampers with a rollup and checks that `verify.py` fails), `convert/verify.py` on every converted tree.

Node writer (no Python): `node node-writer/convert.mjs TREE.nwk OUT --meta SERVE/NAME/tipmeta.parquet` (after `./build.sh`; `node-writer/compare.sh` runs it for the 100k and 1M Yule trees and verifies the output).

## Files

- `convert/` Python reference converter (`treearrays.py` parse + rollups, `layout.py` Parquet layout, `convert.py` CLI, `verify.py`, `sizes.py`, `pick_clades.py`, `prepare_all.sh`).
- `node-writer/` the same layout written with hyparquet-writer.
- `web/reader.js` the reader (`ParquetTreeSource`, `RangeFile`); `web/measure.js`, `web/baseline.ts`, `web/harness.html` the in-page measurement code.
- `server.mjs` static server with Range, added latency per request, shared bandwidth bucket, request log; `run-browser.mjs` the Playwright harness.
- `proposal/tree-source.ts` the type-checked `TreeSource` proposal (also pasted in the results document).
- `results/` raw JSON of every run (`sizes-*.json`, `browser-main.json` = final pass, `browser-main-v1-64k-nodebudget.json` and `browser-main-v2a-single-tips-file.json` = earlier passes with earlier layout decisions, `browser-variant-*.json`, `browser-nodew.json`, `node-writer-*.json`), `verify-*.txt`, `overview-vs-layout.txt`.
- `report/` generates `docs/results/parquet-experiment.md` from `results/` (`python3 -I report/build_doc.py`); `report/make_tables.py` prints single tables.

Network model (server.mjs): every response waits `latency` ms before the first byte; every new TCP connection costs `2 x latency` once; all
response bytes (plus 400 B of header) share one token bucket of `mbps`. Not modelled: slow start, loss, HTTP/2 multiplexing, CDN misses.
