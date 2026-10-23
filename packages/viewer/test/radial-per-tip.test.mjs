// Radial: tip dots, labels and folding are decided per tip, from the arc at the tip's own radius (#110). Every tip has the angle `da`, so the
// room between neighbours is `da` times the tip's radius: a tip on a short branch has less than one on the outer ring.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeViewer, destroyAll } from './viewer-harness.mjs';

afterEach(destroyAll);

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const core = path.join(root, 'packages/viewer/src');
const { TIP_DOT_PX, collapseCap, labelMinPx } = await import(path.join(core, 'sizes.ts'));
const { InMemorySource } = await import(path.join(core, 'source.ts'));
const { parseNewick } = await import(path.join(root, 'packages/io/src/newick.ts'));
const { computeLayout, ensureTrig, radialFan, setLayoutFan } = await import(path.join(core, 'layout.ts'));
const { makeTransform } = await import(path.join(core, 'geom.ts'));
const { projectionFor, tipDotRadius } = await import(path.join(core, 'projection.ts'));
const { DrawList, Seen, searchCut, K_TIP, K_SUMMARY } = await import(path.join(core, 'lod.ts'));
const { DEFAULT_OPTIONS } = await import(path.join(core, 'types.ts'));
const { wedgeLimitPx, MAX_WEDGE_DEG } = await import(path.join(core, 'budget.ts'));

/** `groups` groups of three tips under the root, at depth 1 (a), 0.5 (b) and 0.3 (c): three radii in the same tree. */
function threeDepths(groups) {
  const g = [];
  for (let i = 0; i < groups; i++) g.push(`(a${i}:1,b${i}:0.5,c${i}:0.3):0.001`);
  return `(${g.join(',')});`;
}

async function frame(nwk, options = {}, size = [400, 400]) {
  const { viewer, env, ctx } = await makeViewer(nwk, { options: { layout: 'radial', refineMs: 0, ...options }, size });
  env.flush();
  ctx().reset();
  viewer.invalidate();
  env.flush();
  return { viewer, env, ctx: ctx() };
}

/** The tip dots drawn: the full circles of drawMarkers, as the distance of each from the root (px). */
function dotRadii(viewer, ctx) {
  const { cx, cy } = viewer.proj.T;
  return ctx
    .calls('arc')
    .filter((e) => e[5] === 6.2832)
    .map((e) => Math.hypot(e[1] - cx, e[2] - cy));
}

test('two depths: dots and labels only on the tips whose own arc has room', async () => {
  const { viewer, ctx } = await frame(threeDepths(20));
  const { T } = viewer.proj;
  const ring = viewer.proj.L.XMAX[0] * T.k;
  const need = labelMinPx(viewer.opts.labelDensity, viewer.theme.labelSize);
  const arc = (x) => T.da * x * ring; // a tip at depth x * the outer ring
  assert.ok(arc(1) >= need && arc(0.5) >= TIP_DOT_PX && arc(0.5) < need && arc(0.3) < TIP_DOT_PX, 'premise: the three depths fall in three bands');
  const dots = dotRadii(viewer, ctx);
  assert.equal(dots.length, 40, 'a dot on the 20 a tips and the 20 b tips, none on the c tips');
  for (const r of dots) assert.ok(r > 0.4 * ring, `a dot at ${r.toFixed(1)} px, nearer than the b tips`);
  const texts = ctx.calls('fillText').map((e) => e[1]);
  assert.equal(texts.filter((t) => /^a\d/.test(t)).length, 20, 'every a tip is labelled');
  assert.equal(texts.filter((t) => /^[bc]\d/.test(t)).length, 0, 'no b or c tip is');
});

test('the same tree zoomed out: no tip has room, so no dots and no labels', async () => {
  const { viewer, ctx } = await frame(threeDepths(20), {}, [90, 90]);
  assert.ok(viewer.proj.tipPitch < TIP_DOT_PX, 'premise: the outer ring has under 6 px between tips');
  assert.equal(dotRadii(viewer, ctx).length, 0);
  assert.equal(ctx.calls('fillText').filter((e) => /^[abc]\d/.test(e[1])).length, 0);
});

test('minTipDepth: all in view, none in view, or the radius to test tips against', async () => {
  const { viewer, env } = await frame(threeDepths(20));
  const proj = viewer.proj;
  const { T } = proj;
  const ring = proj.L.XMAX[0] * T.k;
  assert.equal(proj.minTipDepth(T.da * ring * 1.01), Infinity, 'more room than the outer ring has: none');
  assert.ok(Math.abs(proj.minTipDepth(T.da * ring) - ring) < 1e-6, 'exactly the outer ring: the tips on it are tested');
  const mid = proj.minTipDepth(TIP_DOT_PX);
  assert.ok(mid > 0 && mid < ring && Math.abs(mid - TIP_DOT_PX / T.da) < 1e-9, 'between the centre and the ring: test per tip');
  assert.equal(proj.minTipDepth(0), -Infinity, 'no room needed: all pass');
  // zoomed so the root is far outside the view: the nearest radius of the view is the ring's, and every tip in view passes
  const v = viewer.getViewport();
  viewer.setViewport({ x0: v.x1 * 0.55, x1: v.x1 * 0.85, y0: -0.15 * v.x1, y1: 0.15 * v.x1 });
  viewer.invalidate();
  env.flush();
  const p2 = viewer.proj;
  assert.ok(p2.rMin > 0, 'premise: the root is out of view');
  assert.equal(p2.minTipDepth(TIP_DOT_PX), -Infinity, 'the nearest visible radius already has the room');
});

test('rectangular: minTipDepth is the row height against the need, for every tip', async () => {
  const { viewer, env } = await makeViewer(threeDepths(20), { options: { layout: 'rectangular', refineMs: 0 }, size: [400, 400] });
  env.flush();
  const p = viewer.proj;
  assert.equal(p.minTipDepth(p.tipPitch * 0.99), -Infinity);
  assert.equal(p.minTipDepth(p.tipPitch * 1.01), Infinity);
  assert.equal(tipDotRadius(p), Infinity, 'no clade is kept open by a dot in rectangular');
});

test('hit testing: a dot is hittable on the tips that have one, not on the c tips', async () => {
  const { viewer } = await frame(threeDepths(20));
  const proj = viewer.proj;
  const t = proj.tree;
  const at = { a: null, c: null };
  for (let i = 0; i < t.nodeCount; i++)
    if (t.childCount[i] === 0) {
      const name = t.tipLabels[t.tipRank[i]];
      if (name === 'a3') at.a = i;
      if (name === 'c3') at.c = i;
    }
  const p = { x: 0, y: 0 };
  proj.nodeXY(at.a, p);
  assert.deepEqual(viewer.hitTest(p.x, p.y), { node: at.a, kind: 'tip' });
  proj.nodeXY(at.c, p);
  const h = viewer.hitTest(p.x, p.y);
  assert.ok(h === null || h.kind !== 'tip', 'no dot on the c tip');
});

// ---- folding

const FAN = radialFan(DEFAULT_OPTIONS.radialOpening, DEFAULT_OPTIONS.radialRotation);

/** The cut of `nwk` at the full view of a 400 x 400 radial canvas with the viewer's cap for minCladePx `min`; `protect` passes the dot radius. */
function cutOf(nwk, min, protect, budget = 20000, wedgeLimited = false) {
  const snap = new InMemorySource(parseNewick(nwk)).snapshot();
  const L = computeLayout(snap, true);
  setLayoutFan(L, FAN);
  ensureTrig(L);
  const N = snap.tipCount;
  const area = { ax: 0, ay: 0, aw: 400, ah: 400, clipL: 0, clipT: 0, clipR: 400, clipB: 400 };
  const T = makeTransform('radial', 400, 400, { x0: -1.05, x1: 1.05, y0: -1.05, y1: 1.05 }, area, N, FAN);
  const proj = projectionFor(snap, L, T);
  const cap = collapseCap(proj.tipPitch, true, false);
  const base = Math.min(cap, min);
  const list = new DrawList();
  const r = searchCut(proj, null, list, new Seen(), {
    lod: true,
    base,
    cap,
    budget,
    summaries: true,
    hint: 0,
    dotR: protect ? tipDotRadius(proj) : Infinity,
    // the adaptive budget's wedge limit: the px of 4 degrees at the outer ring bounds the ladder, 4 degrees bounds every clade
    limit: wedgeLimited ? wedgeLimitPx(L.XMAX[0] * T.k) : Infinity,
    wedge: wedgeLimited ? (MAX_WEDGE_DEG * Math.PI) / 180 : Infinity,
    hardBudget: budget * 10,
  });
  const kinds = [];
  for (let e = 0; e < list.count; e++) kinds.push([list.node[e], list.kind[e]]);
  return { proj, r, list, kinds, snap, cap };
}

/** Groups of three tips on short branches (0.2, a dot each, but a clade whose arc is under the cap) next to groups on long ones (1). */
function shortAndLong(groups) {
  const g = [];
  for (let i = 0; i < groups; i++) {
    const d = i % 2 ? 1 : 0.2;
    g.push(`(x${i}:${d},y${i}:${d},z${i}:${d}):0.001`);
  }
  return `(${g.join(',')});`;
}

test('a clade with a tip that would get a dot is not folded, at any threshold up to the cap', () => {
  const nwk = shortAndLong(8);
  const old = cutOf(nwk, 40, false);
  const now = cutOf(nwk, 40, true);
  const { proj } = now;
  assert.ok(proj.tipPitch >= 40, 'premise: the outer ring has room for the threshold');
  assert.ok(proj.T.da * 0.2 * proj.L.XMAX[0] * proj.T.k >= TIP_DOT_PX, 'premise: the short clades have a tip with a dot');
  assert.ok(old.r.res.summaries > 0, 'without the protection the short clades fold under minCladePx 40 (3 rows of ~10 px)');
  assert.equal(now.r.res.summaries, 0, 'with it nothing folds');
  assert.equal(now.r.res.forced, 0);
  assert.equal(now.r.res.tips, 24);
});

test('a clade whose tips are all too close for dots still folds', () => {
  const g = [];
  for (let i = 0; i < 20; i++) g.push(`(x${i}:0.05,y${i}:0.05,z${i}:0.05):0.001`, `(p${i}:1,q${i}:1):0.001`);
  const nwk = `(${g.join(',')});`;
  const now = cutOf(nwk, 40, true);
  assert.ok(now.proj.tipPitch >= TIP_DOT_PX, 'premise: tips on the outer ring have dots');
  const folded = now.kinds.filter(([, k]) => k === K_SUMMARY).length;
  assert.ok(folded > 0, 'the clades at 5% of the radius have no room for a dot and fold');
  for (const [i, k] of now.kinds)
    if (k === K_SUMMARY) assert.ok(now.proj.L.XMAX[i] * now.proj.T.k * now.proj.T.da < TIP_DOT_PX, 'only a clade without a dotted tip folds');
});

test('the budget still folds a clade with a dotted tip: past the cap the protection is off, and the list fits', () => {
  const nwk = shortAndLong(40);
  const now = cutOf(nwk, 40, true, 60);
  assert.equal(now.r.res.overflow, false, 'the list fits the budget');
  assert.ok(now.list.count <= 60);
  assert.ok(now.r.res.summaries > 0, 'something folded for the budget');
  assert.ok(now.r.res.forced > 0, 'and the cut says it was forced');
  assert.ok(now.r.minPx > now.cap, 'the threshold went past the cap');
});

test('an ultrametric tree is cut as before: every tip is on the outer ring', () => {
  const g = [];
  for (let i = 0; i < 30; i++) g.push(`(a${i}:1,b${i}:1,c${i}:1):0.001`);
  const nwk = `(${g.join(',')});`;
  for (const budget of [20000, 40]) {
    const a = cutOf(nwk, 14, false, budget);
    const b = cutOf(nwk, 14, true, budget);
    assert.deepEqual(b.kinds, a.kinds);
    assert.deepEqual(b.r.res, a.r.res);
    assert.equal(b.r.minPx, a.r.minPx);
  }
});

test('a run of tips (rule R) is broken where a tip has room for a dot', () => {
  // a star of 60 tips at mixed lengths under the root: tips at 1 have dots at this size, tips at 0.02 do not
  const kids = [];
  for (let i = 0; i < 60; i++) kids.push(`t${i}:${i % 3 === 0 ? 1 : 0.02}`);
  const now = cutOf(`(${kids.join(',')});`, 40, true);
  const tipsDrawn = now.kinds.filter(([, k]) => k === K_TIP).map(([i]) => i);
  const L = now.proj.L;
  const long = now.snap.nodeCount;
  let longTips = 0;
  for (let i = 1; i < long; i++)
    if (now.snap.childCount[i] === 0 && L.X[i] > 0.9) {
      longTips++;
      assert.ok(tipsDrawn.includes(i), 'a tip with a dot is its own entry, not part of a slice');
    }
  assert.equal(longTips, 20);
});

test('the wedge limit is per clade: a clade ending at half the radius is not folded to a wedge over 4 degrees', () => {
  // 50 clades of 20 tips at half the radius, and one tip at the outer ring: 1000 tips round the circle, a clade is about 6.9 degrees
  const g = [];
  for (let i = 0; i < 50; i++) {
    const t = Array.from({ length: 20 }, (_, j) => `u${i}_${j}:0.5`);
    g.push(`(${t.join(',')}):0.001`);
  }
  const nwk = `(${g.join(',')},far:1);`;
  const free = cutOf(nwk, 14, true, 20000, false);
  const lim = cutOf(nwk, 14, true, 20000, true);
  const wide = (c) => {
    const { L } = c.proj;
    const rad = (MAX_WEDGE_DEG * Math.PI) / 180;
    let n = 0;
    for (const [i, k] of c.kinds) if (k === K_SUMMARY && (L.rowEnd[i] - L.rowStart[i]) * c.proj.T.da >= rad) n++;
    return n;
  };
  assert.ok(wide(free) > 0, 'premise: by arc in px (11 px under 14) the clades fold into wedges of about 7 degrees');
  assert.equal(wide(lim), 0, 'with the limit no folded clade is 4 degrees or wider');
  assert.ok(lim.r.res.summaries > 0, 'the narrower clades inside them still fold');
});
