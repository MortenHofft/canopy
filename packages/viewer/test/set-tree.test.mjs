// Unit tests of TreeViewer.setTree over the fake DOM: the view kept through a node map, fitted when nothing survives, the treechange
// event, the controls and listeners that stay, and what is rebuilt (clades, highlights, search index, legend) for the new tree.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const harness = await import('./viewer-harness.mjs');
const { destroyAll } = harness;
const { makeViewer } = harness;
const { Search, Legend, Zoom } = await import('../src/controls/index.ts');
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const { parseNewick } = await import(path.join(root, 'packages/io/src/newick.ts'));

afterEach(destroyAll);

/** A caterpillar over the given tip labels: tip i has rank i. */
function ladder(labels) {
  let s = labels[labels.length - 1];
  for (let i = labels.length - 2; i >= 0; i--) s = `(${labels[i]},${s})`;
  return parseNewick(s + ';');
}
const names = (from, to) => Array.from({ length: to - from }, (_, i) => 't' + (from + i));

/** The node map between two trees by tip label (tips only; internal nodes are -1, which setTree does not look at). */
function tipMap(before, after) {
  const m = new Int32Array(before.nodeCount).fill(-1);
  for (let r = 0; r < before.tipCount; r++) {
    const n = after.tipIndex(before.tipLabels[r]);
    if (n >= 0) m[before.tipNode[r]] = n;
  }
  return m;
}

const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} vs ${b}`);

test('setTree keeps the viewport for an identity map', async () => {
  const a = ladder(names(0, 40));
  const { viewer, env } = await makeViewer(a);
  env.flush();
  viewer.setViewport({ x0: 0, x1: 1, y0: 10, y1: 20 });
  const v = viewer.getViewport();
  const b = ladder(names(0, 40));
  viewer.setTree(b, { map: tipMap(a, b) });
  env.flush();
  assert.deepEqual(viewer.getViewport(), v);
  assert.equal(viewer.getTree().tipCount, 40);
});

test('setTree keeps a window that cuts a row at its edges, with and without the zoom cap', async () => {
  for (const options of [{}, { maxTipSpacing: 'auto' }]) {
    const a = ladder(names(0, 40));
    const { viewer, env } = await makeViewer(a, { options });
    env.flush();
    viewer.setViewport({ x0: 0, x1: 1, y0: 10, y1: 21.83 });
    const v = viewer.getViewport();
    const b = ladder(names(0, 40));
    viewer.setTree(b, { map: tipMap(a, b) });
    env.flush();
    assert.deepEqual(viewer.getViewport(), v);
    destroyAll();
  }
});

test('setTree frames the surviving tips after a prune', async () => {
  const a = ladder(names(0, 40));
  const { viewer, env } = await makeViewer(a);
  env.flush();
  viewer.setViewport({ x0: 0, x1: 1, y0: 10, y1: 25 });
  const b = ladder(names(5, 40)); // t0..t4 removed: every tip moves up by 5 rows
  viewer.setTree(b, { map: tipMap(a, b) });
  const v = viewer.getViewport();
  near(v.y0, 5, 'y0');
  near(v.y1, 20, 'y1');
  assert.equal(b.tipLabels[Math.round(v.y0)], 't10');
});

test('setTree keeps the view across a flip inside it', async () => {
  const a = ladder(names(0, 40));
  const { viewer, env } = await makeViewer(a);
  env.flush();
  viewer.setViewport({ x0: 0, x1: 1, y0: 10, y1: 25 });
  const order = [...names(0, 12), ...names(12, 18).reverse(), ...names(18, 40)];
  const b = ladder(order);
  viewer.setTree(b, { map: tipMap(a, b) });
  const v = viewer.getViewport();
  near(v.y0, 10, 'y0');
  near(v.y1, 25, 'y1');
});

test('setTree fits when no tip in view survives, and without a map', async () => {
  const a = ladder(names(0, 40));
  const { viewer, env } = await makeViewer(a);
  env.flush();
  viewer.setViewport({ x0: 0, x1: 1, y0: 0, y1: 12 });
  const b = ladder(names(12, 40));
  viewer.setTree(b, { map: tipMap(a, b) });
  assert.deepEqual(viewer.getViewport(), { x0: 0, x1: 1, y0: 0, y1: 28 });
  // no map: fit, as the default
  viewer.setViewport({ x0: 0, x1: 1, y0: 10, y1: 20 });
  viewer.setTree(ladder(names(0, 30)));
  assert.deepEqual(viewer.getViewport(), { x0: 0, x1: 1, y0: 0, y1: 30 });
  // 'fit' wins over a map
  viewer.setViewport({ x0: 0, x1: 1, y0: 10, y1: 20 });
  const c = ladder(names(0, 30));
  viewer.setTree(c, { map: new Int32Array(c.nodeCount).map((_, i) => i), view: 'fit' });
  assert.deepEqual(viewer.getViewport(), { x0: 0, x1: 1, y0: 0, y1: 30 });
});

test("setTree view 'keep' without a map matches tips by label", async () => {
  const a = ladder(names(0, 40));
  const { viewer, env } = await makeViewer(a);
  env.flush();
  viewer.setViewport({ x0: 0, x1: 1, y0: 10, y1: 20 });
  viewer.setTree(ladder(names(5, 40)), { view: 'keep' });
  near(viewer.getViewport().y0, 5, 'y0');
});

test('setTree keeps a fitted view fitted', async () => {
  const a = ladder(names(0, 40));
  const { viewer, env } = await makeViewer(a);
  env.flush();
  const b = ladder(names(0, 25));
  viewer.setTree(b, { map: tipMap(a, b) });
  assert.deepEqual(viewer.getViewport(), { x0: 0, x1: 1, y0: 0, y1: 25 });
});

test('setTree radial: an identity map keeps the window, a prune turns it with the tips', async () => {
  const a = ladder(names(0, 40));
  const { viewer, env } = await makeViewer(a, { options: { layout: 'radial' } });
  env.flush();
  viewer.setViewport({ x0: 0.3, x1: 1.3, y0: -0.4, y1: 0.4 }); // right of the root: the tips at angles near 0 (and the last ones)
  const v = viewer.getViewport();
  const same = ladder(names(0, 40));
  viewer.setTree(same, { map: tipMap(a, same) });
  assert.deepEqual(viewer.getViewport(), v);
  assert.equal(viewer.options.layout, 'radial');
  // the first ten tips go: the rest move by 10 ranks of 2pi/40, then 2pi/30 apart: the window turns, its size stays
  const b = ladder(names(10, 40));
  viewer.setTree(b, { map: tipMap(same, b) });
  const w = viewer.getViewport();
  near(w.x1 - w.x0, v.x1 - v.x0, 'width');
  near(w.y1 - w.y0, v.y1 - v.y0, 'height');
  assert.notDeepEqual(w, v);
});

test('setTree emits treechange with the map, after the new tree is in force', async () => {
  const a = ladder(names(0, 10));
  const { viewer, env } = await makeViewer(a);
  env.flush();
  const seen = [];
  viewer.on('treechange', (e) => seen.push([e.map, viewer.getTree().tipCount]));
  const b = ladder(names(2, 10));
  const map = tipMap(a, b);
  viewer.setTree(b, { map });
  viewer.setTree(a);
  assert.equal(seen.length, 2);
  assert.equal(seen[0][0], map);
  assert.equal(seen[0][1], 8);
  assert.equal(seen[1][0], null);
  assert.equal(seen[1][1], 10);
});

test('setTree keeps controls, listeners, options and theme overrides, and does not fire ready again', async () => {
  const a = ladder(names(0, 10));
  const zoom = new Zoom();
  const { viewer, env } = await makeViewer(a, { options: { layout: 'radial', axis: false }, theme: { branch: '#123456' }, controls: [zoom] });
  env.flush();
  let ready = 0;
  let frames = 0;
  viewer.on('ready', () => ready++);
  viewer.on('frame', () => frames++);
  const root = viewer.root;
  viewer.setTree(ladder(names(0, 12)));
  env.flush();
  assert.deepEqual(viewer.getControls(), [zoom]);
  assert.equal(zoom.viewer, viewer);
  assert.equal(viewer.root, root);
  assert.equal(viewer.options.layout, 'radial');
  assert.equal(viewer.options.axis, false);
  assert.equal(viewer.getTheme().branch, '#123456');
  assert.equal(ready, 0);
  assert.ok(frames > 0, 'listeners still get events');
  assert.equal(viewer.isDestroyed(), false);
});

test('setTree applies clades, highlights and collapsed marks with the new tree, and remaps clades through the map by default', async () => {
  const a = ladder(names(0, 10));
  const { viewer, env } = await makeViewer(a);
  env.flush();
  const tNode = (t, l) => t.tipNode[t.tipIndex(l) >= 0 ? t.tipRank[t.tipIndex(l)] : 0];
  viewer.setClades([{ node: tNode(a, 't9'), colour: 'red' }]);
  viewer.setHighlighted(['t8', 'gone']);
  const b = ladder(names(2, 10));
  viewer.setTree(b, { map: tipMap(a, b) });
  assert.deepEqual(viewer.getClades(), [{ node: tNode(b, 't9'), colour: 'red' }]);
  assert.deepEqual([...viewer.hlRanks], [b.tipRank[b.tipIndex('t8')]], 'a highlight follows its tip label to its new rank');
  assert.equal(viewer.hl.length, 8);
  // explicit lists win and apply before the next frame
  const c = ladder(names(0, 10));
  viewer.setTree(c, { map: tipMap(b, c), clades: [{ node: tNode(c, 't0'), colour: 'blue' }], highlighted: ['t1'] });
  assert.deepEqual(viewer.getClades(), [{ node: tNode(c, 't0'), colour: 'blue' }]);
  assert.deepEqual(viewer.getHighlighted(), ['t1']);
  assert.deepEqual([...viewer.hlRanks], [c.tipRank[c.tipIndex('t1')]], 'the highlight ranks are those of the new tree');
  assert.equal(viewer.hl[1], 1);
  let cladeEvents = 0;
  viewer.on('cladeschange', () => cladeEvents++);
  viewer.setClades([{ node: tNode(c, 't0'), colour: 'blue' }]);
  assert.equal(cladeEvents, 0, 'the same list is a no-op after setTree');
});

test('setTree: the Search index and the Legend follow the new tree', async () => {
  const a = ladder(['alpha', 'beta', 'gamma']);
  const search = new Search();
  const legend = new Legend();
  const { viewer, env } = await makeViewer(a, { controls: [search, legend] });
  env.flush();
  assert.deepEqual(search.find(viewer, 'ga'), [2]);
  assert.equal(search.find(viewer, 'delta').length, 0);
  const b = ladder(['delta', 'alpha', 'gamma', 'epsilon']);
  viewer.setTree(b, {
    clades: [{ node: b.tipNode[0], colour: 'red', label: 'first' }],
  });
  assert.deepEqual(search.find(viewer, 'delta'), [0]);
  assert.deepEqual(search.find(viewer, 'ga'), [2]);
  assert.equal(legend.element.hidden, false);
  assert.match(legend.element.textContent ?? '', /first/);
});

// ---------------------------------------------------------------- review fixes

test('setTree always clamps a kept window: rows past the end of a pruned tree', async () => {
  const a = ladder(names(0, 100));
  const { viewer, env } = await makeViewer(a);
  env.flush();
  viewer.setViewport({ x0: 0, x1: 1, y0: 40, y1: 60 });
  const b = ladder(names(0, 51)); // t51.. pruned: the old window is past the end of the tree
  viewer.setTree(b, { map: tipMap(a, b) });
  const v = viewer.getViewport();
  assert.deepEqual(v, viewer.vs.clampView({ ...v }), 'the window is a valid one for the new tree');
  assert.ok(v.y0 < 51);
});

test('setTree carries the x window through the survivors when X is rescaled (the deepest tip is pruned)', async () => {
  const deep = (withDeep) => {
    const parts = Array.from({ length: 40 }, (_, i) => `t${i}:1`);
    let s = parts[39];
    for (let i = 38; i >= 0; i--) s = `(${parts[i]},${s}):0.1`;
    return parseNewick(withDeep ? `(deep:20,${s}:0.1);` : `(${s}:0.1);`);
  };
  const a = deep(true);
  const { viewer, env } = await makeViewer(a);
  env.flush();
  const xs = [10, 11, 12, 13].map((i) => viewer.layout.X[a.tipIndex('t' + i)]);
  const lo = Math.min(...xs),
    hi = Math.max(...xs);
  const rows = [10, 11, 12, 13].map((i) => a.tipRank[a.tipIndex('t' + i)]);
  viewer.setViewport({ x0: lo - 0.01, x1: hi + 0.01, y0: Math.min(...rows), y1: Math.max(...rows) + 1 });
  const b = deep(false);
  viewer.setTree(b, { map: tipMap(a, b) });
  const v = viewer.getViewport();
  const L = viewer.layout;
  for (const i of [10, 11, 12, 13]) {
    const xx = L.X[b.tipNode[b.tipRank[b.tipIndex('t' + i)]]];
    assert.ok(xx >= v.x0 && xx <= v.x1, `t${i} (x ${xx.toFixed(3)}) is inside the x window ${v.x0.toFixed(3)}..${v.x1.toFixed(3)}`);
  }
});

test('setTree keeps the view when the clade in view is collapsed, and when it is expanded again', async () => {
  let clade = Array.from({ length: 16 }, (_, i) => `c${i}`);
  while (clade.length > 1) {
    const nx = [];
    for (let i = 0; i < clade.length; i += 2) nx.push(`(${clade[i]},${clade[i + 1]})`);
    clade = nx;
  }
  let nw = clade[0];
  for (let i = 39; i >= 0; i--) nw = `(t${i},${nw})`;
  const a = parseNewick(nw + ';');
  const { viewer, env } = await makeViewer(a);
  env.flush();
  let top = a.parent[a.tipNode[a.tipRank[a.tipIndex('c0')]]];
  while (a.leafEnd[top] - a.leafStart[top] < 16) top = a.parent[top];
  viewer.zoomToNode(top);
  const { collapseClades, invertMap } = await import(path.join(root, 'packages/tree-ops/src/index.ts'));
  const { TreeModel } = await import(path.join(root, 'packages/io/src/tree.ts'));
  const r = collapseClades(a, [top]);
  const col = new TreeModel(r.tree);
  viewer.setTree(col, { map: r.map });
  const v1 = viewer.getViewport();
  const fit = { x0: 0, x1: 1, y0: 0, y1: col.tipCount };
  assert.notDeepEqual(v1, fit, 'not fitted');
  assert.ok(41 - 0.5 >= v1.y0 && 41 - 0.5 <= v1.y1, 'the collapsed tip is in view');
  // expand: the collapsed tip maps to the clade root
  viewer.setTree(a, { map: invertMap(r.map, col.nodeCount) });
  const v2 = viewer.getViewport();
  assert.notDeepEqual(v2, { x0: 0, x1: 1, y0: 0, y1: a.tipCount }, 'not fitted');
  assert.ok(v2.y0 < a.tipCount - 8 && v2.y1 > a.tipCount - 8, 'the expanded clade is in view');
});

test('setTree: radial with no tip in view keeps the window; a rowHeight view keeps its height', async () => {
  const a = ladder(names(0, 40));
  const { viewer, env } = await makeViewer(a, { options: { layout: 'radial' } });
  env.flush();
  viewer.setViewport({ x0: 0.02, x1: 0.1, y0: -0.03, y1: 0.03 }); // next to the root, no tip near
  const v = viewer.getViewport();
  viewer.setTree(ladder(names(0, 30)), { view: 'keep' });
  assert.deepEqual(viewer.getViewport(), v);
  const m = await makeViewer(ladder(names(0, 40)), { options: { rowHeight: 10 } });
  m.env.flush();
  m.viewer.setViewport({ x0: 0, x1: 1, y0: 5, y1: 15 });
  const h = m.viewer.getViewport().y1 - m.viewer.getViewport().y0;
  const b = ladder(names(0, 40).reverse()); // every tip moves: the survivors spread over the whole tree
  m.viewer.setTree(b, { view: 'keep' });
  near(m.viewer.getViewport().y1 - m.viewer.getViewport().y0, h, 'height');
});

test('setTree tells listeners: hover ended, clades and highlights changed; an unusable map is ignored', async () => {
  const a = ladder(names(0, 10));
  const { viewer, env } = await makeViewer(a);
  env.flush();
  viewer.setClades([{ node: 3, colour: 'red' }]);
  viewer.setHighlighted(['t1']);
  const log = [];
  viewer.on('hover', (e) => log.push(['hover', e]));
  viewer.on('cladeschange', () => log.push(['cladeschange']));
  viewer.on('highlightchange', () => log.push(['highlightchange']));
  viewer.hoverNode = 4; // as doHover leaves it
  viewer.hoverKind = 'tip';
  const b = ladder(names(2, 10));
  viewer.setTree(b, { map: tipMap(a, b), highlighted: ['t5'] });
  assert.deepEqual(log.map((x) => x[0]).sort(), ['cladeschange', 'highlightchange', 'hover']);
  assert.equal(log.find((x) => x[0] === 'hover')[1], null);
  // a map of another tree: warned about, ignored, fitted
  const warned = [];
  const warn = console.warn;
  console.warn = (...x) => warned.push(x);
  try {
    viewer.setViewport({ x0: 0, x1: 1, y0: 2, y1: 5 });
    viewer.setTree(ladder(names(2, 10)), { map: new Int32Array(3) });
  } finally {
    console.warn = warn;
  }
  assert.equal(warned.length, 1);
  assert.deepEqual(viewer.getViewport(), { x0: 0, x1: 1, y0: 0, y1: 8 });
});

test('setTree ends a drag in progress and refreshes the screen-reader list', async () => {
  const a = ladder(names(0, 10));
  const { viewer, env } = await makeViewer(a);
  env.flush();
  viewer.input.drag = { id: 1, moved: true };
  viewer.input.pointers.set(1, { x: 0, y: 0 });
  viewer.setTree(ladder(names(0, 12)));
  assert.equal(viewer.input.gesturing, false);
  assert.equal(viewer.input.pointers.size, 0);
});

test('setTree fits (and is fitted) when the tips in view are all gone in a real prune, not just the nearest ancestor (the root)', async () => {
  const ops = await import(path.join(root, 'packages/tree-ops/src/index.ts'));
  const { TreeModel } = await import(path.join(root, 'packages/io/src/tree.ts'));
  const a = ladder(names(0, 40));
  const { viewer, env } = await makeViewer(a);
  env.flush();
  viewer.setViewport({ x0: 0, x1: 1, y0: 0, y1: 12 });
  const r = ops.prune(a, (rank) => rank >= 12); // keeps t12..: the tips in view are gone; their ancestors all lead to the root
  viewer.setTree(new TreeModel(r.tree), { map: r.map });
  assert.deepEqual(viewer.getViewport(), { x0: 0, x1: 1, y0: 0, y1: 28 });
  assert.equal(viewer.vs.fitted, true);
});

test('setTree on a deep (caterpillar) tree: the ancestor walk is linear', async () => {
  const ops = await import(path.join(root, 'packages/tree-ops/src/index.ts'));
  const { TreeModel } = await import(path.join(root, 'packages/io/src/tree.ts'));
  const N = 20000;
  let s = 't' + (N - 1);
  for (let i = N - 2; i >= 0; i--) s = `(t${i}:1,${s}:1)`;
  const a = parseNewick(s + ';');
  const { viewer, env } = await makeViewer(a);
  env.flush();
  viewer.setViewport({ x0: 0, x1: 1, y0: 0, y1: N * 0.9 });
  const r = ops.prune(a, (rank) => rank >= N - 50); // nothing in view survives directly: every tip walks up
  const b = new TreeModel(r.tree);
  const t0 = performance.now();
  viewer.setTree(b, { map: r.map });
  const ms = performance.now() - t0;
  assert.ok(ms < 1500, `setTree took ${ms.toFixed(0)} ms (was 668 ms when quadratic at 20k; linear is a few tens)`);
});
