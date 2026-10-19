// Library's own Nexus/Newick parser (extracted from the dist source map into a scratch dir, see docs/results/heat-tree.md); run with node from that dir. Paths below are the scratch layout used in the session.
import fs from 'node:fs'; import zlib from 'node:zlib';
import { parseNexus, isNexusFormat } from './nexusParser.js';
import { parseNewick } from './parsers.js';
const D = '/home/user/gbif-phylo/data/';
const rd = (p) => { const b = fs.readFileSync(D + p); return (p.endsWith('.gz') ? zlib.gunzipSync(b) : b).toString('utf8'); };
const leaves = (n) => { const out = []; const st = [n]; while (st.length) { const x = st.pop(); if (x.children) st.push(...x.children); else out.push(x.name); } return out; };
for (const p of ['rich/fish-carangaria-mcc/Carangaria-MCC.tre', 'rich/corvoid-mcc-680/CC_MCC.tre.gz', 'rich/birdtree-100-posterior/output2.nex.gz', 'rich/edge-cases/multi-tree-translate.nex']) {
  const t = rd(p);
  const r = { p, nexus: isNexusFormat(t) };
  try { const trees = parseNexus(t); r.trees = trees.length; r.names = trees.slice(0, 3).map((x) => x.treeName); const l = leaves(trees[0].treeData); r.tips0 = l.length; r.sample = l.slice(0, 3); r.numericTips = l.filter((x) => /^\d+$/.test(x)).length; }
  catch (e) { r.err = String(e.message).slice(0, 120); }
  console.log(JSON.stringify(r));
}
// deep tree: caterpillar 20000 and 5000
for (const n of [2000, 5000, 10000, 20000]) {
  let s = 'T0:1'; for (let i = 1; i < n; i++) s = `(${s},T${i}:1):1`; s += ';';
  try { parseNewick(s); console.log('caterpillar', n, 'ok'); } catch (e) { console.log('caterpillar', n, e.constructor.name, e.message.slice(0, 60)); }
}
// quoted label
for (const s of ["('A b':1,'C,d':1);", "(A:1,B:1)[&R];", "((A:1,B:1)0.95:1,C:1);"]) { try { const x = parseNewick(s); console.log(s, JSON.stringify(leaves(x))); } catch (e) { console.log(s, 'ERR', e.message); } }
