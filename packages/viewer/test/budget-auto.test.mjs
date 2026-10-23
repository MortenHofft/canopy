// The adaptive budget in the viewer (#114): 'auto' for drawBudget and radialMaxNodes, the default; a number stays fixed. The frame time is
// the viewer's own JS time (performance.now), stubbed so that each frame takes `clock.cost` ms (as in interaction-lod.test.mjs). The
// frames that measure a changed budget come from a timer (BUDGET_FRAME_MS), so the tests wait for it.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeViewer, destroyAll } from './viewer-harness.mjs';

afterEach(destroyAll);

const realNow = performance.now.bind(performance);
afterEach(() => {
  performance.now = realNow;
});

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const core = path.join(root, 'packages/viewer/src');
const B = await import(path.join(core, 'budget.ts'));
const { K_SUMMARY, DrawList, Seen, searchCut } = await import(path.join(core, 'lod.ts'));
const { parseNewick } = await import(path.join(root, 'packages/io/src/newick.ts'));
const { InMemorySource } = await import(path.join(core, 'source.ts'));
const { computeLayout, ensureTrig } = await import(path.join(core, 'layout.ts'));
const { makeTransform } = await import(path.join(core, 'geom.ts'));
const { projectionFor } = await import(path.join(core, 'projection.ts'));

/** A balanced tree of n tips, all at the same depth (an ultrametric tree: every tip is on the outermost ring). */
function balanced(n) {
  const go = (m, p) => (m === 1 ? `${p}:1` : `(${go(m / 2, p + 'a')},${go(m / 2, p + 'b')}):1`);
  return go(n, 't') + ';';
}
const BIG = balanced(16384);

/** A viewer whose frames each take `clock.cost` ms. `frame()` runs the queued frame round; `wait()` lets the budget timer fire and runs
 *  the frame it asks for. */
async function setup(options, nwk = BIG, size = [1000, 1000]) {
  const { viewer, env } = await makeViewer(nwk, { options: { refineMs: 0, layout: 'radial', minCladePx: 1, ...options }, size });
  const clock = { cost: 1, start: 0, first: true };
  performance.now = () => {
    if (!clock.first) return clock.start + clock.cost;
    clock.first = false;
    return clock.start;
  };
  const frame = () => {
    clock.start = env.now();
    clock.first = true;
    env.frame();
  };
  const wait = async () => {
    await new Promise((r) => setTimeout(r, B.BUDGET_FRAME_MS + 15));
    frame();
  };
  const frames = [];
  viewer.on('frame', (s) => frames.push({ ...s }));
  return { viewer, env, clock, frame, wait, frames };
}

/** Wait for frames until the controller has nothing pending, at most `max` rounds. */
async function settleBudget(ctx, max = 40) {
  for (let k = 0; k < max; k++) {
    await ctx.wait();
    if (!ctx.viewer.budgetPending) break;
  }
}

/** Widest summary wedge of the viewer's current list, as arc px at its own outer radius, and the limit of MAX_WEDGE_DEG at the outer ring. */
function widest(viewer) {
  const { list, proj } = viewer;
  const { L, T } = proj;
  let w = 0;
  for (let c = 0; c < list.count; c++) {
    if (list.kind[c] !== K_SUMMARY || list.last[c] >= 0) continue;
    const i = list.node[c];
    w = Math.max(w, (L.rowEnd[i] - L.rowStart[i]) * T.da * L.XMAX[i] * T.k);
  }
  return { widest: w, limit: B.wedgeLimitPx(L.XMAX[0] * T.k) };
}

test("the defaults are auto, and a first frame uses today's starting values", async () => {
  const { viewer, frame } = await setup({ radialMaxNodes: undefined });
  assert.equal(viewer.options.drawBudget, 'auto');
  assert.equal(viewer.options.radialMaxNodes, 'auto');
  frame();
  assert.equal(viewer.getStats().budget, B.START_RADIAL);
  const r = await setup({ layout: 'rectangular' }, BIG);
  r.frame();
  assert.equal(r.viewer.getStats().budget, B.START_RECT);
});

test("'auto' changes the budget across frames: fast frames raise it until the canvas has nothing more to show", async () => {
  const ctx = await setup({});
  ctx.frame();
  const seen = [ctx.viewer.getStats().budget];
  await settleBudget(ctx);
  for (const f of ctx.frames) seen.push(f.budget);
  assert.equal(seen[0], B.START_RADIAL);
  assert.ok(Math.max(...seen) > B.START_RADIAL, `raised: ${seen.join(' ')}`);
  for (let k = 1; k < seen.length; k++) assert.ok(seen[k] >= seen[k - 1], 'only up while frames are fast');
  const st = ctx.viewer.getStats();
  assert.ok(st.budget <= B.CEILING);
  assert.equal(ctx.viewer.budgetPending, false, 'and it came to rest');
  assert.ok(st.forced === 0 || st.budget >= B.CEILING, `levelled off: forced ${st.forced}, budget ${st.budget}`);
});

test('it does not climb to the ceiling when the cut already shows everything: a small tree stays at the start', async () => {
  const ctx = await setup({ layout: 'rectangular' }, '(((a,b)ab,(c,d)cd)abcd,((e,f)ef,(g,h)gh)efgh)r;');
  ctx.frame();
  await settleBudget(ctx, 6);
  assert.equal(ctx.viewer.getStats().budget, B.START_RECT);
  assert.equal(ctx.viewer.autoRect.budget, B.START_RECT);
});

test("'auto' lowers the budget on slow frames, and the wedge limit gives way to it", async () => {
  const ctx = await setup({});
  ctx.clock.cost = 100;
  ctx.frame();
  await settleBudget(ctx, 12);
  const st = ctx.viewer.getStats();
  assert.ok(st.budget < B.START_RADIAL, `lowered: ${st.budget}`);
  assert.ok(st.budget >= B.FLOOR_RADIAL);
  assert.equal(ctx.viewer.autoRadial.pressed, true);
  const { widest: w, limit } = widest(ctx.viewer);
  assert.ok(w > limit, `a wedge past ${B.MAX_WEDGE_DEG} degrees (${w.toFixed(1)} px > ${limit.toFixed(1)} px) once frames are over the target`);
});

test('radial, frames on target: no summary wedge wider than MAX_WEDGE_DEG, whatever the budget has come down to', async () => {
  const ctx = await setup({});
  ctx.frame();
  const first = widest(ctx.viewer);
  assert.ok(first.widest <= first.limit * (1 + 1e-9), `first frame: ${first.widest.toFixed(2)} px <= ${first.limit.toFixed(2)} px`);
  await settleBudget(ctx);
  const last = widest(ctx.viewer);
  assert.ok(last.widest <= last.limit * (1 + 1e-9), `after: ${last.widest.toFixed(2)} px <= ${last.limit.toFixed(2)} px`);
});

test('a number stays fixed: the budget does not move, and no frame follows', async () => {
  for (const [options, expected] of [
    [{ drawBudget: 5000, radialMaxNodes: 300 }, 300],
    [{ drawBudget: 5000, radialMaxNodes: Infinity }, 5000],
    [{ layout: 'rectangular', drawBudget: 3000 }, 3000],
  ]) {
    for (const cost of [1, 100]) {
      const ctx = await setup(options);
      ctx.clock.cost = cost;
      ctx.frame();
      const n = ctx.frames.length;
      for (let k = 0; k < 4; k++) await ctx.wait();
      assert.equal(ctx.frames.length, n, 'no frames of its own');
      assert.equal(ctx.viewer.getStats().budget, expected, JSON.stringify(options));
      assert.ok(ctx.viewer.getStats().drawn <= expected);
    }
  }
});

test('a fixed drawBudget bounds radialMaxNodes auto, and radialMaxNodes bounds drawBudget auto', async () => {
  const a = await setup({ drawBudget: 3000 });
  a.frame();
  await settleBudget(a);
  assert.ok(a.viewer.getStats().budget <= 3000, `${a.viewer.getStats().budget}`);
  const b = await setup({ radialMaxNodes: 700 });
  b.frame();
  await settleBudget(b);
  assert.equal(b.viewer.getStats().budget, 700);
  assert.equal(b.viewer.autoRect.budget <= 700, true);
});

for (const interactionLOD of [true, 'auto', false]) {
  test(`applied on settle only, interactionLOD ${interactionLOD}: frames of a gesture measure, they do not move the budget`, async () => {
    const ctx = await setup({ interactionLOD });
    ctx.frame();
    await settleBudget(ctx);
    const at = ctx.viewer.autoRadial.budget;
    ctx.clock.cost = 200;
    const tip = ctx.viewer.getTree().tipIndex('taaaaaaaaaaaaaa');
    assert.ok(tip >= 0);
    ctx.clock.start = ctx.env.now();
    ctx.clock.first = true;
    ctx.viewer.zoomToNode(tip, true);
    for (let k = 0; k < 6; k++) ctx.frame();
    assert.equal(ctx.viewer.moving, true, 'still moving');
    assert.equal(ctx.viewer.autoRadial.budget, at, 'unchanged mid-gesture');
    assert.ok(ctx.viewer.autoRadial.n >= 1 || ctx.viewer.autoRadial.iv > 0, 'but measured');
    // the gesture ends: the refine timer settles, the next settled frame applies it
    for (let k = 0; k < 200 && ctx.viewer.vs.animating; k++) ctx.frame();
    await new Promise((r) => setTimeout(r, 30));
    ctx.frame();
    await settleBudget(ctx, 8);
    assert.ok(ctx.viewer.autoRadial.budget < at, `lowered after the gesture: ${ctx.viewer.autoRadial.budget} < ${at}`);
  });
}

test('a new tree: its first frame is not measured, so a slow cold frame does not lower the budget', async () => {
  const ctx = await setup({});
  ctx.frame();
  await settleBudget(ctx);
  const at = ctx.viewer.autoRadial.budget;
  assert.ok(at > B.START_RADIAL);
  const fullMs = ctx.viewer.fullMs;
  assert.ok(fullMs > 0);
  ctx.clock.cost = 300; // the cold frame of the new tree
  ctx.viewer.setTree(parseNewick(balanced(8192)), { view: 'fit' });
  assert.equal(ctx.viewer.fullMs, 0, 'the interaction LOD measures afresh');
  assert.equal(ctx.viewer.autoRadial.n, 0);
  ctx.frame();
  assert.equal(ctx.viewer.autoRadial.n, 0, 'the first frame is not measured');
  assert.equal(ctx.viewer.fullMs, 0);
  assert.equal(ctx.viewer.autoRadial.budget, at);
  assert.equal(ctx.viewer.autoRadial.pressed, false);
  ctx.clock.cost = 1;
  await settleBudget(ctx);
  assert.ok(ctx.viewer.autoRadial.budget >= at, 'and the next frames are fast');
  assert.equal(ctx.viewer.autoRadial.pressed, false);
});

test('the follow-up frames start again when an option or the layout changes, not only on input', async () => {
  const ctx = await setup({});
  ctx.frame();
  await settleBudget(ctx);
  ctx.viewer.budgetChain = 0;
  ctx.viewer.setOptions({ radialMaxNodes: 1500 });
  assert.equal(ctx.viewer.budgetChain, B.CHAIN_FRAMES);
  assert.equal(ctx.viewer.budgetPending, true);
  ctx.viewer.budgetChain = 0;
  ctx.viewer.setOptions({ layout: 'rectangular' });
  ctx.frame();
  assert.ok(ctx.viewer.budgetChain > 0, 'the rectangular controller starts its follow-up frames');
});

// ---- searchCut with a limit

const tree = new InMemorySource(parseNewick(balanced(16384))).snapshot();
const L = computeLayout(tree, true);
ensureTrig(L);
const area = { ax: 0, ay: 0, aw: 400, ah: 400, clipL: 0, clipT: 0, clipR: 400, clipB: 400 };
const T = makeTransform('radial', 400, 400, { x0: -1.1, x1: 1.1, y0: -1.1, y1: 1.1 }, area, L.rowEnd[0], L.fan);
const proj = projectionFor(tree, L, T);
const limit = B.wedgeLimitPx(L.XMAX[0] * T.k);
const arcs = (list) => {
  let w = 0;
  for (let c = 0; c < list.count; c++) {
    if (list.kind[c] !== K_SUMMARY || list.last[c] >= 0) continue;
    const i = list.node[c];
    w = Math.max(w, (L.rowEnd[i] - L.rowStart[i]) * T.da * L.XMAX[i] * T.k);
  }
  return w;
};
const search = (o) => {
  const list = new DrawList();
  return { ...searchCut(proj, null, list, new Seen(), { lod: true, base: 3, cap: Infinity, budget: 40, summaries: true, hint: 0, ...o }), list };
};

test('searchCut: a small budget raises the threshold past 4 degrees without a limit, and stops at it with one', () => {
  const free = search({});
  assert.ok(free.list.count <= 40);
  assert.ok(arcs(free.list) > limit * 1.5, `without a limit: ${arcs(free.list).toFixed(1)} px, limit ${limit.toFixed(1)} px`);
  const held = search({ limit, hardBudget: 200000 });
  assert.ok(arcs(held.list) <= limit * (1 + 1e-9), `with it: ${arcs(held.list).toFixed(1)} px`);
  assert.ok(held.minPx <= limit * (1 + 1e-9));
  assert.ok(held.list.count > 40, `the list is past the budget: ${held.list.count}`);
  assert.equal(held.res.overflow, false);
  // the same with the previous frame's rung as a hint
  const again = search({ limit, hardBudget: 200000, hint: held.minPx });
  assert.equal(again.minPx, held.minPx);
  assert.equal(again.list.count, held.list.count);
  const high = search({ limit, hardBudget: 200000, hint: free.minPx });
  assert.equal(high.minPx, held.minPx, 'a hint above the limit is held at it');
});

test('searchCut: a budget the limit leaves room for is used as before, and no limit is the old search', () => {
  const roomy = search({ budget: 5000, limit, hardBudget: 200000 });
  const none = search({ budget: 5000 });
  assert.equal(roomy.minPx, none.minPx);
  assert.equal(roomy.list.count, none.list.count);
  const inf = search({ limit: Infinity, hardBudget: 10 });
  assert.equal(inf.minPx, search({}).minPx);
  assert.ok(inf.list.count <= 40);
});

test('searchCut: where even the hard budget overflows at the limit, the ladder goes on and the list fits', () => {
  const hard = Math.floor(search({ limit, hardBudget: 200000 }).list.count / 2);
  const r = search({ limit, hardBudget: hard });
  assert.equal(r.res.overflow, false);
  assert.ok(r.list.count <= hard);
  assert.ok(r.minPx > limit, 'past the limit: the budget wins');
});

test('searchCut: a limit under the base holds the base', () => {
  const r = search({ base: 30, limit: 5, hardBudget: 200000 });
  assert.equal(r.minPx, 30);
  assert.equal(r.res.overflow, false);
});

test('searchCut: a caterpillar (walk too long for the ladder) obeys the limit as well', () => {
  const n = 100000;
  let nwk = 't0:1';
  for (let k = 1; k < n; k++) nwk = `(${nwk},t${k}:1):1`;
  const snap = new InMemorySource(parseNewick(nwk + ';')).snapshot();
  const l2 = computeLayout(snap, true);
  ensureTrig(l2);
  const t2 = makeTransform('radial', 400, 400, { x0: -1.1, x1: 1.1, y0: -1.1, y1: 1.1 }, area, l2.rowEnd[0], l2.fan);
  const p2 = projectionFor(snap, l2, t2);
  const lim = B.wedgeLimitPx(l2.XMAX[0] * t2.k);
  const list = new DrawList();
  const r = searchCut(p2, null, list, new Seen(), {
    lod: true,
    base: 3,
    cap: Infinity,
    budget: 300,
    summaries: true,
    hint: 0,
    limit: lim,
    hardBudget: 200000,
  });
  assert.equal(r.res.overflow, false);
  assert.ok(r.minPx <= lim * (1 + 1e-9) || list.count <= 200000);
});
