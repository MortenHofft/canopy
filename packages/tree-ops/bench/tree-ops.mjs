// Cost of the tree operations (src/) on large trees, in Node (same V8 as Chromium, no rendering). Each operation builds
// new preorder arrays and the times include that; wrapping them in a tree model is the caller's. Median of --reps runs.
//   npm run bench -- [--reps 5] file.nwk[.gz] ...   (from packages/tree-ops)
// The big synthetic trees are git-ignored: `make large` in data/synthetic generates them.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { autoCollapse, collapseBySupport, ladderise, midpointRoot, prune, reroot } from '../src/index.ts';
import { parseNewick } from '@gbif-phylo/io'; // fixture: text -> TreeInput

const argv = process.argv.slice(2);
const reps = argv[0] === '--reps' ? Number(argv[1]) : 5;
const files = argv[0] === '--reps' ? argv.slice(2) : argv;

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

for (const f of files) {
  const buf = fs.readFileSync(f);
  const text = (f.endsWith('.gz') ? zlib.gunzipSync(buf) : buf).toString('utf8');
  const t0 = performance.now();
  const t = parseNewick(text);
  const parseMs = performance.now() - t0;
  // the deepest tip: the longest path to reverse
  const h = t.depth;
  let deep = t.tipNode[0];
  for (let r = 0; r < t.tipCount; r++) if (h[t.tipNode[r]] > h[deep]) deep = t.tipNode[r];
  const hasSupport = t.support.some((s) => !Number.isNaN(s));
  const row = {
    tree: path.basename(f),
    tips: t.tipCount,
    maxDepth: t.maxDepth,
    parseMs: +parseMs.toFixed(0),
    rerootDeepMs: +median(() => reroot(t, deep)).toFixed(1),
    midpointMs: t.hasLengths ? +median(() => midpointRoot(t)).toFixed(1) : null,
    ladderiseMs: +median(() => ladderise(t)).toFixed(1),
    collapseSupportMs: hasSupport ? +median(() => collapseBySupport(t, 70)).toFixed(1) : null,
    prune10pctMs: +median(() => prune(t, (r) => r % 10 === 0)).toFixed(1),
    autoCollapse50Ms: +median(() => autoCollapse(t, { maxRows: 50 })).toFixed(2),
  };
  console.log(JSON.stringify(row));
}
