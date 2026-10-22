// Unit tests of the selection (#61): `setSelected` / `getSelected` / `selectionchange`, the ring on the top canvas (theme tokens), a click
// selecting by default, and what keeps it: switches of layout and branch lengths (which also keep the keyboard cursor, and centre the
// new view on the selection instead of fitting), `setTree` through its map, and collapsing (a hidden node selects its clade).
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeViewer, destroyAll } from './viewer-harness.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const { parseNewick } = await import(path.join(root, 'packages/io/src/newick.ts'));

afterEach(destroyAll);

// 32 tips with lengths, balanced, so a middle tip can be centred in both layouts
function balanced(depth) {
  let n = 0;
  const go = (d) => (d === 0 ? `t${n++}:1` : `(${go(d - 1)},${go(d - 1)}):${d % 2 ? 0.5 : 2}`);
  return go(depth) + ';';
}
const NWK = balanced(5);
const make = (init = {}) => makeViewer(NWK, { size: [600, 400], ...init });
const tipId = (viewer, label) => viewer.tipNode(label);

/** The rings of the last drawn top frame, as [x, y, radius, strokeStyle, lineWidth]. */
function rings(top) {
  const log = top.log;
  let start = 0;
  for (let i = 0; i < log.length; i++) if (log[i][0] === 'clearRect') start = i;
  const out = [];
  let stroke = '',
    width = 1;
  for (let i = start; i < log.length; i++) {
    const [k, ...a] = log[i];
    if (k === 'strokeStyle=') stroke = a[0];
    else if (k === 'lineWidth=') width = a[0];
    else if (k === 'arc') out.push([a[0], a[1], a[2], stroke, width]);
  }
  return out;
}
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
const ringAt = (rs, p, radius) => rs.some((r) => near(r[0], p.x) && near(r[1], p.y) && (radius === undefined || r[2] === radius));

test('setSelected / getSelected: a node id or null, selectionchange on a change only, unknown ids ignored with a warning', async () => {
  const { viewer, env } = await make();
  env.flush();
  const seen = [];
  viewer.on('selectionchange', (e) => seen.push(e.node));
  assert.equal(viewer.getSelected(), null);
  const t5 = tipId(viewer, 't5');
  viewer.setSelected(t5);
  viewer.setSelected(t5);
  assert.equal(viewer.getSelected(), t5);
  viewer.setSelected(0); // an internal node (the root) can be selected too
  const warn = console.warn;
  const warned = [];
  console.warn = (m) => warned.push(m);
  try {
    viewer.setSelected(10_000);
    viewer.setSelected(1.5);
  } finally {
    console.warn = warn;
  }
  assert.equal(warned.length, 2, 'two warnings');
  assert.equal(viewer.getSelected(), 0, 'ignored: the selection is unchanged');
  viewer.setSelected(null);
  assert.deepEqual(seen, [t5, 0, null]);
});

test('the selection ring: drawn at the node in selectionColour (default foreground) on a background halo; theme and CSS tokens', async () => {
  const { viewer, env, top } = await make({ cssVars: { '--phylo-selection-width': '4', '--phylo-selection-radius': '9px' } });
  env.flush();
  const id = tipId(viewer, 't9');
  viewer.setSelected(id);
  env.flush();
  const p = viewer.nodePosition(id);
  const th = viewer.getTheme();
  assert.equal(th.selectionWidth, 4);
  assert.equal(th.selectionRadius, 9);
  let rs = rings(top()).filter((r) => near(r[0], p.x) && near(r[1], p.y));
  assert.deepEqual(
    rs.map((r) => [r[2], r[3], r[4]]),
    [
      [9, th.background, 6],
      [9, th.foreground, 4],
    ],
    'halo, then the ring',
  );
  viewer.setTheme({ selectionColour: '#ff0000' });
  env.flush();
  rs = rings(top()).filter((r) => near(r[0], p.x) && near(r[1], p.y));
  assert.equal(rs.at(-1)[3], '#ff0000');
  viewer.setTheme({ selectionWidth: 0 });
  env.flush();
  assert.equal(rings(top()).length, 0, 'a width of 0 draws no ring');
  viewer.setTheme({});
  viewer.setSelected(null);
  env.flush();
  assert.equal(rings(top()).length, 0, 'nothing selected, no ring');
});

test('a click selects its node by default; preventDefault() in a click listener stops it', async () => {
  const { viewer, env } = await make();
  env.flush();
  const host = viewer.inputHost();
  const a = tipId(viewer, 't3');
  host.activate(a); // Enter on the keyboard cursor: a click
  assert.equal(viewer.getSelected(), a);
  const stop = viewer.on('click', (e) => e.preventDefault());
  host.activate(tipId(viewer, 't4'));
  assert.equal(viewer.getSelected(), a, 'prevented: unchanged');
  stop();
  host.activate(0);
  assert.equal(viewer.getSelected(), 0, 'an internal node');
});

for (const [what, patch, back] of [
  ['layout', { layout: 'radial' }, { layout: 'rectangular' }],
  ['branch lengths', { branchLengths: false }, { branchLengths: true }],
]) {
  test(`setOptions(${what}): the keyboard cursor and the selection stay, and their rings are drawn at the node's new position`, async () => {
    const { viewer, env, top } = await make();
    env.flush();
    const cursor = tipId(viewer, 't15'); // next to the selection: in view whenever it is
    const sel = tipId(viewer, 't14');
    viewer.setActive(cursor);
    viewer.setSelected(sel);
    env.flush();
    const changes = [];
    viewer.on('selectionchange', (e) => changes.push(e.node));
    for (const step of [patch, back, patch]) {
      const was = viewer.nodePosition(sel);
      viewer.overlay.live.textContent = '';
      viewer.setOptions(step);
      env.flush();
      assert.equal(viewer.activeNode, cursor, 'the cursor is kept');
      assert.equal(viewer.getSelected(), sel, 'the selection is kept');
      const p = viewer.nodePosition(sel);
      assert.ok(p, 'the selected tip is in view');
      assert.ok(!was || !near(was.x, p.x, 0.5) || !near(was.y, p.y, 0.5), 'the node moved');
      const rs = rings(top());
      assert.ok(ringAt(rs, p, viewer.getTheme().selectionRadius), 'the selection ring is at its new position');
      const c = viewer.nodePosition(cursor);
      assert.ok(c, 'the cursor tip is in view');
      assert.ok(ringAt(rs, c, 10), 'the cursor ring is at its new position');
      assert.equal(viewer.overlay.live.textContent, 't15', 'the cursor is announced again');
    }
    assert.deepEqual(changes, [], 'no selectionchange');
  });
}

test('a switch with a tip selected centres the new view on it (rectangular and radial); with nothing selected it is fitted', async () => {
  const { viewer, env } = await make();
  env.flush();
  const sel = tipId(viewer, 't13');
  viewer.setSelected(sel);
  for (const o of [{ layout: 'radial' }, { branchLengths: false }, { layout: 'rectangular' }, { branchLengths: true }]) {
    viewer.setOptions(o);
    env.flush();
    const p = viewer.nodePosition(sel);
    assert.ok(p, `${JSON.stringify(o)}: in view`);
    const a = viewer.vs.area;
    if (viewer.options.layout === 'radial') {
      assert.ok(near(p.x, 300, 0.5) && near(p.y, 200, 0.5), `${JSON.stringify(o)}: centred (${p.x}, ${p.y})`);
    } else {
      assert.ok(near(p.y, a.ay + a.ah / 2, 0.5), `${JSON.stringify(o)}: centred vertically (${p.y} in ${a.ay}..${a.ay + a.ah})`);
      assert.ok(p.x >= a.ax && p.x <= a.ax + a.aw + 0.5, 'and inside the plot horizontally');
    }
    assert.equal(viewer.vs.fitted, false, 'not the fit view');
  }
  viewer.setSelected(null);
  viewer.setOptions({ layout: 'radial' });
  env.flush();
  assert.equal(viewer.vs.fitted, true, 'nothing selected: fitted');
  assert.deepEqual(viewer.getViewport(), viewer.fitViewport());
});

test('a switch with a clade selected frames the clade', async () => {
  const { viewer, env } = await make();
  env.flush();
  const t = viewer.getTree();
  const clade = t.parent[t.parent[tipId(viewer, 't9')]]; // 4 tips
  viewer.setSelected(clade);
  for (const o of [{ layout: 'radial' }, { layout: 'rectangular' }, { branchLengths: false }]) {
    viewer.setOptions(o);
    env.flush();
    const T = viewer.T;
    for (let r = t.leafStart[clade]; r < t.leafEnd[clade]; r++) {
      const p = viewer.nodePosition(t.tipNode[r]);
      assert.ok(p && p.x >= T.clipL && p.x <= T.clipR && p.y >= T.clipT && p.y <= T.clipB, `${JSON.stringify(o)}: tip rank ${r} in view`);
    }
    const out = viewer.nodePosition(tipId(viewer, 't0'));
    assert.equal(out, null, `${JSON.stringify(o)}: zoomed in on it (a tip far from it is out of view)`);
  }
});

test('collapsing a clade around the selection selects the clade (and moves the cursor there); expanding keeps it on the clade', async () => {
  const { viewer, env, top } = await make();
  env.flush();
  const t = viewer.getTree();
  const tip = tipId(viewer, 't6');
  const clade = t.parent[t.parent[tip]];
  viewer.setSelected(tip);
  viewer.setActive(tip);
  const seen = [];
  viewer.on('selectionchange', (e) => seen.push(e.node));
  viewer.setCollapsed([clade]);
  env.flush();
  assert.equal(viewer.getSelected(), clade);
  assert.equal(viewer.activeNode, clade, 'the cursor moved to the clade');
  assert.deepEqual(seen, [clade]);
  assert.ok(ringAt(rings(top()), viewer.nodePosition(clade), viewer.getTheme().selectionRadius), 'the ring is on the clade');
  viewer.setSelected(tip);
  assert.equal(viewer.getSelected(), clade, 'selecting a hidden node selects its collapsed clade');
  viewer.setCollapsed([]);
  assert.equal(viewer.getSelected(), clade);
});

test('setTree: the selection follows the map (removed: none); without a map it is dropped', async () => {
  const { viewer, env } = await make();
  env.flush();
  const n = viewer.getTree().nodeCount;
  const ident = Int32Array.from({ length: n }, (_, i) => i);
  viewer.setSelected(7);
  const seen = [];
  viewer.on('selectionchange', (e) => seen.push(e.node));
  const shift = ident.map((i) => (i === 7 ? 8 : i === 8 ? 7 : i));
  viewer.setTree(parseNewick(NWK), { map: shift });
  assert.equal(viewer.getSelected(), 8, 'through the map');
  viewer.setTree(parseNewick(NWK), { map: ident.map((i) => (i === 8 ? -1 : i)) });
  assert.equal(viewer.getSelected(), null, 'its node is gone');
  viewer.setSelected(3);
  viewer.setTree(parseNewick(NWK));
  assert.equal(viewer.getSelected(), null, 'no map: dropped');
  assert.deepEqual(seen, [8, null, 3, null]);
});
