// Golden test of the viewport cut (src/core/lod.ts) and of the summary rules draw and hit apply on top of the projection's extents.
//
// The goldens in cut-golden.json (full draw list: node, kind, cls, last, xmax per entry; the whole CutResult; the threshold and the number
// of retries) were captured from the code at commit e2897fb (the cut before it was moved behind the layout projection), by running the cases
// of cut-golden-cases.mjs through that commit's searchCut (rectangular and radial loops, as they were) with options { lod: true, base,
// budget, summaries: true, hint: 0 }. So a failure here means the cut no longer produces what it produced then. To recapture on purpose
// (a deliberate change of the cut): `node --experimental-transform-types scripts/capture-cut-golden.mjs`, which writes the JSON from the
// current code in the same layout (one case per line); on the unchanged cut it reproduces the committed file byte for byte once formatted
// by Prettier.
//
// The radial cases were recaptured on purpose for issue #41 (the radial layout leaves an opening, radialOpening 0.05 with the opening at
// the bottom, radialRotation 90): they use the default fan of the options. The same radial cases on the whole circle from 3 o'clock
// (radialFan(0, 0)) must still give exactly the e2897fb draw lists: cut-golden-circle.json holds their hashes, computed from the
// cut-golden.json entries as they were before the recapture.
//
// The cases cover: a comb, a balanced tree with thin cherries (collapsed by height only since #87), a random tree, polytomies (runs of small siblings between larger
// children, a class change and a parent change in the middle of a run), a snapshot with stubs, a view that cuts the tree at the right edge
// (clades whose node lies beyond the clip edge), sub-pixel pans, and budgets small enough to raise the threshold (`forced`).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..', '..', '..');
const { parseNewick } = await import(path.join(root, 'packages/io/src/newick.ts'));
const core = path.join(root, 'packages/viewer/src');
const { computeLayout, ensureTrig, radialFan, setLayoutFan } = await import(path.join(core, 'layout.ts'));
const { makeTransform } = await import(path.join(core, 'geom.ts'));
const { DrawList, Seen, searchCut, K_SUMMARY } = await import(path.join(core, 'lod.ts'));
const { InMemorySource } = await import(path.join(core, 'source.ts'));
const { projectionFor } = await import(path.join(core, 'projection.ts'));
const { drawBody } = await import(path.join(core, 'draw.ts'));
const { HitIndex } = await import(path.join(core, 'hit.ts'));
const { FALLBACK_THEME, DEFAULT_OPTIONS } = await import(path.join(core, 'types.ts'));
const { W, H, TREES, VIEWS, allCases, cappedCases } = await import(path.join(here, 'cut-golden-cases.mjs'));
const golden = JSON.parse(fs.readFileSync(path.join(here, 'cut-golden.json'), 'utf8'));
const goldenCap = JSON.parse(fs.readFileSync(path.join(here, 'cut-golden-cap.json'), 'utf8'));
const { collapseCap } = await import(path.join(core, 'sizes.ts'));
const goldenCircle = JSON.parse(fs.readFileSync(path.join(here, 'cut-golden-circle.json'), 'utf8'));
const FAN = radialFan(DEFAULT_OPTIONS.radialOpening, DEFAULT_OPTIONS.radialRotation);
const CIRCLE = radialFan(0, 0);
const area = { ax: 0, ay: 0, aw: W, ah: H, clipL: 0, clipT: 0, clipR: W, clipB: H };

/** A snapshot with stubs is a snapshot whose `stub` array marks rows standing for clades that are not loaded. */
function build(spec) {
  const snap = new InMemorySource(parseNewick(spec.nwk)).snapshot();
  let s = snap;
  if (spec.stubs) {
    const stub = new Uint8Array(snap.nodeCount);
    for (let i = 0; i < snap.nodeCount; i++) if (spec.stubs(i, snap.childCount[i])) stub[i] = 1;
    s = Object.create(snap);
    Object.defineProperty(s, 'stub', { value: stub });
  }
  const L = computeLayout(s, true);
  const classOf = spec.classes ? Uint8Array.from({ length: s.nodeCount }, (_, i) => spec.classes(i)) : null;
  return { s, L, classOf };
}
const built = Object.fromEntries(Object.entries(TREES).map(([name, spec]) => [name, build(spec)]));

test('the golden file covers every case', () => {
  assert.deepEqual(
    Object.keys(golden).sort(),
    allCases()
      .map((c) => c.id)
      .sort(),
  );
});

function runCase(c, fan) {
  const { s, L, classOf } = built[c.tree];
  const N = s.tipCount;
  setLayoutFan(L, fan);
  ensureTrig(L);
  const T = makeTransform(c.layout, W, H, VIEWS[c.layout][c.view](N), area, N, fan);
  const list = new DrawList();
  const r = searchCut(projectionFor(s, L, T), classOf, list, new Seen(), {
    lod: true,
    base: c.opts.base,
    budget: c.opts.budget,
    summaries: true,
    hint: 0,
    cap: Infinity,
  });
  const entries = [];
  for (let e = 0; e < list.count; e++) entries.push(list.node[e], list.kind[e], list.cls[e], list.last[e], list.xmax[e]);
  return { res: r.res, minPx: r.minPx, retries: r.retries, entries };
}

// the cut with the collapse cap the viewer computes (#109, #113): rectangular rows of 0.9, 1, 2 and 6 px, radial pitches under and over 6 px
test('the cap golden file covers every capped case', () => {
  assert.deepEqual(
    Object.keys(goldenCap).sort(),
    cappedCases()
      .map((c) => c.id)
      .sort(),
  );
});

for (const c of cappedCases()) {
  test(`cut golden, capped: ${c.id}`, () => {
    const { s, L, classOf } = built[c.tree];
    setLayoutFan(L, FAN);
    ensureTrig(L);
    const proj = projectionFor(s, L, makeTransform(c.layout, W, H, c.view, area, s.tipCount, FAN));
    const cap = collapseCap(proj.tipPitch, true, c.layout === 'rectangular');
    const list = new DrawList();
    const r = searchCut(proj, classOf, list, new Seen(), { lod: true, base: Math.min(cap, 14), budget: c.budget, summaries: true, hint: 0, cap });
    const g = goldenCap[c.id];
    assert.deepEqual(r.res, g.res, 'CutResult');
    assert.equal(r.minPx, g.minPx, 'threshold');
    assert.equal(r.retries, g.retries, 'retries');
    assert.ok(list.count <= c.budget, 'within the budget');
    assert.equal(list.count * 5, g.entries.length, 'draw list length');
    for (let e = 0; e < list.count; e++)
      assert.deepEqual([list.node[e], list.kind[e], list.cls[e], list.last[e], list.xmax[e]], g.entries.slice(e * 5, e * 5 + 5), `entry ${e}`);
  });
}

for (const c of allCases()) {
  test(`cut golden: ${c.id}`, () => {
    const r = runCase(c, FAN);
    const g = golden[c.id];
    assert.deepEqual(r.res, g.res, 'CutResult');
    assert.equal(r.minPx, g.minPx, 'threshold');
    assert.equal(r.retries, g.retries, 'retries');
    const got = r.entries;
    assert.equal(got.length, g.entries.length, `draw list length ${got.length / 5} entries, golden ${g.entries.length / 5}`);
    for (let k = 0; k < got.length; k++) assert.equal(got[k], g.entries[k], `entry ${(k / 5) | 0} field ${k % 5}`);
  });
}

test('the circle goldens cover every radial case', () => {
  assert.deepEqual(
    Object.keys(goldenCircle).sort(),
    allCases()
      .filter((c) => c.layout === 'radial')
      .map((c) => c.id)
      .sort(),
  );
});

for (const c of allCases().filter((c) => c.layout === 'radial'))
  test(`cut golden, whole circle (radialOpening 0, radialRotation 0): ${c.id}`, () => {
    const hash = createHash('sha256')
      .update(JSON.stringify(runCase(c, CIRCLE)))
      .digest('hex')
      .slice(0, 16);
    assert.equal(hash, goldenCircle[c.id], 'the draw list of the cut before the opening existed');
  });

// ---- the minimum sizes draw and hit give a summary (a clade a fraction of a pixel in size must stay visible and clickable)

/** (a:0.001,b:0.001) under a long branch, in a view so tall that the cherry is 0.4 px high and 0.3 px wide. */
function tinySummary(layout) {
  // radial needs many tips for the cherry's arc (at radius 100 px) to be under 1.5 px: 1,000 siblings
  const others = layout === 'rectangular' ? 'c:1' : Array.from({ length: 998 }, (_, k) => `c${k}:1`).join(',');
  const snap = new InMemorySource(parseNewick(`((a:0.001,b:0.001)ab:1,${others})r;`)).snapshot();
  const L = computeLayout(snap, true);
  ensureTrig(L);
  const N = snap.tipCount;
  const vp = layout === 'rectangular' ? { x0: 0, x1: 1, y0: 0, y1: 1000 } : { x0: -1.5, x1: 1.5, y0: -1, y1: 1 };
  const T = makeTransform(layout, W, H, vp, area, N);
  const proj = projectionFor(snap, L, T);
  const list = new DrawList();
  const i = 1; // the cherry
  list.push(i, K_SUMMARY, 0);
  return { snap, L, T, proj, list, i };
}
function recorder() {
  const calls = [];
  const ctx = new Proxy(
    {},
    {
      get:
        (_, k) =>
        (...a) => {
          calls.push([String(k), ...a]);
        },
      set: () => true,
    },
  );
  return { ctx, calls };
}
const scene = (proj, list) => ({ proj, list, theme: FALLBACK_THEME, colours: ['#000'], classOf: null, scale: 1, thin: false });

test('rectangular summary: drawn at least 2 px wide and 1.5 px tall', () => {
  const { proj, list, i } = tinySummary('rectangular');
  proj.summaryExtent(i, -1, 0);
  assert.ok(proj.d1 - proj.d0 < 2 && proj.t1 - proj.t0 < 1.5, 'the clade itself is smaller than the minimum');
  const { ctx, calls } = recorder();
  drawBody(ctx, scene(proj, list), 1);
  const tri = calls.filter(([k]) => k === 'moveTo' || k === 'lineTo').slice(-3); // apex, then the two base corners (after the branch segment)
  assert.equal(tri.length, 3);
  const [apex, c0, c1] = tri;
  assert.ok(Math.abs(c0[1] - apex[1] - 2) < 1e-9, `base is 2 px right of the apex, got ${c0[1] - apex[1]}`);
  assert.ok(Math.abs(c1[2] - c0[2] - 1.5) < 1e-9, `base is 1.5 px tall, got ${c1[2] - c0[2]}`);
});

test('radial summary: fan reaches at least 2 px from the apex and spans 1.5 px at its outer edge', () => {
  const { proj, list, i } = tinySummary('radial');
  proj.summaryExtent(i, -1, 0);
  assert.ok(proj.d1 - proj.d0 < 2 || (proj.t1 - proj.t0) * proj.d1 < 1.5, 'the clade itself is smaller than the minimum');
  const { ctx, calls } = recorder();
  drawBody(ctx, scene(proj, list), 1);
  const pts = calls.filter(([k]) => k === 'moveTo' || k === 'lineTo').slice(-3);
  const [apex, p0, p1] = pts;
  assert.ok(Math.hypot(p0[1] - apex[1], p0[2] - apex[2]) >= 2 - 1e-9, 'outer edge at least 2 px from the apex');
  assert.ok(Math.abs(Math.hypot(p1[1] - p0[1], p1[2] - p0[2]) - 1.5) < 1e-3, 'outer edge 1.5 px wide');
});

test('rectangular hit: a summary is clickable over the minimum 2 px width and 2 px height', () => {
  const { proj, list, i } = tinySummary('rectangular');
  const hit = new HitIndex();
  hit.build(list, proj);
  const p = { x: 0, y: 0 };
  proj.nodeXY(i, p);
  proj.summaryExtent(i, -1, 0);
  const xm = Math.max(proj.d0 + 2, proj.d1);
  // at the right end of the (widened) triangle and 3.5 px below its centre line: inside the 2 px minimum height plus the 2 px slack,
  // far outside the clade's real 0.3 x 0.4 px
  const h = hit.query(xm, p.y + 3.5, proj);
  assert.deepEqual(h, { node: i, kind: 'summary' });
  // and 3.9 px right of the apex: inside the 2 px minimum width plus the 2 px slack, far outside the clade's real 0.3 px
  assert.deepEqual(hit.query(proj.d0 + 3.9, p.y, proj), { node: i, kind: 'summary' });
  assert.equal(hit.query(xm + 5, p.y, proj), null, 'but not beyond the slack');
});
