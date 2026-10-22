// Unit tests of the rings that say which node an action is for (#65): the node menu's target (opening the menu selects the node, so the
// selection ring stays on it while the pointer is in the menu) and `setMarked` (the pending pick of a two-step action such as a swap),
// with its theme tokens, and what keeps it: pans and zooms, layout switches, collapsing and `setTree` through its map.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeViewer, destroyAll } from './viewer-harness.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const { parseNewick } = await import(path.join(root, 'packages/io/src/newick.ts'));
const { NodeMenu } = await import('../src/overlays/index.ts');

afterEach(destroyAll);

function balanced(depth) {
  let n = 0;
  const go = (d) => (d === 0 ? `t${n++}:1` : `(${go(d - 1)},${go(d - 1)}):1`);
  return go(depth) + ';';
}
const NWK = balanced(4);
const make = (init = {}) => makeViewer(NWK, { size: [600, 400], ...init });

/** The rings of the last drawn top frame, as [x, y, radius, strokeStyle, lineWidth, dash]; a path stroked once holds every arc in it. */
function rings(top) {
  const log = top.log;
  let start = 0;
  for (let i = 0; i < log.length; i++) if (log[i][0] === 'clearRect') start = i;
  const out = [];
  let stroke = '',
    width = 1,
    dash = [],
    path = [];
  for (let i = start; i < log.length; i++) {
    const [k, ...a] = log[i];
    if (k === 'strokeStyle=') stroke = a[0];
    else if (k === 'lineWidth=') width = a[0];
    else if (k === 'setLineDash') dash = a[0];
    else if (k === 'beginPath') path = [];
    else if (k === 'arc') path.push(a);
    else if (k === 'stroke') for (const p of path) out.push([p[0], p[1], p[2], stroke, width, dash]);
  }
  return out;
}
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
const ringsAt = (rs, p, radius) => rs.filter((r) => near(r[0], p.x) && near(r[1], p.y) && (radius === undefined || r[2] === radius));

test('the node menu: opening it selects the node, whose ring stays after the pointer leaves the node for the menu', async () => {
  const { viewer, env, top } = await make();
  globalThis.addEventListener ??= () => {}; // the menu's window listeners (a press outside, Escape) are not exercised here
  globalThis.removeEventListener ??= () => {};
  const menu = new NodeMenu({ items: () => [{ id: 'a', label: 'A', onSelect() {} }] });
  viewer.addControl(menu);
  env.flush();
  const host = viewer.inputHost();
  const n = viewer.tipNode('t5');
  const p = viewer.nodePosition(n);
  host.hover(p);
  env.flush();
  const sr = viewer.getTheme().selectionRadius;
  assert.equal(ringsAt(rings(top()), p).length > 0, true, 'hovered: a ring');
  const hit = host.pick(p.x, p.y);
  assert.ok(hit, 'the tip is hit');
  host.click(hit, p.x, p.y);
  env.flush();
  assert.equal(menu.isOpen(), true, 'the menu is open');
  assert.equal(viewer.getSelected(), n, 'its node is selected');
  host.hover(null); // the pointer moves off the tree into the menu
  env.flush();
  assert.ok(ringsAt(rings(top()), p, sr).length > 0, 'the ring stays at the node while the menu is open');
  menu.close(false);
  env.flush();
  assert.ok(ringsAt(rings(top()), p, sr).length > 0, 'and after: it is the selection');
  // opened by the app (not by a click): it selects too
  const m = viewer.tipNode('t9');
  viewer.setSelected(null);
  menu.openAt(viewer, { node: m, run: null, isTip: true, tipId: 't9', clientX: 0, clientY: 0, via: 'pointer' });
  env.flush();
  assert.equal(viewer.getSelected(), m);
  assert.ok(ringsAt(rings(top()), viewer.nodePosition(m), sr).length > 0, 'the ring is on the node the menu was opened for');
});

test('setMarked draws a dashed ring on a halo at each node, in the mark tokens; [] clears them; unknown ids are warned about', async () => {
  const { viewer, env, top } = await make({ cssVars: { '--phylo-mark-width': '3', '--phylo-mark-radius': '12px', '--phylo-mark-dash': '4 1' } });
  env.flush();
  const th = viewer.getTheme();
  assert.equal(th.markWidth, 3);
  assert.equal(th.markRadius, 12);
  assert.equal(th.markDash, '4 1');
  const a = viewer.tipNode('t2'),
    b = viewer.tipNode('t3');
  viewer.setMarked([a, b]);
  env.flush();
  assert.deepEqual(viewer.getMarked(), [a, b]);
  for (const n of [a, b]) {
    const rs = ringsAt(rings(top()), viewer.nodePosition(n), 12);
    assert.deepEqual(
      rs.map((r) => [r[3], r[4], r[5]]),
      [
        [th.background, 5, []],
        [th.highlight, 3, [4, 1]],
      ],
      'a solid halo of the background, then the dashed ring in highlight',
    );
  }
  viewer.setTheme({ markColour: '#ff0000', markDash: 'none' });
  env.flush();
  const last = ringsAt(rings(top()), viewer.nodePosition(a), 12).at(-1);
  assert.equal(last[3], '#ff0000');
  assert.deepEqual(last[5], [], "'none' is solid");
  viewer.setTheme({ markWidth: 0 });
  env.flush();
  assert.equal(rings(top()).length, 0, 'a width of 0 draws no ring');
  viewer.setTheme({});
  const warn = console.warn;
  const warned = [];
  console.warn = (m) => warned.push(m);
  try {
    viewer.setMarked([a, 10_000]);
  } finally {
    console.warn = warn;
  }
  assert.equal(warned.length, 1);
  assert.deepEqual(viewer.getMarked(), [a]);
  viewer.setMarked([]);
  env.flush();
  assert.equal(rings(top()).length, 0, 'cleared');
});

test('the marks and the selection ring are both drawn, and so is the hover ring of a candidate: the two picks of a swap', async () => {
  const { viewer, env, top } = await make();
  env.flush();
  const th = viewer.getTheme();
  const a = viewer.tipNode('t4'),
    b = viewer.tipNode('t5');
  viewer.setSelected(a);
  viewer.setMarked([a]);
  viewer.inputHost().hover(viewer.nodePosition(b));
  env.flush();
  const rs = rings(top());
  assert.ok(ringsAt(rs, viewer.nodePosition(a), th.markRadius).length === 2, 'the mark');
  assert.ok(ringsAt(rs, viewer.nodePosition(a), th.selectionRadius).length === 2, 'the selection');
  assert.ok(ringsAt(rs, viewer.nodePosition(b), 6).length === 1, 'the hover ring of the candidate');
});

test('a mark follows its node through a pan, a zoom and a layout switch, and sits on a collapsed clade that hides it', async () => {
  const { viewer, env, top } = await make();
  env.flush();
  const n = viewer.tipNode('t6');
  viewer.setMarked([n]);
  env.flush();
  const R = viewer.getTheme().markRadius;
  const v = viewer.getViewport();
  const h = v.y1 - v.y0;
  const steps = [
    () => viewer.setViewport({ x0: v.x0, x1: v.x1, y0: v.y0 + h * 0.2, y1: v.y0 + h * 0.7 }), // zoom
    () => viewer.setViewport({ x0: v.x0, x1: v.x1, y0: v.y0 + h * 0.25, y1: v.y0 + h * 0.75 }), // pan
    () => viewer.setOptions({ layout: 'radial' }),
  ];
  for (const step of steps) {
    const was = viewer.nodePosition(n);
    step();
    env.flush();
    const p = viewer.nodePosition(n);
    assert.ok(p && (!near(was.x, p.x, 0.5) || !near(was.y, p.y, 0.5)), 'the node moved');
    assert.equal(ringsAt(rings(top()), p, R).length, 2, 'the mark is at its new position');
  }
  const t = viewer.getTree();
  const clade = t.parent[t.parent[n]];
  viewer.setCollapsed([clade]);
  env.flush();
  assert.equal(ringsAt(rings(top()), viewer.nodePosition(clade), R).length, 2, 'on the clade');
  assert.deepEqual(viewer.getMarked(), [n], 'getMarked gives what was set');
  viewer.setCollapsed([]);
  env.flush();
  assert.equal(ringsAt(rings(top()), viewer.nodePosition(n), R).length, 2, 'expanded: on the tip again');
});

test('setTree: the marks follow the map (removed: dropped); without a map they are dropped', async () => {
  const { viewer, env } = await make();
  env.flush();
  const count = viewer.getTree().nodeCount;
  const ident = Int32Array.from({ length: count }, (_, i) => i);
  viewer.setMarked([7, 9]);
  viewer.setTree(parseNewick(NWK), { map: ident.map((i) => (i === 7 ? 8 : i === 8 ? 7 : i === 9 ? -1 : i)) });
  assert.deepEqual(viewer.getMarked(), [8]);
  viewer.setTree(parseNewick(NWK));
  assert.deepEqual(viewer.getMarked(), []);
});
