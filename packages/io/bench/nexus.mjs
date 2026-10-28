// Parse time of parseNexus on NEXUS files, in Node (same V8 as Chromium). Median of --reps runs after a warm-up.
//   npm run bench -- [--reps 7] [file.nex[.gz] ...]   (from packages/io)
// With no files: the NEXUS files of data/synthetic/nexus and the NEXUS trees of data/rich (see its manifest.json).
// Per file: the tree 0 parse without and with { annotations: true }, the index pass alone, and for a file of several trees the
// last tree (what a posterior browser pays for the tree it opens last) and all trees through nexusTrees.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { nexusIndex, nexusTrees, parseNexus } from '../src/nexus.ts';

const DATA = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../data');
const argv = process.argv.slice(2);
const reps = argv[0] === '--reps' ? Number(argv[1]) : 7;
let files = argv[0] === '--reps' ? argv.slice(2) : argv;
if (!files.length) {
  const manifest = JSON.parse(fs.readFileSync(path.join(DATA, 'rich/manifest.json'), 'utf8')).datasets;
  files = [
    ...fs.readdirSync(path.join(DATA, 'synthetic/nexus')).map((f) => path.join(DATA, 'synthetic/nexus', f)),
    ...manifest.filter((d) => d.format_detected === 'nexus').map((d) => path.join(DATA, 'rich', d.main_tree)),
  ];
}

const median = (fn) => {
  fn(); // warm-up
  const ts = [];
  for (let r = 0; r < reps; r++) {
    const t0 = performance.now();
    fn();
    ts.push(performance.now() - t0);
  }
  ts.sort((a, b) => a - b);
  return ts[ts.length >> 1];
};

const rows = [];
for (const f of files) {
  const buf = fs.readFileSync(f);
  const text = (f.endsWith('.gz') ? zlib.gunzipSync(buf) : buf).toString('utf8');
  const first = parseNexus(text);
  const trees = first.treeCount;
  const plain = median(() => parseNexus(text));
  const annotated = median(() => parseNexus(text, { annotations: true }));
  const indexed = median(() => nexusIndex(text));
  const every =
    trees > 1
      ? median(() => {
          for (const r of nexusTrees(text)) if (!r.tree) throw new Error('no tree');
        })
      : null;
  const last = trees > 1 ? median(() => parseNexus(text, trees - 1)) : null;
  const mb = text.length / 1e6;
  rows.push({
    file: path.basename(f),
    MB: mb.toFixed(2),
    tips: first.tree.tipCount,
    trees,
    ms: plain.toFixed(1),
    'ms +annotations': annotated.toFixed(1),
    'ms index': indexed.toFixed(1),
    'ms every tree': every === null ? '' : every.toFixed(1),
    'ms last tree': last === null ? '' : last.toFixed(1),
  });
}
console.table(rows);
