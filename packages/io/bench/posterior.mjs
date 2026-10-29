// Time of nexusIndex, index.parse and nexusTrees on a made-up posterior sample: one random tree repeated as `tree STATE_n = [&U]
// [&lnP=...] (...)`, with a TAXA block and a TRANSLATE table, like what BEAST writes. The tree is the same in every command, so
// the timings say what reading costs, not what the trees look like.
//   npm run bench:posterior -- [--trees 10000] [--tips 200] [--annotated]   (from packages/io)
// --annotated puts a BEAST-style comment on every node (`[&rate=...,height=...]`), as a summary tree or a posterior with
// per-node statistics has.
import { nexusIndex, nexusTrees } from '../src/nexus.ts';

const arg = (name, dflt) => {
  const i = process.argv.indexOf(name);
  return i < 0 ? dflt : Number(process.argv[i + 1]);
};
const nTrees = arg('--trees', 10000);
const nTips = arg('--tips', 200);
const annotated = process.argv.includes('--annotated');

let seed = 7;
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const comment = () => (annotated ? `[&rate=${rnd().toFixed(5)},height=${rnd().toFixed(5)}]` : '');
// a random binary tree: join two neighbours at random until one is left
const nodes = [];
for (let i = 1; i <= nTips; i++) nodes.push(`${i}${comment()}:${rnd().toFixed(5)}`);
while (nodes.length > 1) {
  const i = Math.floor(rnd() * (nodes.length - 1));
  const [a, b] = nodes.splice(i, 2);
  nodes.splice(i, 0, `(${a},${b})${comment()}:${rnd().toFixed(5)}`);
}
const newick = nodes[0] + ';';

const parts = ['#NEXUS', `begin taxa; dimensions ntax=${nTips}; taxlabels`];
for (let i = 1; i <= nTips; i++) parts.push(` taxon_${i}`);
parts.push(';end;', 'begin trees; translate');
for (let i = 1; i <= nTips; i++) parts.push(` ${i} taxon_${i}${i < nTips ? ',' : ''}`);
parts.push(';');
for (let k = 0; k < nTrees; k++) parts.push(`tree STATE_${k * 1000} = [&U] [&lnP=-1234.5] ${newick}`);
parts.push('end;');
const text = parts.join('\n');
console.log(`${nTrees} trees of ${nTips} tips${annotated ? ' with a comment on every node' : ''}: ${(text.length / 1e6).toFixed(1)} MB`);

const time = (label, fn) => {
  const t0 = performance.now();
  const r = fn();
  console.log(`${label.padEnd(34)} ${(performance.now() - t0).toFixed(1).padStart(8)} ms`);
  return r;
};
const index = time('nexusIndex', () => nexusIndex(text));
time('index.parse(last)', () => index.parse(nTrees - 1));
time('index.parse(0)', () => index.parse(0));
time('every tree through nexusTrees', () => {
  let n = 0;
  for (const r of nexusTrees(text)) n += r.tree.tipCount;
  return n;
});
console.log(`heap ${(process.memoryUsage().heapUsed / 1e6).toFixed(0)} MB`);
