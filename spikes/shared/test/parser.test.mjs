// Run: node --test shared/test/   (Node >= 22.18 strips TypeScript types natively)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { parseNewick, parseNexus, toNewick } from '../newick.ts';

const DATA = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../data');
const read = (p) => {
  const b = fs.readFileSync(path.join(DATA, p));
  return (p.endsWith('.gz') ? zlib.gunzipSync(b) : b).toString('utf8');
};

test('basic topology, lengths, labels', () => {
  const t = parseNewick('((A:1,B:2)AB:0.5,(C,D:4):1,E)root;');
  assert.equal(t.tipCount, 5);
  assert.equal(t.nodeCount, 8);
  assert.deepEqual(t.tipLabels, ['A', 'B', 'C', 'D', 'E']);
  assert.deepEqual(t.descendantTips('n0'), ['A', 'B', 'C', 'D', 'E']);
  assert.deepEqual(t.descendantTips('n1'), ['A', 'B']);
  assert.equal(t.labels[0], 'root');
  assert.equal(t.labels[1], 'AB');
  assert.equal(t.length[2], 1);
  assert.ok(Number.isNaN(t.length[5])); // C has no length
  assert.equal(t.cumLength[3], 2.5);
  assert.equal(t.childCount[0], 3);
  assert.equal(t.mrca(t.tipIndex('A'), t.tipIndex('B')), 1);
  assert.equal(t.mrca(t.tipIndex('A'), t.tipIndex('D')), 0);
  assert.equal(t.nodeId(t.tipIndex('E')), 'n7');
  assert.deepEqual(t.tipsOf(['n1', 'n4']), ['A', 'B', 'C', 'D']);
  assert.equal(t.nodeIndex('n7'), 7);
  assert.throws(() => t.nodeIndex('n99'));
});

test('quoted labels with commas, parentheses, quotes, comments', () => {
  const t = parseNewick("(('a,b (c)':1,'it''s':2)'in,ner (x)':3,[&note=x,y(z)]D[&r=1]:4);");
  assert.deepEqual(t.tipLabels, ['a,b (c)', "it's", 'D']);
  assert.equal(t.labels[1], 'in,ner (x)');
  assert.equal(t.length[4], 4);
});

test('internal labels as support / names / both', () => {
  const t = parseNewick("((A,B)0.95:0.3,(C,D)'98.0:c__Foo',(E,F)node_EF)root;");
  assert.equal(t.support[1], 0.95);
  assert.equal(t.support[4], 98);
  assert.equal(t.nodeName(4), 'c__Foo');
  assert.ok(Number.isNaN(t.support[7]));
  assert.equal(t.nodeName(7), 'node_EF');
});

test('missing, zero, negative lengths, polytomy, unrooted root', () => {
  const t = parseNewick('((A:1,B:1,C:1,D:1,E:1)p5:2,(F,G)nl,(H:0,I:0)z:0,J:-0.1)root;');
  assert.equal(t.tipCount, 10);
  assert.equal(t.childCount[1], 5);
  assert.equal(t.length[t.tipIndex('J')], -0.1);
  assert.equal(parseNewick('(A:0.1,B:0.2,(C:0.3,D:0.4):0.05);').childCount[0], 3);
});

test('unnamed leaves, single leaf, no semicolon, whitespace', () => {
  assert.equal(parseNewick('(,);').tipCount, 2);
  assert.equal(parseNewick('A;').tipCount, 1);
  assert.equal(parseNewick(' ( A , B ) ').tipCount, 2);
  assert.equal(parseNewick('(A,B)\n;\n').tipCount, 2);
});

test('errors', () => {
  assert.throws(() => parseNewick('((A,B);'), /unbalanced/);
  assert.throws(() => parseNewick('(A,B));'), /unbalanced/);
  assert.throws(() => parseNewick(''), /empty/);
  assert.throws(() => parseNewick("('A,B);"), /unterminated/);
});

test('1,000,000-deep caterpillar does not overflow the stack', () => {
  const n = 1_000_000;
  const parts = [];
  for (let i = 0; i < n - 1; i++) parts.push('(t' + i + ':1,');
  parts.push('t' + (n - 1) + ':1');
  parts.push('):1'.repeat(n - 1));
  const t = parseNewick(parts.join('') + ';');
  assert.equal(t.tipCount, n);
  assert.equal(t.nodeCount, 2 * n - 1);
  assert.equal(t.maxDepth, n - 1);
  assert.equal(t.subtreeEnd[0], t.nodeCount);
  assert.equal(t.descendantTips('n0').length, n);
  assert.equal(t.mrca(t.tipIndex('t0'), t.tipIndex('t' + (n - 1))), 0);
  const back = toNewick(t);
  assert.equal(parseNewick(back).tipCount, n);
});

test('round trip through the writer keeps topology, labels and lengths', () => {
  const src = "((A:1,'B c':2)'x,y':0.5,(C,D:4):1,E)root;";
  const t = parseNewick(src);
  const t2 = parseNewick(toNewick(t));
  assert.deepEqual(t2.tipLabels, t.tipLabels);
  assert.deepEqual(Array.from(t2.parent), Array.from(t.parent));
  assert.deepEqual(t2.labels, t.labels);
  assert.deepEqual(Array.from(t2.cumLength), Array.from(t.cumLength));
});

test('structural invariants on a real tree', () => {
  const t = parseNewick(read('synthetic/newick/yule_1000.nwk'));
  assert.equal(t.tipCount, 1000);
  for (let i = 1; i < t.nodeCount; i++) assert.ok(t.parent[i] < i);
  for (let i = 0; i < t.nodeCount; i++) {
    const [a, b] = t.tipRange(i);
    assert.equal(b - a, t.tipLabels.slice(a, b).length);
    // brute force: tips in [i, subtreeEnd) are exactly ranks [a,b)
    let c = 0;
    for (let k = i; k < t.subtreeEnd[i]; k++) if (t.childCount[k] === 0) c++;
    assert.equal(c, b - a);
  }
});

test('catalogue files parse to the recorded tip counts (committed files only)', () => {
  const cases = [
    ['synthetic/newick/yule_200.nwk', 200],
    ['synthetic/newick/caterpillar_10000.nwk.gz', 10000],
    ['real-ladder/trees/otl-1k-testudines.nwk.gz', 888],
    ['rich/edge-cases/quoted-labels.nwk', 5],
    ['rich/edge-cases/caterpillar-20000.nwk.gz', 20000],
  ];
  for (const [f, tips] of cases) assert.equal(parseNewick(read(f)).tipCount, tips, f);
});

test('NEXUS with TRANSLATE, comments, multiple trees', () => {
  const r = parseNexus(read('rich/fish-carangaria-mcc/Carangaria-MCC.tre'));
  assert.equal(r.tree.tipCount, 135);
  assert.ok(r.translateEntries > 0);
  assert.ok(r.tree.tipLabels.every((l) => /[A-Za-z]/.test(l)), 'labels translated');
  assert.ok(r.tree.isUltrametric(1e-3));
  const m = parseNexus(read('rich/edge-cases/multi-tree-translate.nex'), 1);
  assert.equal(m.treesSeen, 2);
  assert.ok(m.tree.tipCount > 3);
  assert.throws(() => parseNexus(read('rich/edge-cases/multi-tree-translate.nex'), 9));
});
