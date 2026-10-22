// setTree 100 times with different trees (reroot, prune, ladderise, collapse, unrelated), with seven controls, an animation in flight and
// a layout switch now and then: no listener, subscription, element or frame-loop leak, and the state stays consistent.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import path from 'node:path';
import { fileURLToPath } from 'node:url';
const WT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const { makeViewer, destroyAll } = await import('./viewer-harness.mjs');
const { Search, Legend, Zoom, OverviewControl, LayoutToggle } = await import(WT + '/packages/viewer/src/controls/index.ts');
const { Tooltip, NodeMenu } = await import(WT + '/packages/viewer/src/overlays/index.ts');
const { InMemorySource } = await import(WT + '/packages/viewer/src/source.ts');
const { parseNewick } = await import(WT + '/packages/io/src/newick.ts');
const raw = await import(WT + '/packages/tree-ops/src/index.ts');
const { TreeModel } = await import(WT + '/packages/io/src/tree.ts');
const wrap =
  (f) =>
  (...a) => {
    const r = f(...a);
    return { ...r, tree: new TreeModel(r.tree) };
  };
const ops = { ...raw, reroot: wrap(raw.reroot), prune: wrap(raw.prune), ladderise: wrap(raw.ladderise), collapseClades: wrap(raw.collapseClades) };

afterEach(destroyAll);

/** Seeded random binary tree with `n` tips labelled from a pool, with lengths. */
function rnd(seed) {
  let s = seed >>> 0 || 1;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
}
function randomTree(n, seed) {
  const r = rnd(seed);
  const parts = Array.from({ length: n }, (_, i) => `t${Math.floor(r() * 1000)}_${i}:${(r() * 2).toFixed(3)}`);
  while (parts.length > 1) {
    const i = Math.floor(r() * (parts.length - 1));
    parts.splice(i, 2, `(${parts[i]},${parts[i + 1]}):${(r() * 2).toFixed(3)}`);
  }
  return parseNewick(parts[0] + ';');
}

/** A source that counts its subscriptions. */
class CountingSource {
  constructor(tree, counter) {
    this.inner = new InMemorySource(tree);
    this.counter = counter;
    this.version = 0;
    this.nodeCount = this.inner.nodeCount;
    this.tipCount = this.inner.tipCount;
  }
  subscribe() {
    this.counter.live++;
    let done = false;
    return () => {
      if (!done) this.counter.live--;
      done = true;
    };
  }
  snapshot() {
    return this.inner.snapshot();
  }
  ensureClade() {
    return Promise.resolve();
  }
}

function listenerCounts(viewer) {
  const m = viewer.events.map; // private, read for the test
  const o = {};
  for (const [k, list] of m) o[k] = list.length;
  return o;
}

test('setTree x100: no leaks, consistent state', async () => {
  const counter = { live: 0 };
  const first = randomTree(50, 1);
  const { viewer, env } = await makeViewer(first, {});
  env.flush();
  const controls = [
    new Zoom(),
    new Search(),
    new Legend(),
    new OverviewControl(),
    new LayoutToggle(),
    new Tooltip(),
    new NodeMenu({ items: () => [] }),
  ];
  for (const c of controls) viewer.addControl(c);
  env.flush();
  // switch the first tree to a counting source so the subscription is visible
  viewer.setTree(new CountingSource(first, counter));
  env.flush();
  assert.equal(counter.live, 1);
  const base = listenerCounts(viewer);
  const rootKids = viewer.root.children.length;
  const uiKids = viewer.container.children.length;
  const schemes = env.schemeListenerCount();
  const ros = env.observers.filter((o) => !o.disconnected).length;
  let treechanges = 0;
  viewer.on('treechange', () => treechanges++);
  let prev = first;
  for (let k = 0; k < 100; k++) {
    const kind = k % 5;
    let next, map;
    if (kind === 0) {
      next = randomTree(10 + ((k * 37) % 300), 100 + k);
    } else if (kind === 1) {
      const r = ops.reroot(prev, Math.max(1, (k * 7) % prev.nodeCount));
      next = r.tree;
      map = r.map;
    } else if (kind === 2) {
      const r = ops.prune(prev, (rank) => rank % 3 !== 0 || prev.tipCount < 6);
      next = r.tree;
      map = r.map;
    } else if (kind === 3) {
      const r = ops.ladderise(prev);
      next = r.tree;
      map = r.map;
    } else {
      const inner = [];
      for (let i = 1; i < prev.nodeCount && inner.length < 2; i++)
        if (prev.childCount[i] > 0 && prev.leafEnd[i] - prev.leafStart[i] < 6) inner.push(i);
      const r = ops.collapseClades(prev, inner);
      next = r.tree;
      map = r.map;
    }
    if (k % 2) viewer.setViewport({ x0: 0.2, x1: 0.6, y0: 1, y1: Math.min(5, prev.tipCount) });
    if (k % 7 === 0) viewer.fit(true); // an animation in flight at the swap
    if (k % 11 === 0) viewer.setOptions({ layout: k % 22 === 0 ? 'radial' : 'rectangular' });
    viewer.setClades([{ node: 1, colour: 'red' }]);
    viewer.setHighlighted([prev.tipLabels[0]]);
    viewer.setTree(new CountingSource(next, counter), { map });
    env.flush(5);
    const t = viewer.getTree();
    assert.equal(t.tipCount, next.tipCount, 'tree in force');
    assert.equal(counter.live, 1, `one live subscription after ${k}`);
    const v = viewer.getViewport();
    for (const x of Object.values(v)) assert.ok(Number.isFinite(x), 'finite viewport ' + JSON.stringify(v));
    assert.ok(v.x1 > v.x0 && v.y1 > v.y0);
    for (const c of viewer.getClades()) assert.ok(c.node < t.nodeCount, 'clade node in range');
    assert.ok(
      viewer.layout.X.length >= t.nodeCount && viewer.layout.X.length <= t.nodeCount + 1,
      'layout of the new tree ' + viewer.layout.X.length + ' ' + t.nodeCount,
    );
    // hover / click picking does not throw against the new tree
    viewer.nodeBounds(0);
    viewer.locateNode(t.tipNode[0]);
    prev = next;
  }
  env.flush();
  assert.equal(treechanges, 100);
  const after = listenerCounts(viewer);
  after.treechange -= 1; // ours
  assert.deepEqual(after, base, 'listener counts unchanged');
  assert.equal(viewer.root.children.length, rootKids, 'root children unchanged');
  assert.equal(viewer.container.children.length, uiKids);
  assert.equal(env.schemeListenerCount(), schemes);
  assert.equal(env.observers.filter((o) => !o.disconnected).length, ros);
  assert.ok(env.pendingFrames() <= 1, 'no frame loop left running: ' + env.pendingFrames());
  viewer.destroy();
  assert.equal(counter.live, 0, 'destroy drops the last subscription');
});
