#!/usr/bin/env node
// The partitioning experiments: each one generates datasets that differ in one thing, runs the benchmark on each (bench.mjs) and writes
// results/<id>.json and a markdown table. Datasets are made in ../../data/parquet/exp and removed after their run (--keep to keep them).
//   node scripts/experiments.mjs [--only E1,E2] [--repeat 2] [--profiles none,4g] [--keep]
//   E1 scale          10k, 100k, 1M tips (and 5M without sequences), with and without a 500-base sequence per tip
//   E2 sidecar rows   row group size of the small sidecar columns, one file or one file per column, codes or strings (1M tips)
//   E3 merging        the gap below which range requests are merged, and the planning of ranges, on the two layouts (1M tips)
//   E4 sequences      row group size of the sequence file, and how well sequences compress at three mutation rates (1M tips, 500 bases)
//   E5 node groups    row group size of nodes.parquet: what opening a clade costs (1M tips)
//   E7 shards         the sequence file cut into files of N tips, so that small row groups do not make a big footer (1M tips, 500 bases)
//   E8 wide sidecar   many columns: one file against one file per column, for colouring and for reading one tip's row (1M tips, 16 columns)
//   E6 overview       rows of the first overview level: what the first view costs and how big a stub is (1M tips)

import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { generate } from './generate.mjs';
import { runCase } from './bench.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..', '..', 'data', 'parquet', 'exp');
const results = path.resolve(here, '..', 'results');

const M = 1_000_000;
const EXPERIMENTS = {
  E1: {
    title: 'Scale: the tree and the sidecar from 10,000 to 5,000,000 tips',
    cases: [10_000, 100_000, M]
      .flatMap((tips) => [
        { name: `${tips / 1000}k`, gen: { tips, seqLength: 0 } },
        { name: `${tips / 1000}k-seq500`, gen: { tips, seqLength: 500, seqRate: 0.5 } },
      ])
      .concat([{ name: '5000k', gen: { tips: 5 * M, seqLength: 0 } }]),
  },
  E2: {
    title: 'The small sidecar columns: row group size, file layout and encoding (1M tips, no sequences)',
    cases: [
      { name: 'single rg16k codes', gen: { tips: M, tipRg: 16384 } },
      { name: 'single rg64k codes', gen: { tips: M, tipRg: 65536 } },
      { name: 'single rg256k codes', gen: { tips: M, tipRg: 262144 } },
      { name: 'columns rg16k codes', gen: { tips: M, tipRg: 16384, sidecarFiles: 'columns' } },
      { name: 'columns rg64k codes', gen: { tips: M, tipRg: 65536, sidecarFiles: 'columns' } },
      { name: 'columns rg256k codes', gen: { tips: M, tipRg: 262144, sidecarFiles: 'columns' } },
      { name: 'single rg16k strings', gen: { tips: M, tipRg: 16384, catEncoding: 'string' } },
      { name: 'columns rg64k strings', gen: { tips: M, tipRg: 65536, sidecarFiles: 'columns', catEncoding: 'string' } },
    ],
  },
  E3: {
    title: 'Merging range requests: the gap and the planning of ranges (1M tips, no sequences)',
    cases: [
      { name: 'single rg16k gap0', gen: { tips: M }, dataset: 'single', page: 'gap=0' },
      { name: 'single rg16k gap64k', gen: { tips: M }, dataset: 'single', page: 'gap=65536' },
      { name: 'single rg16k gap256k', gen: { tips: M }, dataset: 'single', page: 'gap=262144' },
      { name: 'single rg16k gap1M', gen: { tips: M }, dataset: 'single', page: 'gap=1048576' },
      { name: 'single rg16k gap64k noplan', gen: { tips: M }, dataset: 'single', page: 'gap=65536&plan=0' },
      { name: 'columns rg16k gap64k', gen: { tips: M, sidecarFiles: 'columns' }, dataset: 'columns', page: 'gap=65536' },
      { name: 'columns rg16k gap64k noplan', gen: { tips: M, sidecarFiles: 'columns' }, dataset: 'columns', page: 'gap=65536&plan=0' },
    ],
  },
  E4: {
    title: 'Sequences: row group size of the sequence file, and how well they compress (1M tips, 500 bases)',
    cases: [
      ...[64, 256, 1024, 4096].map((seqRg) => ({ name: `seq-rg ${seqRg}`, gen: { tips: M, seqLength: 500, seqRate: 0.5, seqRg } })),
      ...[0.05, 2].map((seqRate) => ({ name: `rate ${seqRate} seq-rg 512`, gen: { tips: M, seqLength: 500, seqRate, seqRg: 512 } })),
    ],
  },
  E5: {
    title: 'Row groups of nodes.parquet: what opening a clade costs (1M tips, no sequences)',
    cases: [4096, 16384, 65536].map((rg) => ({ name: `node rg ${rg}`, gen: { tips: M, rg } })),
  },
  E7: {
    title: 'Sequences in shards: files of N tips, so that small row groups do not make a big footer (1M tips, 500 bases)',
    cases: [
      { name: 'seq-rg 256, one file', gen: { tips: M, seqLength: 500, seqRate: 0.5, seqRg: 256 } },
      { name: 'seq-rg 1024, one file', gen: { tips: M, seqLength: 500, seqRate: 0.5, seqRg: 1024 } },
      { name: 'seq-rg 256, shards of 65536', gen: { tips: M, seqLength: 500, seqRate: 0.5, seqRg: 256, seqShard: 65536 } },
      { name: 'seq-rg 64, shards of 65536', gen: { tips: M, seqLength: 500, seqRate: 0.5, seqRg: 64, seqShard: 65536 } },
      { name: 'seq-rg 256, shards of 16384', gen: { tips: M, seqLength: 500, seqRate: 0.5, seqRg: 256, seqShard: 16384 } },
    ],
  },
  E8: {
    title: 'A wide sidecar: 8 category and 8 numeric columns, one file or one file per column (1M tips, no sequences)',
    cases: [
      { name: 'wide single rg16k', gen: { tips: M, categories: 8, numeric: 8 } },
      { name: 'wide columns rg16k', gen: { tips: M, categories: 8, numeric: 8, sidecarFiles: 'columns' } },
      { name: 'wide columns rg64k', gen: { tips: M, categories: 8, numeric: 8, sidecarFiles: 'columns', tipRg: 65536 } },
    ],
  },
  E6: {
    title: 'Rows of the first overview level (1M tips, no sequences)',
    cases: [512, 2048, 8192].map((firstBudget) => ({ name: `first level ${firstBudget} rows`, gen: { tips: M, firstBudget } })),
  },
};

const fmtB = (b) => (b >= 1e6 ? `${(b / 1e6).toFixed(2)} MB` : `${(b / 1e3).toFixed(0)} KB`);
const cell = (x) => (x ? `${x.ms.toFixed(0)} ms, ${x.requests} req, ${fmtB(x.bytes)}` : 'n/a');

function markdown(id, e, rows, profile) {
  const out = [
    `### ${id}: ${e.title}`,
    '',
    `Profile \`${profile}\` (${profile === 'none' ? 'no network model' : 'simulated'}), median of the runs. Headless Chromium, CPU canvas, local server.`,
    '',
  ];
  out.push(
    '| case | files | first view | colour by country | zoom (open a clade) | inspect, cold | inspect, warm |',
    '|---|---|---|---|---|---|---|',
  );
  for (const r of rows) {
    if (r.error) {
      out.push(`| ${r.name} | error: ${r.error} | | | | | |`);
      continue;
    }
    const s = r.result.profiles[profile];
    const f = r.result.files;
    const files = Object.entries(f)
      .map(([k, v]) => `${k.replace('.parquet', '')} ${fmtB(v.bytes)} (${v.row_groups} rg, footer ${fmtB(v.footer)})`)
      .join('; ');
    out.push(`| ${r.name} | ${files} | ${cell(s.first)} | ${cell(s.colour)} | ${cell(s.zoom)} | ${cell(s.inspect)} | ${cell(s.inspect2)} |`);
  }
  return out.join('\n');
}

const { values: A } = parseArgs({
  options: {
    only: { type: 'string' },
    repeat: { type: 'string', default: '2' },
    profiles: { type: 'string', default: 'none,4g' },
    keep: { type: 'boolean' },
  },
});
const ids = (A.only ?? Object.keys(EXPERIMENTS).join(',')).split(',');
fs.mkdirSync(results, { recursive: true });
fs.mkdirSync(root, { recursive: true });
for (const id of ids) {
  const e = EXPERIMENTS[id];
  const rows = [];
  const shared = new Map(); // dataset key -> directory, for cases that differ only in the page parameters
  for (const c of e.cases) {
    const key = c.dataset ?? c.name;
    const dir = path.join(root, key.replace(/[^a-zA-Z0-9_-]+/g, '_'));
    try {
      if (!shared.has(key)) {
        fs.rmSync(dir, { recursive: true, force: true });
        const t0 = performance.now();
        await generate({ ...c.gen, out: dir });
        console.error(`[${id}] generated ${key} in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
        shared.set(key, dir);
      }
      const result = await runCase({ data: dir, profiles: A.profiles.split(','), repeat: +A.repeat, pageParams: c.page });
      rows.push({ name: c.name, params: { gen: c.gen, page: c.page }, result });
      console.error(`[${id}] ${c.name}: done`);
    } catch (err) {
      rows.push({ name: c.name, error: String(err.message ?? err) });
      console.error(`[${id}] ${c.name}: ${err}`);
    }
    if (!A.keep && !e.cases.some((o) => o !== c && (o.dataset ?? o.name) === key && e.cases.indexOf(o) > e.cases.indexOf(c)))
      fs.rmSync(dir, { recursive: true, force: true });
  }
  fs.writeFileSync(path.join(results, `${id}.json`), JSON.stringify({ id, title: e.title, rows }, null, 1));
  const md = A.profiles
    .split(',')
    .map((p) => markdown(id, e, rows, p))
    .join('\n\n');
  fs.writeFileSync(path.join(results, `${id}.md`), md + '\n');
  console.log(md + '\n');
}
