# Example: a tree and its sidecar as Parquet

An experiment (issues #139 and #12), not part of the libraries: a tree of any size and its sidecar table (per-tip columns, even a
sequence per tip) stored as Parquet files and read in the browser with HTTP range requests. The page opens the tree from an overview of
about 2,000 rows, opens clades as you zoom, colours the tree by a sidecar column and reads one tip's row and sequence when you click it. The
point is to measure what it costs and to try different ways of cutting the files into row groups; the results are in
[docs/design/parquet-sidecar-benchmark.md](../../docs/design/parquet-sidecar-benchmark.md).

The viewer and tree-ops packages stay free of runtime dependencies: `hyparquet`, `fzstd` and `hysnappy` (reading, all MIT) are
dependencies of this example only, and `hyparquet-writer` (MIT) of the generator.

## Run it

```sh
npm install                                   # at the repository root
cd examples/parquet

# 1. a dataset: 100,000 tips, a 500-base sequence per tip (a few seconds; the folder is git-ignored)
node scripts/generate.mjs --tips 100000 --seq-length 500 --out ../../data/parquet/t100k

# 2. a server for the files with range requests and CORS (add --latency 150 --mbps 9 to feel a 4G connection)
node scripts/serve.mjs --root ../../data/parquet --port 5210

# 3. the page
npm run dev
# open http://127.0.0.1:5309/?url=http://127.0.0.1:5210/t100k
```

The page's address takes `url` (the folder of the dataset), `cpu=1` (software canvas, for a machine without a GPU), `budget=2000` (the
viewer's draw budget: lower it to see the level of detail simplify a small tree), `layout=radial`, `gap=65536` (merge range requests that
lie less than this many bytes apart) and `plan=0` (do not ask for the ranges of a read up front). The Network panel counts what the page
has fetched; the Requests list shows the last ones with their ranges.

## Make datasets

`node scripts/generate.mjs --tips N --out DIR` writes the same files for the same parameters. It streams to disk and keeps about 120 bytes
per tip in memory, so a few million tips are fine on a laptop. The sidecar follows the tree like real data does: a category is passed
down from the parent with probability `--keep` and drawn again otherwise (so clades have a dominant country), numbers are random walks
down the tree, and a sequence is the parent's with a few mutations per unit of branch length (so neighbouring tips are similar).

| flag              | default  |                                                                                                                      |
| ----------------- | -------- | -------------------------------------------------------------------------------------------------------------------- |
| `--tips`          | 100000   | tips of the tree                                                                                                     |
| `--seed`          | 1        |                                                                                                                      |
| `--categories`    | 2        | category columns: `country`, `host`, then `cat_3`...                                                                 |
| `--cardinality`   | 40       | distinct values of `country`; the others have five times as many, at most 5000                                       |
| `--keep`          | 0.9      | probability that a clade keeps its parent's category (higher: the values are more clustered in the tree)             |
| `--numeric`       | 2        | numeric columns: `year`, `lat`, `lon`, `num_4`...                                                                    |
| `--seq-length`    | 0        | bases per tip, 0 for none                                                                                            |
| `--seq-rate`      | 0.05     | mutations per site per unit of branch length (higher: sequences differ more and compress worse)                      |
| `--rg`            | 16384    | rows per row group of `nodes.parquet`                                                                                |
| `--tip-rg`        | 16384    | rows per row group of the small sidecar columns                                                                      |
| `--label-rg`      | 2048     | rows per row group of `tips.parquet` (labels)                                                                        |
| `--seq-rg`        | 512      | rows per row group of `sequence.parquet`                                                                             |
| `--cat-encoding`  | `code`   | category columns as INT32 codes (the dictionary is in the manifest) or as STRING with Parquet's dictionary           |
| `--sidecar-files` | `single` | all small columns in `sidecar.parquet`, or one file per column                                                       |
| `--first-budget`  | 2048     | rows of the first overview level (the next ones are 4, 16 and 64 times as many while at most an eighth of the nodes) |
| `--codec`         | `zstd`   | `zstd` (needs Node 22.15), `snappy` or `none`; zstd falls back to snappy on an older Node                            |
| `--no-lengths`    |          | a cladogram                                                                                                          |

## The files

| file                                              | rows                              | content                                                                                                                                                       |
| ------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `manifest.json`                                   |                                   | counts, file sizes and footer sizes, row group boundaries, the overview levels, the sidecar columns (with the dictionary and counts of category columns)      |
| `overview.parquet`                                | about 2,000 and then 4x, 16x, 64x | the pyramid: level 0 is what the first view is drawn from; the deepest level is written first, so level 0 plus the footer is one contiguous tail, one request |
| `nodes.parquet`                                   | preorder, one row per node        | `parent`, `subtree_end`, `leaf_start`, `tip_count`, `len`, `cum_len`, `max_cum`, `depth`, `max_depth`; a clade is the row range `[i, subtree_end[i])`         |
| `tips.parquet`                                    | one per tip, rank order           | `node`, `tip_label`                                                                                                                                           |
| `sidecar.parquet` (or `sidecar_<column>.parquet`) | one per tip, rank order           | the category and numeric columns                                                                                                                              |
| `sequence.parquet`                                | one per tip, rank order           | `sequence`                                                                                                                                                    |

The format of the first three is that of the research experiment (`docs/results/parquet-experiment.md` on the `research` branch,
section 3); the sidecar and the sequences are new here. Not written: the spine, `open.json` and `labels.parquet` of that experiment
(path to a tip, label to rank), which this page does not use.

## Measure

```sh
node scripts/bench.mjs --data ../../data/parquet/t100k --profile none,4g --repeat 3
node scripts/experiments.mjs --only E2,E4 --repeat 2        # the partitioning experiments, results/*.md
```

`bench.mjs` opens the dataset in headless Chromium through the server with a network profile (`wifi` 20 ms and 30 Mbit/s, `4g` 150 ms and
9 Mbit/s, `3g` 300 ms and 1.6 Mbit/s; only the dataset is slowed, not the page) and times the first view, colouring by country, zooming into
the biggest stub, and inspecting a tip (cold: the footers are read too, and warm). `experiments.mjs` generates datasets that differ in one
thing and writes a table per experiment. Needs Chromium: `CHROMIUM_PATH`, or the copy of the cloud sandbox, or Playwright's own.

## Tests

`npm test` writes a small dataset, serves it and reads it back: determinism, the node table against the tree, the overview tiling the
tips once, the sidecar against its manifest, and that reads fetch ranges and not files.
`npm run test:browser -w tests/browser -- --only parquet` runs the page against its own dataset.

## What is not built

Labels in the snapshot of a partially loaded tree (none are drawn, no search); eviction of loaded clades; a worker for decoding; retries
and an error display; the tree operations (they need the whole tree); a CDN (the files are served locally). See #12.
