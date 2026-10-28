// Unit tests of the view kept across a switch of layout or branch lengths (#56, option `switchView`): a zoomed clade's tips stay mostly
// in view at about the same tip pitch, rectangular <-> radial and phylogram <-> cladogram; a fitted view stays fitted; 'fit' fits; a
// radial window over the place where the two ends of the fan meet keeps the end with more tips; the selection does not pull the view.
// Through a real viewer over the fake DOM (viewer-harness.mjs), and `viewContent` / `placeContent` directly.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { makeViewer, destroyAll } from './viewer-harness.mjs';
import { viewContent } from '../src/view-carry.ts';

afterEach(destroyAll);

/** A balanced tree of 2^depth tips with uneven lengths (so phylogram and cladogram differ), tips t0, t1, ... in preorder. */
function balanced(depth) {
  let n = 0;
  const go = (d) => {
    if (d === 0) return `t${n++}:${1 + (n % 3) * 0.7}`;
    return `(${go(d - 1)},${go(d - 1)}):${0.5 + (d % 3) * 0.6}`;
  };
  return go(depth) + ';';
}
const SIZE = [800, 600];
const make = (nwk, options = {}) => makeViewer(nwk, { size: SIZE, options: { maxTipSpacing: Infinity, ...options } });

/** The tip ranks in view (their node inside the clip), and the tip pitch there: rectangular the row height, radial the arc between
 *  neighbouring tips at their median radius. */
function inView(viewer) {
  const t = viewer.getTree();
  const ranks = [];
  const radii = [];
  for (let r = 0; r < t.tipCount; r++) {
    if (viewer.nodePosition(t.tipNode[r])) {
      ranks.push(r);
      radii.push(viewer.layout.X[t.tipNode[r]]);
    }
  }
  const T = viewer.T;
  radii.sort((a, b) => a - b);
  const pitch = T.kind === 'rectangular' ? T.ky : T.k * T.da * (radii[radii.length >> 1] ?? 0);
  return { ranks, pitch };
}
const share = (a, b) => a.filter((r) => b.includes(r)).length / a.length;

async function zoomed(nwk, layout, clade = 'mid', options = {}) {
  const { viewer, env, target } = await make(nwk, { layout, ...options });
  env.flush();
  const t = viewer.getTree();
  // a clade of 8 tips in the middle of the tree (or at its start), framed as zoomToNode does, then zoomed in about its centre
  const tip = t.tipNode[clade === 'mid' ? (t.tipCount >> 1) + 3 : 3];
  const node = t.parent[t.parent[t.parent[tip]]];
  viewer.zoomToNode(node);
  env.flush();
  return { viewer, env, node, target };
}

const cladeTips = (viewer, node) => {
  const t = viewer.getTree();
  return Array.from({ length: t.leafEnd[node] - t.leafStart[node] }, (_, i) => t.leafStart[node] + i);
};

for (const [from, to] of [
  ['rectangular', 'radial'],
  ['radial', 'rectangular'],
]) {
  for (const lengths of [true, false]) {
    for (const where of ['mid', 'start']) {
      test(`${from} -> ${to} (${lengths ? 'phylogram' : 'cladogram'}, clade at the ${where}): the zoomed clade stays in view at about the same pitch, also after three round trips with the view moved a little`, async () => {
        const { viewer, env, node } = await zoomed(balanced(9), from, where, { branchLengths: lengths });
        const clade = cladeTips(viewer, node);
        const a = inView(viewer);
        assert.ok(a.ranks.length >= 8 && a.ranks.length < 100, `zoomed: ${a.ranks.length} tips in view`);
        assert.ok(share(clade, a.ranks) === 1, 'the clade is in view');
        for (let trip = 0; trip < 3; trip++) {
          for (const kind of [to, from]) {
            // nudged by a hundredth of the window first, so this is not a switch back to a window left untouched (which is restored)
            const v = viewer.getViewport();
            const d = (v.x1 - v.x0) / 100;
            viewer.setViewport({ ...v, x0: v.x0 + d, x1: v.x1 + d });
            viewer.setOptions({ layout: kind });
            env.flush();
            const b = inView(viewer);
            const at = `trip ${trip}, ${kind}`;
            assert.equal(viewer.vs.fitted, false, `${at}: not fitted`);
            // after the first switch every tip of the clade; later, moved a little each time, 3/4 of them (each switch holds the tips in
            // view, which are not centred on the clade where it is at an end of the tree, so the window walks a little; measured: at
            // most 1 of 8 lost). Radial to rectangular keeps the middle 2/3 of the radial window's tips (measured 0.67), the pitch
            // drops to 3/4 at most (measured 0.79, a phylogram's tips at different depths going to radial) and never rises.
            const want = trip === 0 && kind === to ? 1 : 0.75;
            assert.ok(share(clade, b.ranks) >= want, `${at}: the clade's tips ${clade} in view: ${b.ranks}`);
            assert.ok(share(a.ranks, b.ranks) >= 0.65, `${at}: most tips kept: ${share(a.ranks, b.ranks)} of ${a.ranks} in ${b.ranks}`);
            assert.ok(b.pitch >= 0.75 * a.pitch && b.pitch < 1.001 * a.pitch, `${at}: pitch ${a.pitch} -> ${b.pitch}`);
          }
        }
      });
    }
  }
}

test('switched back untouched, the view goes back to the window it came from', async () => {
  for (const from of ['rectangular', 'radial']) {
    const { viewer, env } = await zoomed(balanced(9), from);
    const v = viewer.getViewport();
    for (const o of [{ layout: from === 'radial' ? 'rectangular' : 'radial' }, { branchLengths: false }]) {
      viewer.setOptions(o);
      env.flush();
      assert.notDeepEqual(viewer.getViewport(), v);
      viewer.setOptions({ layout: from, branchLengths: true });
      env.flush();
      assert.deepEqual(viewer.getViewport(), v, `${from}, ${JSON.stringify(o)}`);
    }
    destroyAll();
  }
});

test('rectangular, branch lengths: the y window is kept exactly and the tips in view stay in view horizontally', async () => {
  for (const lengths of [true, false]) {
    const { viewer, env } = await zoomed(balanced(9), 'rectangular', 'mid', { branchLengths: lengths });
    const v = viewer.getViewport();
    const a = inView(viewer);
    viewer.setOptions({ branchLengths: !lengths });
    env.flush();
    const w = viewer.getViewport();
    assert.equal(w.y0, v.y0);
    assert.equal(w.y1, v.y1);
    assert.deepEqual(inView(viewer).ranks, a.ranks, `${lengths}: the same tips, inside the plot horizontally too`);
    destroyAll();
  }
});

test('radial, branch lengths: the tips in view stay in view at about the same pitch', async () => {
  for (const lengths of [true, false]) {
    const { viewer, env } = await zoomed(balanced(9), 'radial', 'mid', { branchLengths: lengths });
    const a = inView(viewer);
    viewer.setOptions({ branchLengths: !lengths });
    env.flush();
    const b = inView(viewer);
    assert.ok(share(a.ranks, b.ranks) >= 0.8, `${lengths}: ${a.ranks} in ${b.ranks}`);
    assert.ok(b.pitch > 0.9 * a.pitch && b.pitch < 1.001 * a.pitch, `${lengths}: pitch ${a.pitch} -> ${b.pitch}`);
    destroyAll();
  }
});

test('a layout and branch-length switch at once keeps the tips too', async () => {
  const { viewer, env } = await zoomed(balanced(9), 'rectangular');
  const a = inView(viewer);
  viewer.setOptions({ layout: 'radial', branchLengths: false });
  env.flush();
  assert.ok(share(a.ranks, inView(viewer).ranks) >= 0.8);
});

test('a fitted view stays fitted; switchView "fit" fits a zoomed one', async () => {
  const { viewer, env } = await make(balanced(7));
  env.flush();
  for (const o of [{ layout: 'radial' }, { branchLengths: false }, { layout: 'rectangular' }, { branchLengths: true }]) {
    viewer.setOptions(o);
    env.flush();
    assert.equal(viewer.vs.fitted, true, JSON.stringify(o));
    assert.deepEqual(viewer.getViewport(), viewer.fitViewport());
  }
  viewer.setOptions({ switchView: 'fit' });
  const t = viewer.getTree();
  viewer.zoomToNode(t.parent[t.parent[t.tipNode[40]]]);
  for (const o of [{ layout: 'radial' }, { branchLengths: false }]) {
    viewer.setOptions(o);
    env.flush();
    assert.equal(viewer.vs.fitted, true, `'fit': ${JSON.stringify(o)}`);
    viewer.zoomToNode(t.parent[t.parent[t.tipNode[40]]]);
  }
});

test('a view zoomed out less than the new fit is fitted, not shown smaller than the fit', async () => {
  const { viewer, env } = await make(balanced(7));
  env.flush();
  const f = viewer.getViewport();
  viewer.setViewport({ ...f, y0: f.y0 + 2, y1: f.y1 - 2 }); // nearly the whole tree: in the radial layout that is less than its fit
  env.flush();
  assert.equal(viewer.vs.fitted, false);
  viewer.setOptions({ layout: 'radial' });
  env.flush();
  assert.equal(viewer.vs.fitted, true);
});

test('radial -> rectangular across the place where the ends meet: the end with more of the tips in view is kept', async () => {
  for (const more of ['first', 'last']) {
    const { viewer, env } = await make(balanced(8), { layout: 'radial', radialOpening: 0, radialRotation: 0 });
    env.flush();
    const t = viewer.getTree();
    const N = t.tipCount;
    // the full fan starts at 3 o'clock: row 0 just below the x axis (angles run clockwise), the last row just above it
    const L = viewer.layout;
    assert.equal(L.fan.start, 0);
    const r0 = L.X[t.tipNode[0]];
    const v = viewer.getViewport();
    const k = viewer.vs.area.aw / (v.x1 - v.x0);
    const kz = k * 12;
    const hw = viewer.vs.area.aw / 2 / kz,
      hh = viewer.vs.area.ah / 2 / kz;
    const da = (2 * Math.PI) / N;
    const off = (more === 'first' ? 3 : -3) * da * r0; // the window's centre moved toward that end
    viewer.setViewport({ x0: r0 - hw, x1: r0 + hw, y0: off - hh, y1: off + hh });
    env.flush();
    const a = inView(viewer).ranks;
    const first = a.filter((r) => r < N / 2).length,
      last = a.length - first;
    assert.ok(first > 0 && last > 0, `both ends in view: ${a}`);
    assert.ok(more === 'first' ? first > last : last > first, `${more}: ${first} first, ${last} last`);
    viewer.setOptions({ layout: 'rectangular' });
    env.flush();
    const b = inView(viewer).ranks;
    const kept = a.filter((r) => (more === 'first' ? r < N / 2 : r >= N / 2));
    assert.ok(share(kept, b) >= 0.8, `${more}: the ${more} end kept (${kept} in ${b})`);
    assert.ok(
      b.every((r) => (more === 'first' ? r < N / 2 : r >= N / 2)),
      `${more}: only that end (${b})`,
    );
    destroyAll();
  }
});

test('a switch keeps the view, not the selection: a selected tip out of view does not pull the view to it', async () => {
  const { viewer, env } = await zoomed(balanced(8), 'rectangular');
  const t = viewer.getTree();
  const far = t.tipNode[0];
  viewer.setSelected(far);
  assert.equal(viewer.nodePosition(far), null, 'the selected tip is out of view');
  const a = inView(viewer).ranks;
  for (const o of [{ layout: 'radial' }, { branchLengths: false }, { layout: 'rectangular' }]) {
    viewer.setOptions(o);
    env.flush();
    assert.equal(viewer.nodePosition(far), null, `${JSON.stringify(o)}: still out of view`);
    assert.ok(share(a, inView(viewer).ranks) >= 0.8, `${JSON.stringify(o)}: the tips in view kept`);
    assert.equal(viewer.getSelected(), far, 'the selection stays');
  }
});

test('viewContent: the rows in view, sampled on a big window; null for a radial window with no tip', async () => {
  const { viewer, env } = await make(balanced(8));
  env.flush();
  const L = viewer.layout,
    tree = viewer.getTree(),
    area = viewer.vs.area;
  const c = viewContent('rectangular', { x0: 0, x1: 1, y0: 10.2, y1: 20.6 }, area, L, tree);
  assert.deepEqual(Array.from(c.rows.subarray(0, c.count)), [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
  assert.ok(Math.abs(c.pitch - area.ah / 10.4) < 1e-9);
  // radial: a small window around the root holds no tip
  assert.equal(viewContent('radial', { x0: -0.01, x1: 0.01, y0: -0.01, y1: 0.01 }, area, L, tree), null);
});

// what happens in the other layout between two switches can change what the first window means: switched back, the tips that were in
// view are in view again (the window is placed afresh, not restored), whatever changed
for (const [what, change] of [
  ['radialRotation', (v) => v.setOptions({ radialRotation: 200 })],
  ['radialOpening', (v) => v.setOptions({ radialOpening: 0.6 })],
  ['alignLabels', (v) => v.setOptions({ alignLabels: true })],
  ['the label size', (v) => v.setTheme({ labelSize: 20 })],
  ['the size', (_v, env, target) => env.resize(target, 700, 500)],
  ['collapsed clades', (v) => v.setCollapsed([v.getTree().parent[v.getTree().tipNode[3]]])],
]) {
  test(`radial -> rectangular, ${what} changed, -> radial: the tips that were in view are in view again`, async () => {
    // a clade near the start of the fan, which a new opening moves
    const { viewer, env, target } = await zoomed(balanced(8), 'radial', 'start');
    const a = inView(viewer);
    viewer.setOptions({ layout: 'rectangular' });
    env.flush();
    change(viewer, env, target);
    env.flush();
    viewer.setOptions({ layout: 'radial' });
    env.flush();
    const b = inView(viewer);
    assert.ok(share(a.ranks, b.ranks) >= 0.8, `${what}: ${a.ranks} in ${b.ranks}`);
  });
}

for (const patch of [{ radialRotation: 200 }, { radialOpening: 0.3 }]) {
  for (const [from, to] of [
    ['radial', { layout: 'rectangular' }],
    ['radial', { branchLengths: false }],
    ['rectangular', { layout: 'radial' }],
  ]) {
    test(`${from}, ${JSON.stringify({ ...to, ...patch })} in one call: the tips in view stay in view`, async () => {
      const { viewer, env } = await zoomed(balanced(8), from);
      const a = inView(viewer);
      viewer.setOptions({ ...to, ...patch });
      env.flush();
      const b = inView(viewer);
      assert.ok(share(a.ranks, b.ranks) >= 0.65, `${a.ranks} in ${b.ranks}`);
      if (to.layout === 'rectangular') {
        // the rectangular window does not depend on the fan: the same as without the new fan
        const ref = await zoomed(balanced(8), from);
        ref.viewer.setOptions(to);
        ref.env.flush();
        const w = ref.viewer.getViewport(),
          v = viewer.getViewport();
        for (const k of ['x0', 'x1', 'y0', 'y1']) assert.ok(Math.abs(w[k] - v[k]) < 1e-9, `${k}: ${v[k]} vs ${w[k]}`);
      }
    });
  }
}

test('switched back untouched, a radial window panned out past the tip cap comes back at its scale', async () => {
  // a tip on a short branch lets the window zoom deeper near the root than at the rim (the tip cap is per position, #120)
  const nwk = '(s:0.02,' + balanced(8).slice(0, -1) + ':1);';
  const { viewer, env } = await makeViewer(nwk, { size: SIZE, options: { layout: 'radial', maxTipSpacing: 12 } });
  env.flush();
  const a = viewer.vs.area;
  const k = 20000;
  const at = (x, y) => ({ x0: x - a.aw / 2 / k, x1: x + a.aw / 2 / k, y0: y - a.ah / 2 / k, y1: y + a.ah / 2 / k });
  viewer.setViewport(at(0.01, 0));
  const deep = viewer.getViewport();
  assert.ok(Math.abs(a.aw / (deep.x1 - deep.x0) - k) < 1e-6, 'that deep near the root');
  const L = viewer.layout,
    t = viewer.getTree();
  const tip = t.tipNode[100],
    ang = L.fan.start + (t.tipRank[tip] + 0.5) * (L.fan.span / L.rows);
  const rim = at(L.X[tip] * Math.cos(ang), L.X[tip] * Math.sin(ang)); // on a tip at the rim
  viewer.setViewport(rim); // a pan keeps the scale
  const v = viewer.getViewport();
  assert.ok(Math.abs(a.aw / (v.x1 - v.x0) - k) < 1e-6, 'the pan kept the scale');
  assert.ok(a.aw / (viewer.vs.clampView(rim).x1 - viewer.vs.clampView(rim).x0) < k * 0.99, 'a new window there could not be that deep');
  viewer.setOptions({ layout: 'rectangular' });
  env.flush();
  viewer.setOptions({ layout: 'radial' });
  env.flush();
  assert.deepEqual(viewer.getViewport(), v);
});

test('rectangular, branch lengths: the deepest tip in view keeps its place on the screen', async () => {
  for (const lengths of [true, false]) {
    const { viewer, env } = await zoomed(balanced(9), 'rectangular', 'mid', { branchLengths: lengths });
    const t = viewer.getTree();
    const before = viewer.layout;
    const a = inView(viewer).ranks;
    viewer.setOptions({ branchLengths: !lengths });
    env.flush();
    const after = viewer.layout;
    // the deepest before; of equals (a cladogram's tips), the deepest after
    let deep = -1;
    for (const r of a) {
      const n = t.tipNode[r];
      if (deep < 0 || before.X[n] > before.X[deep] || (before.X[n] === before.X[deep] && after.X[n] > after.X[deep])) deep = n;
    }
    viewer.setOptions({ branchLengths: lengths });
    env.flush();
    viewer.zoomToNode(t.parent[t.parent[t.parent[t.tipNode[(t.tipCount >> 1) + 3]]]]);
    env.flush();
    const p = viewer.nodePosition(deep);
    viewer.setOptions({ branchLengths: !lengths });
    env.flush();
    const q = viewer.nodePosition(deep);
    assert.ok(p && q && Math.abs(p.x - q.x) < 1, `${lengths}: x ${p?.x} -> ${q?.x}`);
    destroyAll();
  }
});
