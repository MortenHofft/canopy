// The collapse threshold never exceeds the tip pitch once rows are 1 px tall (rectangular, #113) or tips have dots (radial, #109): a
// clade or a run of tips next to such tips is not folded, whatever minCladePx says. Below that minCladePx applies as before, and the
// budget still raises the threshold when it must, past the cap.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeViewer, destroyAll } from './viewer-harness.mjs';

afterEach(destroyAll);

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const core = path.join(root, 'packages/viewer/src');
const { collapseCap, TIP_DOT_PX, RECT_CAP_MIN_PX } = await import(path.join(core, 'sizes.ts'));
const { InMemorySource } = await import(path.join(core, 'source.ts'));
const { parseNewick } = await import(path.join(root, 'packages/io/src/newick.ts'));
const { computeLayout, ensureTrig } = await import(path.join(core, 'layout.ts'));
const { makeTransform } = await import(path.join(core, 'geom.ts'));
const { projectionFor } = await import(path.join(core, 'projection.ts'));
const { DrawList, Seen, searchCut } = await import(path.join(core, 'lod.ts'));

// one-tip genera (single-tip clades under a node of their own), cherries and 30-tip polytomies under one root; all tips at depth 1.5, so
// that in the radial layout every tip is on the outermost ring (its arc is the tip pitch)
const tips = (q, n) => Array.from({ length: n }, (_, i) => `${q}${i}:1.5`).join(',');
const NWK = `(${tips('p', 30)},(s1:1):0.5,(c0:1,c1:1):0.5,(s2:1):0.5,${tips('q', 30)},(s3:1):0.5,(d0:1,d1:1):0.5);`;
const MIN = 14;

/** The last frame's stats of a 400 x 300 viewer; `view` (rectangular) sets the window in rows. */
async function frameAt(layout, minCladePx, rows, nwk = NWK) {
  const { viewer, env } = await makeViewer(nwk, { options: { layout, minCladePx, refineMs: 0 }, size: [400, 300] });
  env.flush();
  let st;
  viewer.on('frame', (s) => (st = s));
  if (rows) {
    const v = viewer.getViewport();
    viewer.setViewport({ x0: v.x0, x1: v.x1, y0: 0, y1: rows });
  }
  viewer.invalidate();
  env.flush();
  return { ...st, pitch: viewer.proj.tipPitch };
}

test('collapseCap: the tip pitch from 1 px rows (rectangular) or the dot size (radial) up, none below', () => {
  assert.equal(RECT_CAP_MIN_PX, 1);
  assert.equal(collapseCap(RECT_CAP_MIN_PX - 0.01, true, true), Infinity);
  assert.equal(collapseCap(TIP_DOT_PX - 0.01, true, false), Infinity);
  for (const [pitch, rect] of [
    [RECT_CAP_MIN_PX, true],
    [TIP_DOT_PX, false],
    [13.5, true],
    [13.5, false],
  ]) {
    const c = collapseCap(pitch, true, rect);
    assert.ok(c < pitch && Math.abs(c - pitch) < 2e-3, `a hair under the pitch ${pitch}: ${c}`);
  }
  assert.equal(collapseCap(13.5, false, true), Infinity, 'none with the level of detail off');
  assert.equal(collapseCap(13.5, false, false), Infinity);
});

test('rectangular: rows of 1 to 6 px with minCladePx 14 fold nothing, and the threshold is the row height', async () => {
  for (const px of [1.2, 1.5, 2, 3, 4.5, 6]) {
    const st = await frameAt('rectangular', MIN, 255 / px, balanced(1024));
    assert.ok(Math.abs(st.pitch - px) < 0.1 * px, `${px} px rows: pitch ${st.pitch}`);
    assert.equal(st.summaries, 0, `${px} px rows`);
    assert.ok(st.minPxUsed < MIN && st.minPxUsed >= st.pitch * 0.99, `${px} px rows: minPxUsed ${st.minPxUsed}`);
    assert.equal(st.budgetHit, false);
  }
});

test('rectangular: rows of exactly 1.0 px fold nothing, rows of 0.99 px fold by minCladePx', async () => {
  const nwk = balanced(1024);
  const at = async (px) => {
    const { viewer, env } = await makeViewer(nwk, { options: { layout: 'rectangular', minCladePx: MIN, refineMs: 0 }, size: [400, 300] });
    env.flush();
    let st;
    viewer.on('frame', (s) => (st = s));
    // the window that gives the pitch `px`: scale the fitted window's height by the pitch it gave
    const v = viewer.getViewport();
    const p0 = viewer.proj.tipPitch;
    viewer.setViewport({ x0: v.x0, x1: v.x1, y0: v.y0, y1: v.y0 + (v.y1 - v.y0) * (p0 / px) });
    viewer.invalidate();
    env.flush();
    return { ...st, pitch: viewer.proj.tipPitch };
  };
  const one = await at(1);
  assert.ok(Math.abs(one.pitch - 1) < 1e-6, `pitch ${one.pitch}`);
  assert.equal(one.summaries, 0);
  assert.ok(one.minPxUsed < 1.0001, `minPxUsed ${one.minPxUsed}`);
  const below = await at(0.99);
  assert.ok(Math.abs(below.pitch - 0.99) < 1e-6, `pitch ${below.pitch}`);
  assert.equal(below.minPxUsed, MIN);
  assert.ok(below.summaries > 0);
});

test('rectangular: zooming from rows under 1 px to 1 px or more takes a couple of passes, not a walk down the ladder', async () => {
  const { viewer, env } = await makeViewer(balanced(1024), { options: { layout: 'rectangular', minCladePx: MIN, refineMs: 0 }, size: [400, 300] });
  env.flush();
  const frames = [];
  viewer.on('frame', (s) => frames.push({ ...s, pitch: viewer.proj.tipPitch }));
  const v = viewer.getViewport();
  const p0 = viewer.proj.tipPitch;
  const zoomTo = (px) => {
    viewer.setViewport({ x0: v.x0, x1: v.x1, y0: v.y0, y1: v.y0 + (v.y1 - v.y0) * (p0 / px) });
    viewer.invalidate();
    env.flush();
    return frames[frames.length - 1];
  };
  for (const [from, to] of [
    [0.99, 1.01],
    [0.999, 1.0],
  ]) {
    zoomTo(from);
    const f = zoomTo(to);
    assert.ok(f.pitch >= 1 && f.minPxUsed < MIN, `pitch ${f.pitch}, minPxUsed ${f.minPxUsed}`);
    assert.ok(f.budgetRetries <= 2, `${from} to ${to}: ${f.budgetRetries} retries`);
  }
});

test('rectangular: rows of about 10 px with minCladePx 14 fold nothing, and the threshold reported is the capped one', async () => {
  const st = await frameAt('rectangular', MIN, 30);
  assert.equal(st.summaries, 0);
  assert.ok(st.minPxUsed < MIN && st.minPxUsed >= TIP_DOT_PX, `minPxUsed ${st.minPxUsed}`);
  assert.equal(st.budgetHit, false);
});

test('rectangular: rows under 1 px still fold by minCladePx, as before', async () => {
  // rows under 1 px: minCladePx applies as before
  const st = await frameAt('rectangular', MIN, 0, balanced(1024)); // the whole tree: 0.3 px rows
  assert.ok(st.pitch < 1, `pitch ${st.pitch}`);
  assert.equal(st.minPxUsed, MIN);
  assert.ok(st.summaries > 0);
});

test('radial: pitches of 2 to 5 px still fold by minCladePx, as before', async () => {
  for (const size of [60, 100, 160]) {
    const { viewer, env } = await makeViewer(NWK, { options: { layout: 'radial', minCladePx: MIN, refineMs: 0 }, size: [size, size] });
    env.flush();
    const st = viewer.getStats();
    assert.ok(viewer.proj.tipPitch < TIP_DOT_PX && viewer.proj.tipPitch >= 1, `pitch ${viewer.proj.tipPitch}`);
    assert.equal(st.minPxUsed, MIN);
    assert.ok(st.summaries > 0);
  }
});

test('radial: a minCladePx far above the tip pitch is capped at it and nothing folds', async () => {
  const st = await frameAt('radial', 200);
  assert.ok(st.minPxUsed < 200, `minPxUsed ${st.minPxUsed}`);
  assert.equal(st.summaries, 0);
});

// ---- searchCut on its own

function balanced(n) {
  const go = (m, p) => (m === 1 ? `${p}:1` : `(${go(m / 2, p + 'a')},${go(m / 2, p + 'b')}):1`);
  return go(n, 't') + ';';
}
const tree = new InMemorySource(parseNewick(balanced(512))).snapshot();
const L = computeLayout(tree, true);
ensureTrig(L);
const area = { ax: 0, ay: 0, aw: 600, ah: 400, clipL: 0, clipT: 0, clipR: 600, clipB: 400 };
const proj = projectionFor(tree, L, makeTransform('rectangular', 600, 400, { x0: 0, x1: 1, y0: 0, y1: 512 }, area, 512));
const run = (o) => {
  const list = new DrawList();
  return { ...searchCut(proj, null, list, new Seen(), { lod: true, base: 3, budget: 100, summaries: true, hint: 0, ...o }), list };
};

test('searchCut: when the list overflows at the cap the ladder goes on past it, folding instead of truncating', () => {
  const capped = run({ cap: 6 });
  const free = run({ cap: Infinity });
  assert.ok(capped.minPx > 6, `climbed past the cap: ${capped.minPx}`);
  assert.equal(capped.res.overflow, false);
  assert.ok(capped.list.count <= 100);
  assert.ok(capped.minPx >= free.minPx, 'never lower than where an uncapped search lands');
  assert.ok(capped.res.summaries > 0);
});

test('searchCut: a small budget climbs past a 1 px cap', () => {
  const r = run({ cap: 1, budget: 100 });
  assert.ok(r.minPx > 1 && r.res.overflow === false && r.list.count <= 100, `minPx ${r.minPx}, ${r.list.count} entries`);
});

test('rectangular: rows of 2 px with a draw budget they do not fit in: the threshold climbs past the row height, folding', async () => {
  const { viewer, env } = await makeViewer(balanced(4096), {
    options: { layout: 'rectangular', minCladePx: MIN, drawBudget: 500, refineMs: 0 },
    size: [400, 600],
  });
  env.flush();
  const v = viewer.getViewport();
  viewer.setViewport({ x0: v.x0, x1: v.x1, y0: 0, y1: 300 });
  viewer.invalidate();
  env.flush();
  const st = viewer.getStats();
  assert.ok(viewer.proj.tipPitch >= 1, `pitch ${viewer.proj.tipPitch}`);
  assert.ok(st.minPxUsed > viewer.proj.tipPitch && st.budgetHit && st.summaries > 0, `minPxUsed ${st.minPxUsed}, summaries ${st.summaries}`);
  assert.equal(st.truncated, false);
});

test('searchCut: a cap below the base does not lower the base', () => {
  assert.equal(run({ budget: 1e6, cap: 1 }).minPx, 3);
});

// ---- the viewer: the budget still wins, in both layouts

test('radial, 128 tips in 900 x 900 (tips far apart) with radialMaxNodes 100: folded to fit the budget, not truncated', async () => {
  const { viewer, env } = await makeViewer(balanced(128), { options: { layout: 'radial', radialMaxNodes: 100, refineMs: 0 }, size: [900, 900] });
  env.flush();
  const st = viewer.getStats();
  assert.ok(viewer.proj.tipPitch >= TIP_DOT_PX, `tips have room for dots (${viewer.proj.tipPitch})`);
  assert.equal(st.truncated, false);
  assert.ok(st.drawn <= 100 && st.summaries > 0, `${st.drawn} drawn, ${st.summaries} summaries`);
  assert.ok(st.minPxUsed > viewer.proj.tipPitch, 'the budget raised the threshold past the pitch');
  assert.equal(st.budgetHit, true);
});

test('interactionLOD: the reduced base (minCladePx x 1.6) is capped at the tip pitch too', async () => {
  // 600 tips on a 1600 px circle: tips 7.8 px apart, more than 1000 entries, so the next reduced frame uses the x 1.6 base (9.6 px)
  const { viewer, env } = await makeViewer(balanced(512), {
    options: { layout: 'radial', radialMaxNodes: Infinity, minCladePx: 6, interactionLOD: true, refineMs: 0 },
    size: [1600, 1600],
  });
  env.flush();
  const full = viewer.getStats();
  assert.ok(full.drawn > 1000 && viewer.proj.tipPitch > 6, `heavy full frame: ${full.drawn} drawn, pitch ${viewer.proj.tipPitch}`);
  assert.ok(full.minPxUsed < viewer.proj.tipPitch);
  const seen = [];
  viewer.on('frame', (s) => seen.push({ reduced: s.reduced, minPxUsed: s.minPxUsed, pitch: viewer.proj.tipPitch, summaries: s.summaries }));
  const v = viewer.getViewport();
  viewer.setViewport({ x0: v.x0 * 0.99, x1: v.x1 * 0.99, y0: v.y0 * 0.99, y1: v.y1 * 0.99 }, true); // a small animated zoom: the pitch stays near 7.8
  for (let k = 0; k < 4; k++) env.frame();
  const reduced = seen.filter((f) => f.reduced);
  assert.ok(reduced.length > 0, 'a reduced frame was drawn');
  for (const f of reduced) {
    assert.ok(f.minPxUsed <= f.pitch, `reduced frame: threshold ${f.minPxUsed} within the pitch ${f.pitch}`);
    assert.equal(f.summaries, 0);
  }
});
