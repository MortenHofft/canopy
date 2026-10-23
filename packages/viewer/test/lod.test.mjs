// Unit tests of the pieces of src/core/lod.ts the golden test does not reach directly: the dedupe set (Seen), the growing draw list
// (DrawList), the threshold search (searchCut) on a budget the tree overflows and the collapse rule on a clade of near-zero branch
// lengths (#87). The cut itself is pinned by cut-golden.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const { parseNewick } = await import(path.join(root, 'packages/io/src/newick.ts'));
const core = path.join(root, 'packages/viewer/src');
const { computeLayout, ensureTrig } = await import(path.join(core, 'layout.ts'));
const { InMemorySource } = await import(path.join(core, 'source.ts'));
const { makeTransform } = await import(path.join(core, 'geom.ts'));
const { projectionFor } = await import(path.join(core, 'projection.ts'));
const { DrawList, Seen, searchCut, cell, K_NODE, K_TIP, K_SUMMARY } = await import(path.join(core, 'lod.ts'));

test('Seen: the first add of a key is new, the second is not; keys differ in any of the five parts', () => {
  const s = new Seen();
  assert.equal(s.add(1, 2, 3, 4, 5), true);
  assert.equal(s.add(1, 2, 3, 4, 5), false);
  assert.equal(s.add(1, 2, 3, 4, 6), true, 'e differs');
  assert.equal(s.add(1, 2, 3, 5, 5), true, 'd differs');
  assert.equal(s.add(1, 2, 4, 4, 5), true, 'c differs');
  assert.equal(s.add(1, 3, 3, 4, 5), true, 'b differs');
  assert.equal(s.add(2, 2, 3, 4, 5), true, 'a differs');
  assert.equal(s.add(1, 2, 3, 4, 5), false, 'still there');
});

test('Seen: many keys, including ones that collide in the table, are all remembered', () => {
  const s = new Seen();
  for (let i = 0; i < 5000; i++) assert.equal(s.add(i & 255, i >> 8, i % 7, i % 11, i % 13), true, `key ${i} is new`);
  for (let i = 0; i < 5000; i++) assert.equal(s.add(i & 255, i >> 8, i % 7, i % 11, i % 13), false, `key ${i} is known`);
});

test('Seen.reset forgets every key at once and can be repeated', () => {
  const s = new Seen();
  s.add(7, 7, 7, 7, 7);
  s.add(8, 8, 8, 8, 8);
  s.reset();
  assert.equal(s.add(7, 7, 7, 7, 7), true);
  assert.equal(s.add(7, 7, 7, 7, 7), false);
  for (let k = 0; k < 5; k++) {
    s.reset();
    assert.equal(s.add(8, 8, 8, 8, 8), true, `after reset ${k}`);
  }
});

test('Seen: the generation counter rolls over without a stale key coming back to life', () => {
  const s = new Seen();
  assert.equal(s.add(5, 6, 7, 8, 9), true); // stamped with generation 1
  // `cur` and `n` are private fields of Seen (src/core/lod.ts): a rename there must be followed here
  s.cur = 0xffffffef; // the next reset reaches 0xfffffff0 and wraps to 1
  s.reset();
  assert.equal(s.cur, 1, 'wrapped');
  assert.equal(s.add(5, 6, 7, 8, 9), true, 'the old stamp (1) was cleared, so the key is new again');
  assert.equal(s.add(5, 6, 7, 8, 9), false);
  s.reset();
  assert.equal(s.cur, 2);
  assert.equal(s.add(5, 6, 7, 8, 9), true);
});

test('Seen: a nearly full table stops deduplicating instead of looping', () => {
  const s = new Seen();
  s.n = 380001; // private field `n` of Seen, see the note on `cur` above
  assert.equal(s.add(1, 1, 1, 1, 1), true);
  assert.equal(s.add(1, 1, 1, 1, 1), true, 'no longer remembered: both are "new"');
  s.reset();
  assert.equal(s.n, 0);
  assert.equal(s.add(1, 1, 1, 1, 1), true);
  assert.equal(s.add(1, 1, 1, 1, 1), false, 'dedupe is back after a reset');
});

test('cell: offset by 1024 so small negatives stay apart, clamped to 13 bits', () => {
  assert.equal(cell(0), 1024);
  assert.equal(cell(0.9), 1024);
  assert.equal(cell(-0.1), 1023);
  assert.equal(cell(-2000), 0);
  assert.equal(cell(1e9), 8191);
  assert.equal(cell(7167), 8191);
  assert.equal(cell(7166.5), 8190);
});

test('DrawList: push fills the parallel arrays, defaults last to -1 and xmax to 0', () => {
  const d = new DrawList();
  d.push(11, K_TIP, 2);
  d.push(12, K_SUMMARY, 0, 30, 0.5);
  assert.equal(d.count, 2);
  assert.deepEqual([d.node[0], d.kind[0], d.cls[0], d.last[0], d.xmax[0]], [11, K_TIP, 2, -1, 0]);
  assert.deepEqual([d.node[1], d.kind[1], d.cls[1], d.last[1], d.xmax[1]], [12, K_SUMMARY, 0, 30, 0.5]);
});

test('DrawList grows by doubling when full, keeping every field of every entry', () => {
  const d = new DrawList();
  const start = d.node.length;
  assert.equal(start, 8192);
  const total = start * 2 + 5;
  for (let k = 0; k < total; k++) d.push(k, k % 4, k % 7, k % 3 === 0 ? k + 1 : -1, k % 3 === 0 ? k / 16 : 0);
  assert.equal(d.count, total);
  assert.equal(d.node.length, start * 4, 'doubled twice');
  for (const a of [d.node, d.kind, d.cls, d.last, d.xmax]) assert.equal(a.length, start * 4, 'all five arrays grow together');
  for (let k = 0; k < total; k++) {
    const want = [k, k % 4, k % 7, k % 3 === 0 ? k + 1 : -1, k % 3 === 0 ? k / 16 : 0];
    const got = [d.node[k], d.kind[k], d.cls[k], d.last[k], d.xmax[k]];
    if (got.some((v, f) => v !== want[f])) assert.deepEqual(got, want, `entry ${k} survived the growth`);
  }
  d.count = 0;
  d.push(1, K_NODE, 0);
  assert.equal(d.node[0], 1, 'reusable after count = 0');
});

// ---- searchCut

/** A balanced binary tree of n tips (n a power of two) with unit lengths. */
function balanced(n) {
  const go = (m, p) => (m === 1 ? `${p}:1` : `(${go(m / 2, p + 'a')},${go(m / 2, p + 'b')}):1`);
  return go(n, 't') + ';';
}
const tree = new InMemorySource(parseNewick(balanced(512))).snapshot();
const L = computeLayout(tree, true);
ensureTrig(L);
const W = 600,
  H = 400;
const area = { ax: 0, ay: 0, aw: W, ah: H, clipL: 0, clipT: 0, clipR: W, clipB: H };
const T = makeTransform('rectangular', W, H, { x0: 0, x1: 1, y0: 0, y1: 512 }, area, 512);
const proj = projectionFor(tree, L, T);
const search = (budget, hint = 0, over = {}) => {
  const list = new DrawList();
  const r = searchCut(proj, null, list, new Seen(), { lod: true, base: 3, budget, summaries: true, hint, ...over });
  return { ...r, list };
};
const STEP = 1.15;
const onLadder = (m) => Math.abs(Math.log(m / 3) / Math.log(STEP) - Math.round(Math.log(m / 3) / Math.log(STEP))) < 1e-9;

test('searchCut without budget pressure: one pass at the base threshold', () => {
  const r = search(1_000_000);
  assert.equal(r.minPx, 3);
  assert.equal(r.retries, 0);
  assert.equal(r.res.overflow, false);
  assert.equal(r.res.forced, 0);
  assert.ok(r.list.count > 100);
});

test('searchCut on a budget the tree overflows: the threshold rises on the ladder base * 1.15^n and the list fits', () => {
  const free = search(1_000_000).list.count;
  for (const budget of [free - 1, Math.floor(free / 2), 200, 60, 20]) {
    const r = search(budget);
    assert.equal(r.res.overflow, false, `budget ${budget}: fits`);
    assert.ok(r.list.count <= budget, `budget ${budget}: ${r.list.count} entries`);
    assert.ok(r.minPx > 3, `budget ${budget}: the threshold rose`);
    assert.ok(onLadder(r.minPx), `budget ${budget}: ${r.minPx} is a rung of the ladder`);
    assert.ok(r.retries >= 1, `budget ${budget}: retries counted`);
    assert.ok(r.res.forced > 0, `budget ${budget}: clades were summarised because of the budget`);
  }
});

test('searchCut: a tighter budget never gives a lower threshold; retries equal the number of extra passes', () => {
  let last = 0;
  for (const budget of [2000, 600, 200, 100, 50, 25, 12]) {
    const r = search(budget);
    assert.ok(r.minPx >= last, `budget ${budget}: ${r.minPx} >= ${last}`);
    assert.ok(r.list.count <= budget);
    last = r.minPx;
  }
  // from the base each rung costs one pass: the ladder index is the number of retries when only overflow drove the climb
  const r = search(100);
  assert.equal(r.retries, Math.round(Math.log(r.minPx / 3) / Math.log(STEP)), 'one extra pass per rung climbed');
});

test('searchCut: the previous threshold as a hint is kept (sticky), and a hint far too high comes back down only as far as the budget allows', () => {
  const first = search(100);
  const again = search(100, first.minPx);
  assert.equal(again.minPx, first.minPx, 'same view, same budget: the same rung');
  assert.equal(again.retries, 2, 'two extra passes: the probe of the next rung down (which does not fit), then the kept rung again');
  assert.equal(again.list.count, first.list.count);
  const high = search(100, first.minPx * STEP ** 6);
  assert.ok(high.minPx <= first.minPx * STEP ** 6 + 1e-9, 'never above the hint when that fits');
  assert.ok(high.list.count <= 100);
  assert.ok(high.minPx >= first.minPx - 1e-9, 'not below the smallest rung that fits');
  const loose = search(1_000_000, first.minPx);
  assert.equal(loose.minPx, 3, 'the budget allows more: the search walks back down to the base');
  assert.equal(loose.res.forced, 0);
});

test('searchCut: a budget nothing can meet climbs 99 rungs, reports the overflow, and still never writes past the budget', () => {
  const r = search(1);
  assert.equal(r.res.overflow, true);
  assert.equal(r.retries, 99, 'passes are capped at 100');
  assert.ok(r.list.count <= 1);
  assert.ok(r.minPx > 3 * STEP ** 90);
  assert.ok(onLadder(r.minPx));
});

test('searchCut with LOD off is a single pass at the base threshold, whatever the budget', () => {
  const r = search(10, 0, { lod: false });
  assert.equal(r.retries, 0);
  assert.equal(r.minPx, 3);
  assert.ok(r.list.count <= 10);
  assert.equal(r.res.overflow, true);
});

test('searchCut: the caller-owned list holds the entries of the pass that was kept', () => {
  const r = search(150);
  assert.equal(r.res.summaries, Array.from({ length: r.list.count }, (_, e) => r.list.kind[e]).filter((k) => k === K_SUMMARY).length);
  assert.equal(r.res.tips, Array.from({ length: r.list.count }, (_, e) => r.list.kind[e]).filter((k) => k === K_TIP).length);
});

// ---- the collapse rule counts rows only (#87)

// 128 tips whose first cherry has near-zero branch lengths: however far you zoom, it stays less than a pixel wide
const NARROW = balanced(128).replace('(taaaaaaa:1,taaaaaab:1)', '(taaaaaaa:0.000001,taaaaaab:0.000001)');
const narrowTree = new InMemorySource(parseNewick(NARROW)).snapshot();
const narrowL = computeLayout(narrowTree, true);
ensureTrig(narrowL);
const cherry = narrowTree.parent[narrowTree.tipNode[0]];
const kindsOf = (view, kind, base) => {
  const p = projectionFor(narrowTree, narrowL, makeTransform(kind, W, H, view, area, 128));
  const list = new DrawList();
  searchCut(p, null, list, new Seen(), { lod: true, base, budget: 1_000_000, summaries: true, hint: 0 });
  const of = (node) =>
    Array.from({ length: list.count }, (_, e) => e)
      .filter((e) => list.node[e] === node)
      .map((e) => list.kind[e]);
  return { cherry: of(cherry), a: of(narrowTree.tipNode[0]), b: of(narrowTree.tipNode[1]) };
};

test('a two-tip clade with near-zero branch lengths is not collapsed once its rows are taller than minCladePx', () => {
  assert.ok(narrowTree.leafEnd[cherry] - narrowTree.leafStart[cherry] === 2 && narrowTree.length[narrowTree.tipNode[0]] < 1e-5);
  // 20 px rows, minCladePx 14: the cherry is 40 px tall and well under a pixel wide
  assert.deepEqual(kindsOf({ x0: 0, x1: 1, y0: 0, y1: 20 }, 'rectangular', 14), { cherry: [K_NODE], a: [K_TIP], b: [K_TIP] });
  // 5 px rows: 10 px tall, under minCladePx, so it is a summary
  assert.deepEqual(kindsOf({ x0: 0, x1: 1, y0: 0, y1: 80 }, 'rectangular', 14), { cherry: [K_SUMMARY], a: [], b: [] });
});

test('radial: a two-tip clade with near-zero branch lengths is not collapsed once its arc is longer than minCladePx', () => {
  // radius 300 px over 128 tips: about 15 px of arc per tip, so the cherry's arc (about 29 px) is over 14 and under 4 * 14
  assert.deepEqual(kindsOf({ x0: -1, x1: 1, y0: -1, y1: 1 }, 'radial', 14), { cherry: [K_NODE], a: [K_TIP], b: [K_TIP] });
  assert.deepEqual(kindsOf({ x0: -1, x1: 1, y0: -1, y1: 1 }, 'radial', 40), { cherry: [K_SUMMARY], a: [], b: [] });
});

test('radial, cold search (no hint) zoomed 64 times into a 20k comb: the ladder climbs past 60 passes and the list fits the budget', () => {
  // equal branches: the spine's clades are deep and their arcs at the rim run to tens of thousands of px, so the threshold that fits
  // is about 6,000 times the base, more than 60 rungs up
  let nwk = 't0:0.01';
  for (let i = 1; i < 20000; i++) nwk = `(${nwk}:0.01,t${i}:0.01)`;
  const comb = new InMemorySource(parseNewick(nwk + ';')).snapshot();
  const cl = computeLayout(comb, true);
  ensureTrig(cl);
  const w = 2 / 64,
    h = 1.5 / 64;
  const a = { ax: 0, ay: 0, aw: 800, ah: 600, clipL: 0, clipT: 0, clipR: 800, clipB: 600 };
  const p = projectionFor(comb, cl, makeTransform('radial', 800, 600, { x0: 0.6 - w / 2, x1: 0.6 + w / 2, y0: -h / 2, y1: h / 2 }, a, 20000));
  const list = new DrawList();
  const r = searchCut(p, null, list, new Seen(), { lod: true, base: 14, budget: 2000, summaries: true, hint: 0 });
  assert.equal(r.res.overflow, false, `fits (${r.retries} retries, minPx ${r.minPx})`);
  assert.ok(r.retries >= 60, `more than 60 passes: ${r.retries + 1}`);
  assert.ok(list.count <= 2000);
});
