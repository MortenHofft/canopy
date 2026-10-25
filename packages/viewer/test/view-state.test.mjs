// Unit tests of the viewport arithmetic (src/core/view-state.ts) without a canvas or a DOM: area, fit, limits, zoom about a point,
// the target windows of focusTip / zoomToNode / keyboard scrolling, resize, and the animation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const { parseNewick } = await import(path.join(root, 'packages/io/src/newick.ts'));
const { computeLayout } = await import(path.join(root, 'packages/viewer/src/layout.ts'));
const { InMemorySource } = await import(path.join(root, 'packages/viewer/src/source.ts'));
const { ViewState, radialFitScale, innerTipRadius } = await import(path.join(root, 'packages/viewer/src/view-state.ts'));
const K = await import(path.join(root, 'packages/viewer/src/constants.ts'));

// A ladder of 60 tips with branch lengths, so rows, x and the clade sizes differ from node to node.
function ladder(n) {
  let s = 't0:1';
  for (let i = 1; i < n; i++) s = `(${s},t${i}:${1 + (i % 3)}):1`;
  return s + ';';
}
const tree = new InMemorySource(parseNewick(ladder(60))).snapshot();
const L = computeLayout(tree, true);

/** A ViewState over a plain env object (the renderer builds the same from its fields). */
function make(over = {}) {
  const env = {
    layout: 'rectangular',
    overview: false,
    axis: false,
    rowHeight: null,
    maxTipSpacing: Infinity,
    labelSize: 13,
    maxViewWidth: K.RECT_MAX_VIEW_W,
    treeWidth: 'auto',
    fillColumns: 0,
    W: 800,
    H: 600,
    tree,
    L,
    columnsWidth: 0,
    hasColumns: false,
    placeColumns() {},
    ...over,
  };
  const log = { changed: [], frames: 0, moving: 0 };
  const vs = new ViewState(env, { changed: (step) => log.changed.push(step), needFrame: () => log.frames++, moving: () => log.moving++ });
  vs.computeArea();
  vs.view = vs.fitViewport();
  return { env, vs, log };
}
const world = (vs, px, py) => {
  const a = vs.area,
    v = vs.view;
  return { x: v.x0 + ((px - a.ax) / a.aw) * (v.x1 - v.x0), y: v.y0 + ((py - a.ay) / a.ah) * (v.y1 - v.y0) };
};
const K_FILL = 40;
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps * Math.max(1, Math.abs(a), Math.abs(b)), `${a} vs ${b}`);

test('area: rectangular leaves room for overview, columns, head and foot; radial is the whole container', () => {
  const m = make({ overview: true, axis: true, columnsWidth: 100, hasColumns: true });
  const a = m.vs.area;
  assert.equal(a.clipR, 800 - (K.OVERVIEW_STRIP_W_PX + 8) - 100, 'overview strip and columns sit right of the clip');
  assert.equal(a.ay, 24, 'column headers need head room');
  assert.equal(a.clipB, a.ay + a.ah);
  assert.equal(a.ah, 600 - 24 - 36, 'axis foot (the layout has branch lengths)');
  const { vs } = make({ layout: 'radial' });
  assert.deepEqual(vs.area, { ax: 0, ay: 0, aw: 800, ah: 600, clipL: 0, clipT: 0, clipR: 800, clipB: 600 });
});

test('area: placeColumns gets the clip edge plus the gap', () => {
  let placed = null;
  make({ columnsWidth: 50, hasColumns: true, placeColumns: (x) => (placed = x) });
  assert.ok(placed > 0);
});

test('fit viewport: rectangular shows every tip row, a fixed row height shows fewer; radial is centred on the root at the fit scale', () => {
  let { vs } = make();
  assert.deepEqual(vs.fitViewport(), { x0: 0, x1: 1, y0: 0, y1: 60 });
  ({ vs } = make({ rowHeight: 20 }));
  assert.equal(vs.fitViewport().y1, vs.area.ah / 20);
  ({ vs } = make({ layout: 'radial' }));
  const f = vs.fitViewport();
  const k = radialFitScale(800, 600);
  assert.equal(k, 300 - K.RADIAL_FIT_MARGIN_PX);
  near(f.x1, 400 / k);
  near(f.x0, -f.x1);
  near(f.y1, 300 / k);
  assert.equal(radialFitScale(40, 40), K.RADIAL_FIT_MIN_R_PX, 'a tiny container still gets the minimum scale');
});

test('clampView, rectangular: zoom limits, whole tree kept when zoomed out, 15% overscroll when zoomed in', () => {
  const { vs } = make();
  const a = vs.area;
  let c = vs.clampView({ x0: -5, x1: 6, y0: -300, y1: 400 });
  near(c.x1 - c.x0, K.RECT_MAX_VIEW_W, 1e-12);
  assert.ok(c.x0 <= 0 && c.x1 >= 1, 'zoomed out: the whole tree stays inside the window');
  assert.ok(c.y0 <= 0 && c.y1 >= 60);
  c = vs.clampView({ x0: 0.5, x1: 0.5, y0: 10, y1: 10 });
  near(c.x1 - c.x0, a.aw / K.RECT_MAX_ZOOM_X, 1e-12);
  near(c.y1 - c.y0, a.ah / K.RECT_MAX_ZOOM_Y, 1e-12);
  c = vs.clampView({ x0: -9, x1: -8.9, y0: -50, y1: -49 });
  near(c.x0, -K.OVERSCROLL_FRAC * 0.1, 1e-12);
  near(c.y0, -K.OVERSCROLL_FRAC * (c.y1 - c.y0), 1e-12);
  c = vs.clampView({ x0: 9, x1: 9.1, y0: 500, y1: 501 });
  near(c.x0, 1 - K.OVERSCROLL_KEEP_FRAC * 0.1, 1e-12);
  near(c.y0, 60 - K.OVERSCROLL_KEEP_FRAC * (c.y1 - c.y0), 1e-12);
  const inside = { x0: 0.2, x1: 0.4, y0: 10, y1: 20 };
  assert.deepEqual(vs.clampView(inside), inside, 'a window inside the limits is unchanged');
});

test('clampView, radial: scale between the zoom limits, centre within the pan limit', () => {
  const { vs } = make({ layout: 'radial' });
  const a = vs.area;
  const kfit = radialFitScale(800, 600);
  const scale = (v) => a.aw / (v.x1 - v.x0);
  near(scale(vs.clampView({ x0: -1e6, x1: 1e6, y0: -1e6, y1: 1e6 })), kfit * K.RADIAL_MIN_ZOOM, 1e-12);
  near(scale(vs.clampView({ x0: 0, x1: 1e-12, y0: 0, y1: 1e-12 })), kfit * K.RADIAL_MAX_ZOOM, 1e-12);
  const c = vs.clampView({ x0: 49, x1: 51, y0: -51, y1: -49 });
  near((c.x0 + c.x1) / 2, K.RADIAL_PAN_LIMIT, 1e-12);
  near((c.y0 + c.y1) / 2, -K.RADIAL_PAN_LIMIT, 1e-12);
});

for (const layout of ['rectangular', 'radial']) {
  test(`zoomBy keeps the point under the cursor fixed (${layout})`, () => {
    const { vs, log } = make({ layout });
    vs.fit(false);
    log.changed.length = 0;
    const [px, py] = [vs.area.ax + 0.3 * vs.area.aw, vs.area.ay + 0.7 * vs.area.ah];
    const before = world(vs, px, py);
    const [fx, fy] = layout === 'radial' ? [2, 2] : [2, 3]; // a radial view has one scale: the window keeps its aspect
    vs.zoomBy(fx, fy, px, py);
    const after = world(vs, px, py);
    near(after.x, before.x, 1e-9);
    near(after.y, before.y, 1e-9);
    assert.deepEqual(log.changed, [false], 'one change event, not a step');
    assert.equal(vs.fitted, false);
    const wBefore = vs.view.x1 - vs.view.x0;
    vs.zoomBy(0.5, layout === 'radial' ? 0.5 : 1, px, py);
    near(vs.view.x1 - vs.view.x0, wBefore * 2, 1e-9);
  });
}

for (const layout of ['rectangular', 'radial']) {
  test(`zoomAtWorld keeps the world point at its relative place in the window (${layout})`, () => {
    const { vs } = make({ layout });
    vs.fit(false);
    if (layout === 'radial') vs.zoomBy(3, 3, vs.area.ax + 100, vs.area.ay + 100);
    else vs.zoomBy(1, 4, vs.area.ax + 100, vs.area.ay + 100);
    const v = vs.view;
    // a point inside the window, and the same zoom through the screen-point entry
    const [rx, ry] = [0.25, 0.8];
    const [wx, wy] = [v.x0 + rx * (v.x1 - v.x0), v.y0 + ry * (v.y1 - v.y0)];
    const [fx, fy] = layout === 'radial' ? [2, 2] : [1.5, 2];
    const viaScreen = vs.zoomedView(fx, fy, vs.area.ax + rx * vs.area.aw, vs.area.ay + ry * vs.area.ah);
    vs.zoomAtWorld(fx, fy, wx, wy);
    const n = vs.view;
    near((wx - n.x0) / (n.x1 - n.x0), rx, 1e-9);
    near((wy - n.y0) / (n.y1 - n.y0), ry, 1e-9);
    near(n.x1 - n.x0, (v.x1 - v.x0) / fx, 1e-9);
    for (const k of ['x0', 'x1', 'y0', 'y1']) near(n[k], vs.clampView(viaScreen)[k], 1e-9);
  });

  test(`zoomAtWorld on a point outside the window pulls the window toward it (${layout})`, () => {
    const { vs } = make({ layout });
    vs.fit(false);
    if (layout === 'radial') vs.zoomBy(4, 4, vs.area.ax + 50, vs.area.ay + 50);
    else vs.zoomBy(1, 6, vs.area.ax + 50, vs.area.ay + 50);
    const v = vs.view;
    // below the window (and right of it for radial)
    const [wx, wy] = [v.x1 + (v.x1 - v.x0) * 0.5, v.y1 + (v.y1 - v.y0) * 0.5];
    vs.zoomAtWorld(layout === 'radial' ? 2 : 1, 2, wx, wy);
    const n = vs.view;
    assert.ok(n.y0 > v.y0, 'the window moved down toward the point');
    assert.ok(Math.abs(wy - (n.y0 + n.y1) / 2) < Math.abs(wy - (v.y0 + v.y1) / 2), 'the centre is nearer the point');
  });
}

test('zoomAtWorld: zooming out about a point far outside the window anchors at the nearest point of the window (no push away)', () => {
  const { vs } = make();
  vs.fit(false);
  vs.setViewport({ x0: 0, x1: 1, y0: 20, y1: 30 });
  const v = { ...vs.view };
  vs.zoomAtWorld(1, 0.5, 0.5, 58); // far below the window
  assert.ok(vs.view.y1 - vs.view.y0 > v.y1 - v.y0, 'it zooms out');
  near(vs.view.y1, v.y1, 1e-9); // the bottom edge, the nearest point to the anchor, stays put
  near(vs.view.y0, v.y0 - (v.y1 - v.y0), 1e-9);
});

test('zoomAtWorld: at the zoom limit a wheel-in over a far point does not pan', () => {
  const { vs } = make({ layout: 'radial' });
  vs.fit(false);
  vs.zoomBy(1e6, 1e6, vs.area.ax + 100, vs.area.ay + 100); // to the limit
  const v = { ...vs.view };
  vs.zoomAtWorld(2, 2, v.x0 + 40, v.y0 + 40);
  assert.deepEqual(vs.view, v);
});

test('setViewport: ignores an empty window, skips an equal one, clamps, clears fitted', () => {
  const { vs, log } = make();
  vs.fit(false);
  log.changed.length = 0;
  vs.setViewport({ x0: 1, x1: 1, y0: 0, y1: 1 });
  vs.setViewport({ ...vs.view });
  assert.deepEqual(log.changed, []);
  assert.equal(vs.fitted, true);
  vs.setViewport({ x0: -3, x1: 9, y0: 0, y1: 60 });
  near(vs.view.x1 - vs.view.x0, K.RECT_MAX_VIEW_W, 1e-12);
  assert.equal(vs.fitted, false);
  assert.deepEqual(log.changed, [false]);
});

test('focusViewport, rectangular: the tip row is centred at a readable row height, x only moves when the tip is out of the window', () => {
  const { vs } = make();
  const tip = tree.tipNode[7];
  let v = vs.focusViewport(tip);
  const ky = vs.area.ah / (v.y1 - v.y0);
  near(ky, K.FOCUS_TIP_MIN_ROW_PX, 1e-12); // the fit view is too small a row height: raised to the minimum
  near((v.y0 + v.y1) / 2, L.ROW[tip], 1e-12);
  assert.deepEqual([v.x0, v.x1], [0, 1], 'the tip is in the window: x is kept');
  vs.view = { x0: 0, x1: 0.1, y0: 0, y1: 10 };
  v = vs.focusViewport(tree.tipNode[59]);
  near((v.x0 + v.x1) / 2, L.X[tree.tipNode[59]], 1e-12);
  near(v.x1 - v.x0, 0.1, 1e-12);
  vs.view = { x0: 0, x1: 1, y0: 0, y1: vs.area.ah / 1000 };
  const z = vs.focusViewport(tip);
  near(vs.area.ah / (z.y1 - z.y0), K.FOCUS_TIP_MAX_ROW_PX, 1e-12); // a row taller than the maximum is lowered to it
});

test('focusViewport, radial: centred on the tip at the wanted tip pitch', () => {
  const { vs } = make({ layout: 'radial' });
  const tip = tree.tipNode[15];
  const v = vs.focusViewport(tip);
  const ang = L.ROW[tip] * ((2 * Math.PI) / tree.tipCount);
  near((v.x0 + v.x1) / 2, L.X[tip] * Math.cos(ang), 1e-12);
  near((v.y0 + v.y1) / 2, L.X[tip] * Math.sin(ang), 1e-12);
  const k = vs.area.aw / (v.x1 - v.x0);
  assert.ok(k >= (K.FOCUS_TIP_RADIAL_PITCH_PX * tree.tipCount) / (2 * Math.PI) - 1e-9, 'at least the wanted pitch between neighbouring tips');
});

test('cladeViewport: rectangular shows all rows of the clade; radial contains the clade sector centre', () => {
  let { vs } = make();
  const clade = [...Array(tree.nodeCount).keys()].filter((i) => tree.childCount[i] > 0).find((i) => tree.leafEnd[i] - tree.leafStart[i] === 4); // a small clade
  assert.ok(tree.childCount[clade] > 0);
  let v = vs.cladeViewport(clade);
  assert.ok(v.y0 <= tree.leafStart[clade] && v.y1 >= tree.leafEnd[clade]);
  assert.ok(v.x0 <= L.X[clade] && v.x1 >= L.XMAX[clade], 'from the clade root to its deepest tip');
  ({ vs } = make({ layout: 'radial' }));
  v = vs.cladeViewport(clade);
  const k = vs.area.aw / (v.x1 - v.x0);
  assert.ok(Number.isFinite(k) && k > radialFitScale(800, 600), 'zoomed in on the clade');
});

test('visibleViewport: null when the node is in view, else a window that has it (rectangular)', () => {
  const { vs } = make();
  vs.view = { x0: 0, x1: 1, y0: 20, y1: 40 };
  assert.equal(vs.visibleViewport(tree.tipNode[30]), null);
  const v = vs.visibleViewport(tree.tipNode[55]);
  assert.ok(v.y0 <= L.ROW[tree.tipNode[55]] && v.y1 >= L.ROW[tree.tipNode[55]]);
  near(v.y1 - v.y0, 20, 1e-12);
});

test('visibleViewport (radial): null near the centre, a window centred on the node when it is off screen', () => {
  const { vs } = make({ layout: 'radial' });
  vs.fit(false);
  assert.equal(vs.visibleViewport(tree.tipNode[3]), null, 'the fit view shows every node');
  vs.view = { x0: -0.01, x1: 0.01, y0: -0.01 * 0.75, y1: 0.01 * 0.75 };
  const tip = tree.tipNode[20];
  const v = vs.visibleViewport(tip);
  const ang = L.ROW[tip] * ((2 * Math.PI) / tree.tipCount);
  near((v.x0 + v.x1) / 2, L.X[tip] * Math.cos(ang), 1e-12);
  near((v.y0 + v.y1) / 2, L.X[tip] * Math.sin(ang), 1e-12);
});

test('resize: a zoomed rectangular view keeps its scale and its top left corner, the window grows with the container', () => {
  const { vs, env } = make();
  vs.setViewport({ x0: 0.2, x1: 0.6, y0: 10, y1: 30 });
  const kx = vs.area.aw / 0.4,
    ky = vs.area.ah / 20;
  const keep = vs.beforeResize();
  env.W = 1000;
  env.H = 700;
  vs.afterResize(keep);
  near(vs.area.aw / (vs.view.x1 - vs.view.x0), kx, 1e-9);
  near(vs.area.ah / (vs.view.y1 - vs.view.y0), ky, 1e-9);
  near(vs.view.x0, 0.2, 1e-12);
  near(vs.view.y0, 10, 1e-12);
});

test('resize: a fitted view follows the container, a zoomed radial view keeps its centre and scale', () => {
  let { vs, env } = make();
  env.H = 400;
  vs.afterResize(vs.beforeResize());
  assert.equal(vs.area.ah, 400 - 16);
  assert.equal(vs.view.y1, 60, 'still the whole tree');
  ({ vs, env } = make({ layout: 'radial' }));
  vs.setViewport({ x0: 0.1, x1: 0.2, y0: 0.3, y1: 0.375 });
  vs.fitted = false;
  const keep = vs.beforeResize();
  const k0 = vs.area.aw / (vs.view.x1 - vs.view.x0);
  env.W = 1000;
  env.H = 500;
  vs.afterResize(keep);
  near(vs.area.aw / (vs.view.x1 - vs.view.x0), k0, 1e-9);
  near((vs.view.x0 + vs.view.x1) / 2, 0.15, 1e-9);
  near((vs.view.y0 + vs.view.y1) / 2, 0.3375, 1e-9);
});

test('labelReserve: from the longest tip label, floor 70, cap 190, partial trees assume a binomial, measured again after a reset', () => {
  const named = (label) => new InMemorySource(parseNewick(`(${label}:1,b:1);`)).snapshot();
  const { vs, env } = make();
  assert.equal(vs.labelReserve(), 70, 'short labels: the floor (3 chars would be 33 px)');
  env.tree = named('x'.repeat(20));
  assert.equal(vs.labelReserve(), 70, 'cached until reset');
  vs.resetLabelReserve();
  near(vs.labelReserve(), 20 * 6.3 + 14, 1e-12);
  env.tree = named('x'.repeat(60));
  vs.resetLabelReserve();
  assert.equal(vs.labelReserve(), 190, 'capped');
  env.tree = { ...named('a'), stub: new Uint8Array(3) };
  vs.resetLabelReserve();
  near(vs.labelReserve(), Math.min(190, 28 * 6.3 + 14), 1e-12); // labels are not loaded: 28 chars assumed
});

test('clampView, rectangular: the zoomed-out test is w >= 0.999 / h >= 0.999 N, and the tallest window is 1.6 N rows', () => {
  const { vs } = make({ H: 200 }); // a short container, so that ah / 4 (46) is below 1.6 N (96)
  const hmax = Math.max(60 * K.RECT_MAX_VIEW_H_FACTOR, vs.area.ah / 4);
  const tall = vs.clampView({ x0: 0, x1: 1, y0: 0, y1: 1000 });
  near(tall.y1 - tall.y0, hmax, 1e-12);
  // just under / over the threshold, window pushed left / up: only the zoomed-out branch keeps the whole tree inside
  assert.equal(vs.clampView({ x0: -0.3, x1: -0.3 + 0.9995, y0: 0, y1: 60 }).x0, 0, 'w = 0.9995: zoomed out');
  near(vs.clampView({ x0: -0.3, x1: -0.3 + 0.998, y0: 0, y1: 60 }).x0, -K.OVERSCROLL_FRAC * 0.998, 1e-12);
  assert.equal(vs.clampView({ x0: 0, x1: 1, y0: -5, y1: 54.95 }).y0, 0, 'h = 59.95: zoomed out');
  assert.equal(vs.clampView({ x0: 0, x1: 1, y0: -5, y1: 54.9 }).y0, -5, 'h = 59.9: zoomed in, overscroll allowed');
});

test('visibleViewport, rectangular: a tip within min(12% of the window, 3 rows) of the edge scrolls', () => {
  const { vs } = make();
  const row = (rank) => tree.tipNode[rank];
  vs.view = { x0: 0, x1: 1, y0: 20, y1: 60 }; // 40 rows: margin 3
  assert.equal(vs.visibleViewport(row(23)), null, 'row 23.5 is outside the 3-row margin');
  const up = vs.visibleViewport(row(22));
  near(up.y0, 22.5 - 3, 1e-12);
  assert.equal(vs.visibleViewport(row(56)), null, 'row 56.5 is outside the margin at the bottom');
  near(vs.visibleViewport(row(57)).y1, 57.5 + 3, 1e-12);
  vs.view = { x0: 0, x1: 1, y0: 20, y1: 30 }; // 10 rows: margin 1.2
  assert.equal(vs.visibleViewport(row(21)), null);
  near(vs.visibleViewport(row(20)).y0, 20.5 - 1.2, 1e-12);
});

test('visibleViewport, radial: a node within 30 px of the container edge scrolls', () => {
  const { vs } = make({ layout: 'radial' });
  const tip = tree.tipNode[20];
  const ang = L.ROW[tip] * ((2 * Math.PI) / tree.tipCount);
  const wx = L.X[tip] * Math.cos(ang),
    wy = L.X[tip] * Math.sin(ang);
  const k = 100;
  // a window of 800 x 600 px at scale k that puts the node at screen x = sx, y = 300
  const at = (sx) => ({ x0: wx - sx / k, x1: wx - sx / k + 800 / k, y0: wy - 300 / k, y1: wy - 300 / k + 600 / k });
  vs.view = at(800 - 31);
  assert.equal(vs.visibleViewport(tip), null, '31 px from the right edge: in view');
  vs.view = at(800 - 29);
  assert.notEqual(vs.visibleViewport(tip), null, '29 px from the right edge: scrolled to the centre');
});

test('animation: setViewport(animate) asks for a frame, steps report as steps, ends on the clamped target; fit(true) ends fitted', () => {
  const { vs, log } = make();
  const target = { x0: 0.2, x1: 0.4, y0: 10, y1: 20 };
  vs.setViewport(target, true);
  assert.equal(log.frames, 1);
  assert.equal(vs.animating, true);
  assert.equal(vs.fitted, false);
  const t0 = performance.now();
  vs.stepAnim(t0 + K.ANIMATION_MS / 2);
  assert.equal(vs.animating, true);
  const mid = vs.view;
  assert.ok(mid.x1 - mid.x0 < 1 && mid.x1 - mid.x0 > 0.2, 'between the start and the target width');
  vs.stepAnim(t0 + K.ANIMATION_MS + 10);
  assert.equal(vs.animating, false);
  assert.deepEqual(vs.view, vs.clampView(target));
  assert.equal(log.moving, 2);
  assert.deepEqual(log.changed, [true, true]);
  vs.fit(true);
  vs.stepAnim(performance.now() + K.ANIMATION_MS + 10);
  assert.equal(vs.fitted, true);
  assert.deepEqual(vs.view, vs.fitViewport());
  vs.setViewport(target, true);
  vs.cancelAnim();
  assert.equal(vs.animating, false);
  vs.stepAnim(performance.now() + 1000);
  assert.equal(log.changed.length, 3, 'stepAnim without an animation does nothing');
});

test('a cancelled or superseded fit animation does not make a later animation end fitted', () => {
  for (const interrupt of ['cancelAnim', 'animateOther', 'jump']) {
    const { vs } = make();
    const target = { x0: 0.2, x1: 0.4, y0: 10, y1: 20 };
    vs.fit(true);
    if (interrupt === 'cancelAnim') vs.cancelAnim();
    if (interrupt === 'jump') vs.setViewport({ x0: 0.1, x1: 0.5, y0: 5, y1: 25 });
    vs.setViewport(target, true);
    vs.stepAnim(performance.now() + K.ANIMATION_MS + 10);
    assert.equal(vs.animating, false);
    assert.equal(vs.fitted, false, interrupt);
  }
});

// ---- maxTipSpacing (#38)

test('maxTipSpacing, rectangular: zooming in stops at the cap; Infinity restores the 500 px per row ceiling', () => {
  const { vs } = make({ maxTipSpacing: 24 });
  const deep = vs.clampView({ x0: 0.5, x1: 0.6, y0: 10, y1: 10.01 });
  near(vs.area.ah / (deep.y1 - deep.y0), 24, 1e-12);
  const { vs: free } = make({ maxTipSpacing: Infinity });
  const d2 = free.clampView({ x0: 0.5, x1: 0.6, y0: 10, y1: 10.01 });
  near(free.area.ah / (d2.y1 - d2.y0), K.RECT_MAX_ZOOM_Y, 1e-12);
  const x = vs.clampView({ x0: 0.5, x1: 0.5, y0: 10, y1: 20 });
  near(x.x1 - x.x0, vs.area.aw / K.RECT_MAX_ZOOM_X, 1e-12); // the x limit is untouched
});

test('maxTipSpacing, rectangular: the fitted view of a small tree is not changed (limit = max(fit, cap)), and it can only zoom out', () => {
  const small = new InMemorySource(parseNewick('((a:1,b:1):1,(c:1,d:1):1);')).snapshot();
  const { vs } = make({ tree: small, L: computeLayout(small, true), maxTipSpacing: 24 });
  const fit = vs.fitViewport();
  const fitPx = vs.area.ah / (fit.y1 - fit.y0);
  assert.ok(fitPx > 24 * 4, 'four tips in the pane are far more than 24 px apart');
  assert.deepEqual(vs.clampView({ ...fit }), fit);
  const tighter = vs.clampView({ x0: 0, x1: 1, y0: 1, y1: 2 });
  near(vs.area.ah / (tighter.y1 - tighter.y0), fitPx, 1e-9);
});

test('maxTipSpacing: a fixed row height is not capped below itself', () => {
  const { vs } = make({ maxTipSpacing: 10, rowHeight: 30 });
  const fit = vs.fitViewport();
  assert.deepEqual(vs.clampView({ ...fit }), fit, 'the fit (30 px rows) survives a 10 px cap');
  const c = vs.clampView({ x0: 0, x1: 1, y0: 0, y1: 0.5 });
  near(vs.area.ah / (c.y1 - c.y0), 30, 1e-9);
});

test('maxTipSpacing, radial: the arc between neighbouring tips stops at the cap, but never below RADIAL_GEOMETRIC_ZOOM times the fit', () => {
  const kfit = radialFitScale(800, 600);
  const maxScale = (over, n) => {
    const bigL = n ? { ...L, rows: n } : L; // the cap counts rows
    const { vs } = make({ layout: 'radial', L: bigL, ...over });
    const c = vs.clampView({ x0: 0, x1: 1e-9, y0: 0, y1: 1e-9 });
    return vs.area.aw / (c.x1 - c.x0);
  };
  // 10000 tips: the tip cap (24 px between the innermost tips, #110) is above 50 x the fit scale
  near(((maxScale({ maxTipSpacing: 24 }, 10000) * 2 * Math.PI) / 10000) * innerTipRadius(L), 24, 1e-12);
  // 60 tips: the cap alone would be the fit scale; the geometric floor allows 50 x
  near(maxScale({ maxTipSpacing: 24 }), kfit * K.RADIAL_GEOMETRIC_ZOOM, 1e-12);
  near(maxScale({ maxTipSpacing: 1 }), kfit * K.RADIAL_GEOMETRIC_ZOOM, 1e-12);
  near(maxScale({ maxTipSpacing: Infinity }), kfit * K.RADIAL_MAX_ZOOM, 1e-9);
  assert.ok(maxScale({ maxTipSpacing: 24 }, 200) > kfit * 3.35, 'a 200-tip tree zooms well beyond the old 3.35 x');
});

test('radial, millions of tips: the zoom reaches the tip cap, beyond RADIAL_MAX_ZOOM times the fit (#76)', () => {
  const kfit = radialFitScale(800, 600);
  const Lc = computeLayout(tree, false); // a cladogram: every tip on the outer ring
  const pitchAtMax = (maxTipSpacing, rows) => {
    const { vs } = make({ layout: 'radial', L: { ...Lc, rows }, maxTipSpacing });
    const c = vs.clampView({ x0: 0, x1: 1e-12, y0: 0, y1: 1e-12 });
    return ((vs.area.aw / (c.x1 - c.x0)) * 2 * Math.PI) / rows;
  };
  // 3M tips: RADIAL_MAX_ZOOM times the fit leaves them about 11 px apart, closer than the explorer's minCladePx (14), so a polytomy of
  // tips stayed a slice at any zoom
  assert.ok((kfit * K.RADIAL_MAX_ZOOM * 2 * Math.PI) / 3e6 < 14, 'the old ceiling stops short of 14 px');
  near(pitchAtMax(24, 3e6), 24, 1e-9);
  // no cap: the hard ceiling is RADIAL_MAX_TIP_PX between tips
  near(pitchAtMax(Infinity, 3e6), K.RADIAL_MAX_TIP_PX, 1e-9);
});

test('maxTipSpacing, radial, with a collapsed clade: the cap is maxTipSpacing px per ROW, not per tip', () => {
  // 30000 tips: a clade of over 12000 collapsed leaves fewer than 18000 rows
  const big = new InMemorySource(parseNewick(ladder(30000))).snapshot();
  const clade = big.parent[big.tipNode[0]]; // the deepest clade of the ladder: 2 tips; take a large one instead
  let c = clade;
  while (big.leafEnd[big.parent[c]] - big.leafStart[big.parent[c]] <= 12000 && big.parent[c] > 0) c = big.parent[c];
  const mask = new Uint8Array(big.nodeCount);
  mask[c] = 1;
  const Lc = computeLayout(big, false, mask); // a cladogram: the cap is at the outer ring
  assert.ok(Lc.rows < big.tipCount - 10000);
  const scale = (LL) => {
    const { vs } = make({ layout: 'radial', tree: big, L: LL, maxTipSpacing: 24 });
    const k = vs.clampView({ x0: 0, x1: 1e-9, y0: 0, y1: 1e-9 });
    return vs.area.aw / (k.x1 - k.x0);
  };
  near((scale(Lc) * 2 * Math.PI) / Lc.rows, 24, 1e-12);
  assert.ok(scale(Lc) < scale(computeLayout(big, false)), 'fewer rows: the scale at the cap is lower than per tip');
});

test('maxTipSpacing: wheel zoom-in stops at the cap and does not pan; focusViewport respects it', () => {
  const { vs } = make({ maxTipSpacing: 24 });
  vs.view = vs.clampView({ x0: 0.4, x1: 0.5, y0: 20, y1: 20 + vs.area.ah / 24 });
  const before = { ...vs.view };
  vs.zoomAtWorld(2, 2, 0.45, 25);
  assert.equal(vs.view.y0, before.y0, 'at the cap y neither zooms nor pans');
  assert.equal(vs.view.y1, before.y1);
  near(vs.view.x1 - vs.view.x0, (before.x1 - before.x0) / 2, 1e-9); // x has no such limit and zooms
  const f = vs.focusViewport(tree.tipNode[7]);
  assert.ok(vs.area.ah / (f.y1 - f.y0) <= 24 + 1e-9, 'focusTip row height is min(26, cap)');
  const { vs: roomy } = make({ maxTipSpacing: 100 });
  const g = roomy.focusViewport(tree.tipNode[7]);
  near(roomy.area.ah / (g.y1 - g.y0), K.FOCUS_TIP_MIN_ROW_PX, 1e-12);
});

test('focusViewport, radial: the wanted tip pitch follows labelSize and the cap', () => {
  const pitch = (over) => {
    const { vs } = make({ layout: 'radial', ...over });
    const f = vs.focusViewport(tree.tipNode[7]);
    return (vs.area.aw / (f.x1 - f.x0)) * ((2 * Math.PI) / tree.tipCount) * L.X[tree.tipNode[7]]; // at the tip's own radius
  };
  near(pitch({ labelSize: 26 }), 48, 1e-9);
  near(pitch({ labelSize: 26, maxTipSpacing: 30 }), 30, 1e-9);
});

test('treeWidth is clamped to leave the fixed columns and the fill minimums on screen; auto + fill keeps a minimum tree', () => {
  const placed = [];
  const over = { hasColumns: true, placeColumns: (l, f) => placed.push([l, f]) };
  const wide = make({ ...over, columnsWidth: 266, treeWidth: 1000 });
  assert.equal(wide.vs.area.clipR, 800 - 266, 'px wider than the container');
  const full = make({ ...over, columnsWidth: 266, treeWidth: '100%', fillColumns: 1 });
  assert.equal(full.vs.area.clipR, 800 - 266 - K_FILL, 'the fill column keeps its minimum');
  const narrow = make({ ...over, W: 400, columnsWidth: 312, fillColumns: 1 });
  assert.equal(narrow.vs.area.clipR, 120, 'never under 120 px');
  const roomy = make({ ...over, W: 1000, columnsWidth: 100, fillColumns: 1 });
  assert.equal(roomy.vs.area.clipR, 450, 'half of what the fixed columns leave');
  const mid = make({ ...over, W: 500, columnsWidth: 100, fillColumns: 1 });
  assert.equal(mid.vs.area.clipR, 240, 'not less than 240 px while the fill column keeps 40 px');
});

test('focusViewport: the minimum row height follows labelSize (26 px at 13)', () => {
  const { vs } = make({ labelSize: 26 });
  const f = vs.focusViewport(tree.tipNode[7]);
  near(vs.area.ah / (f.y1 - f.y0), 52, 1e-12);
});

// ---- maxViewWidth and treeWidth (#39)

test('maxViewWidth: the x window may grow beyond 1.6 tree widths', () => {
  const { vs } = make({ maxViewWidth: 4 });
  const c = vs.clampView({ x0: -5, x1: 6, y0: 0, y1: 60 });
  near(c.x1 - c.x0, 4, 1e-12);
  assert.ok(c.x0 <= 0 && c.x1 >= 1);
  const { vs: dflt } = make();
  near(dflt.clampView({ x0: -5, x1: 6, y0: 0, y1: 60 }).x1 - dflt.clampView({ x0: -5, x1: 6, y0: 0, y1: 60 }).x0, 1.6, 1e-12);
});

test("treeWidth: 'auto' is unchanged; px and % fix the tree area and move the columns; fill columns take the rest", () => {
  const placed = [];
  const over = { columnsWidth: 100 + 6, hasColumns: true, placeColumns: (left, fill) => placed.push([left, fill]) };
  const auto = make(over);
  assert.equal(auto.vs.area.clipR, 800 - 106);
  assert.deepEqual(placed.at(-1), [800 - 106 + 6, 0]);
  const px = make({ ...over, treeWidth: 300 });
  assert.equal(px.vs.area.clipR, 300);
  assert.equal(placed.at(-1)[0], 306);
  const pct = make({ ...over, treeWidth: '25%', overview: true });
  near(pct.vs.area.clipR, 0.25 * (800 - K.OVERVIEW_STRIP_W_PX - 8), 1e-12);
  const fill = make({ ...over, treeWidth: '25%', fillColumns: 1 });
  assert.equal(fill.vs.area.clipR, 200);
  assert.deepEqual(placed.at(-1), [206, 800 - 200 - 106], 'the fill column gets what the tree and the fixed columns leave');
  make({ ...over, treeWidth: 300, fillColumns: 2 });
  assert.equal(placed.at(-1)[1], (800 - 300 - 106) / 2);
  const half = make({ ...over, fillColumns: 1 });
  assert.equal(half.vs.area.clipR, (800 - 106) / 2, "'auto' with a fill column: tree and fill column split what is left");
  const bad = make({ ...over, treeWidth: 'wide' });
  assert.equal(bad.vs.area.clipR, 800 - 106, 'not a size: auto');
  const tiny = make({ ...over, treeWidth: 10 });
  assert.equal(tiny.vs.area.clipR, 120, 'at least 120 px');
});

test('treeWidth: the plot area (and so fit) follows the tree area; radial ignores it', () => {
  const a = make({ treeWidth: 400, hasColumns: true, columnsWidth: 50 }).vs.area;
  const b = make({ hasColumns: true, columnsWidth: 50 }).vs.area;
  assert.ok(a.aw < b.aw);
  assert.equal(a.clipR, 400);
  assert.equal(make({ layout: 'radial', treeWidth: 400 }).vs.area.clipR, 800);
});

test('zoomBy at the row cap does not scroll: y0 stays put under repeated wheel-in and centre zoom', () => {
  const big = new InMemorySource(parseNewick(ladder(1000))).snapshot();
  const { vs } = make({ tree: big, L: computeLayout(big, true), maxTipSpacing: 24 });
  vs.view = vs.clampView({ x0: 0.2, x1: 0.4, y0: 500, y1: 500 + vs.area.ah / 24 });
  const y = { y0: vs.view.y0, y1: vs.view.y1 };
  const a = vs.area;
  for (let i = 0; i < 5; i++) {
    vs.zoomBy(1, 1.4, a.ax + 0.3 * a.aw, a.ay + 0.95 * a.ah); // pointer near the bottom
    vs.zoomBy(1, 1.4, a.ax + a.aw / 2, a.ay + a.ah / 2); // the + key
  }
  assert.equal(vs.view.y0, y.y0);
  assert.equal(vs.view.y1, y.y1);
  const w = vs.view.x1 - vs.view.x0;
  vs.zoomBy(1.4, 1, a.ax + a.aw / 2, a.ay + a.ah / 2);
  assert.ok(vs.view.x1 - vs.view.x0 < w, 'x has no such limit and still zooms');
});
