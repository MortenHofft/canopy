// The collapse threshold never exceeds the tip pitch once tips have dots (#109): a clade or a run of tips next to tips drawn with
// dots and labels is not folded, whatever minCladePx says. Below the dot size minCladePx applies as before, and the budget still
// raises the threshold when it must, up to the cap.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeViewer, destroyAll } from './viewer-harness.mjs';

afterEach(destroyAll);

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const core = path.join(root, 'packages/viewer/src');
const { collapseCap, TIP_DOT_PX } = await import(path.join(core, 'sizes.ts'));
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
async function frameAt(layout, minCladePx, rows) {
  const { viewer, env } = await makeViewer(NWK, { options: { layout, minCladePx, refineMs: 0 }, size: [400, 300] });
  env.flush();
  let st;
  viewer.on('frame', (s) => (st = s));
  if (rows) {
    const v = viewer.getViewport();
    viewer.setViewport({ x0: v.x0, x1: v.x1, y0: 0, y1: rows });
  }
  viewer.invalidate();
  env.flush();
  return st;
}

test('collapseCap: the tip pitch from the dot size up, none below', () => {
  assert.equal(collapseCap(TIP_DOT_PX - 0.01), Infinity);
  assert.ok(Math.abs(collapseCap(TIP_DOT_PX) - TIP_DOT_PX) < 1e-3 && collapseCap(TIP_DOT_PX) < TIP_DOT_PX, 'a hair under the pitch');
  assert.ok(Math.abs(collapseCap(13.5) - 13.5) < 2e-3);
});

test('rectangular: rows of about 10 px with minCladePx 14 fold nothing, and the threshold reported is the capped one', async () => {
  const st = await frameAt('rectangular', MIN, 30);
  assert.equal(st.summaries, 0);
  assert.ok(st.minPxUsed < MIN && st.minPxUsed >= TIP_DOT_PX, `minPxUsed ${st.minPxUsed}`);
  assert.equal(st.budgetHit, false);
});

test('rectangular: without the cap the same view folds (the window is wide enough to see the old behaviour)', async () => {
  // rows of about 3 px, under the dot size: minCladePx applies as before
  const st = await frameAt('rectangular', MIN, 66 * 1.5);
  assert.equal(st.minPxUsed, MIN);
  assert.ok(st.summaries > 0);
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

test('searchCut: the budget raises the threshold up to the cap and not past it', () => {
  const free = run({});
  assert.ok(free.minPx > 6, 'without a cap the threshold climbs past 6');
  const capped = run({ cap: 6 });
  assert.equal(capped.minPx, 6);
  assert.ok(capped.list.count <= 100);
  assert.equal(run({ cap: 1e6 }).minPx, free.minPx);
});

test('searchCut: a cap below the base does not lower the base', () => {
  assert.equal(run({ budget: 1e6, cap: 1 }).minPx, 3);
});
