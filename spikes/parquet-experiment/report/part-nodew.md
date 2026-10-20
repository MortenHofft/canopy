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

Results (same trees, same metadata, zstd level 3, 64k rows per group, `tuned` encodings; Python figures are from the same machine):

NODEW_TABLE

- **Files our reader reads: yes.** `convert/verify.py` (pyarrow reading the Node-written files, independent recomputation of every rollup) passes on both Node-written trees (`results/verify-nodew-*.txt`), `test/selftest.mjs` passes on the 100k output, and Chromium reads the Node-written 100k and 1M trees through the same `ParquetTreeSource` (`results/browser-nodew.json`, section 6).
- **Sizes comparable**: Node nodes file is within a few percent of pyarrow's (smaller in both runs, because the writer also drops the per-page statistics pyarrow adds), tips files are 6 percent larger (pyarrow's dictionary and string handling are better).
- **Time**: conversion of 1M tips takes about 10 s in Node including parsing, of which 8 s is the writer; the Python reference takes PYTIME s for the same tree (parse 3.5 s, arrays 3.4 s, write 3.2 s on this machine). Memory stays below the default heap for 100k; for 1M and 1.49M start Node with `--max-old-space-size=4096` or more (I ran with 8000, peak not measured).
- **Caveats**: (a) the Vercel build installs dependencies per candidate (`scripts/build-site.mjs`), so the converter would need its own `npm install` step; (b) the writer is 0.x software (0.17.0, published the day this experiment ran); pin the version and keep `verify.py` (or a JS port, about 150 lines) in CI; (c) no zstd encoder in the package, see above; (d) Vercel static output size limits and range support for large files are **unverified**.
