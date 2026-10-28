// The memo of the last two keys in Seen (#5): a key that repeats is answered without the table, and the cut is exactly what it was without
// the memo. The differential test runs searchCut with Seen and with a plain Set of the same keys on seeded random trees (caterpillars in
// both child orders, binary trees, polytomies with runs and classes), both layouts, several views and budgets.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const { parseNewick } = await import(path.join(root, 'packages/io/src/newick.ts'));
const core = path.join(root, 'packages/viewer/src');
const { computeLayout, ensureTrig, radialFan, setLayoutFan } = await import(path.join(core, 'layout.ts'));
const { InMemorySource } = await import(path.join(core, 'source.ts'));
const { makeTransform } = await import(path.join(core, 'geom.ts'));
const { projectionFor } = await import(path.join(core, 'projection.ts'));
const { DEFAULT_OPTIONS } = await import(path.join(core, 'types.ts'));
const { DrawList, Seen, searchCut } = await import(path.join(core, 'lod.ts'));
const { W, H, VIEWS } = await import('./cut-golden-cases.mjs');

test('Seen memo: alternating keys stay known, a third key in between does not make one new again', () => {
  const s = new Seen();
  assert.equal(s.add(1, 1, 1, 1, 1), true);
  assert.equal(s.add(2, 2, 2, 2, 2), true);
  for (let k = 0; k < 4; k++) {
    assert.equal(s.add(1, 1, 1, 1, 1), false);
    assert.equal(s.add(2, 2, 2, 2, 2), false);
  }
  assert.equal(s.add(3, 3, 3, 3, 3), true);
  assert.equal(s.add(4, 4, 4, 4, 4), true);
  assert.equal(s.add(1, 1, 1, 1, 1), false, 'out of the memo, still in the table');
  assert.equal(s.add(1, 1, 1, 1, 2), true, 'differs from a memo key in e only');
  assert.equal(s.add(1, 1, 1, 2, 2), true, 'differs in d only');
});

test('Seen memo: reset forgets the memo too', () => {
  const s = new Seen();
  s.add(5, 5, 5, 5, 5);
  s.add(6, 6, 6, 6, 6);
  s.reset();
  assert.equal(s.add(5, 5, 5, 5, 5), true);
  assert.equal(s.add(6, 6, 6, 6, 6), true);
  assert.equal(s.add(6, 6, 6, 6, 6), false);
});

/** The dedupe set without a memo or a table: what Seen must answer. */
class PlainSeen {
  keys = new Set();
  reset() {
    this.keys.clear();
  }
  add(a, b, c, d, e) {
    const k = `${a},${b},${c},${d},${e}`;
    if (this.keys.has(k)) return false;
    this.keys.add(k);
    return true;
  }
}

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x9e3779b9) >>> 0;
    s ^= s >>> 13;
    return (s >>> 0) / 4294967296;
  };
}

/** Newick of a tree given as child lists (node 0 the root), without recursion. Branch lengths from `len` (none when null). */
function newick(kids, len) {
  const out = [];
  const stack = [[0, 0]];
  while (stack.length) {
    const top = stack[stack.length - 1];
    const [v, k] = top;
    if (k === 0 && kids[v].length > 0) out.push('(');
    if (k < kids[v].length) {
      if (k > 0) out.push(',');
      top[1]++;
      stack.push([kids[v][k], 0]);
      continue;
    }
    if (kids[v].length > 0) out.push(')');
    out.push(kids[v].length === 0 ? `t${v}` : '');
    if (len && v > 0) out.push(':' + len[v].toFixed(6));
    stack.pop();
  }
  return out.join('') + ';';
}

function caterpillar(n, tipFirst, r, lengths) {
  const kids = [];
  for (let j = 0; j < n - 1; j++) kids.push([]);
  // spine nodes 0..n-2, tips n-1..2n-2
  for (let j = 0; j < n - 1; j++) {
    const tip = n - 1 + j;
    const next = j < n - 2 ? j + 1 : 2 * n - 2;
    kids[j] = tipFirst ? [tip, next] : [next, tip];
  }
  for (let t = n - 1; t <= 2 * n - 2; t++) kids[t] = [];
  return newick(kids, lengths ? kids.map(() => r() * r()) : null);
}

/** Random tree: each internal node gets 2 children, or (with `poly`) sometimes 3 to 40, until n tips. */
function randomTree(n, r, poly) {
  const kids = [[]];
  const open = [0];
  let tips = 1;
  while (tips < n) {
    const at = Math.floor(r() * open.length);
    const v = open[at];
    open[at] = open[open.length - 1];
    open.pop();
    const c = poly && r() < 0.2 ? 3 + Math.floor(r() * 38) : 2;
    for (let k = 0; k < c; k++) {
      kids[v].push(kids.length);
      open.push(kids.length);
      kids.push([]);
    }
    tips += c - 1;
  }
  return newick(
    kids,
    kids.map(() => r()),
  );
}

const FAN = radialFan(DEFAULT_OPTIONS.radialOpening, DEFAULT_OPTIONS.radialRotation);
const area = { ax: 0, ay: 0, aw: W, ah: H, clipL: 0, clipT: 0, clipR: W, clipB: H };

function runCut(s, L, classOf, layout, view, budget, seen) {
  const T = makeTransform(layout, W, H, view, area, s.tipCount, FAN);
  const list = new DrawList();
  const r = searchCut(projectionFor(s, L, T), classOf, list, seen, { lod: true, base: 3, cap: Infinity, budget, summaries: true, hint: 0 });
  const entries = [];
  for (let e = 0; e < list.count; e++) entries.push(list.node[e], list.kind[e], list.cls[e], list.last[e], list.xmax[e]);
  return { res: r.res, minPx: r.minPx, retries: r.retries, entries };
}

test('Seen memo: the cut is the same as with a plain set of keys, on random trees and caterpillars', () => {
  const r = rng(20261028);
  const trees = [
    ['caterpillar tip first', caterpillar(10000, true, r, true)],
    ['caterpillar spine first', caterpillar(10000, false, r, true)],
    ['caterpillar no lengths', caterpillar(5000, true, r, false)],
    ['binary', randomTree(5000, r, false)],
    ['polytomies', randomTree(5000, r, true)],
  ];
  for (const [name, nwk] of trees) {
    const s = new InMemorySource(parseNewick(nwk)).snapshot();
    const L = computeLayout(s, true);
    setLayoutFan(L, FAN);
    ensureTrig(L);
    const classOf = name === 'polytomies' ? Uint8Array.from({ length: s.nodeCount }, () => (r() < 0.9 ? 0 : 1)) : null;
    for (const layout of ['rectangular', 'radial'])
      for (const [vname, v] of Object.entries(VIEWS[layout]))
        for (const budget of [20000, 400, 40]) {
          const view = v(s.tipCount);
          const a = runCut(s, L, classOf, layout, view, budget, new Seen());
          const b = runCut(s, L, classOf, layout, view, budget, new PlainSeen());
          assert.deepEqual(a, b, `${name} ${layout} ${vname} budget ${budget}`);
        }
  }
});
