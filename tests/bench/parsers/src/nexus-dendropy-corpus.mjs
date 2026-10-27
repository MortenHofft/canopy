// Our parseNexus against DendroPy on every NEXUS file in DendroPy's own test data, tree by tree.
//   node --experimental-transform-types --no-warnings src/nexus-dendropy-corpus.mjs <dendropy>/tests/unittests/data [--json out.json]
// Needs `pip install dendropy` and a checkout of DendroPy (BSD-3, https://github.com/jeetsukumaran/dendropy). The files are
// read, not copied. Imports the parser from the sources, so no npm install is needed.
//
// Per file the verdict is one of
//   same        both read it and agree on the tree(s) compared (first, second, last): tip labels, tip and node counts,
//               branch-length count and sum, root degree, a hash of the shape with every edge length, and the number of trees (or both find no tree in it)
//   differs     both read it, they disagree (what is listed)
//   we-throw    DendroPy reads it, we throw
//   dp-throws   we read it, DendroPy throws
//   both-throw  neither reads it
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { signature } from './nexus-shape.mjs';
import { parseNexus } from '../../../../packages/io/src/index.ts';

const argv = process.argv.slice(2);
const root = argv[0];
if (!root || root.startsWith('--')) {
  console.error('usage: nexus-dendropy-corpus.mjs <dendropy>/tests/unittests/data [--json out.json]');
  process.exit(2);
}
const jsonOut = argv.includes('--json') ? argv[argv.indexOf('--json') + 1] : null;
const here = dirname(fileURLToPath(import.meta.url));

/** UTF-8, or latin-1 for a file that is not UTF-8 (the same rule as dendropy-nexus-summary.py). */
function readText(path) {
  const b = readFileSync(path);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(b);
  } catch {
    return b.toString('latin1');
  }
}

const files = [];
for (const d of ['trees', 'mixed']) {
  for (const f of readdirSync(join(root, d)).sort()) {
    const p = join(root, d, f);
    if (/^\s*#nexus\b/i.test(readText(p).slice(0, 2000))) files.push(p);
  }
}

const py = spawnSync('python3', [resolve(here, 'dendropy-nexus-summary.py'), ...files], { encoding: 'utf8', maxBuffer: 1 << 28 });
if (py.status !== 0) {
  console.error(py.stderr.slice(0, 500));
  process.exit(1);
}
const dp = new Map(
  py.stdout
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l))
    .map((r) => [r.file, r]),
);

const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
function ours(text, i) {
  const { tree: t } = parseNexus(text, i);
  let nlen = 0;
  let lensum = 0;
  for (let n = 1; n < t.nodeCount; n++) {
    if (!Number.isNaN(t.length[n])) {
      nlen++;
      lensum += t.length[n];
    }
  }
  return {
    tips: t.tipCount,
    nodes: t.nodeCount,
    labels: [...t.tipLabels].sort(),
    nlen,
    lensum,
    rootChildren: t.children(0).length,
    sig: signature(t),
  };
}

const rows = [];
for (const f of files) {
  const name = f.slice(root.length + 1);
  const text = readText(f);
  const d = dp.get(f);
  let treeCount = null;
  let err = null;
  try {
    ours(text, 0); // throws when there is no tree 0
    treeCount = parseNexus(text, 0).treeCount;
  } catch (e) {
    err = e.message;
  }
  if (!d.error && err && d.treeCount === 0 && /no tree number/.test(err))
    rows.push({ name, verdict: 'same', note: 'no trees in the file, for both' });
  else if (d.error && err) rows.push({ name, verdict: 'both-throw', note: `ours: ${err.slice(0, 90)} | dendropy: ${d.error.slice(0, 90)}` });
  else if (d.error) rows.push({ name, verdict: 'dp-throws', note: d.error.slice(0, 160) });
  else if (err) rows.push({ name, verdict: 'we-throw', note: err.slice(0, 160) });
  else {
    const diffs = [];
    if (treeCount !== d.treeCount) diffs.push(`trees ${treeCount} vs ${d.treeCount}`);
    for (const [i, s] of Object.entries(d.trees)) {
      let o;
      try {
        o = ours(text, Number(i));
      } catch (e) {
        diffs.push(`tree ${i}: we throw ${e.message.slice(0, 60)}`);
        continue;
      }
      if (o.tips !== s.tips) diffs.push(`tree ${i} tips ${o.tips} vs ${s.tips}`);
      if (o.nodes !== s.nodes) diffs.push(`tree ${i} nodes ${o.nodes} vs ${s.nodes}`);
      if (!same(o.labels, s.labels)) {
        const miss = s.labels.filter((l) => !o.labels.includes(l));
        diffs.push(
          `tree ${i} labels (e.g. ours ${JSON.stringify(o.labels.filter((l) => !s.labels.includes(l)).slice(0, 2))} vs ${JSON.stringify(miss.slice(0, 2))})`,
        );
      }
      if (o.nlen !== s.nlen) diffs.push(`tree ${i} lengths ${o.nlen} vs ${s.nlen}`);
      else if (Math.abs(o.lensum - s.lensum) > 1e-9 * Math.max(1, Math.abs(s.lensum))) diffs.push(`tree ${i} length sum ${o.lensum} vs ${s.lensum}`);
      if (o.sig !== s.sig) diffs.push(`tree ${i} shape or branch lengths differ (hash ${o.sig} vs ${s.sig})`);
      if (o.rootChildren !== s.rootChildren) diffs.push(`tree ${i} root degree ${o.rootChildren} vs ${s.rootChildren}`);
    }
    rows.push({ name, verdict: diffs.length ? 'differs' : 'same', note: diffs.join('; ') });
  }
}

const count = (v) => rows.filter((r) => r.verdict === v).length;
for (const r of rows) if (r.verdict !== 'same') console.log(`${r.verdict.padEnd(10)} ${r.name}\n           ${r.note}`);
console.log(
  `\n${rows.length} NEXUS files: same ${count('same')}, differs ${count('differs')}, we-throw ${count('we-throw')}, dp-throws ${count('dp-throws')}, both-throw ${count('both-throw')}`,
);
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(rows, null, 1));
