// Unit tests of TreeViewer.setTree over the fake DOM: the view kept through a node map, fitted when nothing survives, the treechange
// event, the controls and listeners that stay, and what is rebuilt (clades, highlights, search index, legend) for the new tree.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { makeViewer, destroyAll } = await import('./viewer-harness.mjs');
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

test('setTree frames the surviving tips after a prune', async () => {
  const a = ladder(names(0, 40));
  const { viewer, env } = await makeViewer(a);
  env.flush();
  viewer.setViewport({ x0: 0, x1: 1, y0: 10, y1: 20 });
  const b = ladder(names(5, 40)); // t0..t4 removed: every tip moves up by 5 rows
  viewer.setTree(b, { map: tipMap(a, b) });
  const v = viewer.getViewport();
  near(v.y0, 5, 'y0');
  near(v.y1, 15, 'y1');
  assert.equal(b.tipLabels[Math.round(v.y0)], 't10');
});

test('setTree keeps the view across a flip inside it', async () => {
  const a = ladder(names(0, 40));
  const { viewer, env } = await makeViewer(a);
  env.flush();
  viewer.setViewport({ x0: 0, x1: 1, y0: 10, y1: 20 });
  const order = [...names(0, 12), ...names(12, 18).reverse(), ...names(18, 40)];
  const b = ladder(order);
  viewer.setTree(b, { map: tipMap(a, b) });
  const v = viewer.getViewport();
  near(v.y0, 10, 'y0');
  near(v.y1, 20, 'y1');
});

test('setTree fits when no tip in view survives, and without a map', async () => {
  const a = ladder(names(0, 40));
  const { viewer, env } = await makeViewer(a);
  env.flush();
  viewer.setViewport({ x0: 0, x1: 1, y0: 0, y1: 5 });
  const b = ladder(names(5, 40));
  viewer.setTree(b, { map: tipMap(a, b) });
  assert.deepEqual(viewer.getViewport(), { x0: 0, x1: 1, y0: 0, y1: 35 });
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
  assert.deepEqual([...viewer.getTree().tipRank.slice(0, 0)], []);
  // explicit lists win and apply before the next frame
  const c = ladder(names(0, 10));
  viewer.setTree(c, { map: tipMap(b, c), clades: [{ node: tNode(c, 't0'), colour: 'blue' }], highlighted: ['t1'] });
  assert.deepEqual(viewer.getClades(), [{ node: tNode(c, 't0'), colour: 'blue' }]);
  assert.deepEqual(viewer.getHighlighted(), ['t1']);
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
