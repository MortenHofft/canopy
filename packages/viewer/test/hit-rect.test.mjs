// Unit tests of rectangular hit-testing (src/core/hit.ts): a draw list from the real cut for a small tree at 20 px per tip, the grid index
// built over it, and queries at the places a pointer goes: a tip dot, a node marker, a branch, a collapsed clade, a run of small siblings.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const { parseNewick } = await import(path.join(root, 'packages/io/src/newick.ts'));
const core = path.join(root, 'packages/viewer/src');
const { computeLayout } = await import(path.join(core, 'layout.ts'));
const { InMemorySource } = await import(path.join(core, 'source.ts'));
const { makeTransform } = await import(path.join(core, 'geom.ts'));
const { projectionFor } = await import(path.join(core, 'projection.ts'));
const { cut, newCutResult, DrawList, Seen, K_SUMMARY, K_NODE, K_TIP, SLICE_MIN_CHILDREN } = await import(path.join(core, 'lod.ts'));
const { HitIndex, MARKER_PX } = await import(path.join(core, 'hit.ts'));

/** Tree, size and collapse threshold -> projection, draw list and a built hit index. The view is the whole tree: ky = H / tips. */
function scene(nwk, W, H, minPx) {
  const tree = new InMemorySource(parseNewick(nwk)).snapshot();
  const L = computeLayout(tree, true);
  const N = tree.tipCount;
  const area = { ax: 0, ay: 0, aw: W, ah: H, clipL: 0, clipT: 0, clipR: W, clipB: H };
  const T = makeTransform('rectangular', W, H, { x0: 0, x1: 1, y0: 0, y1: N }, area, N);
  const proj = projectionFor(tree, L, T);
  const list = new DrawList();
  cut(proj, { lod: true, minPx, budget: 10000, summaries: true }, null, list, new Seen(), newCutResult());
  const hit = new HitIndex();
  hit.build(list, proj);
  const xy = (i) => {
    const p = { x: 0, y: 0 };
    proj.nodeXY(i, p);
    return p;
  };
  const pxy = (i) => {
    const p = { x: 0, y: 0 };
    proj.parentXY(i, p);
    return p;
  };
  return { tree, proj, list, hit, xy, pxy, q: (x, y) => hit.query(x, y, proj) };
}
const kindsOf = (list, k) => {
  const out = [];
  for (let e = 0; e < list.count; e++) if (list.kind[e] === k) out.push(list.node[e]);
  return out;
};

// 8 tips in 160 px: 20 px per tip. minPx 70 collapses the two 3-tip clades (60 px) and keeps CDE (80 px) open. (A clade of two tips is
// never collapsed by size, #112.)
const NWK = '((A:1,B:2,A2:1)AB:1,(C:1,(D:2,E:3,E2:1)DE:1)CDE:2,F:4)root;';
const S = scene(NWK, 600, 160, 70);
const id = (label) => S.tree.tipIndex(label);
const parentOf = (label) => S.tree.parent[id(label)];
const AB = parentOf('A');
const DE = parentOf('D');
const CDE = parentOf('C');

test('the scene is what the tests assume: tips 20 px apart, AB and DE collapsed, CDE open, C and F drawn as tips', () => {
  assert.equal(S.proj.tipPitch, 20);
  assert.deepEqual(kindsOf(S.list, K_SUMMARY).sort(), [AB, DE].sort());
  assert.ok(kindsOf(S.list, K_NODE).includes(CDE));
  assert.deepEqual(kindsOf(S.list, K_TIP).sort(), [id('C'), id('F')].sort());
  assert.ok(S.proj.cladeSize(CDE) >= MARKER_PX);
});

test('a point on a tip dot hits that tip, also a few pixels off it', () => {
  const { x, y } = S.xy(id('C'));
  assert.deepEqual(S.q(x, y), { node: id('C'), kind: 'tip' });
  assert.deepEqual(S.q(x + 6, y + 3), { node: id('C'), kind: 'tip' });
  const f = S.xy(id('F'));
  assert.deepEqual(S.q(f.x, f.y), { node: id('F'), kind: 'tip' });
});

test('a point on an internal marker hits the node, even though its branch and connector are as close', () => {
  const { x, y } = S.xy(CDE);
  assert.deepEqual(S.q(x, y), { node: CDE, kind: 'node' });
  assert.deepEqual(
    S.q(x, y + 3),
    { node: CDE, kind: 'node' },
    'on the connector line, 3 px below the marker: the marker (0.5) beats the connector (14)',
  );
  const left = S.q(x - 3, y);
  assert.deepEqual(left, { node: CDE, kind: 'node' }, 'on the branch, 3 px before the marker: the marker still wins');
});

test('a point on a horizontal branch hits kind branch with the child node', () => {
  const { x, y } = S.xy(CDE);
  const p = S.pxy(CDE);
  assert.ok(x - p.x > 60, 'the branch is long enough to have a middle');
  assert.deepEqual(S.q((x + p.x) / 2, y), { node: CDE, kind: 'branch' });
  assert.deepEqual(S.q((x + p.x) / 2, y + 3), { node: CDE, kind: 'branch' }, 'within the 4 px slop');
  assert.equal(S.q((x + p.x) / 2, y + 12), null, 'beyond it');
});

test('a point on a clade connector (the vertical line) hits kind branch with the clade', () => {
  const { x } = S.xy(CDE);
  const c = S.xy(id('C'));
  assert.deepEqual(S.q(x, c.y + 1), { node: CDE, kind: 'branch' });
});

test('a tip dot is hittable within 8 px along the branch; farther along, the branch is hit instead', () => {
  const { x, y } = S.xy(id('F'));
  assert.deepEqual(S.q(x - 7, y), { node: id('F'), kind: 'tip' });
  assert.deepEqual(S.q(x - 30, y), { node: id('F'), kind: 'branch' });
});

test('a point inside a collapsed clade triangle hits kind summary, and the summary beats the branch at the same distance', () => {
  for (const node of [AB, DE]) {
    const { x, y } = S.xy(node);
    S.proj.summaryExtent(node, -1, 0);
    const xm = S.proj.d1;
    assert.ok(xm > x + 20, 'the triangle has width');
    const mid = (x + xm) / 2;
    assert.deepEqual(S.q(mid, y), { node, kind: 'summary' });
    assert.deepEqual(S.q(x + 2, y), { node, kind: 'summary' }, '2 px right of the apex the branch is just as close (14) but the summary scores 12');
    assert.deepEqual(S.q(xm - 3, y + 8), { node, kind: 'summary' }, 'near the base, off the centre line');
  }
});

test('a point on the branch of a collapsed clade, left of its apex, hits the branch', () => {
  const { x, y } = S.xy(AB);
  const p = S.pxy(AB);
  assert.deepEqual(S.q((x + p.x) / 2, y), { node: AB, kind: 'branch' });
});

test('a point far from everything returns null; so does a query before the index is built or after it is invalidated', () => {
  assert.equal(S.q(30, 115), null, 'empty corner below the root');
  assert.equal(S.q(-50, -50), null, 'outside the grid');
  assert.equal(S.q(2000, 2000), null);
  const fresh = new HitIndex();
  assert.equal(fresh.query(100, 50, S.proj), null);
  const h = new HitIndex();
  h.build(S.list, S.proj);
  const { x, y } = S.xy(id('F'));
  assert.ok(h.query(x, y, S.proj));
  h.invalidate();
  assert.equal(h.valid, false);
  assert.equal(h.query(x, y, S.proj), null);
  assert.ok(h.items > 0 && h.entries > 0 && h.builtMs >= 0);
});

test('tips closer than 6 px apart have no dot to hit', () => {
  const dense = scene(NWK, 600, 40, 2); // 5 px per tip
  assert.equal(dense.proj.tipPitch, 5);
  const { x, y } = dense.xy(dense.tree.tipIndex('C'));
  const hit = dense.q(x, y);
  assert.notEqual(hit?.kind, 'tip');
});

// ---- runs of small siblings (rule R, SLICE_MIN_CHILDREN)

const tips = (n, p, len = 1) => Array.from({ length: n }, (_, i) => `${p}${i}:${len}`);

test('a polytomy of small siblings is one run: a click inside reports the parent with kind summary and the first and last member', () => {
  const n = 3 * SLICE_MIN_CHILDREN;
  const star = scene(`(${tips(n, 's').join(',')})root;`, 600, 2.5 * n, 3); // 2.5 px per tip
  assert.equal(star.list.count, 2, 'the root and one entry for all the tips');
  assert.equal(star.list.kind[1], K_SUMMARY);
  assert.ok(star.list.last[1] >= 0, 'a run entry');
  const first = star.tree.tipIndex('s0'),
    last = star.tree.tipIndex(`s${n - 1}`);
  star.proj.summaryExtent(first, star.list.last[1], star.list.xmax[1]);
  const { d0, d1, t0, t1 } = star.proj;
  const h = star.q((d0 + d1) / 2, (t0 + t1) / 2);
  assert.deepEqual(h, { node: 0, kind: 'summary', run: { first, last } });
  assert.deepEqual(star.q((d0 + d1) / 2, t1 + 1.5), { node: 0, kind: 'summary', run: { first, last } }, 'inside the 2 px slack');
  assert.equal(star.q((d0 + d1) / 2, t1 + 12), null, 'outside it');
  assert.equal(star.q(d1 + 10, (t0 + t1) / 2), null);
  assert.equal(star.q(d0 + 2, t0 - 12), null);
});

test('runs between larger children: each run is its own hit with its own first and last, the open clade between them is not a run', () => {
  // 20 tips, a clade of 6 tips, 20 tips, a clade of 6: at 2.5 px per tip the clades (15 px) stay open, the tips around them are runs
  const nwk = `(${[...tips(20, 'm'), `(${tips(6, 'c').join(',')}):1`, ...tips(20, 'n'), `(${tips(6, 'd').join(',')}):1`].join(',')})root;`;
  const m = scene(nwk, 600, 2.5 * 52, 3);
  const runs = [];
  for (let e = 0; e < m.list.count; e++) if (m.list.kind[e] === K_SUMMARY && m.list.last[e] >= 0) runs.push(e);
  assert.equal(runs.length, 2, 'the tips before the first clade and between the clades; none after the last (a clade)');
  const probe = (e) => {
    m.proj.summaryExtent(m.list.node[e], m.list.last[e], m.list.xmax[e]);
    return m.q((m.proj.d0 + m.proj.d1) / 2, (m.proj.t0 + m.proj.t1) / 2);
  };
  assert.deepEqual(probe(runs[0]), { node: 0, kind: 'summary', run: { first: m.tree.tipIndex('m0'), last: m.tree.tipIndex('m19') } });
  assert.deepEqual(probe(runs[1]), { node: 0, kind: 'summary', run: { first: m.tree.tipIndex('n0'), last: m.tree.tipIndex('n19') } });
  // the open clade c: its marker is hittable (15 px tall >= MARKER_PX)
  const cNode = m.tree.parent[m.tree.tipIndex('c0')];
  assert.ok(m.list.node.subarray(0, m.list.count).includes(cNode));
  const { x, y } = m.xy(cNode);
  assert.deepEqual(m.q(x, y), { node: cNode, kind: 'node' });
});
