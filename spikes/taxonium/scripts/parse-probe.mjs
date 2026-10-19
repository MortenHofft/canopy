import fs from 'node:fs'; import zlib from 'node:zlib';
// needs nexusToNewick.ts and jstree.js copied from taxonium_component/src/utils at tag v2.1.24 next to this file
import nexusToNewick from './nexusToNewick.ts';
import { kn_parse } from './jstree.js';
import { parseNewick } from '/home/user/gbif-phylo/spikes/shared/newick.ts';
const D = '/home/user/gbif-phylo/data/';
const rd = (p) => { const b = fs.readFileSync(D + p); return (p.endsWith('.gz') ? zlib.gunzipSync(b) : b).toString('utf8'); };
const files = [
  ['edge multi-tree nexus (translate, quoted, 3 trees)', 'rich/edge-cases/multi-tree-translate.nex', 'nexus'],
  ['fish Carangaria MCC (nexus, translate)', 'rich/fish-carangaria-mcc/Carangaria-MCC.tre', 'nexus'],
  ['corvoid MCC 680 (nexus, translate, BEAST comments)', 'rich/corvoid-mcc-680/CC_MCC.tre.gz', 'nexus'],
  ['birdtree 100 posterior (many trees)', 'rich/birdtree-100-posterior/output2.nex.gz', 'nexus'],
  ['edge quoted labels (newick)', 'rich/edge-cases/quoted-labels.nwk', 'nwk'],
  ['edge polytomy missing lengths (newick)', 'rich/edge-cases/polytomy-missing-lengths.nwk', 'nwk'],
  ['edge internal support (newick)', 'rich/edge-cases/internal-labels-support.nwk', 'nwk'],
  ['edge trifurcating root (newick)', 'rich/edge-cases/unrooted-trifurcating-root.nwk', 'nwk'],
];
for (const [label, p, type] of files) {
  const text = rd(p);
  let nw = text;
  const out = { label, bytes: text.length };
  try {
    if (type === 'nexus') { nw = nexusToNewick(text).newick; out.nexusNewickChars = nw.length; }
    nw = nw.replaceAll('\n', '').replaceAll('\r', '');
    if (nw[0] === '[') nw = nw.slice(nw.indexOf(']') + 1);
    const t = kn_parse(nw);
    out.libTips = t.node.filter((n) => n.child.length === 0).length;
    out.libErr = t.error;
    out.sampleTips = t.node.filter((n) => n.child.length === 0).slice(0, 4).map((n) => n.name);
  } catch (e) { out.libError = String(e.message).slice(0, 120); }
  try {
    // ground truth: the harness' own conversion for nexus lives in shared/data.ts; for plain newick use the shared parser directly
    const truth = type === 'nwk' ? parseNewick(text) : null;
    if (truth) { out.truthTips = truth.tipCount; out.truthSample = truth.tipLabels.slice(0, 4); }
  } catch (e) { out.truthError = String(e.message).slice(0, 100); }
  console.log(JSON.stringify(out));
}
