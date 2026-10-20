#!/usr/bin/env node
// Newick -> the same Parquet layout as convert/layout.py, with hyparquet-writer only (no Python, no pyarrow).
//   node node-writer/convert.mjs TREE.nwk[.gz] OUTDIR --meta SOMEDIR/tips.parquet [--rg 65536] [--codec zstd|snappy|none] [--enc tuned|plain]
// --meta reads occurrence_count / country from a tips.parquet written by the Python converter so that both converters
// carry IDENTICAL data (verify.py then applies unchanged). zstd compression uses node:zlib (Node >= 22.15), snappy is the
// writer's built-in JS snappy; neither needs an extra dependency.
// Bundle first: ./build.sh (esbuild turns shared/newick.ts into node-writer/dist/newick.mjs).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { ByteWriter, ParquetWriter, schemaFromColumnData } from 'hyparquet-writer';
import { parquetMetadata, parquetRead, asyncBufferFromFile } from 'hyparquet';
import { compressors as readCompressors } from 'hyparquet-compressors';

const here = path.dirname(fileURLToPath(import.meta.url));
const { parseNewick } = await import(path.join(here, 'dist', 'newick.mjs'));

const BUDGETS = [1024, 4096, 16384, 65536];
const budgetsFor = (nInternal) => { const b = BUDGETS.filter((x) => x <= Math.floor(nInternal / 8)); return b.length ? b : [Math.max(1, Math.floor(nInternal / 4))]; };

export function arraysFromTree(t, occ) {
  const n = t.nodeCount, p = t.parent;
  const row = new Float64Array(n), lastC = new Int32Array(n).fill(-1);
  for (let i = 1; i < n; i++) lastC[p[i]] = i;
  for (let r = 0; r < t.tipCount; r++) row[t.tipNode[r]] = r + 0.5;
  for (let i = n - 1; i >= 0; i--) if (lastC[i] >= 0) row[i] = (row[i + 1] + row[lastC[i]]) / 2;
  const cum = new Float64Array(n), maxCum = new Float64Array(n), maxDepth = new Int32Array(n), depth = t.depth;
  const raw = t.length;
  let hasLen = false;
  for (let i = 1; i < n; i++) { const l = raw[i]; if (l === l) hasLen = true; cum[i] = cum[p[i]] + (l > 0 ? l : 0); }
  maxCum.set(cum); maxDepth.set(depth);
  for (let i = n - 1; i > 0; i--) { const q = p[i]; if (maxCum[i] > maxCum[q]) maxCum[q] = maxCum[i]; if (maxDepth[i] > maxDepth[q]) maxDepth[q] = maxDepth[i]; }
  const tipCount = new Int32Array(n);
  for (let i = 0; i < n; i++) tipCount[i] = t.leafEnd[i] - t.leafStart[i];
  const pref = new Float64Array(t.tipCount + 1);
  for (let r = 0; r < t.tipCount; r++) pref[r + 1] = pref[r] + occ[r];
  const occSum = new BigInt64Array(n);
  for (let i = 0; i < n; i++) occSum[i] = BigInt(pref[t.leafEnd[i]] - pref[t.leafStart[i]]);
  return { n, row, parent: t.parent, subtreeEnd: t.subtreeEnd, leafStart: t.leafStart, tipCount, len: raw, cum, maxCum, depth, maxDepth, occSum, hasLen };
}

function colsFor(a, idx, o, withRow = false) {
  // idx: Int32Array of row indexes (rows of the table to emit)
  const take = (arr) => { const out = new arr.constructor(idx.length); for (let k = 0; k < idx.length; k++) out[k] = arr[idx[k]]; return out; };
  const I = (name, x) => ({ name, data: take(x), type: 'INT32', nullable: false, ...(o.tuned ? { encoding: 'DELTA_BINARY_PACKED' } : {}) });
  const F = (name, x) => ({ name, data: o.f64 ? take(x) : Float32Array.from(take(x)), type: o.f64 ? 'DOUBLE' : 'FLOAT', nullable: false, ...(o.tuned ? { encoding: 'BYTE_STREAM_SPLIT' } : {}) });
  return [I('parent', a.parent), I('subtree_end', a.subtreeEnd), F('len', a.len), I('leaf_start', a.leafStart), I('tip_count', a.tipCount), F('cum_len', a.cum), F('max_cum', a.maxCum), ...(withRow ? [F('row', a.row)] : []),
    I('depth', a.depth), I('max_depth', a.maxDepth), { name: 'occ_sum', data: take(a.occSum), type: 'INT64', nullable: false }];
}

function makeCompressors(codec) {
  if (codec === 'zstd') return { ZSTD: (input) => new Uint8Array(zlib.zstdCompressSync(input, { params: { [zlib.constants.ZSTD_c_compressionLevel]: 3 } })) };
  return {};
}
const CODEC = { zstd: 'ZSTD', snappy: 'SNAPPY', none: 'UNCOMPRESSED' };

function writeFile(file, columnsPerGroup, codec) {
  // columnsPerGroup: array of columnData arrays (one per row group)
  const bw = new ByteWriter();
  const schema = schemaFromColumnData({ columnData: columnsPerGroup[0] });
  const w = new ParquetWriter({ writer: bw, schema, codec: CODEC[codec], compressors: makeCompressors(codec), statistics: true });
  for (const cd of columnsPerGroup) w.write({ columnData: cd, rowGroupSize: cd[0].data.length });
  w.finish();
  const buf = new Uint8Array(bw.getBuffer());
  fs.writeFileSync(file, buf);
  return buf;
}

export async function convert(treeFile, outDir, opts) {
  const T = {};
  let t0 = performance.now();
  let text;
  const raw = fs.readFileSync(treeFile);
  text = treeFile.endsWith('.gz') ? zlib.gunzipSync(raw).toString('utf8') : raw.toString('utf8');
  const tree = parseNewick(text);
  text = null;
  T.parse_ms = performance.now() - t0; t0 = performance.now();
  // metadata from the Python-written tips.parquet
  const mfile = await asyncBufferFromFile(opts.meta);
  const md = parquetMetadata(await mfile.slice(0, mfile.byteLength));
  const meta = {};
  await parquetRead({ file: mfile, metadata: md, compressors: readCompressors, columns: ['occurrence_count', 'country'], onChunk: (c) => { (meta[c.columnName] ??= []).push(c); } });  // pages can complete out of order: sort by rowStart below
  const cat = (cs) => { const chunks = cs.sort((x, y) => x.rowStart - y.rowStart).map((c) => c.columnData); let n = 0; for (const c of chunks) n += c.length; const out = new (chunks[0].constructor === Array ? Array : chunks[0].constructor)(n); let o = 0; for (const c of chunks) { if (out.set && c.length) out.set(c, o); else for (let i = 0; i < c.length; i++) out[o + i] = c[i]; o += c.length; } return out; };
  const occ = cat(meta.occurrence_count), country = cat(meta.country);
  if (occ.length !== tree.tipCount) throw new Error(`meta rows ${occ.length} != tips ${tree.tipCount}`);
  const a = arraysFromTree(tree, occ);
  T.arrays_ms = performance.now() - t0; t0 = performance.now();
  fs.mkdirSync(outDir, { recursive: true });
  const o = { tuned: opts.enc === 'tuned', f64: false };
  const n = a.n, rg = opts.rg;
  const starts = []; for (let s = 0; s < n; s += rg) starts.push(s); starts.push(n);
  const nodeGroups = [];
  for (let g = 0; g < starts.length - 1; g++) {
    const idx = new Int32Array(starts[g + 1] - starts[g]); for (let k = 0; k < idx.length; k++) idx[k] = starts[g] + k;
    nodeGroups.push(colsFor(a, idx, o));
  }
  const nodesBuf = writeFile(path.join(outDir, 'nodes.parquet'), nodeGroups, opts.codec);
  // tips aligned to node row groups
  const tipStart = starts.map((s) => (s === n ? tree.tipCount : tree.leafStart[s]));
  const tipGroups = [];
  for (let g = 0; g < starts.length - 1; g++) {
    const r0 = tipStart[g], r1 = tipStart[g + 1];
    const node = new Int32Array(r1 - r0), occc = new Int32Array(r1 - r0), lab = new Array(r1 - r0), cty = new Array(r1 - r0);
    for (let r = r0; r < r1; r++) { node[r - r0] = tree.tipNode[r]; occc[r - r0] = occ[r]; lab[r - r0] = tree.tipLabels[r]; cty[r - r0] = country[r]; }
    tipGroups.push([
      { name: 'node', data: node, type: 'INT32', nullable: false, ...(o.tuned ? { encoding: 'DELTA_BINARY_PACKED' } : {}) },
      { name: 'tip_label', data: lab, type: 'STRING', nullable: false },
      { name: 'occurrence_count', data: occc, type: 'INT32', nullable: false, ...(o.tuned ? { encoding: 'DELTA_BINARY_PACKED' } : {}) },
      { name: 'country', data: cty, type: 'STRING', nullable: false },
    ]);
  }
  const tipsBuf = writeFile(path.join(outDir, 'tips.parquet'), tipGroups, opts.codec);
  // overview pyramid
  const cand = []; for (let i = 0; i < n; i++) if (a.subtreeEnd[i] !== i + 1) cand.push(i);
  const keys = new Float64Array(cand.length);
  const SH = 2 ** 23;
  for (let k = 0; k < cand.length; k++) keys[k] = a.tipCount[cand[k]] * SH + (SH - 1 - cand[k]);
  keys.sort(); // ascending: iterate from the end for tip_count desc, index asc
  const order = new Int32Array(cand.length);
  for (let k = 0; k < cand.length; k++) order[k] = SH - 1 - (keys[cand.length - 1 - k] % SH);
  const budgets = budgetsFor(cand.length);
  const sel = new Uint8Array(n).fill(255);
  let prev = 0;
  budgets.forEach((B, L) => { for (let k = prev; k < Math.min(B, order.length); k++) sel[order[k]] = L; prev = Math.max(prev, B); });
  const levelRows = [], levelGroups = [];
  for (let L = 0; L < budgets.length; L++) {
    const isNew = new Uint8Array(n);
    for (let i = 0; i < n; i++) if (sel[i] === L) isNew[i] = 1;
    const rows = [];
    for (let i = 0; i < n; i++) {
      if (sel[i] === L) rows.push(i);
      else if (i > 0 && isNew[a.parent[i]] && sel[i] > L) rows.push(i);
    }
    const idx = Int32Array.from(rows);
    levelRows.push(idx.length);
    const cd = colsFor(a, idx, o, true);
    cd.unshift({ name: 'node', data: idx, type: 'INT32', nullable: false });
    cd.push({ name: 'sel_level', data: Int32Array.from(rows, (i) => sel[i]), type: 'INT32', nullable: false });
    levelGroups.push(cd);
  }
  const ovBuf = writeFile(path.join(outDir, 'overview.parquet'), levelGroups.slice().reverse(), opts.codec);
  // spine
  const openIds = starts.slice(0, -1).map((s) => { const ch = []; for (let i = s > 0 ? a.parent[s] : -1; i >= 0; i = i > 0 ? a.parent[i] : -1) { ch.push(i); if (i === 0) break; } return ch.reverse(); });
  const uniq = [...new Set(openIds.flat())].sort((x, y) => x - y);
  const sidx = Int32Array.from(uniq);
  const scd = colsFor(a, sidx, o, true); scd.unshift({ name: 'node', data: sidx, type: 'INT32', nullable: false });
  const spBuf = writeFile(path.join(outDir, 'spine.parquet'), [scd], opts.codec);
  T.write_ms = performance.now() - t0;
  const meta2 = (buf) => parquetMetadata(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const info = (buf, file) => { const m = meta2(buf); return { file, bytes: buf.byteLength, footer: new DataView(buf.buffer, buf.byteOffset + buf.byteLength - 8, 4).getUint32(0, true) + 8, row_groups: m.row_groups.length }; };
  const ovMeta = meta2(ovBuf);
  const lastRg = ovMeta.row_groups[ovMeta.row_groups.length - 1];
  const tailStart = Math.min(...lastRg.columns.map((c) => Number(c.meta_data.dictionary_page_offset || c.meta_data.data_page_offset)));
  const manifest = {
    version: 1, nodes: n, tips: tree.tipCount, has_lengths: a.hasLen, has_support: false, has_names: false, max_depth: a.maxDepth[0], max_cum: a.maxCum[0], root_occ_sum: Number(a.occSum[0]),
    float: 'f32', codec: opts.codec, rg_rows: rg, rg_node_start: starts, rg_tip_start: tipStart,
    overview: { budgets, level_rows: levelRows, tail_start: tailStart, file_order: 'deepest level first, level 0 last' },
    rg_open: openIds, spine_nodes: uniq,
    files: { nodes: info(nodesBuf, 'nodes.parquet'), tips: info(tipsBuf, 'tips.parquet'), overview: info(ovBuf, 'overview.parquet'), spine: info(spBuf, 'spine.parquet') },
    notes: 'written by hyparquet-writer (node-writer/convert.mjs)',
  };
  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest));
  T.total_ms = T.parse_ms + T.arrays_ms + T.write_ms;
  return { timings: T, sizes: { nodes: nodesBuf.byteLength, tips: tipsBuf.byteLength, overview: ovBuf.byteLength, spine: spBuf.byteLength, manifest: JSON.stringify(manifest).length } };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values: A, positionals } = parseArgs({ allowPositionals: true, options: { meta: { type: 'string' }, rg: { type: 'string', default: '65536' }, codec: { type: 'string', default: 'zstd' }, enc: { type: 'string', default: 'tuned' } } });
  const r = await convert(positionals[0], positionals[1], { meta: A.meta, rg: +A.rg, codec: A.codec, enc: A.enc });
  console.log(JSON.stringify(r, null, 1));
}
