// Run from packages/io: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { parseNewick, parseNexus, toNewick, toNexus } from '../src/newick.ts';
import { supportFrom } from '../src/annotations.ts';

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
  assert.ok(
    r.tree.tipLabels.every((l) => /[A-Za-z]/.test(l)),
    'labels translated',
  );
  assert.ok(r.tree.isUltrametric(1e-3));
  const m = parseNexus(read('rich/edge-cases/multi-tree-translate.nex'), 1);
  assert.equal(m.treesSeen, 2);
  assert.ok(m.tree.tipCount > 3);
  assert.throws(() => parseNexus(read('rich/edge-cases/multi-tree-translate.nex'), 9));
});

test('toNexus round trip, with and without TRANSLATE, keeps topology, labels and lengths', () => {
  const src = "((A_b:1,'B c':2)'x,y':0.5,('it''s':3,'D-1':4)95:1,E=F)root;";
  const t = parseNewick(src);
  for (const translate of [true, false]) {
    const text = toNexus(t, { translate, treeName: 'my tree' });
    assert.ok(text.startsWith('#NEXUS'));
    const r = parseNexus(text);
    assert.equal(r.treeName, 'my tree');
    assert.deepEqual(r.tree.tipLabels, t.tipLabels, `translate ${translate}`);
    assert.deepEqual(Array.from(r.tree.parent), Array.from(t.parent));
    assert.deepEqual(r.tree.labels, t.labels);
    assert.deepEqual(Array.from(r.tree.cumLength), Array.from(t.cumLength));
  }
  const fish = parseNexus(read('rich/fish-carangaria-mcc/Carangaria-MCC.tre')).tree;
  const back = parseNexus(toNexus(fish)).tree;
  assert.deepEqual(back.tipLabels, fish.tipLabels);
  assert.deepEqual(Array.from(back.parent), Array.from(fish.parent));
});

// ------------------------------------------------------------------------------------------ annotations (#17)

test('annotations are off by default', () => {
  const t = parseNewick('((A[&x=1]:1,B:2)[&posterior=0.9]:0.5,C);');
  assert.equal(t.annotations, null);
  assert.throws(() => supportFrom(t, 'posterior'), /annotations: true/);
});

test('BEAST annotations: numbers, strings, ranges, node versus edge', () => {
  const t = parseNewick('((A[&rate=0.5,state="x,y"]:[&rate_95%_HPD={0.1,0.9}]1,B:2)n[&posterior=0.9,set={"u","v"}]:0.5,C)[&R][&posterior=1];', {
    annotations: true,
  });
  const a = t.annotations;
  assert.equal(a.get(2, 'rate'), 0.5);
  assert.equal(a.get(2, 'state'), 'x,y');
  assert.equal(a.get(2, 'rate'), 0.5);
  assert.deepEqual(a.get(2, 'rate_95%_HPD', 'edge'), [0.1, 0.9]);
  assert.equal(a.get(2, 'rate_95%_HPD'), undefined);
  assert.equal(a.get(1, 'posterior'), 0.9);
  assert.deepEqual(a.get(1, 'set'), ['u', 'v']);
  assert.equal(t.labels[1], 'n');
  assert.equal(a.get(0, 'posterior'), 1);
  assert.equal(a.get(0, 'R'), undefined); // flags without a value are not annotations
  assert.equal(t.length[2], 1);
  assert.deepEqual(a.keys('edge'), ['rate_95%_HPD']);
});

test('NHX annotations on a committed file', () => {
  const t = parseNewick(read('rich/edge-cases/tree.nhx'), { annotations: true });
  const a = t.annotations;
  assert.equal(t.tipCount, 3);
  assert.equal(a.get(0, 'S'), 'Amniota');
  assert.equal(a.get(0, 'D'), 'N');
  assert.equal(a.get(1, 'S'), 'Euarchontoglires');
  assert.equal(a.get(1, 'B'), 100);
  assert.equal(a.get(2, 'S'), 'Homo sapiens');
  assert.equal(a.get(2, 'T'), 9606);
  assert.equal(a.edge.size, 0); // NHX comments after the length still belong to the node
  assert.equal(t.length[2], 0.1);
  assert.deepEqual(parseNewick(read('rich/edge-cases/tree.nhx')).tipLabels, t.tipLabels);
});

test('fish MCC tree: posterior on internal nodes, supportFrom leaves tree.support alone', () => {
  const t = parseNexus(read('rich/fish-carangaria-mcc/Carangaria-MCC.tre'), { annotations: true }).tree;
  const plain = parseNexus(read('rich/fish-carangaria-mcc/Carangaria-MCC.tre')).tree;
  assert.equal(t.nodeCount, plain.nodeCount);
  assert.deepEqual(t.length, plain.length);
  const post = supportFrom(t, 'posterior');
  assert.equal(post.length, t.nodeCount);
  let internal = 0;
  let withPost = 0;
  for (let i = 0; i < t.nodeCount; i++) {
    if (t.childCount[i] === 0) {
      assert.ok(Number.isNaN(post[i]));
      continue;
    }
    internal++;
    if (!Number.isNaN(post[i])) {
      withPost++;
      assert.ok(post[i] >= 0 && post[i] <= 1);
    }
  }
  assert.ok(withPost > internal * 0.9, `${withPost} of ${internal} internal nodes have a posterior`);
  assert.ok(plain.support.every(Number.isNaN)); // the label-based support is untouched
  assert.ok(t.support.every(Number.isNaN));
  const hpd = t.annotations.get(0, 'height_95%_HPD');
  assert.ok(Array.isArray(hpd) && hpd.length === 2 && hpd[0] <= hpd[1]);
});

test('BEAST discrete trait tree: quoted strings, sets and edge rates', () => {
  const text = zlib.gunzipSync(fs.readFileSync(path.join(DATA, 'rich/beast-hcv-2k1b/2k1b_fullGenome_9GTR1clock_COO_BSSVSMJ.MCC.tree.gz'))).toString();
  const t = parseNexus(text, { annotations: true }).tree;
  const coo = t.annotations.column('COO.prob');
  assert.ok(coo.some((v) => v === 1));
  const tip = t.annotations.node.get(t.tipNode[0]);
  assert.equal(typeof tip.COO, 'string');
  assert.ok(!tip.COO.includes('"'));
  assert.ok(Array.isArray(tip['COO.set']));
  const flu = parseNexus(read('rich/beast-fluB-vic-ha/unified_global_vic.HA.mcc.tre.gz'), { annotations: true }).tree;
  assert.ok(flu.annotations.node.size > 0);
  assert.equal(typeof flu.annotations.get(flu.tipNode[0], 'location'), 'string'); // the HA annotation is in the TAXA block only
  assert.ok(supportFrom(flu, 'posterior').some((v) => v > 0.9));
});

test('round trip through toNewick and toNexus keeps the annotations', () => {
  const same = (a, b, n) => {
    assert.equal(a.nodeCount, b.nodeCount);
    assert.deepEqual([...b.annotations.node], [...a.annotations.node]);
    assert.deepEqual([...b.annotations.edge], [...a.annotations.edge]);
    assert.ok(a.annotations.node.size > 0 || n === 0);
  };
  const src = '((A[&rate=0.5,state="x,y"]:[&hpd={0.1,0.9}]1,B:2)n[&posterior=0.9,set={"u","v"}]:0.5,C)[&posterior=1];';
  const t = parseNewick(src, { annotations: true });
  same(t, parseNewick(toNewick(t, { annotations: true }), { annotations: true }));
  assert.equal(parseNewick(toNewick(t)).annotations, null);
  assert.ok(!toNewick(t).includes('['));
  same(t, parseNexus(toNexus(t, { annotations: true }), { annotations: true }).tree);
  same(t, parseNexus(toNexus(t, { annotations: true, translate: false }), { annotations: true }).tree);
  for (const f of ['rich/fish-carangaria-mcc/Carangaria-MCC.tre', 'rich/edge-cases/tree.nhx']) {
    const orig = f.endsWith('.nhx') ? parseNewick(read(f), { annotations: true }) : parseNexus(read(f), { annotations: true }).tree;
    const back = parseNexus(toNexus(orig, { annotations: true }), { annotations: true }).tree;
    same(orig, back);
    assert.deepEqual(back.tipLabels, orig.tipLabels);
  }
});

test('remap carries annotations over an edit', () => {
  const t = parseNewick('((A[&x=1]:1,B[&x=2]:[&e=1]2)n[&x=3],C[&x=4]);', { annotations: true });
  const map = Int32Array.from([0, -1, 1, 2, 3]); // pretend node 1 was removed
  const m = t.annotations.remap(map, 4);
  assert.equal(m.nodeCount, 4);
  assert.deepEqual([...m.node.keys()].sort(), [1, 2, 3]); // the removed node's annotations are gone
  assert.equal(m.get(1, 'x'), 1);
  assert.equal(m.get(2, 'e', 'edge'), 1);
  assert.equal(t.annotations.remap(map, 4, { stripEdges: true }).edge.size, 0);
});
