#!/usr/bin/env node
// Compact markdown tables from results/E*.json, the ones that docs/design/parquet-sidecar-benchmark.md shows.
//   node scripts/report.mjs [E1 E2 ...]   (default: all that exist)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'results');
const kb = (b) => (b >= 1e6 ? `${(b / 1e6).toFixed(2)} MB` : `${(b / 1e3).toFixed(0)} KB`);
const step = (x) => (x ? `${x.ms.toFixed(0)} ms, ${x.requests} req, ${kb(x.bytes)}` : 'n/a');
const sum = (f, pre) =>
  Object.entries(f)
    .filter(([k]) => k.startsWith(pre))
    .reduce((a, [, v]) => ({ bytes: a.bytes + v.bytes, rg: a.rg + v.row_groups, files: a.files + 1, footer: Math.max(a.footer, v.footer) }), {
      bytes: 0,
      rg: 0,
      files: 0,
      footer: 0,
    });

const TABLES = {
  E1: {
    head: ['case', 'all files', 'first view', 'colour by country', 'open a clade', 'inspect, cold', 'inspect, warm', 'JS heap'],
    row: (r, p) => [
      r.name,
      kb(Object.values(r.result.files).reduce((a, v) => a + v.bytes, 0)),
      step(p.first),
      step(p.colour),
      step(p.zoom),
      step(p.inspect),
      step(p.inspect2),
      `${p.end.heapMB.toFixed(0)} MB`,
    ],
  },
  E2: {
    head: ['case', 'sidecar files', 'colour by country', 'inspect, cold', 'inspect, warm'],
    row: (r, p) => {
      const s = sum(r.result.files, 'sidecar');
      return [r.name, `${s.files} file(s), ${kb(s.bytes)}, ${s.rg} row groups`, step(p.colour), step(p.inspect), step(p.inspect2)];
    },
  },
  E3: {
    head: ['case', 'colour by country', 'inspect, cold', 'inspect, warm'],
    row: (r, p) => [r.name, step(p.colour), step(p.inspect), step(p.inspect2)],
  },
  E4: {
    head: ['case', 'sequence file', 'inspect, cold', 'inspect, warm'],
    row: (r, p) => {
      const s = sum(r.result.files, 'sequence');
      return [r.name, `${kb(s.bytes)}, ${s.rg} row groups, footer ${kb(s.footer)}`, step(p.inspect), step(p.inspect2)];
    },
  },
  E5: {
    head: ['case', 'nodes.parquet', 'first view', 'open a clade'],
    row: (r, p) => {
      const n = r.result.files['nodes.parquet'];
      return [r.name, `${kb(n.bytes)}, ${n.row_groups} row groups, footer ${kb(n.footer)}`, step(p.first), step(p.zoom)];
    },
  },
  E6: {
    head: ['case', 'overview.parquet', 'first view', 'open a clade'],
    row: (r, p) => {
      const n = r.result.files['overview.parquet'];
      return [r.name, `${kb(n.bytes)}, ${n.row_groups} row groups`, step(p.first), step(p.zoom)];
    },
  },
};
TABLES.E7 = TABLES.E4;
TABLES.E8 = TABLES.E2;

const want = process.argv.slice(2);
for (const id of Object.keys(TABLES)) {
  if (want.length && !want.includes(id)) continue;
  const f = path.join(dir, `${id}.json`);
  if (!fs.existsSync(f)) continue;
  const d = JSON.parse(fs.readFileSync(f, 'utf8'));
  const t = TABLES[id];
  for (const profile of ['4g', 'none']) {
    console.log(`**${id}, ${profile === 'none' ? 'no network model (local server)' : 'simulated 4G (150 ms, 9 Mbit/s)'}**\n`);
    console.log(`| ${t.head.join(' | ')} |`, `\n|${t.head.map(() => '---').join('|')}|`);
    for (const r of d.rows) console.log(r.error ? `| ${r.name} | error: ${r.error} |` : `| ${t.row(r, r.result.profiles[profile]).join(' | ')} |`);
    console.log();
  }
}
