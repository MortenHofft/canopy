// Run from packages/tree-ops: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import * as ops from '../src/index.ts';
// Test fixtures only: the spikes' Newick parser and TreeModel turn text into a TreeInput and the result arrays back into
// something with tree queries (mrca, descendantTips). The package itself imports nothing outside src/.
import { parseNewick, toNewick } from '../../../spikes/shared/newick.ts';
import { TreeModel } from '../../../spikes/shared/tree.ts';

const DATA = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../data');
const wrap = (fn) => (...a) => { const r = fn(...a); return { ...r, tree: r.changed ? new TreeModel(r.tree) : r.tree }; };
const reroot = wrap(ops.reroot), midpointRoot = wrap(ops.midpointRoot), ladderise = wrap(ops.ladderise), rotate = wrap(ops.rotate);
const collapseBySupport = wrap(ops.collapseBySupport), collapseShortBranches = wrap(ops.collapseShortBranches), prune = wrap(ops.prune), subtree = wrap(ops.subtree);
const readTree = (p) => parseNewick(zlib.gunzipSync(fs.readFileSync(path.join(DATA, p))).toString('utf8'));
const tip = (t, l) => t.tipIndex(l);
const nwk = (t) => toNewick(t);

/** Structural invariants of TreeModel (same as shared/tree.ts promises). */
function checkModel(t) {
  let tips = 0;
  for (let i = 0; i < t.nodeCount; i++) {
    if (i > 0) assert.ok(t.parent[i] < i && t.parent[i] >= 0, `parent of ${i}`);
    assert.ok(t.subtreeEnd[i] > i && t.subtreeEnd[i] <= t.nodeCount);
    if (t.childCount[i] === 0) { assert.equal(t.leafStart[i], tips); tips++; }
    if (i > 0) assert.notEqual(t.childCount[i], 1, `unary node ${i}`);
  }
  assert.equal(tips, t.tipCount);
}

/** Tip-to-tip distance, missing lengths as 0. */
function dist(t, a, b) {
  const cum = (i) => { let s = 0; for (; i > 0; i = t.parent[i]) { const l = t.length[i]; if (l === l) s += l; } return s; };
  return cum(a) + cum(b) - 2 * cum(t.mrca(a, b));
}

/** Unrooted splits as canonical strings (the side without the first tip label). */
function splits(t) {
  const first = t.tipLabels.slice().sort()[0];
  const out = new Set();
  for (let i = 1; i < t.nodeCount; i++) {
    if (t.childCount[i] === 0) continue;
    const inside = t.descendantTips(i);
    const side = inside.includes(first) ? t.tipLabels.filter((l) => !inside.includes(l)) : inside;
    if (side.length > 1 && side.length < t.tipCount - 1) out.add(side.sort().join(','));
  }
  return out;
}

let seed = 1;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

test('reroot: new root splits the edge, path reversed, binary old root suppressed', () => {
  const t = parseNewick('((A:1,B:2)AB:3,(C:4,D:5)CD:6)root;');
  const { tree, map } = reroot(t, tip(t, 'A'), { at: 0.5 });
  assert.equal(nwk(tree), '(A:0.5,(B:2,(C:4,D:5)CD:9)AB:0.5);');
  checkModel(tree);
  assert.equal(map[tip(t, 'A')], 1);
  assert.equal(map[0], -1); // old root suppressed
  assert.equal(tree.labels[map[1]], 'AB'); // names stay with nodes
});

test('reroot: support moves with the edge, names stay, GTDB-style labels recomposed', () => {
  const t = parseNewick("(((A:1,B:1)90:1,C:1)'70:g__X':1,(D:1,E:1)n1:1);");
  const { tree } = reroot(t, tip(t, 'A'));
  checkModel(tree);
  const s = new Map();
  for (let i = 1; i < tree.nodeCount; i++) if (tree.childCount[i] > 0) s.set(tree.descendantTips(i).sort().join(','), tree.labels[i]);
  // rooted on A, each split keeps its support: {A,B}|{C,D,E} = 90 (now above the node named g__X), {A,B,C}|{D,E} = 70
  // (now above n1: both halves of the old root edge described it). Names stay with their nodes.
  assert.equal(s.get('B,C,D,E'), ''); // the edge above A: a trivial split
  assert.equal(s.get('C,D,E'), '90:g__X');
  assert.equal(s.get('D,E'), '70:n1');
  assert.equal(tree.support[tree.mrcaOf(['C', 'D', 'E'])], 90);
});

test('reroot on a child of a binary root only moves the root along the root edge', () => {
  const t = parseNewick('((A:1,B:1):2,C:4);');
  const { tree } = reroot(t, 1, { at: 0.25 });
  assert.equal(nwk(tree), '((A:1,B:1):0.5,C:5.5);');
});

test('reroot on a multifurcating root keeps the old root as a node', () => {
  const t = parseNewick('(A:1,B:2,C:3);');
  const { tree } = reroot(t, tip(t, 'C'), { at: 0.5 });
  assert.equal(nwk(tree), '(C:1.5,(A:1,B:2):1.5);');
  checkModel(tree);
});

test('reroot preserves tip distances and unrooted splits on a real tree', () => {
  const t = readTree('real-ladder/trees/gtdb-0200-iainarchaeia.nwk.gz');
  const before = splits(t);
  for (let k = 0; k < 10; k++) {
    const v = 1 + Math.floor(rnd() * (t.nodeCount - 1));
    const { tree, map } = reroot(t, v, { at: rnd() });
    checkModel(tree);
    assert.equal(tree.tipCount, t.tipCount);
    assert.deepEqual(splits(tree), before);
    for (let j = 0; j < 20; j++) {
      const a = t.tipNode[Math.floor(rnd() * t.tipCount)], b = t.tipNode[Math.floor(rnd() * t.tipCount)];
      assert.ok(Math.abs(dist(t, a, b) - dist(tree, map[a], map[b])) < 1e-9);
    }
  }
});

test('midpoint root: both sides of the root reach half the diameter', () => {
  for (const p of ['real-ladder/trees/gtdb-0200-iainarchaeia.nwk.gz', 'real-ladder/trees/gtdb-1k-nitrososphaeria.nwk.gz', 'real-ladder/trees/otl-0200-canidae.nwk.gz']) {
    const t = readTree(p);
    if (!t.hasLengths) { assert.throws(() => midpointRoot(t)); continue; }
    const { tree, info } = midpointRoot(t);
    checkModel(tree);
    const deepest = (c) => { let m = 0; for (let r = tree.leafStart[c]; r < tree.leafEnd[c]; r++) m = Math.max(m, dist(tree, 0, tree.tipNode[r])); return m; };
    // the two farthest tips lie on different sides of the root, each at distance D/2
    const [a, b] = info.tips;
    const side = (v) => tree.children(0).find((c) => tree.contains(c, v));
    const { map } = midpointRoot(t);
    assert.notEqual(side(map[a]), side(map[b]));
    for (const c of tree.children(0)) assert.ok(deepest(c) <= info.diameter / 2 + 1e-9);
    assert.ok(Math.abs(Math.max(...tree.children(0).map(deepest)) - info.diameter / 2) < 1e-9);
  }
});

test('midpoint root on a small tree (longest path D-A = 10, midpoint 5 along D)', () => {
  const t = parseNewick('((A:1,B:1):1,(C:1,D:7):1);');
  assert.equal(nwk(midpointRoot(t).tree), '(D:5,(C:1,(A:1,B:1):2):2);');
});

test('ladderise and rotate change only the order', () => {
  const t = parseNewick('(((A,B),C,(D,(E,F))),G);');
  assert.equal(nwk(ladderise(t).tree), '(G,(C,(A,B),(D,(E,F))));');
  assert.equal(nwk(ladderise(t, { order: 'decreasing' }).tree), '((((E,F),D),(A,B),C),G);');
  assert.equal(nwk(rotate(t, 0).tree), '(G,((A,B),C,(D,(E,F))));');
  const r = readTree('real-ladder/trees/gtdb-1k-nitrososphaeria.nwk.gz');
  const l = ladderise(r);
  checkModel(l.tree);
  assert.deepEqual(splits(l.tree), splits(r));
  for (let i = 0; i < l.tree.nodeCount; i++) {
    const s = l.tree.children(i).map((c) => l.tree.tipCountOf(c));
    for (let k = 1; k < s.length; k++) assert.ok(s[k - 1] <= s[k]);
  }
});

test('collapse by support and by length', () => {
  const t = parseNewick('(((A:1,B:1)95:0.5,C:1)40:0.001,(D:1,E:1)60:2);');
  assert.equal(nwk(collapseBySupport(t, 50).tree), '((A:1,B:1)95:0.5,C:1,(D:1,E:1)60:2);');
  assert.equal(nwk(collapseBySupport(t, 70).tree), '((A:1,B:1)95:0.5,C:1,D:1,E:1);');
  assert.equal(nwk(collapseShortBranches(t, 0.01).tree), '((A:1,B:1)95:0.5,C:1,(D:1,E:1)60:2);');
  assert.equal(collapseBySupport(t, 10).changed, false); // nothing to do: the input comes back
  assert.equal(collapseBySupport(t, 10).tree, t);
  checkModel(collapseBySupport(t, 70).tree);
});

test('prune: unary nodes merged, edges above the new root dropped, distances kept', () => {
  const t = parseNewick('((A:1,(B:1,C:1):2):3,(D:1,E:1):4);');
  const keep = (names) => (r) => names.includes(t.tipLabels[r]);
  assert.equal(nwk(prune(t, keep(['A', 'C', 'D'])).tree), '((A:1,C:3):3,D:5);');
  assert.equal(nwk(prune(t, keep(['B', 'C'])).tree), '(B:1,C:1);');
  assert.equal(nwk(prune(t, keep(['E'])).tree), 'E;');
  assert.throws(() => prune(t, () => false));
  const r = readTree('real-ladder/trees/gtdb-1k-nitrososphaeria.nwk.gz');
  const kept = new Set();
  for (let k = 0; k < r.tipCount; k++) if (rnd() < 0.2) kept.add(k);
  const { tree, map } = prune(r, (k) => kept.has(k));
  checkModel(tree);
  assert.equal(tree.tipCount, kept.size);
  const ks = [...kept];
  for (let j = 0; j < 50; j++) {
    const a = r.tipNode[ks[Math.floor(rnd() * ks.length)]], b = r.tipNode[ks[Math.floor(rnd() * ks.length)]];
    assert.ok(Math.abs(dist(r, a, b) - dist(tree, map[a], map[b])) < 1e-9);
  }
});

test('subtree', () => {
  const t = parseNewick('((A:1,B:2)AB:3,(C:4,D:5)CD:6)root;');
  assert.equal(nwk(subtree(t, 4).tree), '(C:4,D:5)CD;');
  assert.equal(nwk(subtree(t, tip(t, 'D')).tree), 'D;');
});

test('edge-case trees: reroot on every node, midpoint, prune and collapse keep the invariants', () => {
  const read = (p) => { const b = fs.readFileSync(path.join(DATA, p)); return parseNewick((p.endsWith('.gz') ? zlib.gunzipSync(b) : b).toString('utf8')); };
  for (const p of ['rich/edge-cases/polytomy-missing-lengths.nwk', 'rich/edge-cases/unrooted-trifurcating-root.nwk', 'rich/edge-cases/internal-labels-support.nwk', 'rich/edge-cases/quoted-labels.nwk']) {
    const t = read(p);
    const before = splits(t);
    const labels = t.tipLabels.slice().sort();
    for (let v = 1; v < t.nodeCount; v++) {
      const { tree } = reroot(t, v);
      checkModel(tree);
      assert.deepEqual(tree.tipLabels.slice().sort(), labels, `${p} reroot ${v}`);
      assert.deepEqual(splits(tree), before, `${p} reroot ${v}`);
    }
    if (t.hasLengths) checkModel(midpointRoot(t).tree);
    checkModel(ladderise(t).tree);
    checkModel(collapseBySupport(t, 70).tree);
    checkModel(prune(t, (r) => r % 2 === 0).tree);
  }
});

test('deep tree: a 100k-tip caterpillar (depth 100k) reroots, midpoint-roots, ladderises and prunes without recursion', () => {
  // ((((t0:1,t1:1):1,t2:1):1,...) built iteratively; idea from patristic's test/deep.test.js
  const N = 100000;
  const parts = new Array(N);
  parts[0] = '('.repeat(N - 1) + 't0:1';
  for (let i = 1; i < N; i++) parts[i] = `,t${i}:1):1`;
  const t = parseNewick(parts.join('').replace(/:1$/, '') + ';');
  assert.equal(t.tipCount, N);
  const deepest = t.tipIndex('t0');
  const r = reroot(t, deepest);
  assert.equal(r.tree.tipCount, N);
  assert.ok(Math.abs(dist(r.tree, r.map[deepest], r.map[t.tipIndex('t5')]) - dist(t, deepest, t.tipIndex('t5'))) < 1e-9);
  const m = midpointRoot(t);
  assert.ok(Math.abs(m.info.diameter - N) < 1e-6); // t0 to t(N-1): N-2 internal edges plus the two tip edges
  assert.equal(ladderise(t).tree.tipCount, N);
  assert.equal(prune(t, (k) => k % 3 === 0).tree.tipCount, Math.ceil(N / 3));
});
