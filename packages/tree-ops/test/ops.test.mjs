// Run from packages/tree-ops: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import * as ops from '../src/index.ts';
// Test fixtures only: @gbif-phylo/io's Newick parser and TreeModel turn text into a TreeInput and the result arrays back into
// something with tree queries (mrca, descendantTips). The package itself imports nothing outside src/.
import { parseNewick, parseNexus, supportFrom, toNewick, TreeModel } from '@gbif-phylo/io';

const DATA = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../data');
const wrap =
  (fn) =>
  (...a) => {
    const r = fn(...a);
    return { ...r, tree: r.changed ? new TreeModel(r.tree) : r.tree };
  };
const reroot = wrap(ops.reroot),
  midpointRoot = wrap(ops.midpointRoot),
  ladderise = wrap(ops.ladderise),
  rotate = wrap(ops.rotate),
  swap = wrap(ops.swap),
  reorder = wrap(ops.reorder);
const collapseClades = wrap(ops.collapseClades);
const collapseBySupport = wrap(ops.collapseBySupport),
  collapseShortBranches = wrap(ops.collapseShortBranches),
  prune = wrap(ops.prune),
  subtree = wrap(ops.subtree);
const readTree = (p) => parseNewick(zlib.gunzipSync(fs.readFileSync(path.join(DATA, p))).toString('utf8'));
const tip = (t, l) => t.tipIndex(l);
const nwk = (t) => toNewick(t);

/** Structural invariants of TreeModel (same as shared/tree.ts promises). */
/** Structural invariants; `maxUnary` = one-child nodes allowed (the input's own; operations must not create new ones). */
function checkModel(t, maxUnary = 0) {
  let tips = 0,
    unary = 0;
  for (let i = 0; i < t.nodeCount; i++) {
    if (i > 0) assert.ok(t.parent[i] < i && t.parent[i] >= 0, `parent of ${i}`);
    assert.ok(t.subtreeEnd[i] > i && t.subtreeEnd[i] <= t.nodeCount);
    if (t.childCount[i] === 0) {
      assert.equal(t.leafStart[i], tips);
      tips++;
    }
    if (t.childCount[i] === 1) unary++;
  }
  assert.ok(unary <= maxUnary, `${unary} one-child nodes, at most ${maxUnary} expected`);
  assert.equal(tips, t.tipCount);
}
/** Support value per unrooted split (as in splits()); the two edges below a binary root are one unrooted edge, and when they carry
 *  different supports the split is AMBIGUOUS (no single right answer after rerooting). One-child nodes repeat their child's split. */
const AMBIGUOUS = Symbol('ambiguous');
function splitSupports(t) {
  const first = t.tipLabels.slice().sort()[0];
  const out = new Map();
  for (let i = 1; i < t.nodeCount; i++) {
    if (t.childCount[i] === 0 || Number.isNaN(t.support[i])) continue;
    const inside = t.descendantTips(i);
    const side = inside.includes(first) ? t.tipLabels.filter((l) => !inside.includes(l)) : inside;
    if (side.length < 2 || side.length > t.tipCount - 2) continue;
    const key = side.sort().join(',');
    out.set(key, out.has(key) && out.get(key) !== t.support[i] ? AMBIGUOUS : t.support[i]);
  }
  return out;
}
const unaryCount = (t) => {
  let u = 0;
  for (let i = 0; i < t.nodeCount; i++) if (t.childCount[i] === 1) u++;
  return u;
};

/** Tip-to-tip distance, missing lengths as 0. */
function dist(t, a, b) {
  const cum = (i) => {
    let s = 0;
    for (; i > 0; i = t.parent[i]) {
      const l = t.length[i];
      if (!Number.isNaN(l)) s += l;
    }
    return s;
  };
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
const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;

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
      const a = t.tipNode[Math.floor(rnd() * t.tipCount)],
        b = t.tipNode[Math.floor(rnd() * t.tipCount)];
      assert.ok(Math.abs(dist(t, a, b) - dist(tree, map[a], map[b])) < 1e-9);
    }
  }
});

test('midpoint root: both sides of the root reach half the diameter', () => {
  for (const p of [
    'real-ladder/trees/gtdb-0200-iainarchaeia.nwk.gz',
    'real-ladder/trees/gtdb-1k-nitrososphaeria.nwk.gz',
    'real-ladder/trees/otl-0200-canidae.nwk.gz',
  ]) {
    const t = readTree(p);
    if (!t.hasLengths) {
      assert.throws(() => midpointRoot(t));
      continue;
    }
    const { tree, info } = midpointRoot(t);
    checkModel(tree);
    const deepest = (c) => {
      let m = 0;
      for (let r = tree.leafStart[c]; r < tree.leafEnd[c]; r++) m = Math.max(m, dist(tree, 0, tree.tipNode[r]));
      return m;
    };
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

test('swap and reorder', () => {
  const b = parseNewick('((A:1,B:2):1,C:1);');
  assert.equal(nwk(swap(b, tip(b, 'A'), tip(b, 'B')).tree), nwk(rotate(b, b.parent[tip(b, 'A')]).tree)); // binary: swap = rotate
  const t = parseNewick('(a:1,b:2,(c:1,d:1)X:3,e:4,f:5)R;');
  const [a, , x, e] = t.children(0);
  const s = swap(t, a, e);
  assert.equal(nwk(s.tree), '(e:4,b:2,(c:1,d:1)X:3,a:1,f:5)R;'); // exactly two branches move
  assert.equal(s.changed, true);
  checkModel(s.tree);
  assert.deepEqual(splits(s.tree), splits(t));
  assert.equal(s.tree.labels[s.map[a]], 'a'); // the map follows the nodes
  assert.equal(nwk(swap(t, a, x).tree), '((c:1,d:1)X:3,b:2,a:1,e:4,f:5)R;'); // a tip with a clade
  const n = parseNewick('((A:1,B:1,C:1)X:2,D:1)R:0.5;');
  const X = n.children(0)[0];
  const [A, , C] = n.children(X);
  const rn = reorder(n, X, [C, A, n.children(X)[1]]);
  assert.equal(nwk(rn.tree), '((C:1,A:1,B:1)X:2,D:1)R:0.5;'); // a non-root node (the writer now writes the root length)
  assert.equal(rn.tree.length[0], 0.5); // the root keeps its length
  checkModel(rn.tree);
  assert.equal(rn.tree.labels[rn.map[C]], 'C');
  assert.equal(rn.map[X], X);
  assert.throws(() => reorder(t, 0, null), RangeError);
  const kids = t.children(0);
  const r = reorder(t, 0, [kids[4], kids[0], kids[1], kids[2], kids[3]]);
  assert.equal(nwk(r.tree), '(f:5,a:1,b:2,(c:1,d:1)X:3,e:4)R;');
  assert.equal(reorder(t, 0, kids).changed, false);
  assert.equal(reorder(t, 0, kids).tree, t);
  assert.throws(() => reorder(t, 0, kids.slice(1)), RangeError); // too short
  assert.throws(() => reorder(t, 0, [kids[0], kids[0], ...kids.slice(2)]), RangeError); // duplicate
  assert.throws(() => reorder(t, 0, [...kids.slice(0, 4), x + 1]), RangeError); // not a child
  assert.throws(() => reorder(t, 99, kids), RangeError);
  assert.throws(() => swap(t, a, a), RangeError);
  assert.throws(() => swap(t, a, x + 1), RangeError); // not siblings
  assert.throws(() => swap(t, 0, a), RangeError); // the root has no siblings
});

test('collapse by support and by length', () => {
  const t = parseNewick('(((A:1,B:1)95:0.5,C:1)40:0.001,(D:1,E:1)60:2);');
  assert.equal(nwk(collapseBySupport(t, 50).tree), '((A:1,B:1)95:0.5,C:1,(D:1,E:1)60:2);');
  assert.equal(nwk(collapseBySupport(t, 70).tree), '((A:1,B:1)95:0.5,C:1,D:1,E:1);');
  // `keep`: a set, an array or a predicate of node indexes whose edge stays whatever its support
  const e60 = t.parent[t.tipIndex('D')];
  for (const keep of [new Set([e60]), [e60], (i) => i === e60])
    assert.equal(nwk(collapseBySupport(t, 70, { keep }).tree), '((A:1,B:1)95:0.5,C:1,(D:1,E:1)60:2);', 'a kept node is not contracted');
  assert.equal(nwk(collapseShortBranches(t, 0.01).tree), '((A:1,B:1)95:0.5,C:1,(D:1,E:1)60:2);');
  assert.equal(collapseBySupport(t, 10).changed, false); // nothing to do: the input comes back
  assert.equal(collapseBySupport(t, 10).tree, t);
  checkModel(collapseBySupport(t, 70).tree);
});

test('collapse with { extend }: the contracted length goes to the children, tip distances stay, a dated tree stays ultrametric', () => {
  const t = parseNewick('(((A:1,B:1)95:0.5,C:1.5)40:0.25,(D:1.75,E:1.75)60:0);');
  assert.equal(nwk(collapseBySupport(t, 50, { extend: true }).tree), '((A:1,B:1)95:0.75,C:1.75,(D:1.75,E:1.75)60:0);');
  assert.equal(nwk(collapseBySupport(t, 99, { extend: true }).tree), '(A:1.75,B:1.75,C:1.75,D:1.75,E:1.75);', 'a chain of contractions accumulates');
  assert.equal(nwk(collapseShortBranches(t, 0.3, { extend: true }).tree), '((A:1,B:1)95:0.75,C:1.75,D:1.75,E:1.75);');
  assert.equal(nwk(collapseBySupport(t, 50).tree), '((A:1,B:1)95:0.5,C:1.5,(D:1.75,E:1.75)60:0);', 'without it the length is lost');
  const f = parseNexus(fs.readFileSync(path.join(DATA, 'rich/fish-carangaria-mcc/Carangaria-MCC.tre'), 'utf8'), { annotations: true }).tree;
  f.support.set(supportFrom(f, 'posterior'));
  assert.ok(f.isUltrametric(1e-3), 'the MCC tree is dated');
  const lost = new TreeModel(collapseBySupport(f, 0.9).tree);
  const kept = new TreeModel(collapseBySupport(f, 0.9, { extend: true }).tree);
  assert.ok(kept.nodeCount < f.nodeCount && kept.nodeCount === lost.nodeCount);
  assert.ok(kept.isUltrametric(1e-3), 'collapse by support with extend keeps the MCC tree ultrametric');
  assert.ok(!lost.isUltrametric(1e-3), 'and without it the tree is no longer ultrametric');
  checkModel(collapseBySupport(f, 0.9, { extend: true }).tree);
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
    const a = r.tipNode[ks[Math.floor(rnd() * ks.length)]],
      b = r.tipNode[ks[Math.floor(rnd() * ks.length)]];
    assert.ok(Math.abs(dist(r, a, b) - dist(tree, map[a], map[b])) < 1e-9);
  }
});

test('subtree', () => {
  const t = parseNewick('((A:1,B:2)AB:3,(C:4,D:5)CD:6)root;');
  assert.equal(nwk(subtree(t, 4).tree), '(C:4,D:5)CD;');
  assert.equal(nwk(subtree(t, tip(t, 'D')).tree), 'D;');
});

test('edge-case trees: reroot on every node, midpoint, prune and collapse keep the invariants', () => {
  const read = (p) => {
    const b = fs.readFileSync(path.join(DATA, p));
    return parseNewick((p.endsWith('.gz') ? zlib.gunzipSync(b) : b).toString('utf8'));
  };
  for (const p of [
    'rich/edge-cases/polytomy-missing-lengths.nwk',
    'rich/edge-cases/unrooted-trifurcating-root.nwk',
    'rich/edge-cases/internal-labels-support.nwk',
    'rich/edge-cases/quoted-labels.nwk',
  ]) {
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

test('unary root edge: rerooting drops the one-child chain above the old root instead of turning it into tips', () => {
  const ids = (t, l) => (t.tipIndex(l) >= 0 ? t.tipIndex(l) : t.labels.indexOf(l));
  const cases = [
    ['((A:1,B:1)X:1)Y;', 'X', 0.5, null], // the root already sits on X's edge
    ['(((A,B)X,C)Z)Y;', 'A', 0.5, '(A,(B,C)X);'],
    ['(((A,B)X,C)Z)Y;', 'C', 0.5, '(C,(A,B)X);'],
    ['((((A,B)X,C)Z)W)Y;', 'A', 0.5, '(A,(B,C)X);'],
    ['(((A,B)X,C)Z)Y;', 'X', 1, null], // rooting at Z, the root below a one-child chain
    ['(((A,B)X,C)Z)Y;', 'X', 0, '(A,B,C)X;'],
  ];
  for (const [text, at, f, want] of cases) {
    const t = parseNewick(text);
    const r = reroot(t, ids(t, at), { at: f });
    if (want === null) assert.equal(r.changed, false, `${text} at ${at}`);
    else assert.equal(nwk(r.tree), want, `${text} at ${at}`);
  }
});

test('random trees with one-child nodes: reroot on every node at 0, 0.5 and 1 keeps tips, splits and distances, adds no one-child node', () => {
  for (let trial = 0; trial < 30; trial++) {
    // random binary tree, then one-child nodes inserted above random nodes (sometimes above the root)
    const nTips = 3 + Math.floor(rnd() * 12);
    const parts = Array.from({ length: nTips }, (_, i) => `T${i}:${(1 + Math.floor(rnd() * 9)) / 4}`);
    let k = 0;
    while (parts.length > 1) {
      const a = parts.splice(Math.floor(rnd() * parts.length), 1)[0];
      const b = parts.splice(Math.floor(rnd() * parts.length), 1)[0];
      const sup = rnd() < 0.7 ? `${Math.floor(rnd() * 101)}:` : '';
      let c = `(${a},${b})'${sup}N${k++}':${(1 + Math.floor(rnd() * 9)) / 4}`;
      if (rnd() < 0.3) c = `(${c})U${k++}:${(1 + Math.floor(rnd() * 9)) / 4}`;
      parts.push(c);
    }
    let text = parts[0].replace(/:[\d.]+$/, '');
    if (rnd() < 0.5) text = `(${text}:1)Top`;
    const t = parseNewick(text + ';');
    const before = splits(t);
    const supBefore = splitSupports(t);
    const labels = t.tipLabels.slice().sort();
    for (let v = 1; v < t.nodeCount; v++) {
      for (const f of [0, 0.5, 1]) {
        const { tree, map, changed } = reroot(t, v, { at: f });
        if (!changed) continue;
        checkModel(tree, unaryCount(t));
        assert.deepEqual(tree.tipLabels.slice().sort(), labels, `${text} reroot ${v} at ${f}`);
        assert.deepEqual(splits(tree), before, `${text} reroot ${v} at ${f}`);
        // every split keeps its support (supports move with their edges)
        for (const [sp, val] of splitSupports(tree))
          if (supBefore.get(sp) !== AMBIGUOUS) assert.equal(val, supBefore.get(sp), `${text} reroot ${v} at ${f}: split ${sp}`);
        const a = t.tipNode[0],
          b = t.tipNode[t.tipCount - 1];
        assert.ok(Math.abs(dist(t, a, b) - dist(tree, map[a], map[b])) < 1e-9);
      }
    }
    checkModel(midpointRoot(t).tree, unaryCount(t));
  }
});

/** Every reroot position keeps every split's support, which lives only in `tree.support` (the labels hold names or nothing). */
function checkSupportOnlyInArray(t, what) {
  const supBefore = splitSupports(t);
  assert.ok(supBefore.size > 3, `${what}: has supports`);
  const names = t.labels.filter((l, i) => t.childCount[i] > 0 && l !== '').sort();
  let n = 0;
  for (let v = 1; v < t.nodeCount; v++) {
    for (const f of [0, 0.5, 1]) {
      const { tree, changed } = reroot(t, v, { at: f });
      if (!changed) continue;
      const now = splitSupports(tree);
      for (const [sp, val] of supBefore)
        if (val !== AMBIGUOUS && now.has(sp)) assert.equal(now.get(sp), val, `${what}: reroot ${v} at ${f}: split ${sp}`);
      // a split present before has its support after, unless the old root's edges merged into it
      assert.ok(now.size >= supBefore.size - 1, `${what}: reroot ${v} at ${f}: ${now.size} of ${supBefore.size} splits keep a support`);
      assert.deepEqual(
        tree.labels.filter((l, i) => tree.childCount[i] > 0 && l !== '').sort(),
        names.filter((x) => tree.labels.includes(x)),
        `${what}: names stay`,
      );
      n++;
    }
  }
  assert.ok(n > 10);
}

test('reroot: support that exists only in tree.support moves with the edges (labels without numbers)', () => {
  const t = parseNewick('(((A:1,B:1)ab:1,C:1)abc:1,((D:1,E:1)de:1,(F:1,G:1)fg:1)defg:1,H:1);');
  for (const [name, v] of [
    ['ab', 0.91],
    ['abc', 0.82],
    ['de', 0.73],
    ['fg', 0.64],
    ['defg', 0.55],
  ])
    t.support[t.labels.indexOf(name)] = v;
  checkSupportOnlyInArray(t, 'array-only');
  const r = reroot(t, t.tipIndex('D'), { at: 0.5 });
  assert.equal(r.tree.support[r.tree.mrcaOf(['A', 'B'])], 0.91);
  assert.equal(r.tree.support[r.tree.mrcaOf(['F', 'G'])], 0.64);
  assert.equal(r.tree.labels[r.tree.mrcaOf(['A', 'B'])], 'ab'); // the name stays, no number is written into it
  // the array wins where label and array disagree; the label's number is used only where the array is NaN
  const u = parseNewick('(((A,B)90:ab,C)80:abc,(D,E)70:de);');
  u.support[u.mrcaOf(['A', 'B'])] = 0.5;
  const abc = u.mrcaOf(['A', 'B', 'C']);
  u.support[abc] = NaN;
  u.labels[abc] = '80:abc'; // only the label has it
  const w = reroot(u, u.tipIndex('D'), { at: 0.5 }).tree;
  assert.equal(w.support[w.mrcaOf(['A', 'B'])], 0.5);
  assert.equal(ops.splitInternalLabel(w.labels[w.mrcaOf(['A', 'B', 'C'])]).support, 80); // untouched node: label as it was
});

test('reroot: the fish MCC posterior (supportFrom) survives every reroot position and midpoint rooting', () => {
  const t = parseNexus(fs.readFileSync(path.join(DATA, 'rich/fish-carangaria-mcc/Carangaria-MCC.tre'), 'utf8'), { annotations: true }).tree;
  t.support.set(supportFrom(t, 'posterior'));
  assert.ok(t.labels.every((l, i) => t.childCount[i] === 0 || Number.isNaN(ops.splitInternalLabel(l).support))); // no number in any label
  const before = splitSupports(t);
  checkSupportOnlyInArray(t, 'fish');
  const m = midpointRoot(t).tree;
  for (const [sp, val] of splitSupports(m)) if (before.get(sp) !== AMBIGUOUS) assert.equal(val, before.get(sp), `midpoint: split ${sp}`);
});

test('reroot: a moved edge carries its label text; the array wins for the value, a disagreeing label stays as written', () => {
  const t = parseNewick("(((A,B)'90:ab',C)'80:abc',((D,E)'70:de',F)'60:def',G);");
  const de = t.mrcaOf(['D', 'E']),
    def = t.mrcaOf(['D', 'E', 'F']);
  t.support[de] = 0.5; // the label says 70, the array 0.5
  t.support[def] = 0.4; // the label says 60
  // rooting on D reverses de and def: de's edge now sits above the node named def, def's edge above the old root
  const r = reroot(t, t.tipIndex('D'), { at: 0.5 }).tree;
  const efabcg = r.mrcaOf(['F', 'A', 'B', 'C', 'G']),
    abcg = r.mrcaOf(['A', 'B', 'C', 'G']);
  assert.equal(r.support[efabcg], 0.5);
  assert.equal(r.labels[efabcg], '70:def'); // the number as written on the old node, the name of the new one
  assert.equal(r.support[abcg], 0.4);
  assert.equal(r.labels[abcg], '60'); // the old root has no name
  // untouched nodes keep both
  assert.equal(r.support[r.mrcaOf(['A', 'B'])], 90);
  assert.equal(r.labels[r.mrcaOf(['A', 'B'])], '90:ab');
  // the text is carried as written: '98.0' and '.95' are not renormalised
  const x = parseNewick("(((A,B)'98.0:ab',C)'.95:abc',D);");
  x.support[x.mrcaOf(['A', 'B'])] = 0.7;
  const w = reroot(x, x.tipIndex('D'), { at: 0.5 }).tree;
  assert.equal(w.labels[w.mrcaOf(['A', 'B', 'C'])], '.95:abc');
  const y = parseNewick("((A,B)'98.0:ab',(C,D)'.95:cd',E);");
  const wy = reroot(y, y.tipIndex('C'), { at: 0.5 }).tree;
  assert.equal(wy.labels[wy.mrcaOf(['A', 'B', 'E'])], '.95'); // cd's edge, as written, without cd's name
});

test('subtree and showFocus drop a root support kept only in the label and keep the name', () => {
  const t = parseNewick('((A,B)ab,C);');
  const ab = t.labels.indexOf('ab');
  t.labels[ab] = '90:ab';
  t.support.fill(NaN);
  const s = subtree(t, ab).tree;
  assert.equal(s.labels[0], 'ab');
  const f = ops.showFocus(t, ops.focusOn(t, ops.NO_FOCUS, ab)).tree;
  assert.equal(f.labels[0], 'ab');
});

test('midpoint exactly on a node roots at that node (no zero-length edge)', () => {
  const t = parseNewick('((A:1,B:1):1,(C:3,D:1):1);'); // C to A = 6, the midpoint is the (C,D) node
  assert.equal(nwk(midpointRoot(t).tree), '(C:3,D:1,(A:1,B:1):2);');
});

test('prune keeps one-child nodes that were in the input (Open Tree monotypic taxa)', () => {
  const t = parseNewick('((A,(B)Bgenus)Fam,C)R;');
  assert.equal(nwk(prune(t, (r) => t.tipLabels[r] !== 'C').tree), '(A,(B)Bgenus)Fam;');
  const o = readTree('real-ladder/trees/otl-0200-canidae.nwk.gz');
  assert.ok(unaryCount(o) > 0);
  const drop = 5; // remove one tip: only nodes on its path can change
  const { tree, map } = prune(o, (r) => r !== drop);
  checkModel(tree, unaryCount(o));
  // every one-child node of the input whose subtree still has tips is still there, with its name
  for (let i = 0; i < o.nodeCount; i++) {
    if (o.childCount[i] !== 1) continue;
    const alive = o.leafEnd[i] - o.leafStart[i] > (o.leafStart[i] <= drop && drop < o.leafEnd[i] ? 1 : 0);
    if (alive) {
      assert.ok(map[i] >= 0, `unary node ${i} (${o.labels[i]}) kept`);
      assert.equal(tree.labels[map[i]], o.labels[i]);
    }
  }
});

test('changed is false when there is nothing to do', () => {
  const t = parseNewick('((A:1,B:1)95:1,C:1);');
  assert.equal(prune(t, () => true).changed, false);
  assert.equal(subtree(t, 0).changed, false);
  assert.equal(rotate(t, t.tipIndex('A')).changed, false);
  assert.equal(reroot(t, 1, { at: 1 }).changed, false); // rooting at the current root
});

test('rotate on a wide polytomy is linear (200k children)', () => {
  const t = parseNewick('(' + Array.from({ length: 200000 }, (_, i) => 't' + i).join(',') + ');');
  const t0 = performance.now();
  const r = rotate(t, 0);
  const ms = performance.now() - t0;
  assert.equal(r.tree.tipLabels[0], 't199999');
  assert.ok(ms < 1500, `rotate took ${ms.toFixed(0)} ms`); // was about 4 s with Array.unshift
});

test('prune drops everything above the MRCA of the kept tips, one-child nodes included', () => {
  const t = parseNewick('((((a:1,b:1)AB:1)Mono:1,c:1)R0:1,d:1)root;');
  assert.equal(nwk(prune(t, (r) => ['a', 'b'].includes(t.tipLabels[r])).tree), '(a:1,b:1)AB;');
  assert.equal(nwk(prune(t, (r) => t.tipLabels[r] !== 'd').tree), '(((a:1,b:1)AB:1)Mono:1,c:1)R0;'); // Mono is below the MRCA: kept
});

test('ladderise on an already ladderised tree changes nothing', () => {
  const t = parseNewick('(A:1,(B:1,C:1)X:1);');
  assert.equal(ladderise(t).changed, false);
  assert.equal(ladderise(t, { order: 'decreasing' }).changed, true);
});

test('midpoint: within 1e-6 of the diameter counts as on a node (lengths rounded in the file)', () => {
  // dated tree written with 6 decimals: tip depths differ by up to 2e-6, the exact midpoint is ~1e-6 from the root
  const t = parseNewick('((A:1.000001,B:1):1,(C:1.000002,D:1):1);');
  assert.equal(midpointRoot(t).changed, false);
  // a real offset still moves the root
  const u = parseNewick('((A:1.1,B:1):1,(C:1,D:1):1);');
  const r = midpointRoot(u);
  assert.equal(r.changed, true);
  // longest path A-C = 4.1, midpoint 2.05 from A: 0.05 below the root on the (A,B) side
  const [ab, cd] = r.tree.children(0);
  assert.ok(Math.abs(r.tree.length[ab] - 0.95) < 1e-12 && Math.abs(r.tree.length[cd] - 1.05) < 1e-12, nwk(r.tree));
});

test('collapseClades: a clade becomes one tip that stands for it; nested and repeated nodes are covered', () => {
  const t = parseNewick('(((A:1,B:1)95:2,C:1)Fam:1,(D:1,(E:1,F:1):1):1);');
  const ab = t.mrcaOf(['A', 'B']),
    fam = t.mrcaOf(['A', 'C']),
    ef = t.mrcaOf(['E', 'F']);
  let r = collapseClades(t, [ab]);
  assert.equal(nwk(r.tree), "(('A and 1 more':2,C:1)Fam:1,(D:1,(E:1,F:1):1):1);");
  checkModel(r.tree);
  assert.equal(r.tree.childCount[r.map[ab]], 0); // the collapsed node is the new tip
  assert.equal(r.map[t.tipIndex('A')], -1);
  r = collapseClades(t, [ab, fam, ef]); // ab is inside fam: covered by it
  assert.equal(nwk(r.tree), "('Fam (3 tips)':1,(D:1,'E and 1 more':1):1);");
  assert.equal(collapseClades(t, [t.tipIndex('A')]).changed, false); // a tip is already one leaf
  assert.equal(collapseClades(t, []).changed, false);
  assert.equal(collapseClades(t, [0]).changed, false); // the root is not collapsed (a one-node tree)
  const u = parseNewick('(((,),),);'); // unlabelled tips
  assert.equal(nwk(collapseClades(u, [u.mrcaOf([2, 3])]).tree), "(('2 tips',),);");
  assert.equal(nwk(collapseClades(t, [ab], (v, n) => `clade${v}x${n}`).tree), '((clade2x2:2,C:1)Fam:1,(D:1,(E:1,F:1):1):1);');
});

test("collapseClades extend: the new tip ends where the clade's tips did (own edge + the clade's height)", () => {
  const t = parseNewick('(((A:1,B:3)95:2,C:1)Fam:1,(D:1,(E:2,F:4):1):1);');
  const ab = t.mrcaOf(['A', 'B']),
    fam = t.mrcaOf(['A', 'C']);
  const len = (r, node) => r.tree.length[r.map[node]];
  assert.equal(len(collapseClades(t, [ab]), ab), 2); // default: the edge is kept
  assert.equal(len(collapseClades(t, [ab], undefined, { extend: false }), ab), 2);
  assert.equal(len(collapseClades(t, [ab], undefined, { extend: true }), ab), 5); // max: 2 + 3
  assert.equal(len(collapseClades(t, [ab], undefined, { extend: 'max' }), ab), 5);
  assert.equal(len(collapseClades(t, [ab], undefined, { extend: 'mean' }), ab), 4); // 2 + (1 + 3) / 2
  assert.equal(len(collapseClades(t, [ab], undefined, { extend: 'min' }), ab), 3); // 2 + 1
  // a clade of clades: depths run through the lengths of the inner edges (A: 1+2, B: 3+2, C: 1)
  assert.equal(len(collapseClades(t, [fam], undefined, { extend: 'max' }), fam), 1 + 5);
  assert.equal(len(collapseClades(t, [fam], undefined, { extend: 'mean' }), fam), 1 + 3);
  assert.equal(len(collapseClades(t, [fam], undefined, { extend: 'min' }), fam), 1 + 1);
  // nested and repeated nodes: the outer clade covers the inner one, which is not lengthened twice
  const r = collapseClades(t, [ab, fam], undefined, { extend: 'max' });
  assert.equal(len(r, fam), 6);
  assert.equal(r.map[ab], -1);
  // missing lengths count as 0 in the height; no lengths at all: nothing to extend
  const m = parseNewick('((A,B:2)x:1,C);');
  assert.equal(len(collapseClades(m, [m.mrcaOf(['A', 'B'])], undefined, { extend: true }), m.mrcaOf(['A', 'B'])), 3);
  const u = parseNewick('((A,B)x,C);');
  assert.equal(nwk(collapseClades(u, [u.mrcaOf(['A', 'B'])], undefined, { extend: true }).tree), "('x (2 tips)',C);");
  assert.ok(Number.isNaN(collapseClades(u, [u.mrcaOf(['A', 'B'])], undefined, { extend: true }).tree.length[1]));
});

test('collapseClades extend: validates the option and counts a negative own edge as 0', () => {
  const t = parseNewick('((A:1,B:3)x:-2,C:1);');
  const x = t.mrcaOf(['A', 'B']);
  for (const bad of ['median', 1, null, {}]) assert.throws(() => ops.collapseClades(t, [x], undefined, { extend: bad }), RangeError);
  assert.equal(collapseClades(t, [x], undefined, { extend: undefined }).tree.length[1], -2);
  const r = collapseClades(t, [x], undefined, { extend: true });
  assert.equal(r.tree.length[r.map[x]], 3); // max(0, -2) + 3
});

test('collapseClades extend: any clade of the dated Carangaria MCC tree collapses without breaking ultrametricity', () => {
  const t = parseNexus(fs.readFileSync(path.join(DATA, 'rich/fish-carangaria-mcc/Carangaria-MCC.tre'), 'utf8')).tree;
  assert.ok(t.isUltrametric(1e-3));
  for (const rule of [true, 'max', 'mean', 'min']) {
    let checked = 0;
    for (let v = 1; v < t.nodeCount; v++) {
      if (t.childCount[v] === 0) continue;
      const r = collapseClades(t, [v], undefined, { extend: rule });
      assert.ok(r.tree.isUltrametric(1e-3), `${rule}: node ${v}`);
      checked++;
    }
    assert.ok(checked > 100);
  }
  // without the option the shown tree is not ultrametric (the issue)
  const inner = t.mrcaOf(t.tipLabels.slice(0, 2));
  assert.ok(!collapseClades(t, [inner]).tree.isUltrametric(1e-3));
  // all the root's clades at once
  const kids = [];
  for (let c = t.firstChild[0]; c >= 0; c = t.nextSibling[c]) kids.push(c);
  assert.ok(collapseClades(t, kids, undefined, { extend: 'max' }).tree.isUltrametric(1e-3));
});

test('focus: show a clade alone, up one level, back', () => {
  const t = parseNewick('((((A,B)ab,C)abc,D)abcd,(E,F)ef);');
  const id = (l) => t.labels.indexOf(l);
  let f = ops.NO_FOCUS;
  assert.equal(ops.canGoBack(f), false);
  assert.equal(ops.canGoUp(f), false);
  assert.equal(ops.showFocus(t, f).changed, false); // the whole tree
  f = ops.focusOn(t, f, id('ab'));
  assert.equal(nwk(new TreeModel(ops.showFocus(t, f).tree)), '(A,B)ab;');
  f = ops.focusUp(t, f);
  assert.equal(ops.focusedNode(f), id('abc'));
  f = ops.focusUp(t, f);
  f = ops.focusUp(t, f); // abcd's parent is the root: the whole tree
  assert.equal(ops.focusedNode(f), -1);
  assert.equal(ops.canGoUp(f), false);
  f = ops.focusBack(f);
  assert.equal(ops.focusedNode(f), id('abcd'));
  f = ops.focusBack(ops.focusBack(ops.focusBack(f)));
  assert.equal(ops.focusedNode(f), -1);
  assert.equal(ops.canGoBack(f), false);
  assert.equal(ops.focusOn(t, f, 0), f); // the root and tips are not focused on
  assert.equal(ops.focusOn(t, f, t.tipIndex('A')), f);
  // remap after an operation: a view that is gone is dropped, so back skips it
  const g = { stack: [id('ab'), id('abc')] };
  assert.deepEqual(ops.remapFocus(g, (v) => (v === id('ab') ? -1 : v + 100)).stack, [id('abc') + 100]);
  // a stack that comes down to 'whole tree' alone is empty: nothing to go back to
  assert.deepEqual(ops.remapFocus({ stack: [id('ab'), -1] }, () => -1).stack, []);
});

// ---- map helpers: followClade, followClades, invertMap, composeMaps
const NEWICK = '((((A:1,B:1)ab:1,C:1)abc:1,D:1)abcd:1,(E:1,F:1)ef:1);';
const clade = (t, l) => t.labels.indexOf(l);

test('followClade: reroot inside a clade splits it, elsewhere keeps it', () => {
  const t = parseNewick(NEWICK);
  const r = reroot(t, clade(t, 'abc'), { at: 0.5 }); // on the edge above abc: ab, abc stay clades
  const f = ops.followClade(t, r.tree, r.map, clade(t, 'ab'));
  assert.equal(f.split, false);
  assert.deepEqual([f.tipsBefore, f.tipsAfter], [2, 2]);
  assert.equal(r.tree.labels[f.node], 'ab');
  // rooting on a tip of abcd splits abcd (its tips lie on both sides of the new root)
  const s = reroot(t, t.tipIndex('D'), { at: 0.5 });
  const g = ops.followClade(t, s.tree, s.map, clade(t, 'abcd'));
  assert.equal(g.split, true);
  assert.equal(g.node, -1);
  assert.deepEqual([g.tipsBefore, g.tipsAfter], [4, 4]);
  assert.equal(ops.followClade(t, s.tree, s.map, clade(t, 'abcd'), { onSplit: 'keep' }).node, s.map[clade(t, 'abcd')]);
});

test('followClade: pruning all the tips gives -1, some gives the clade they form', () => {
  const t = parseNewick(NEWICK);
  const r = prune(t, (k) => t.labels[t.tipNode[k]] !== 'A' && t.labels[t.tipNode[k]] !== 'B');
  const gone = ops.followClade(t, r.tree, r.map, clade(t, 'ab'));
  assert.deepEqual(gone, { node: -1, split: false, tipsBefore: 2, tipsAfter: 0 });
  const abc = ops.followClade(t, r.tree, r.map, clade(t, 'abc'));
  assert.equal(abc.tipsAfter, 1);
  assert.equal(r.tree.labels[abc.node], 'C'); // one surviving tip is a clade of its own
  assert.throws(() => ops.followClade(t, r.tree, r.map, 99), RangeError);
});

test('followClade: ladderise, rotate and a reroot elsewhere keep every clade, though a clade node may not survive', () => {
  const t = parseNewick('(((A:1,B:2)x:1,(C:1,D:3)y:1)z:1,((E:1,F:2)u:1,(G:1,(H:1,I:1)v:1)w:1)q:1);');
  const rs = [ladderise(t, { order: 'decreasing' }), rotate(t, clade(t, 'z')), reroot(t, clade(t, 'u'), { at: 0.5 })];
  for (const r of rs) {
    assert.ok(r.changed);
    // the answer is by tips: it names the same tip set, whatever the operation did to node ids
    for (let v = 1; v < t.nodeCount; v++) {
      const f = ops.followClade(t, r.tree, r.map, v);
      if (f.split) continue;
      assert.ok(f.node >= 0);
      assert.deepEqual(tipSet(r.tree, f.node), tipSet(t, v));
    }
  }
  // rooting on the edge above u removes the old root (map[0] is -1), yet the whole tree is still one clade: the new root
  const r = rs[2];
  assert.equal(r.map[0], -1);
  const all = ops.followClade(t, r.tree, r.map, 0);
  assert.deepEqual([all.node, all.split], [0, false]);
});

const tipSet = (t, v) => {
  const out = [];
  for (let rk = t.leafStart[v]; rk < t.leafEnd[v]; rk++) out.push(t.labels[t.tipNode[rk]]);
  return out.sort();
};

test('followClade across collapseClades: a collapsed clade follows to its tip, a clade holding one to its clade', () => {
  const t = parseNewick('(((A,B)ab,C)abc,(D,E)de,F);');
  const r = collapseClades(t, [clade(t, 'ab')]);
  const self = ops.followClade(t, r.tree, r.map, clade(t, 'ab'));
  assert.equal(self.node, r.map[clade(t, 'ab')]);
  assert.equal(self.split, false);
  const outer = ops.followClade(t, r.tree, r.map, clade(t, 'abc'));
  assert.equal(outer.split, false);
  assert.equal(outer.node, r.map[clade(t, 'abc')]);
  assert.equal(outer.tipsAfter, 2); // the collapsed tip and C
  // a tip inside the collapsed clade has no tip of its own any more
  assert.equal(ops.followClade(t, r.tree, r.map, t.tipIndex('A')).node, -1);
  const many = ops.followClades(t, r.tree, r.map, [clade(t, 'ab'), clade(t, 'abc')]);
  assert.deepEqual(
    many.map((m) => m.node),
    [self.node, outer.node],
  );
});

test('followClades equals followClade for each node, including after a split and a prune', () => {
  const t = parseNewick(NEWICK);
  const nodes = [...Array(t.nodeCount).keys()];
  for (const r of [reroot(t, t.tipIndex('D')), prune(t, (k) => k % 2 === 0), collapseClades(t, [clade(t, 'ab'), clade(t, 'ef')])]) {
    for (const o of [undefined, { onSplit: 'keep' }]) {
      const many = ops.followClades(t, r.tree, r.map, nodes, o);
      nodes.forEach((v, i) => {
        const { node, split } = ops.followClade(t, r.tree, r.map, v, o);
        assert.deepEqual(many[i], { node, split });
      });
    }
  }
});

test('invertMap undoes a map on the surviving nodes and marks added nodes -1', () => {
  const t = parseNewick(NEWICK);
  const r = reroot(t, t.tipIndex('E'), { at: 0.5 });
  const inv = ops.invertMap(r.map, r.tree.nodeCount);
  assert.equal(inv.length, r.tree.nodeCount);
  let added = 0;
  for (let i = 0; i < t.nodeCount; i++) if (r.map[i] >= 0) assert.equal(inv[r.map[i]], i);
  for (const o of inv) if (o < 0) added++;
  assert.equal(added, r.tree.nodeCount - r.map.filter((v) => v >= 0).length);
  assert.ok(added >= 1); // the new root
});

test('invertMap and composeMaps throw on entries out of range', () => {
  assert.throws(() => ops.invertMap(Int32Array.of(0, 5), 3), RangeError);
  assert.throws(() => ops.composeMaps(Int32Array.of(0, 5), Int32Array.of(0, 1)), RangeError);
  assert.deepEqual([...ops.composeMaps(Int32Array.of(-1, 1), Int32Array.of(0, -1))], [-1, -1]);
});

test('composeMaps equals applying two operations in turn', () => {
  const t = parseNewick(NEWICK);
  const a = reroot(t, clade(t, 'ef'), { at: 0.5 });
  const b = prune(a.tree, (k) => a.tree.labels[a.tree.tipNode[k]] !== 'C');
  const ab = ops.composeMaps(a.map, b.map);
  assert.equal(ab.length, t.nodeCount);
  for (let i = 0; i < t.nodeCount; i++) assert.equal(ab[i], a.map[i] >= 0 ? b.map[a.map[i]] : -1);
  assert.equal(ab[t.tipIndex('C')], -1);
  assert.ok(ab[t.tipIndex('A')] >= 0);
  // a composed map follows clades like the two steps do
  const direct = ops.followClade(t, b.tree, ab, clade(t, 'ab'));
  assert.equal(b.tree.labels[direct.node], 'ab');
});

test('remapFocus can follow the operation instead of a callback', () => {
  const t = parseNewick(NEWICK);
  const r = reroot(t, t.tipIndex('D'), { at: 0.5 }); // splits abcd, keeps ab
  const f = ops.remapFocus({ stack: [clade(t, 'ab'), clade(t, 'abcd')] }, t, r.tree, r.map);
  assert.deepEqual(f.stack, [r.map[clade(t, 'ab')]]);
});

// ---- ladderise by: tips | depth | height (#49) ----

const tipOrder = (t) => Array.from({ length: t.tipCount }, (_, i) => t.labels[t.tipNode[i]]).join('');

test('ladderise by depth differs from tips: a deep thin clade next to a wide shallow polytomy', () => {
  const t = parseNewick('((((a,b),c),d),(p,q,r,s,u));');
  assert.equal(tipOrder(ladderise(t, { by: 'tips' }).tree), 'dcabpqrsu'); // 4 tips before 5; inside the thin clade d, c, (a,b)
  const d = ladderise(t, { by: 'depth' });
  assert.equal(d.changed, true);
  assert.equal(tipOrder(d.tree), 'pqrsudcab'); // depth 1 before depth 3
  assert.equal(tipOrder(ladderise(t, { by: 'depth', order: 'decreasing' }).tree), 'abcdpqrsu');
  assert.deepEqual(splits(d.tree), splits(t));
});

test('ladderise by height differs from depth on a phylogram and equals it without lengths', () => {
  const lens = parseNewick('(((a:1,b:1):1,c:1):1,(d:10,e:10):1);');
  assert.equal(tipOrder(ladderise(lens, { by: 'depth' }).tree), 'decab'); // depth 1 before depth 2
  assert.equal(tipOrder(ladderise(lens, { by: 'height' }).tree), 'cabde'); // height 2 before height 10
  assert.equal(tipOrder(ladderise(lens, { by: 'height', order: 'decreasing' }).tree), 'deabc');
  const bare = parseNewick('(((a,b),c),(d,e));');
  assert.equal(bare.hasLengths, false);
  assert.equal(tipOrder(ladderise(bare, { by: 'height' }).tree), tipOrder(ladderise(bare, { by: 'depth' }).tree));
  // a wide shallow clade and a narrow deep one: depth and height put the deep one last, the tip count would not
  const wide = parseNewick('((p,q,r,s),((a,b),c));');
  assert.equal(tipOrder(ladderise(wide, { by: 'tips' }).tree), 'cabpqrs');
  assert.equal(tipOrder(ladderise(wide, { by: 'depth' }).tree), 'pqrscab');
  assert.equal(tipOrder(ladderise(wide, { by: 'height' }).tree), 'pqrscab'); // every edge counts 1, not 0
  // missing and negative lengths count as 0
  const odd = parseNewick('((a:-5,b:-5):1,(c,d):1,(e:0.5,f:0.5):1);');
  assert.equal(tipOrder(ladderise(odd, { by: 'height' }).tree), 'abcdef'); // 0, 0, 0.5: input order, then ef last
});

test('ladderise ties are broken by the other measures, then by input order', () => {
  // equal depth (1): the tip count decides under 'depth'
  const t = parseNewick('((a,b,c),(d,e),(f,g));');
  assert.equal(tipOrder(ladderise(t, { by: 'depth' }).tree), 'defgabc');
  // equal tips (2) and depth (1): 'tips' ties go to the input order, the others look at height
  const h = parseNewick('((a:5,b:5),(c:1,d:1),(e:1,f:1));');
  assert.equal(tipOrder(ladderise(h, { by: 'tips' }).tree), 'abcdef');
  assert.equal(tipOrder(ladderise(h, { by: 'depth' }).tree), 'cdefab'); // depth and tips tie, height 1 < 5
  assert.equal(tipOrder(ladderise(h, { by: 'height' }).tree), 'cdefab');
  // full ties keep the input order, in both directions, and repeat exactly
  const same = parseNewick('((a,b),(c,d),(e,f));');
  for (const by of ['tips', 'depth', 'height']) {
    for (const order of ['increasing', 'decreasing']) {
      const r = ladderise(same, { by, order });
      assert.equal(r.changed, false);
      assert.equal(r.tree, same);
    }
  }
  const a = ladderise(t, { by: 'depth' }).tree,
    b = ladderise(t, { by: 'depth' }).tree;
  assert.equal(nwk(a), nwk(b));
});

test('ladderise by: changed is false on a tree already in that order, and the default equals by: tips', () => {
  const t = parseNewick('(A:1,(B:1,C:1)X:1);');
  for (const by of ['tips', 'depth', 'height']) {
    assert.equal(ladderise(t, { by }).changed, false);
    assert.equal(ladderise(t, { by, order: 'decreasing' }).changed, true);
    const once = ladderise(parseNewick('((((a,b),c),d),(p,q,r,s,u));'), { by }).tree;
    assert.equal(ladderise(once, { by }).changed, false);
  }
  // SHA-256 of the Newick written by ladderise on origin/workshift before `by` existed (captured once, 2026-10-22)
  const r = readTree('real-ladder/trees/gtdb-1k-nitrososphaeria.nwk.gz');
  const gold = {
    increasing: '59836a3b1374ea0d15713e551a1628281ca48d209482a6c8e65b0ed24607f9fc',
    decreasing: '9a152f3b489929ce7d80983f0e992b3b8cab767bb78d4ee5932af85232ae6e9a',
  };
  for (const order of ['increasing', 'decreasing']) {
    const hash = (o) =>
      crypto
        .createHash('sha256')
        .update(nwk(new TreeModel(ops.ladderise(r, o).tree)))
        .digest('hex');
    assert.equal(hash({ order }), gold[order]);
    assert.equal(hash({ order, by: 'tips' }), gold[order]);
  }
  assert.throws(() => ops.ladderise(t, { order: 'up' }), RangeError);
  assert.throws(() => ops.ladderise(t, { by: 'width' }), RangeError);
});

test('ladderise by height: the definition and each step of the tie-break are pinned', () => {
  const o = (nw, opt) => tipOrder(ladderise(parseNewick(nw), opt).tree);
  // the child's own edge is not counted (crown height): 1 < 3 although 1 + 5 > 3 + 1
  assert.equal(o('((a:1,b:1):5,(c:3,d:3):1);', { by: 'height' }), 'abcd');
  // height ties: tips come before depth (3 tips, depth 2 before 4 tips, depth 1)
  assert.equal(o('((a:1,b:1,c:1,d:1),((e:.5,f:.5):.5,g:1));', { by: 'height' }), 'gefabcd');
  // depth ties: tips come before height (2 tips, height 5 before 3 tips, height 1)
  assert.equal(o('((a:1,b:1,c:1),(d:5,e:5));', { by: 'depth' }), 'deabc');
  // a negative length counts as 0, also in the middle of a path: x,y are 5 high whatever the -2 above them
  assert.equal(o('(((x:5,y:5):-2,z:.5),(m:4,n:4));', { by: 'height' }), 'mnzxy');
  // heights equal within 1e-6 of the greatest are ties (0.1 + 0.2 is 0.30000000000000004): tips, depth, then input order
  assert.equal(o('(((x:0.2,y:0.2):0.1,w:0.3):1,((c:0.3,d:0.3):0,v:0.3):1);', { by: 'height' }), 'wxyvcd');
  assert.equal(o('(((x:0.2,y:0.2):0.1,w:0.3):1,((c:0.3,d:0.3):0,v:0.3):1);', { by: 'height', order: 'decreasing' }), 'xywcdv');
  assert.equal(o('(a:1,b:1.01);', { by: 'height' }), 'ab'); // a real difference still decides
});

test('ladderise by, decreasing: the tie-break measures are reversed too, the input order is not', () => {
  const o = (nw, opt) => tipOrder(ladderise(parseNewick(nw), { order: 'decreasing', ...opt }).tree);
  assert.equal(o('((d,e),(a,b,c));', { by: 'depth' }), 'abcde'); // depth ties, more tips first
  assert.equal(o('((a:1,b:1),(c:5,d:5));', { by: 'depth' }), 'cdab'); // depth and tips tie, higher first
  assert.equal(o('((c:5,d:5,e:5),(a:1,b:1,f:1));', { by: 'height' }), 'cdeabf');
  assert.equal(o('((a,b),(c,d));', { by: 'depth' }), 'abcd'); // full tie: input order
});

for (const by of ['tips', 'depth', 'height']) {
  test(`deep tree: a 100k-tip caterpillar ladderises by ${by} without recursion`, () => {
    const N = 100000;
    const parts = new Array(N);
    parts[0] = '('.repeat(N - 1) + 't0:1';
    for (let i = 1; i < N; i++) parts[i] = `,t${i}:1):1`;
    const t = parseNewick(parts.join('').replace(/:1$/, '') + ';');
    assert.equal(ladderise(t, { by }).tree.tipCount, N);
    assert.equal(ladderise(t, { by, order: 'decreasing' }).tree.tipCount, N);
  });
}
