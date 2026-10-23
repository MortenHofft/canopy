// Node timing of the equal-angle unrooted layout pass (packages/viewer/src/unrooted.ts, #42 spike), next to computeLayout for scale.
// Results in docs/design/unrooted.md.
//   node --experimental-transform-types --no-warnings --expose-gc tests/browser/bench/unrooted-layout.mjs <tree.nwk[.gz]> ... [--runs 15]
// Per file: parse once, then `runs` alternating runs of unrootedLayout and computeLayout (phylogram); prints min and median in ms.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const { parseNewick } = await import(path.join(root, 'packages/io/src/newick.ts'));
const { unrootedLayout } = await import(path.join(root, 'packages/viewer/src/unrooted.ts'));
const { computeLayout } = await import(path.join(root, 'packages/viewer/src/layout.ts'));

const argv = process.argv.slice(2);
const ri = argv.indexOf('--runs');
const runs = ri >= 0 ? Number(argv[ri + 1]) : 15;
const files = argv.filter((a, i) => !a.startsWith('--') && (ri < 0 || i !== ri + 1));
if (files.length === 0) {
  console.error('usage: unrooted-layout.mjs <tree.nwk[.gz]> ... [--runs 15]');
  process.exit(2);
}

const stats = (a) => {
  const s = [...a].sort((x, y) => x - y);
  return { min: s[0], median: s[Math.floor(s.length / 2)] };
};
const fmt = (v) => v.toFixed(1);

console.log(`node ${process.version}, ${runs} runs each`);
for (const f of files) {
  let buf = fs.readFileSync(f);
  if (buf[0] === 0x1f && buf[1] === 0x8b) buf = zlib.gunzipSync(buf);
  const t0 = performance.now();
  const tree = parseNewick(buf.toString('utf8'));
  const parseMs = performance.now() - t0;
  const un = [],
    rect = [];
  let L = null;
  for (let r = 0; r < runs; r++) {
    globalThis.gc?.();
    let t = performance.now();
    L = unrootedLayout(tree);
    un.push(performance.now() - t);
    globalThis.gc?.();
    t = performance.now();
    computeLayout(tree, true);
    rect.push(performance.now() - t);
  }
  const u = stats(un),
    c = stats(rect);
  console.log(
    `${path.basename(f)}: ${tree.tipCount} tips, ${tree.nodeCount} nodes, lengths ${L.usedLengths ? 'yes' : 'no (unit)'}, parse ${fmt(parseMs)} ms | ` +
      `unrootedLayout min ${fmt(u.min)} median ${fmt(u.median)} ms | computeLayout min ${fmt(c.min)} median ${fmt(c.median)} ms`,
  );
}
