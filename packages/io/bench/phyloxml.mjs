// Parse time of parsePhyloXml: the phyloXML files of data/rich (or the files given), and phyloXML made up in memory of a given
// size (a random binary tree with names, branch lengths and a taxonomy on every tip).
//   npm run bench:phyloxml -- [--reps 7] [--tips 100000] [file.xml[.gz] ...]   (from packages/io)
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { parsePhyloXml } from '../src/phyloxml.ts';

const DATA = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../data');
const argv = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = argv.indexOf(name);
  return i < 0 ? dflt : Number(argv[i + 1]);
};
const reps = opt('--reps', 7);
const tips = opt('--tips', 100000);
let files = argv.filter((a, i) => !a.startsWith('--') && !['--reps', '--tips'].includes(argv[i - 1]));
if (!files.length) {
  const manifest = JSON.parse(fs.readFileSync(path.join(DATA, 'rich/manifest.json'), 'utf8')).datasets;
  files = manifest.filter((d) => d.format_detected === 'phyloxml').map((d) => path.join(DATA, 'rich', d.main_tree));
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

/** A random binary tree with `n` tips as phyloXML: join two neighbours at random until one is left. */
function made(n) {
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  let nodes = [];
  for (let i = 0; i < n; i++) {
    nodes.push(
      `<clade branch_length="${rnd().toFixed(5)}"><name>tip${i}</name><taxonomy><id provider="NCBI">${i}</id><scientific_name>Genus species${i}</scientific_name></taxonomy></clade>`,
    );
  }
  // pairing neighbours in rounds keeps this linear
  while (nodes.length > 1) {
    const next = [];
    for (let i = 0; i + 1 < nodes.length; i += 2)
      next.push(
        `<clade branch_length="${rnd().toFixed(5)}"><confidence type="bootstrap">${Math.floor(rnd() * 100)}</confidence>${nodes[i]}${nodes[i + 1]}</clade>`,
      );
    if (nodes.length % 2) next.push(nodes[nodes.length - 1]);
    nodes = next;
  }
  return `<?xml version="1.0"?>\n<phyloxml xmlns="http://www.phyloxml.org"><phylogeny rooted="true">${nodes[0]}</phylogeny></phyloxml>`;
}

const rows = [];
const run = (label, text) => {
  const r = parsePhyloXml(text);
  const mb = text.length / 1e6;
  const plain = median(() => parsePhyloXml(text));
  const annotated = median(() => parsePhyloXml(text, { annotations: true }));
  rows.push({
    file: label,
    MB: mb.toFixed(2),
    tips: r.tree.tipCount,
    ms: plain.toFixed(1),
    'MB/s': (mb / (plain / 1000)).toFixed(0),
    'ms +annotations': annotated.toFixed(1),
  });
};
for (const f of files) {
  const buf = fs.readFileSync(f);
  run(path.basename(f), (f.endsWith('.gz') ? zlib.gunzipSync(buf) : buf).toString('utf8'));
}
run(`made up, ${tips} tips`, made(tips));
console.table(rows);
