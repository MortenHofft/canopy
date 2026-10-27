// Our parsePhyloXml against Biopython's phyloXML reader on phyloXML files, tree by tree.
//   node --experimental-transform-types --no-warnings src/phyloxml-biopython-corpus.mjs <file-or-folder> ... [--all] [--json out.json]
// Needs `pip install biopython`. A folder is searched for *.xml and *.xml.gz. Files that are not phyloXML are skipped when both
// readers refuse them; with --all every phylogeny of a file is compared, not the first, second and last. Imports the parser from the sources, so no npm install is needed. Per file the verdict is
//   same        both read it and agree on the phylogenies compared (first, second, last): tip labels, tip and node counts, number
//               and sum of branch lengths, number and sum of supports, root degree, a hash of the shape with every edge length,
//               and the number of phylogenies
//   differs     both read it, they disagree (what is listed)
//   we-throw    Biopython reads it, we throw
//   bio-throws  we read it, Biopython throws
//   bio-none    we read it, Biopython finds no phylogeny in it (it requires the phyloXML namespace; for a file that has none the helper
//               adds it in memory and reads again, so this is left for a file with a namespace that Biopython still cannot use)
//   both-throw  neither reads it
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { signature } from './nexus-shape.mjs';
import { parsePhyloXml } from '../../../../packages/io/src/index.ts';

const argv = process.argv.slice(2);
const jsonOut = argv.includes('--json') ? argv[argv.indexOf('--json') + 1] : null;
const every = argv.includes('--all');
const roots = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--json');
if (!roots.length) {
  console.error('usage: phyloxml-biopython-corpus.mjs <file-or-folder> ... [--json out.json]');
  process.exit(2);
}
const here = dirname(fileURLToPath(import.meta.url));

const files = [];
const walk = (p) => {
  if (statSync(p).isDirectory()) for (const f of readdirSync(p).sort()) walk(join(p, f));
  else if (/\.xml(\.gz)?$/i.test(p)) files.push(p);
};
for (const r of roots) walk(r);

const py = spawnSync('python3', [resolve(here, 'biopython-phyloxml-summary.py'), ...(every ? ['--all'] : []), ...files], {
  encoding: 'utf8',
  maxBuffer: 1 << 28,
});
if (py.status !== 0) {
  console.error(py.stderr.slice(0, 500));
  process.exit(1);
}
const bio = new Map(
  py.stdout
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l))
    .map((r) => [r.file, r]),
);

const text = (f) => {
  const b = readFileSync(f);
  return (f.endsWith('.gz') ? gunzipSync(b) : b).toString('utf8');
};
const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
function ours(src, i) {
  const { tree: t } = parsePhyloXml(src, i);
  let nlen = 0;
  let lensum = 0;
  let nsup = 0;
  let supsum = 0;
  const sups = [];
  for (let n = 0; n < t.nodeCount; n++) {
    if (n > 0 && !Number.isNaN(t.length[n])) {
      nlen++;
      lensum += t.length[n];
    }
    if (!Number.isNaN(t.support[n])) {
      nsup++;
      supsum += t.support[n];
      sups.push(t.support[n]);
    }
  }
  return {
    tips: t.tipCount,
    nodes: t.nodeCount,
    labels: [...t.tipLabels].sort(),
    nlen,
    lensum,
    nsup,
    supsum,
    sups: sups.sort((a, b) => a - b),
    rootChildren: t.children(0).length,
    sig: signature(t),
  };
}
const close = (a, b) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b));

const rows = [];
for (const f of files) {
  const name = f.length > 70 ? '…' + f.slice(-69) : f;
  const src = text(f);
  const d = bio.get(f);
  let treeCount = null;
  let err = null;
  try {
    treeCount = parsePhyloXml(src, 0).treeCount;
  } catch (e) {
    err = e.message;
  }
  if (d.error && err) rows.push({ name, verdict: 'both-throw', note: `ours: ${err.slice(0, 80)} | biopython: ${d.error.slice(0, 80)}` });
  else if (d.error) rows.push({ name, verdict: 'bio-throws', note: d.error.slice(0, 160) });
  else if (!err && d.treeCount === 0) rows.push({ name, verdict: 'bio-none', note: 'Biopython finds no phylogeny (no phyloXML namespace?)' });
  else if (err) rows.push({ name, verdict: 'we-throw', note: err.slice(0, 160) });
  else {
    const diffs = [];
    if (treeCount !== d.treeCount) diffs.push(`phylogenies ${treeCount} vs ${d.treeCount}`);
    for (const [i, s] of Object.entries(d.trees)) {
      let o;
      try {
        o = ours(src, Number(i));
      } catch (e) {
        diffs.push(`tree ${i}: we throw ${e.message.slice(0, 60)}`);
        continue;
      }
      if (o.tips !== s.tips) diffs.push(`tree ${i} tips ${o.tips} vs ${s.tips}`);
      if (o.nodes !== s.nodes) diffs.push(`tree ${i} nodes ${o.nodes} vs ${s.nodes}`);
      if (!same(o.labels, s.labels)) {
        diffs.push(
          `tree ${i} labels (e.g. ours ${JSON.stringify(o.labels.filter((l) => !s.labels.includes(l)).slice(0, 2))} vs ${JSON.stringify(s.labels.filter((l) => !o.labels.includes(l)).slice(0, 2))})`,
        );
      }
      if (o.nlen !== s.nlen) diffs.push(`tree ${i} lengths ${o.nlen} vs ${s.nlen}`);
      else if (!close(o.lensum, s.lensum)) diffs.push(`tree ${i} length sum ${o.lensum} vs ${s.lensum}`);
      if (o.nsup !== s.nsup) diffs.push(`tree ${i} supports ${o.nsup} vs ${s.nsup}`);
      else if (!close(o.supsum, s.supsum)) diffs.push(`tree ${i} support sum ${o.supsum} vs ${s.supsum}`);
      else if (o.sups.some((v, k) => !close(v, s.sups[k]))) diffs.push(`tree ${i} the supports differ (the sorted lists)`);
      if (o.sig !== s.sig) diffs.push(`tree ${i} shape or branch lengths differ`);
      if (o.rootChildren !== s.rootChildren) diffs.push(`tree ${i} root degree ${o.rootChildren} vs ${s.rootChildren}`);
    }
    rows.push({ name, verdict: diffs.length ? 'differs' : 'same', note: diffs.join('; ') });
  }
}
const count = (v) => rows.filter((r) => r.verdict === v).length;
for (const r of rows) if (r.verdict !== 'same') console.log(`${r.verdict.padEnd(10)} ${r.name}\n           ${r.note}`);
console.log(
  `\n${rows.length} phyloXML files: same ${count('same')}, differs ${count('differs')}, we-throw ${count('we-throw')}, bio-throws ${count('bio-throws')}, bio-none ${count('bio-none')}, both-throw ${count('both-throw')}`,
);
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(rows, null, 1));
