// Unit tests of the partial-source path (TreeSnapshot.stub / globalId / rollup / toLocal) through the layout, the cut and the hit index,
// on snapshots built by hand with partial-snapshot.mjs (a miniature of ParquetSource.build()). The Parquet files themselves are covered by
// scripts/check-parquet-source.mjs, which needs git-ignored data; these tests need none.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..', '..', '..');
const { parseNewick } = await import(path.join(root, 'spikes/shared/newick.ts'));
const core = path.join(root, 'spikes/custom/src/core');
const { computeLayout, ensureTrig } = await import(path.join(core, 'layout.ts'));
const { InMemorySource } = await import(path.join(core, 'source.ts'));
const { makeTransform } = await import(path.join(core, 'geom.ts'));
const { projectionFor } = await import(path.join(core, 'projection.ts'));
const { cut, searchCut, newCutResult, DrawList, Seen, isSlice, K_NODE, K_SUMMARY, K_STUB, K_TIP, SLICE_MIN_CHILDREN } = await import(
  path.join(core, 'lod.ts')
);
const { HitIndex } = await import(path.join(core, 'hit.ts'));
const { partialSnapshot } = await import(path.join(here, 'partial-snapshot.mjs'));

// full preorder: 0 root, 1 AB, 2 A, 3 B, 4 CDE, 5 C, 6 DE, 7 D, 8 E, 9 F
const NWK = '((A:1,B:2)AB:1,(C:1,(D:2,E:3)DE:1)CDE:2,F:4)root;';
const full = new InMemorySource(parseNewick(NWK)).snapshot();
const CDE = 4;
const OFFSET = 100000;
const part = partialSnapshot(full, [CDE], OFFSET);
const snap = part.snap;
// rows: 0 root, 1 AB, 2 A, 3 B, 4 CDE (stub), 5 F

test('the fixture: six rows, the stub is a leaf row standing for tips 2..5, tips of the stub are not loaded', () => {
  assert.equal(snap.nodeCount, 6);
  assert.deepEqual([...snap.stub], [0, 0, 0, 0, 1, 0]);
  assert.deepEqual(
    [...snap.globalId],
    [0, 1, 2, 3, 4, 9].map((g) => g + OFFSET),
  );
  assert.equal(snap.subtreeEnd[4], 5, 'a stub covers one row');
  assert.equal(snap.childCount[4], 1, 'internal, so not taken for a tip');
  assert.equal(snap.firstChild[4], -1);
  assert.deepEqual([snap.leafStart[4], snap.leafEnd[4]], [2, 5]);
  assert.deepEqual([...snap.tipNode], [2, 3, -1, -1, -1, 5]);
  assert.equal(snap.tipCount, 6, 'tip counts are those of the full tree');
});

test('toLocal and globalId round-trip; ids below a stub, shifted and out-of-range ids are not part of the snapshot', () => {
  for (let r = 0; r < snap.nodeCount; r++) {
    assert.equal(snap.toLocal(snap.globalId[r]), r, `row ${r}`);
    assert.equal(part.rowOf(snap.globalId[r] - OFFSET), r);
  }
  for (const below of [5, 6, 7, 8]) assert.equal(snap.toLocal(below + OFFSET), -1, `full id ${below} lies below the stub`);
  assert.equal(snap.toLocal(3), -1, 'a row index is not a global id here');
  assert.equal(snap.toLocal(-1), -1);
  assert.equal(snap.toLocal(10 ** 9), -1);
});

test('the in-memory snapshot is the identity mapping and has no stubs', () => {
  assert.equal(full.stub, null);
  assert.equal(full.globalId, null);
  assert.equal(full.rollup, null);
  for (let g = 0; g < full.nodeCount; g++) assert.equal(full.toLocal(g), g);
  assert.equal(full.toLocal(-1), -1);
  assert.equal(full.toLocal(full.nodeCount), -1);
});

for (const lengths of [true, false]) {
  test(`layoutFromRollup (${lengths ? 'phylogram' : 'cladogram'}): X, XMAX and ROW of every row, the stub included, are those of the full tree`, () => {
    const Lf = computeLayout(full, lengths);
    const Lp = computeLayout(snap, lengths);
    assert.equal(Lp.n, 6);
    assert.equal(Lp.tips, 6, 'the tips of the full tree');
    assert.equal(Lp.usedLengths, Lf.usedLengths);
    assert.equal(Lp.maxLen, Lf.maxLen, 'taken from the rollup of the root');
    for (let r = 0; r < snap.nodeCount; r++) {
      const g = snap.globalId[r] - OFFSET;
      assert.ok(Math.abs(Lp.X[r] - Lf.X[g]) < 1e-12, `X of row ${r}: ${Lp.X[r]} vs ${Lf.X[g]}`);
      assert.equal(Lp.XMAX[r], Lf.XMAX[g], `XMAX of row ${r}`);
      assert.equal(Lp.ROW[r], Lf.ROW[g], `ROW of row ${r}`);
    }
    assert.equal(Lp.LAST[0], 5, 'the root ends with the F row');
    assert.equal(Lp.LAST[4], -1, 'a stub has no rows below it');
    assert.equal(Lp.LAST[1], 3);
  });
}

test('layoutFromRollup: the deepest tip below a stub is what reaches XMAX = 1, though that tip is not loaded', () => {
  const L = computeLayout(snap, true);
  assert.equal(L.XMAX[4], 1, 'E (3 + 1 + 2 of 6) is the deepest tip of the tree and lies below the stub');
  assert.ok(L.X[4] < 1);
  assert.equal(L.XMAX[5], Math.fround(4 / 6));
});

const W = 600,
  H = 120;
const area = { ax: 0, ay: 0, aw: W, ah: H, clipL: 0, clipT: 0, clipR: W, clipB: H };
function frame(tree, layout, summaries = true, budget = 1000, minPx = 3) {
  const L = computeLayout(tree, true);
  ensureTrig(L);
  const N = tree.tipCount;
  const v = layout === 'rectangular' ? { x0: 0, x1: 1, y0: 0, y1: N } : { x0: -W / 200, x1: W / 200, y0: -H / 200, y1: H / 200 };
  const T = makeTransform(layout, W, H, v, area, N);
  const proj = projectionFor(tree, L, T);
  const list = new DrawList();
  const res = cut(proj, { lod: true, minPx, budget, summaries }, null, list, new Seen(), newCutResult());
  const entries = [];
  for (let e = 0; e < list.count; e++) entries.push([list.node[e], list.kind[e]]);
  return { proj, list, res, entries, L };
}

for (const layout of ['rectangular', 'radial']) {
  test(`${layout} cut: a stub is emitted as a summary, never opened, though its clade is big on screen`, () => {
    const withStub = frame(snap, layout);
    assert.deepEqual(withStub.entries, [
      [0, K_NODE],
      [1, K_NODE],
      [2, K_TIP],
      [3, K_TIP],
      [4, K_SUMMARY],
      [5, K_TIP],
    ]);
    assert.equal(withStub.res.summaries, 1);
    assert.equal(withStub.res.summaryTips, 3, 'the summary stands for the 3 tips below the stub');
    assert.equal(withStub.res.tips, 3);
    // the same view of the complete tree opens the clade
    const complete = frame(full, layout);
    assert.equal(complete.entries.find(([i]) => i === CDE)[1], K_NODE);
    assert.ok(complete.list.count > withStub.list.count);
  });

  test(`${layout} cut: a stub is a plain branch when summaries are off`, () => {
    const f = frame(snap, layout, false);
    assert.equal(f.entries.find(([i]) => i === 4)[1], K_STUB);
    assert.equal(f.res.summaries, 0);
  });
}

test('a stub is not part of a run of small siblings, and is not a slice', () => {
  // 20 clades of 2 tips under the root, all stubs: sub-pixel tall, all under a parent with 20 children
  const kids = Array.from({ length: 20 }, (_, i) => `(a${i}:1,b${i}:1):1`);
  const big = new InMemorySource(parseNewick(`(${kids.join(',')})root;`)).snapshot();
  const stubs = Array.from({ length: 20 }, (_, i) => big.parent[big.tipIndex(`a${i}`)]);
  const p = partialSnapshot(big, stubs).snap;
  const f = frame(p, 'rectangular', true, 1000, 10);
  const f2 = frame(big, 'rectangular', true, 1000, 10);
  assert.equal(f.res.summaries, f.list.count - 1, 'the root and one summary per stub that survives the pixel-cell dedupe');
  for (let e = 0; e < f.list.count; e++) assert.equal(f.list.last[e], -1, 'no run entry');
  assert.ok(
    Array.from({ length: f2.list.count }, (_, e) => f2.list.last[e]).some((l) => l >= 0),
    'control: the complete tree at the same view does form a run out of the same clades',
  );
  // isSlice: a polytomy of tips is a slice unless the row is a stub
  const star = new InMemorySource(parseNewick(`(${Array.from({ length: SLICE_MIN_CHILDREN }, (_, i) => `s${i}:1`).join(',')})root;`)).snapshot();
  assert.equal(isSlice(star, 0), true);
  assert.equal(isSlice({ ...star, stub: Uint8Array.of(1, ...new Array(star.nodeCount - 1).fill(0)) }, 0), false);
});

test('forced counts only loaded clades that the budget collapsed, never a stub', () => {
  // the root with six clades of three tips; the first three clades are stubs, the other three are loaded
  const clades = 'abcdef'.split('').map((c) => `(${c}1:1,${c}2:1,${c}3:1):1`);
  const t6 = new InMemorySource(parseNewick(`(${clades.join(',')})root;`)).snapshot();
  const ids = 'abcdef'.split('').map((c) => t6.parent[t6.tipIndex(`${c}1`)]);
  const p = partialSnapshot(t6, ids.slice(0, 3)).snap;
  const L = computeLayout(p, true);
  const T = makeTransform('rectangular', W, 360, { x0: 0, x1: 1, y0: 0, y1: 18 }, { ...area, ah: 360, clipB: 360 }, 18); // 20 px per tip
  const proj = projectionFor(p, L, T);
  const base = searchCut(proj, null, new DrawList(), new Seen(), { lod: true, base: 3, budget: 1000, summaries: true, hint: 0 });
  assert.equal(base.res.forced, 0, 'no budget pressure: nothing forced');
  assert.equal(base.res.summaries, 3, 'the three stubs');
  const list = new DrawList();
  const r = searchCut(proj, null, list, new Seen(), { lod: true, base: 3, budget: 8, summaries: true, hint: 0 });
  assert.ok(r.minPx > 3, 'the threshold was raised to fit');
  assert.equal(r.res.summaries, 6, 'three stubs and the three loaded clades, now collapsed');
  assert.equal(r.res.forced, 3, 'only the loaded ones were summarised because of the budget');
  assert.ok(list.count <= 8);
  // all stubs: nothing can be collapsed, so even an impossible budget forces nothing
  const all = partialSnapshot(t6, ids).snap;
  const L2 = computeLayout(all, true);
  const proj2 = projectionFor(all, L2, T);
  const r2 = searchCut(proj2, null, new DrawList(), new Seen(), { lod: true, base: 3, budget: 3, summaries: true, hint: 0 });
  assert.equal(r2.res.forced, 0);
  assert.ok(r2.minPx > 3, 'the search did raise the threshold');
});

test('hit-testing a stub: a click inside its triangle reports the stub row as a summary', () => {
  const f = frame(snap, 'rectangular');
  const hit = new HitIndex();
  hit.build(f.list, f.proj);
  const p = { x: 0, y: 0 };
  f.proj.nodeXY(4, p);
  f.proj.summaryExtent(4, -1, 0);
  const mid = (p.x + f.proj.d1) / 2;
  assert.deepEqual(hit.query(mid, p.y, f.proj), { node: 4, kind: 'summary' }, 'the row, not the global id: the facade converts');
});
