// Unit tests of the layout projections (src/core/projection.ts), of the cut written once on top of them (src/core/lod.ts) and of
// the per-renderer text measurer (src/core/draw.ts): no module-level state is shared between instances.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const { parseNewick } = await import(path.join(root, 'spikes/shared/newick.ts'));
const { computeLayout } = await import(path.join(root, 'spikes/custom/src/core/layout.ts'));
const { InMemorySource } = await import(path.join(root, 'spikes/custom/src/core/source.ts'));
const { makeTransform } = await import(path.join(root, 'spikes/custom/src/core/geom.ts'));
const { projectionFor, RectProjection, RadialProjection } = await import(path.join(root, 'spikes/custom/src/core/projection.ts'));
const { cut, newCutResult, searchCut, DrawList, Seen, K_NODE, K_TIP } = await import(path.join(root, 'spikes/custom/src/core/lod.ts'));
const { TextMeasurer } = await import(path.join(root, 'spikes/custom/src/core/draw.ts'));

const NEWICK = '((A:1,B:2)AB:1,(C:1,(D:2,E:3)DE:1)CDE:2,F:4)root;';
const tree = new InMemorySource(parseNewick(NEWICK)).snapshot();
const L = computeLayout(tree, true);
const W = 600,
  H = 400;
const area = { ax: 0, ay: 0, aw: W, ah: H, clipL: 0, clipT: 0, clipR: W, clipB: H };
const N = tree.tipCount;
const rectT = makeTransform('rectangular', W, H, { x0: 0, x1: 1, y0: 0, y1: N }, area, N);
const k = 150;
const radialT = makeTransform('radial', W, H, { x0: -W / 2 / k, x1: W / 2 / k, y0: -H / 2 / k, y1: H / 2 / k }, area, N);

test('projectionFor chooses the projection from the transform kind', () => {
  assert.ok(projectionFor(tree, L, rectT) instanceof RectProjection);
  assert.ok(projectionFor(tree, L, radialT) instanceof RadialProjection);
});

test('node and parent positions follow the layout formulas', () => {
  const R = projectionFor(tree, L, rectT);
  const C = projectionFor(tree, L, radialT);
  const p = { x: 0, y: 0 },
    q = { x: 0, y: 0 };
  for (let i = 0; i < tree.nodeCount; i++) {
    R.nodeXY(i, p);
    assert.equal(p.x, rectT.ox + L.X[i] * rectT.kx);
    assert.equal(p.y, rectT.oy + L.ROW[i] * rectT.ky);
    R.parentXY(i, q);
    assert.equal(q.x, rectT.ox + L.X[i > 0 ? tree.parent[i] : i] * rectT.kx);
    assert.equal(q.y, p.y, 'a rectangular branch is horizontal');
    C.nodeXY(i, p);
    const a = L.ROW[i] * radialT.da;
    assert.ok(Math.abs(p.x - (radialT.cx + L.X[i] * radialT.k * Math.cos(a))) < 1e-9);
    assert.ok(Math.abs(p.y - (radialT.cy + L.X[i] * radialT.k * Math.sin(a))) < 1e-9);
    C.parentXY(i, q);
    const rp = L.X[i > 0 ? tree.parent[i] : i] * radialT.k;
    assert.ok(Math.abs(q.x - (radialT.cx + rp * Math.cos(a))) < 1e-9, 'a radial branch lies on the node ray');
  }
  C.parentXY(0, q);
  C.nodeXY(0, p);
  assert.deepEqual(q, p, 'the root has no branch: its parent end is the node itself');
});

test('summaryExtent: a plain summary starts at the node, a run at its parent', () => {
  for (const P of [projectionFor(tree, L, rectT), projectionFor(tree, L, radialT)]) {
    const i = 1; // the clade (A,B)
    P.summaryExtent(i, -1, 0);
    assert.equal(P.d0, P.depth(i));
    assert.ok(P.d1 >= P.d0);
    assert.ok(P.t1 > P.t0);
    const kids = [tree.firstChild[i]];
    for (let c = tree.nextSibling[kids[0]]; c >= 0; c = tree.nextSibling[c]) kids.push(c);
    P.summaryExtent(kids[0], kids[kids.length - 1], 0.9);
    assert.equal(P.d0, P.depth(i), 'a run spans from its parent');
    assert.ok(Math.abs(P.d1 - (P.depth(i) + (0.9 - L.X[i]) * (P.kind === 'rectangular' ? rectT.kx : radialT.k))) < 1e-9);
  }
});

test('the radial window belongs to the projection: the root inside it sees every angle, an off-screen root does not', () => {
  const inside = projectionFor(tree, L, radialT);
  assert.equal(inside.all, true);
  const away = makeTransform('radial', W, H, { x0: 1.5, x1: 1.5 + W / k, y0: -0.5, y1: -0.5 + H / k }, area, N);
  const off = projectionFor(tree, L, away);
  assert.equal(off.all, false);
  assert.equal(inside.all, true, 'building another projection did not change the first');
  assert.ok(off.rMin > 0 && off.rMax > off.rMin);
});

test('cut: LOD off emits every node; results are caller-owned and never shared', () => {
  for (const T of [rectT, radialT]) {
    const P = projectionFor(tree, L, T);
    const list = new DrawList(),
      seen = new Seen();
    const a = cut(P, { lod: false, minPx: 3, budget: 1e6, summaries: true }, null, list, seen, newCutResult());
    assert.equal(list.count, tree.nodeCount);
    assert.equal(a.tips, N);
    const kinds = Array.from({ length: list.count }, (_, e) => list.kind[e]);
    assert.equal(kinds.filter((x) => x === K_TIP).length, N);
    assert.equal(kinds.filter((x) => x === K_NODE).length, tree.nodeCount - N);
    // a second cut with a threshold that collapses everything must not touch the first result
    const before = { ...a };
    const small = new DrawList();
    const b = cut(P, { lod: true, minPx: 1e6, budget: 1e6, summaries: true }, null, small, seen, newCutResult());
    assert.notEqual(a, b);
    assert.deepEqual(a, before);
    assert.ok(b.visited <= a.visited);
  }
});

test('searchCut returns an independent result per call', () => {
  const list = new DrawList(),
    seen = new Seen();
  const o = { lod: true, base: 3, budget: 1000, summaries: true, hint: 0 };
  const r1 = searchCut(projectionFor(tree, L, radialT), null, list, seen, o);
  const snap = { ...r1.res };
  const r2 = searchCut(projectionFor(tree, L, rectT), null, list, seen, o);
  assert.notEqual(r1.res, r2.res);
  assert.deepEqual(r1.res, snap);
});

test('TextMeasurer: instances do not share a cache or clear each other', () => {
  let calls = 0;
  const ctx = {
    font: '',
    measureText(t) {
      calls++;
      return { width: t.length * 7 };
    },
  };
  const a = new TextMeasurer(),
    b = new TextMeasurer();
  assert.equal(a.width(ctx, 'Puma', '11px Serif'), 28);
  assert.equal(a.width(ctx, 'Puma', '11px Serif'), 28);
  assert.equal(calls, 1, 'second lookup is cached');
  assert.equal(b.width(ctx, 'Puma', '11px Mono'), 28);
  assert.equal(calls, 2, 'another instance has its own cache');
  assert.equal(a.width(ctx, 'Puma', '11px Serif'), 28);
  assert.equal(calls, 2, 'the other instance (another family) did not clear this one');
  assert.equal(a.width(ctx, 'Puma', '12px Serif'), 28);
  assert.equal(calls, 3, 'the size is part of the key');
  assert.equal(a.width(ctx, 'Puma', '12px Sans'), 28);
  assert.equal(a.width(ctx, 'Puma', '12px Serif'), 28);
  assert.equal(calls, 5, 'a family change clears the cache');
});
