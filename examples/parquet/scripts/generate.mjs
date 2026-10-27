#!/usr/bin/env node
// A synthetic dataset as Parquet files: a tree of N tips, a sidecar of per-tip columns and, optionally, a made-up sequence per tip.
// A pure function of the parameters (same parameters, same files), streamed to disk, so a dataset of millions of tips is only limited by
// the disk (about 120 bytes per tip of memory for the tree arrays).
//
//   node scripts/generate.mjs --tips 100000 --out ../../data/parquet/t100k
//     --tips N            tips of the tree (default 100000)
//     --out DIR           output folder (default ../../data/parquet/t<N>[-seq<L>])
//     --seed N            (default 1)
//     --categories C      category columns of the sidecar: country, host, then cat_3... (default 2)
//     --cardinality K     distinct values of country; the other categories have 5 times as many, at most 5000 (default 40)
//     --keep P            probability that a clade keeps its parent's category, 0..1: higher clusters the values in the tree (default 0.9)
//     --numeric M         numeric columns: year (int), lat, lon, num_4... (default 2)
//     --seq-length L      a made-up sequence of L bases per tip, evolved down the tree; 0 for none (default 0)
//     --seq-rate R        mutations per site per unit of branch length (default 0.05)
//     --rg N              rows per row group of nodes.parquet (default 16384)
//     --tip-rg N          rows per row group of tips and of the small sidecar columns (default 16384)
//     --label-rg N        rows per row group of tips.parquet (labels; default 2048)
//     --seq-shard N       rows per sequence file: sequence_0000.parquet, sequence_0001.parquet... (a multiple of --seq-rg; 0: one file) (default 0)
//     --seq-rg N          rows per row group of the sequences (default 512)
//     --cat-encoding E    'code' (INT32 codes, the dictionary in the manifest) or 'string' (STRING, Parquet's own dictionary) (default code)
//     --sidecar-files F   'single' (all small columns in sidecar.parquet) or 'columns' (one file per column) (default single)
//     --codec C           zstd | snappy | none (default zstd; snappy when this Node has no zstd)
//     --first-budget N    rows of the first overview level; the others are 4, 16 and 64 times as many while at most an eighth of the nodes (default 2048)
//     --no-lengths        a cladogram: no branch lengths
// Prints a JSON summary: the files with their sizes, and the time taken.

import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { makeTree } from './lib/tree.mjs';
import { selectOverview, levelRows } from './lib/overview.mjs';
import { ParquetOut, float32, float64, int32, pickCodec, string } from './lib/out.mjs';
import { categoryName, categoryValue, numberName, streamSidecar } from './lib/sidecar.mjs';
import { tipLabel } from './lib/rng.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

const DEFAULTS = {
  tips: 100000,
  seed: 1,
  categories: 2,
  cardinality: 40,
  keep: 0.9,
  numeric: 2,
  seqLength: 0,
  seqRate: 0.05,
  rg: 16384,
  tipRg: 16384,
  labelRg: 2048,
  seqRg: 512,
  seqShard: 0,
  catEncoding: 'code',
  sidecarFiles: 'single',
  codec: 'zstd',
  firstBudget: 2048,
  lengths: true,
};

/** Generate a dataset into `opts.out`. `opts` as the flags above (camel case); returns the manifest. */
export async function generate(o) {
  const t0 = performance.now();
  const p = { ...DEFAULTS, ...o };
  const out = path.resolve(p.out ?? path.join(here, '..', '..', '..', 'data', 'parquet', `t${p.tips}${p.seqLength ? '-seq' + p.seqLength : ''}`));
  fs.mkdirSync(out, { recursive: true });
  const codec = pickCodec(p.codec);
  const T = {};
  const tree = makeTree(p.tips, p.seed, { lengths: p.lengths });
  const { n } = tree;
  T.tree_ms = performance.now() - t0;
  let t1 = performance.now();

  // nodes.parquet: preorder rows, row index = node id
  const nodes = new ParquetOut(path.join(out, 'nodes.parquet'), codec);
  const starts = [];
  for (let s = 0; s < n; s += p.rg) starts.push(s);
  starts.push(n);
  const nodeColumns = (idx) => {
    const take = (a) => {
      const r = new a.constructor(idx.length);
      for (let k = 0; k < idx.length; k++) r[k] = a[idx[k]];
      return r;
    };
    return [
      int32('parent', take(tree.parent), true),
      int32('subtree_end', take(tree.end), true),
      float32('len', take(tree.len)),
      int32('leaf_start', take(tree.leafStart), true),
      int32('tip_count', take(tree.tipCount), true),
      float32('cum_len', take(tree.cum)),
      float32('max_cum', take(tree.maxCum)),
      int32('depth', take(tree.depth), true),
      int32('max_depth', take(tree.maxDepth), true),
    ];
  };
  for (let g = 0; g < starts.length - 1; g++) {
    const idx = new Int32Array(starts[g + 1] - starts[g]);
    for (let k = 0; k < idx.length; k++) idx[k] = starts[g] + k;
    nodes.writeGroup(nodeColumns(idx));
  }
  const nodesInfo = await nodes.close();
  T.nodes_ms = performance.now() - t1;
  t1 = performance.now();

  // overview.parquet: the pyramid, deepest level first, level 0 last (so level 0 plus the footer is one contiguous tail)
  const { sel, budgets } = selectOverview(tree, p.firstBudget);
  const levels = levelRows(tree, sel, budgets.length);
  const ov = new ParquetOut(path.join(out, 'overview.parquet'), codec);
  for (let L = levels.length - 1; L >= 0; L--) {
    const idx = levels[L];
    const cols = nodeColumns(idx);
    cols.unshift(int32('node', idx));
    cols.splice(
      8,
      0,
      float64(
        'row',
        Float64Array.from(idx, (i) => tree.row[i]),
      ),
    );
    cols.push(
      int32(
        'sel_level',
        Int32Array.from(idx, (i) => sel[i]),
      ),
    );
    ov.writeGroup(cols);
  }
  const ovInfo = await ov.close();
  const lastRg = ovInfo.metadata.row_groups[ovInfo.metadata.row_groups.length - 1];
  const tailStart = Math.min(...lastRg.columns.map((c) => Number(c.meta_data.dictionary_page_offset || c.meta_data.data_page_offset)));
  T.overview_ms = performance.now() - t1;
  t1 = performance.now();

  // tips.parquet, the sidecar and the sequences: one pass over the tree in rank order
  const tipsOut = new ParquetOut(path.join(out, 'tips.parquet'), codec);
  const perColumn = p.sidecarFiles === 'columns';
  const catNames = Array.from({ length: p.categories }, (_, c) => categoryName(c));
  const numNames = Array.from({ length: p.numeric }, (_, c) => numberName(c));
  const sideOuts = new Map(); // file name -> ParquetOut
  const sideFile = (col) => (perColumn ? `sidecar_${col}.parquet` : 'sidecar.parquet');
  const outFor = (file) => {
    if (!sideOuts.has(file)) sideOuts.set(file, new ParquetOut(path.join(out, file), codec));
    return sideOuts.get(file);
  };
  // tips.parquet has its own row group size (labels are big and a tip is looked up on its own): buffer what the stream hands over
  const labelNodes = [];
  const labels = [];
  const flushLabels = (final) => {
    while (labels.length >= p.labelRg || (final && labels.length)) {
      const m = Math.min(p.labelRg, labels.length);
      tipsOut.writeGroup([int32('node', Int32Array.from(labelNodes.splice(0, m)), true), string('tip_label', labels.splice(0, m))]);
    }
  };
  if (p.seqShard && p.seqShard % p.seqRg) throw new Error('--seq-shard must be a multiple of --seq-rg');
  const seqOuts = []; // the sequence file, or its shards
  let seqRows = 0;
  const writeSeq = (g) => {
    const shard = p.seqShard ? Math.floor(seqRows / p.seqShard) : 0;
    if (!seqOuts[shard])
      seqOuts[shard] = new ParquetOut(path.join(out, p.seqShard ? `sequence_${String(shard).padStart(4, '0')}.parquet` : 'sequence.parquet'), codec);
    seqOuts[shard].writeGroup([string('sequence', g)]);
    seqRows += g.length;
  };
  const stats = streamSidecar(tree, p, (rank) => tipLabel(rank, p.seed), p.tipRg, p.seqRg, {
    small(g) {
      for (let k = 0; k < g.node.length; k++) {
        labelNodes.push(g.node[k]);
        labels.push(g.labels[k]);
      }
      flushLabels(false);
      const byFile = new Map();
      const add = (file, col) => byFile.set(file, [...(byFile.get(file) ?? []), col]);
      catNames.forEach((name, c) => {
        add(
          sideFile(name),
          p.catEncoding === 'code'
            ? int32(name, g.cats[c])
            : string(
                name,
                Array.from(g.cats[c], (v) => categoryValue(c, v)),
                true,
              ),
        );
      });
      numNames.forEach((name, c) => {
        const v = g.nums[c];
        add(sideFile(name), name === 'year' ? int32(name, Int32Array.from(v), true) : float32(name, v));
      });
      for (const [file, cols] of byFile) outFor(file).writeGroup(cols);
    },
    seq(g) {
      writeSeq(g);
    },
  });
  flushLabels(true);
  const tipsInfo = await tipsOut.close();
  const sideInfos = [];
  for (const o2 of sideOuts.values()) sideInfos.push(await o2.close());
  const seqInfos = [];
  for (const o3 of seqOuts) seqInfos.push(await o3.close());
  T.sidecar_ms = performance.now() - t1;

  const fileInfo = (i) => ({ bytes: i.bytes, footer: i.footer, row_groups: i.row_groups });
  const files = { 'nodes.parquet': fileInfo(nodesInfo), 'tips.parquet': fileInfo(tipsInfo), 'overview.parquet': fileInfo(ovInfo) };
  for (const i of sideInfos) files[i.file] = fileInfo(i);
  for (const i of seqInfos) files[i.file] = fileInfo(i);
  const columns = [
    ...catNames.map((name, c) => ({
      name,
      kind: 'category',
      file: sideFile(name),
      encoding: p.catEncoding,
      values: Array.from({ length: stats.cardinalities[c] }, (_, k) => categoryValue(c, k)),
      counts: stats.counts[c],
    })),
    ...numNames.map((name) => ({ name, kind: name === 'year' ? 'int' : 'float', file: sideFile(name) })),
  ];
  const manifest = {
    version: 2,
    nodes: n,
    tips: p.tips,
    has_lengths: p.lengths,
    max_depth: tree.maxDepthAll,
    max_cum: tree.maxCum[0],
    float: 'f32',
    codec,
    rg_rows: p.rg,
    rg_node_start: starts,
    overview: {
      row_budgets: budgets,
      level_rows: levels.map((l) => l.length),
      level_min_tips: budgets.map((_, L) => {
        let m = Infinity;
        for (let i = 0; i < n; i++) if (sel[i] === L && tree.tipCount[i] < m) m = tree.tipCount[i];
        return m === Infinity ? 0 : m;
      }),
      tail_start: tailStart,
      file_order: 'deepest level first, level 0 last',
    },
    tip_rg_rows: p.tipRg,
    label_rg_rows: p.labelRg,
    files,
    sidecar: {
      rows: p.tips,
      layout: p.sidecarFiles,
      columns,
      sequence: seqInfos.length
        ? {
            column: 'sequence',
            length: p.seqLength,
            alphabet: 'ACGT',
            rg_rows: p.seqRg,
            shard_rows: p.seqShard || p.tips, // rows of each file but the last
            files: seqInfos.map((i) => ({ file: i.file, rows: i.rows })),
          }
        : null,
    },
    generator: {
      seed: p.seed,
      categories: p.categories,
      cardinality: p.cardinality,
      keep: p.keep,
      numeric: p.numeric,
      seq_length: p.seqLength,
      seq_rate: p.seqRate,
      rg: p.rg,
      tip_rg: p.tipRg,
      seq_rg: p.seqRg,
      cat_encoding: p.catEncoding,
      sidecar_files: p.sidecarFiles,
      first_budget: p.firstBudget,
    },
  };
  fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest));
  T.total_ms = performance.now() - t0;
  return { out, manifest, timings: T };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values: v } = parseArgs({
    options: {
      tips: { type: 'string' },
      out: { type: 'string' },
      seed: { type: 'string' },
      categories: { type: 'string' },
      cardinality: { type: 'string' },
      keep: { type: 'string' },
      numeric: { type: 'string' },
      'seq-length': { type: 'string' },
      'seq-rate': { type: 'string' },
      rg: { type: 'string' },
      'tip-rg': { type: 'string' },
      'label-rg': { type: 'string' },
      'seq-rg': { type: 'string' },
      'seq-shard': { type: 'string' },
      'cat-encoding': { type: 'string' },
      'sidecar-files': { type: 'string' },
      codec: { type: 'string' },
      'first-budget': { type: 'string' },
      'no-lengths': { type: 'boolean' },
    },
  });
  const num = (x) => (x === undefined ? undefined : +x);
  const opts = {
    tips: num(v.tips),
    out: v.out,
    seed: num(v.seed),
    categories: num(v.categories),
    cardinality: num(v.cardinality),
    keep: num(v.keep),
    numeric: num(v.numeric),
    seqLength: num(v['seq-length']),
    seqRate: num(v['seq-rate']),
    rg: num(v.rg),
    tipRg: num(v['tip-rg']),
    labelRg: num(v['label-rg']),
    seqRg: num(v['seq-rg']),
    seqShard: num(v['seq-shard']),
    catEncoding: v['cat-encoding'],
    sidecarFiles: v['sidecar-files'],
    codec: v.codec,
    firstBudget: num(v['first-budget']),
    lengths: v['no-lengths'] ? false : undefined,
  };
  for (const k of Object.keys(opts)) if (opts[k] === undefined) delete opts[k];
  const r = await generate(opts);
  const files = Object.fromEntries(
    Object.entries(r.manifest.files).map(([k, f]) => [k, `${(f.bytes / 1e6).toFixed(2)} MB, ${f.row_groups} row groups`]),
  );
  console.log(
    JSON.stringify(
      {
        out: r.out,
        tips: r.manifest.tips,
        nodes: r.manifest.nodes,
        codec: r.manifest.codec,
        files,
        overview_level_rows: r.manifest.overview.level_rows,
        timings_ms: Object.fromEntries(Object.entries(r.timings).map(([k, x]) => [k, Math.round(x)])),
      },
      null,
      2,
    ),
  );
}
