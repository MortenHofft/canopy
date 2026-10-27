# A tree and its sidecar as Parquet: benchmark and partitioning (issue #139)

Date 2026-10-27. Code: [examples/parquet](../../examples/parquet) (generator, range server, reader, `TreeSource`, page, benchmark; its README says how to run it). Raw results: [examples/parquet/results](../../examples/parquet/results) (`E1`..`E10`, JSON and markdown, with and without the network model). Builds on the research experiment (`docs/results/parquet-experiment.md` on the `research` branch) and on #12 (the `TreeSource` / Parquet path) and #134 (the sidecar).

Evidence levels as in the research notes: **M** measured here, **S** read in source or documentation, **U** unverified. Every number in a table is **M** and comes from `results/E*.json`, made by `scripts/experiments.mjs` (tables below: `node scripts/report.mjs`).

## 1. Short answer

A tree of millions of tips and a sidecar with a sequence per tip can be stored as Parquet, served as static files with range requests and read by the viewer, with no change to the viewer's core. What decides the cost is how the files are cut into row groups and files, not the format. With the layout recommended in section 5:

- **The first view does not depend on the size of the tree.** Two requests and 49 to 85 KB, 0.52 to 0.64 s on a simulated 4G link, from 10,000 to 5,000,000 tips (E1, E9).
- **Colouring by a sidecar column reads that column and nothing else**: 57 KB at 100,000 tips, 567 KB at 1,000,000 (0.86 s), 2.83 MB at 5,000,000 (3.1 s, of which about 0.65 s is decoding and building on this machine). The same column in a plain TSV is inside a file of 43 MB (15 MB gzipped) at 1,000,000 tips without sequences, and 544 MB (111 MB gzipped) with a 500-base sequence per tip, which is more than one JavaScript string can hold (section 3, **M**: `scripts` of this branch, same generator).
- **Opening a clade by zooming** is one footer and one range: 230 KB (0.58 s) at 100,000 tips, 299 KB (0.67 s) at 1,000,000, 1.04 MB (1.6 s) at 5,000,000.
- **Inspecting one tip** (its label, its row of 4 columns and its sequence) is 10 requests and 237 KB cold at 1,000,000 tips (0.70 s), 6 requests and 141 KB (0.39 s) once the footers are known.
- **The same data cut badly is several times slower**: colouring is 2.1 s with 63 requests in one sidecar file and 0.9 s with 2 requests in one file per column at 1,000,000 tips; it was 9.8 s before a fix of the fetch settings (section 4, E10, an artefact of Chromium's cache lock, not of the format).

What this does not show (**U**, section 7): a real CDN and real phones, HTTP/2, real data (compressibility, number of distinct values), and the colouring of clades that are not loaded without reading the whole column.

## 2. What was built and how it was measured

| piece | what |
|---|---|
| `scripts/generate.mjs` | A synthetic dataset from a seed: a Yule tree, a sidecar whose categories are inherited down the tree (so clades have a dominant country), numbers that walk down the tree, and a sequence evolved down the tree (neighbouring tips are similar). Streamed to disk, about 120 bytes of memory per tip, 1,000,000 tips with 500-base sequences in 13 s. |
| `scripts/serve.mjs` | Static files with `Range`, CORS (a range request is a simple request: no preflight), a request log and an optional model of latency and bandwidth, which can be limited to the dataset's URLs. |
| `src/dataset.ts`, `src/rangefile.ts` | The reader: hyparquet, a range file that keeps what it fetched and merges requests that lie close together, one call per thing the page needs (overview, node rows, labels, a sidecar column, a sidecar row, a sequence). |
| `src/ParquetSource.ts` | A `TreeSource` ported from the research branch onto the viewer on `main`; the viewer's own `DetailLoader` opens stubs as you zoom. |
| `src/colouring.ts` | Colouring a partly loaded tree by a column: see section 6. |
| `scripts/bench.mjs`, `scripts/experiments.mjs` | Open a dataset in headless Chromium and time what a person does; vary one thing at a time. |

**Method.** Each case is a fresh page in headless Chromium, the CPU canvas, against the local range server. Steps, each with its time, HTTP requests and bytes received: *first view* (page load to first frame), *colour by country* (read the column, colour the tree), *open a clade* (zoom into the biggest stub and wait for its rows and a frame), *inspect, cold* (a click on a tip, which reads its label, sidecar row and sequence, including the footers of those files) and *inspect, warm* (a tip in another row group). The tables show the median of two runs on a simulated 4G link (150 ms latency, 9 Mbit/s, the first request on a connection pays two extra round trips); `results/*.md` has the same without a network model. Chromium 153 (Chrome for Testing), Node 22.22, hyparquet 1.31.5 and hyparquet-writer 0.17.0, 4 vCPUs shared with other work. Only the dataset is slowed, not the page.

The numbers compare layouts with each other. They are not figures for a phone: the CPU work (decoding, building the snapshot) is that of this machine, the network is a model, and there is no GPU (**U**).

## 3. The files

| file | rows | content |
|---|---|---|
| `manifest.json` | | counts, file sizes and footer sizes (so no `HEAD` request and no search for the footer), row group boundaries, the overview levels, the sidecar columns with the dictionary and counts of category columns |
| `overview.parquet` | about 2,000 and then 4x, 16x, 64x | the pyramid of the research experiment: level 0 plus the footer is one contiguous tail (one request) and holds every row the first view needs |
| `nodes.parquet` | one per node, in preorder | topology and rollups; a clade is the row range `[i, subtree_end[i])` |
| `tips.parquet` | one per tip | `node`, `tip_label` |
| `sidecar.parquet`, or `sidecar_<column>.parquet` | one per tip, in rank order | the category columns (INT32 codes, the values are in the manifest) and the numeric columns |
| `sequence.parquet`, or `sequence_0000.parquet`... | one per tip, in rank order | the sequence |

Tips are in rank order and nodes in preorder, so a clade is a range of rows in every file and a row group is a range of tips.

**The same sidecar as a TSV** (**M**: the same generator, columns `ID`, `country`, `host`, `year`, `lat`): 4.3 MB raw / 1.5 MB gzipped at 100,000 tips and 43.4 MB / 15.4 MB at 1,000,000 without sequences; with a 500-base sequence per tip 54.4 MB / 11.2 MB at 100,000 tips and 544.4 MB / 111.4 MB at 1,000,000. The Parquet files for the same data (labels 9.7 MB, sidecar 5.1 MB, sequences 86.8 MB at 1,000,000 tips: 101.6 MB) are about as large as the gzipped TSV (111.4 MB); the tree files come on top (31 MB). The difference is that a part of them can be read.

## 4. Results

Each table: simulated 4G, median of two runs, 1,000,000 tips unless the title says otherwise.

### E1: scale (single sidecar file, sequences in one file: the default of the generator)

| case | all files | first view | colour by country | open a clade | inspect, cold | inspect, warm | JS heap | 
|---|---|---|---|---|---|---|---|
| 10k | 464 KB | 557 ms, 2 req, 49 KB | 319 ms, 2 req, 6 KB | 437 ms, 2 req, 51 KB | 388 ms, 4 req, 116 KB | 177 ms, 1 req, 19 KB | 17 MB |
| 10k-seq500 | 1.33 MB | 524 ms, 2 req, 49 KB | 319 ms, 2 req, 6 KB | 446 ms, 2 req, 51 KB | 690 ms, 6 req, 162 KB | 208 ms, 2 req, 62 KB | 16 MB |
| 100k | 4.39 MB | 578 ms, 2 req, 58 KB | 658 ms, 8 req, 58 KB | 596 ms, 2 req, 230 KB | 454 ms, 4 req, 185 KB | 463 ms, 3 req, 175 KB | 19 MB |
| 100k-seq500 | 13.08 MB | 559 ms, 2 req, 58 KB | 660 ms, 8 req, 58 KB | 596 ms, 2 req, 230 KB | 474 ms, 6 req, 249 KB | 504 ms, 4 req, 218 KB | 19 MB |
| 1000k | 44.86 MB | 576 ms, 2 req, 67 KB | 2110 ms, 63 req, 579 KB | 680 ms, 2 req, 299 KB | 533 ms, 4 req, 256 KB | 464 ms, 3 req, 175 KB | 39 MB |
| 1000k-seq500 | 131.67 MB | 639 ms, 2 req, 67 KB | 2096 ms, 63 req, 579 KB | 678 ms, 2 req, 299 KB | 693 ms, 6 req, 509 KB | 504 ms, 4 req, 220 KB | 39 MB |
| 5000k | 210.76 MB | 607 ms, 2 req, 75 KB | 8757 ms, 307 req, 2.89 MB | 1478 ms, 2 req, 1.04 MB | 861 ms, 4 req, 588 KB | 448 ms, 3 req, 167 KB | 123 MB |

- The first view is flat: 49 KB at 10,000 tips, 85 KB at 5,000,000 (E9), always two requests (the manifest and the tail of the overview).
- Colouring by one column grows with the number of row groups of the column (one request each) and with the size of the column; in a single sidecar file the row groups are separated by the other columns and cannot be merged (E3). At 5,000,000 tips that is 307 requests and 8.8 s.
- Opening a clade grows with the clade, not the tree (E5). The viewer has to hold 123 MB of JS heap at 5,000,000 tips (E1) to 162 MB (E9) for the colouring and the snapshot (**M**).

### E2: the small sidecar columns: row group size, one file or one file per column, codes or strings (no sequences)

| case | sidecar files | colour by country | inspect, cold | inspect, warm | 
|---|---|---|---|---|
| single rg16k codes | 1 file(s), 5.06 MB, 62 row groups | 2100 ms, 63 req, 579 KB | 525 ms, 4 req, 256 KB | 459 ms, 3 req, 175 KB |
| single rg64k codes | 1 file(s), 5.00 MB, 16 row groups | 1109 ms, 17 req, 569 KB | 925 ms, 4 req, 720 KB | 879 ms, 3 req, 639 KB |
| single rg256k codes | 1 file(s), 4.95 MB, 4 row groups | 904 ms, 5 req, 567 KB | 2620 ms, 4 req, 2.55 MB | 2135 ms, 3 req, 2.01 MB |
| columns rg16k codes | 4 file(s), 5.06 MB, 248 row groups | 905 ms, 2 req, 567 KB | 669 ms, 8 req, 189 KB | 236 ms, 4 req, 92 KB |
| columns rg64k codes | 4 file(s), 5.00 MB, 64 row groups | 867 ms, 2 req, 566 KB | 835 ms, 8 req, 396 KB | 433 ms, 4 req, 310 KB |
| columns rg256k codes | 4 file(s), 4.95 MB, 16 row groups | 876 ms, 2 req, 566 KB | 1542 ms, 8 req, 1.25 MB | 1039 ms, 4 req, 956 KB |
| single rg16k strings | 1 file(s), 4.93 MB, 62 row groups | 2147 ms, 63 req, 521 KB | 525 ms, 4 req, 252 KB | 447 ms, 3 req, 172 KB |
| columns rg64k strings | 4 file(s), 4.84 MB, 64 row groups | 826 ms, 2 req, 498 KB | 841 ms, 8 req, 391 KB | 426 ms, 4 req, 305 KB |

- **One file per column** colours with 2 requests whatever the row group size: the row groups of one column follow each other in its file, so the requests merge. In one file, colouring costs one request per row group (63 at 16,384 rows, 17 at 65,536, 5 at 262,144), and larger row groups make reading one tip's row expensive (2.0 MB at 262,144 rows).
- **Reading one tip's row** costs the row group of each column, so it grows with the row group size: 92 KB (warm) at 16,384 rows per group, 310 KB at 65,536, 956 KB at 262,144 with a file per column; 175 KB, 639 KB and 2.0 MB in a single file.
- **16,384 rows** is the best compromise for the small columns: both reads are cheap.
- Storing category columns as strings with Parquet's dictionary instead of INT32 codes with the dictionary in the manifest makes the file 2 to 4 percent smaller and no difference in speed (local server: 254 against 265 ms). Codes keep the reader simple and typed.

### E3: merging range requests: the gap, and planning the ranges up front

| case | colour by country | inspect, cold | inspect, warm | 
|---|---|---|---|
| single rg16k gap0 | 2111 ms, 63 req, 579 KB | 538 ms, 4 req, 256 KB | 463 ms, 3 req, 175 KB |
| single rg16k gap64k | 2107 ms, 63 req, 579 KB | 525 ms, 4 req, 256 KB | 462 ms, 3 req, 175 KB |
| single rg16k gap256k | 4901 ms, 2 req, 5.06 MB | 413 ms, 2 req, 102 KB | 176 ms, 1 req, 19 KB |
| single rg16k gap1M | 4898 ms, 2 req, 5.06 MB | 424 ms, 2 req, 102 KB | 178 ms, 1 req, 19 KB |
| single rg16k gap64k noplan | 2068 ms, 63 req, 579 KB | 484 ms, 3 req, 183 KB | 249 ms, 2 req, 102 KB |
| columns rg16k gap64k | 888 ms, 2 req, 567 KB | 668 ms, 8 req, 189 KB | 234 ms, 4 req, 92 KB |
| columns rg16k gap64k noplan | 918 ms, 2 req, 567 KB | 667 ms, 8 req, 189 KB | 235 ms, 4 req, 92 KB |

- Raising the gap does not rescue a single file: at 256 KB or more the two requests read the whole 5 MB file, because the other columns lie between the chunks of the one that is wanted (4.9 s). A file per column has nothing in between.
- Planning the ranges of a read up front (asking for all the chunks in one tick so that they merge) changes nothing here: hyparquet already merges adjacent chunks of one column. It is not worth its code (**M**).

### E4 and E7: sequences: row groups, shards, compression (500 bases per tip)

| case | sequence file | inspect, cold | inspect, warm | 
|---|---|---|---|
| seq-rg 64 | 86.21 MB, 15625 row groups, footer 1.64 MB | 2179 ms, 6 req, 1.90 MB | 476 ms, 4 req, 181 KB |
| seq-rg 256 | 84.80 MB, 3907 row groups, footer 418 KB | 961 ms, 6 req, 695 KB | 483 ms, 4 req, 197 KB |
| seq-rg 1024 | 86.07 MB, 977 row groups, footer 105 KB | 692 ms, 6 req, 447 KB | 520 ms, 4 req, 265 KB |
| seq-rg 4096 | 87.27 MB, 245 row groups, footer 28 KB | 820 ms, 6 req, 642 KB | 665 ms, 4 req, 538 KB |
| rate 0.05 seq-rg 512 | 14.25 MB, 1954 row groups, footer 205 KB | 645 ms, 6 req, 468 KB | 470 ms, 4 req, 182 KB |
| rate 2 seq-rg 512 | 149.89 MB, 1954 row groups, footer 210 KB | 704 ms, 6 req, 542 KB | 530 ms, 4 req, 252 KB |

| case | sequence file | inspect, cold | inspect, warm | 
|---|---|---|---|
| seq-rg 256, one file | 84.80 MB, 3907 row groups, footer 418 KB | 947 ms, 6 req, 695 KB | 486 ms, 4 req, 197 KB |
| seq-rg 1024, one file | 86.07 MB, 977 row groups, footer 105 KB | 696 ms, 6 req, 447 KB | 535 ms, 4 req, 265 KB |
| seq-rg 256, shards of 65536 | 84.80 MB, 3907 row groups, footer 27 KB | 543 ms, 6 req, 304 KB | 485 ms, 5 req, 224 KB |
| seq-rg 64, shards of 65536 | 86.20 MB, 15625 row groups, footer 107 KB | 594 ms, 6 req, 369 KB | 540 ms, 5 req, 288 KB |
| seq-rg 256, shards of 16384 | 84.80 MB, 3907 row groups, footer 7 KB | 540 ms, 6 req, 284 KB | 470 ms, 5 req, 204 KB |

- **Compression depends on how similar the sequences are**: 14 MB for 1,000,000 sequences of 500 bases (500 MB raw) when mutations are rare (35 times), 86 MB at the default rate (5.8 times), 150 MB at a high rate (3.3 times). Real data will be somewhere in this range or beyond it (**U**).
- **Every row group costs about 100 bytes of footer, and the footer is read before anything else in the file.** At 64 rows per group the footer of 1,000,000 sequences is 1.6 MB, at 256 rows 418 KB, at 1,024 rows 105 KB.
- **Sharding the sequence file** (files of 65,536 tips) keeps small row groups and a small footer: with 256 rows per group a cold inspection reads 304 KB against 695 KB in one file (447 KB at 1,024 rows in one file), and the warm cost is the row group, 197 to 224 KB. Shards of 16,384 tips gain little more (284 KB) for four times as many files.
- A row group of 256 sequences of 500 bases is about 200 KB, which is what reading one sequence costs. Smaller groups (64 rows) cut the warm cost (181 KB in E4) but make a shard footer of 107 KB.

### E5: row groups of `nodes.parquet`: what opening a clade costs

| case | nodes.parquet | first view | open a clade | 
|---|---|---|---|
| node rg 4096 | 27.39 MB, 489 row groups, footer 296 KB | 579 ms, 2 req, 69 KB | 803 ms, 2 req, 408 KB |
| node rg 16384 | 26.97 MB, 123 row groups, footer 77 KB | 596 ms, 2 req, 67 KB | 688 ms, 2 req, 299 KB |
| node rg 65536 | 26.17 MB, 31 row groups, footer 20 KB | 569 ms, 2 req, 66 KB | 1248 ms, 2 req, 885 KB |

- 16,384 rows per group: 299 KB and 0.69 s. At 4,096 rows the footer alone is 296 KB (408 KB to open the first clade); at 65,536 the group is 885 KB. The same sweet spot as in the research experiment (**M**).

### E6: rows of the first overview level

| case | overview.parquet | first view | open a clade | 
|---|---|---|---|
| first level 512 rows | 874 KB, 4 row groups | 480 ms, 2 req, 25 KB | 1110 ms, 2 req, 736 KB |
| first level 2048 rows | 3.13 MB, 4 row groups | 555 ms, 2 req, 67 KB | 697 ms, 2 req, 299 KB |
| first level 8192 rows | 3.11 MB, 3 row groups | 776 ms, 2 req, 223 KB | 704 ms, 2 req, 295 KB |

- 2,048 rows balances the first view (67 KB) against the size of a stub, and so of the clade that opening it reads (299 KB). At 512 rows the first view is 25 KB but the clade a stub opens is about 2.5 times as large (736 KB); at 8,192 rows the first view is 223 KB and a clade is no smaller.

### E8: a wide sidecar: 8 category and 8 numeric columns

| case | sidecar files | colour by country | inspect, cold | inspect, warm | 
|---|---|---|---|---|
| wide single rg16k | 1 file(s), 29.49 MB, 62 row groups | 2165 ms, 63 req, 628 KB | 1240 ms, 4 req, 1.04 MB | 1167 ms, 3 req, 976 KB |
| wide columns rg16k | 16 file(s), 29.50 MB, 992 row groups | 869 ms, 2 req, 567 KB | 1297 ms, 32 req, 643 KB | 706 ms, 16 req, 493 KB |
| wide columns rg64k | 16 file(s), 29.07 MB, 256 row groups | 878 ms, 2 req, 566 KB | 2441 ms, 32 req, 1.98 MB | 1885 ms, 16 req, 1.88 MB |

- With 16 columns a file per column still colours in 2 requests (0.87 s against 2.2 s). Reading one tip's whole row is 16 requests (32 cold, with the footers) and half the bytes of the single file; on this model it takes 0.7 s warm against 1.2 s, and the 16 requests run six at a time (**U**: with HTTP/2 they would not queue behind the connection limit).
- A page that shows a few chosen fields of a tip, not every column, reads only those files.

### E9: the recommended layout at scale: 500-base sequences, a file per column, sequences in shards of 65,536 tips with 256-row groups

| case | all files | first view | colour by country | open a clade | inspect, cold | inspect, warm | JS heap | 
|---|---|---|---|---|---|---|---|
| 100k columns+shards seq500 | 12.88 MB | 564 ms, 2 req, 58 KB | 377 ms, 2 req, 57 KB | 579 ms, 2 req, 230 KB | 695 ms, 10 req, 151 KB | 332 ms, 6 req, 128 KB | 17 MB |
| 1000k columns+shards seq500 | 129.66 MB | 575 ms, 2 req, 69 KB | 864 ms, 2 req, 567 KB | 669 ms, 2 req, 299 KB | 700 ms, 10 req, 237 KB | 394 ms, 6 req, 141 KB | 38 MB |
| 5000k columns+shards seq500 | 634.88 MB | 608 ms, 2 req, 85 KB | 3065 ms, 2 req, 2.83 MB | 1591 ms, 2 req, 1.04 MB | 836 ms, 10 req, 626 KB | 392 ms, 6 req, 136 KB | 162 MB |

- Total size 12.9 MB, 129.7 MB and 634.9 MB. Each step above reads between 0.05 and 0.44 percent of that at 1,000,000 tips (the first view 69 KB, a colouring 567 KB, a clade 299 KB, a cold inspection 237 KB).

### E10: the fetch cache mode (a finding about Chromium, not about Parquet)

| case | colour by country | inspect, cold | inspect, warm | 
|---|---|---|---|
| single rg16k, cache no-store | 2110 ms, 63 req, 579 KB | 533 ms, 4 req, 256 KB | 466 ms, 3 req, 175 KB |
| single rg16k, cache default | 9762 ms, 63 req, 579 KB | 525 ms, 4 req, 256 KB | 463 ms, 3 req, 175 KB |
| columns rg16k, cache no-store | 890 ms, 2 req, 567 KB | 667 ms, 8 req, 189 KB | 235 ms, 4 req, 92 KB |
| columns rg16k, cache default | 865 ms, 2 req, 567 KB | 669 ms, 8 req, 189 KB | 235 ms, 4 req, 92 KB |

With the browser's default cache mode Chromium serialises the requests for **one URL**, even when they are range requests with different ranges and the response is `no-store`: 24 range requests of one file finished 155 ms apart on a 150 ms link (**M**, a page of plain `fetch` calls). With `cache: 'no-store'` (or `'reload'`) they run six at a time. A Parquet file is one URL, so every layout that reads many ranges of one file is hit by it. The reader uses `cache: 'no-store'` (it keeps what it fetched in memory); the first set of results of this experiment, taken without it, overstated the single-file cases by 4 to 5 times and were redone. A reader that does not set it will not get parallel range requests from Chromium (**S**: observed here; the mechanism, a lock on the HTTP cache entry, is my reading and was not checked in Chromium's source).

## 5. A partitioning scheme

For a tree of N tips and a sidecar, as measured above:

| what | choice | because |
|---|---|---|
| order of rows | tips in rank order, nodes in preorder, in every file | a clade is a range of rows in all of them |
| `overview.parquet` | levels of about 2,048 rows, 4x, 16x, 64x; the deepest level first, level 0 last | the first view is the tail of one file: one request (E6) |
| `nodes.parquet` | 16,384 rows per row group | a clade of 10,000 tips is 299 KB; 4,096 makes the footer large, 65,536 the clade (E5) |
| `tips.parquet` (labels) | 2,048 rows per group | labels are 9.7 MB for 1,000,000 tips in 489 groups: about 20 KB to read one, against 128 KB at 16,384 rows (a calculation from the file size, not a measured read) |
| sidecar columns that are scanned (colouring, filtering) | **one file per column**, 16,384 rows per group | colouring is 2 requests and reads only that column (E2, E3, E8); a row is cheap |
| sidecar columns that are only shown | the same | reading a few fields of one tip reads a few files |
| category values | INT32 codes, the dictionary and counts in the manifest | typed, no string churn, no measurable difference from strings (E2) |
| sequences or other large per-tip fields | files ("shards") of about 65,536 tips, 256 rows per group | the footer of a shard is 27 KB, a cold inspection 304 KB, a warm one 224 KB (E7) |
| fetch | `cache: 'no-store'`, one range file per file, merge requests that lie within 64 KB | E10, E3 |

Rules behind it: (1) the row group is what is fetched and decoded, so size it for the smallest thing that is read often; (2) every row group costs about 100 bytes of footer that is read before anything else, so split a file when it would have more than a few hundred; (3) a column that is scanned should be a file of its own, because the request count of a scan is the number of its row groups unless they are adjacent; (4) a larger merge gap only helps when nothing unwanted lies in the gap.

## 6. Colouring a partly loaded tree

`src/colouring.ts`: the whole column is read once (as codes) and turned into a colour class per tip rank, with `runEnd[r]`, the end of the run of equal classes from rank r. Whenever rows arrive (`sourcechange`) the clade colours are made for the rows that are in the snapshot: a clade whose tips all have one class is one entry (O(1) with `runEnd`: its branches and, if the level of detail draws one, its summary take the colour), a stub takes the class most of its tips have, a tip in a mixed clade is one entry. The browser check `tests/browser/scripts/check-parquet.mjs` compares every entry with the column (a stub may take any of the most frequent classes on a tie) and drives a real click on a tip.

- The cost follows what is loaded: the whole column has to be read first (2.83 MB at 5,000,000 tips), but `setClades` is called with at most the number of rows in the snapshot.
- Reading the whole column is the weak point at the largest sizes and for columns with many values (**U**: only `country`, 40 values, was measured; `host` has 200). The alternative, not built, is a per-clade aggregate (the dominant value and how pure it is) stored in the overview and node rows, so that stubs are coloured without the column; it is the "clade aggregates" item of #12.
- No change to the viewer's core was needed: `TreeSource`, `setClades`, `sourcechange` and the `DetailLoader` were enough.

## 7. What was not measured (all **U**)

- A real CDN and real networks: connection reuse, HTTP/2 or HTTP/3 multiplexing (the local server speaks HTTP/1.1, six connections per host), cache hits, cold edges. The many-request layouts are probably better off than here on HTTP/2; the effect of the footer round trip and the first connection will be larger on a long path.
- Phones: decoding runs on the main thread (hyparquet, fzstd); 0.65 s of the 3.1 s to colour 5,000,000 tips is CPU here. No worker was tried.
- Real data: the synthetic sequences compress 3 to 35 times depending on a parameter, real ones differ; real columns have other cardinalities and less clustering along the tree; real tip labels are longer.
- Memory above 5,000,000 tips (the page holds about 162 MB of JS heap there) and the tree operations (they need the whole tree: see tree-ops.md).
- Writing the files in a build pipeline, and where they are stored (#12): the generator is a script for experiments.
- The viewer still draws no tip labels for a partly loaded tree, and a search has nothing to search (#12).

## 8. Reproduce

```sh
cd examples/parquet
node scripts/generate.mjs --tips 1000000 --seq-length 500 --seq-rate 0.5 --sidecar-files columns --seq-rg 256 --seq-shard 65536 --out ../../data/parquet/t1m
node scripts/bench.mjs --data ../../data/parquet/t1m --profile none,4g --repeat 3
node scripts/experiments.mjs --only E2,E4 --repeat 2     # results/E*.json and .md
node scripts/serve.mjs --root ../../data/parquet --port 5210 --latency 150 --mbps 9   # and `npm run dev`, to try the page by hand
```
