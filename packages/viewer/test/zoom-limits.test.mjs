// Viewer-level tests of the zoom limits and the font-relative sizes (#38): the limits follow options and the theme's labelSize after
// the fact, and the label thresholds read the theme's labelSize.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';

const { makeViewer, destroyAll } = await import('./viewer-harness.mjs');

afterEach(destroyAll);

function ladder(n) {
  let s = 't0:1';
  for (let i = 1; i < n; i++) s = `(${s},t${i}:${1 + (i % 3)}):1`;
  return s + ';';
}
const rowPx = (m) => {
  const v = m.viewer.getViewport();
  return m.viewer.vs.area.ah / (v.y1 - v.y0);
};

test('a new maxTipSpacing clamps a zoomed view at once', async () => {
  const m = await makeViewer(ladder(100), { options: { maxTipSpacing: Infinity }, size: [500, 400] });
  m.env.flush();
  m.viewer.setViewport({ x0: 0, x1: 1, y0: 10, y1: 12 });
  assert.ok(rowPx(m) > 100, 'no cap: deep zoom allowed');
  m.viewer.setOptions({ maxTipSpacing: 20 });
  assert.ok(Math.abs(rowPx(m) - 20) < 1e-9, `clamped to the new cap (${rowPx(m)})`);
});

test('a change of labelSize moves the font-relative cap and clamps a zoomed view', async () => {
  const m = await makeViewer(ladder(100), { options: { maxTipSpacing: '2em' }, theme: { labelSize: 26 }, size: [500, 400] });
  m.env.flush();
  m.viewer.setViewport({ x0: 0, x1: 1, y0: 10, y1: 12 });
  assert.ok(Math.abs(rowPx(m) - 52) < 1e-9, `2 em at 26 px (${rowPx(m)})`);
  m.viewer.updateTheme({ labelSize: 13 });
  assert.ok(Math.abs(rowPx(m) - 26) < 1e-9, `2 em at 13 px (${rowPx(m)})`);
});

test('a fitted view stays fitted when the cap changes', async () => {
  const m = await makeViewer(ladder(100), { size: [500, 400] });
  m.env.flush();
  const fit = m.viewer.getViewport();
  m.viewer.setOptions({ maxTipSpacing: 5 });
  assert.deepEqual(m.viewer.getViewport(), fit);
});

test('a maxTipSpacing that is not a size warns once and applies no cap', async () => {
  const warns = [];
  const orig = console.warn;
  console.warn = (...a) => warns.push(a.join(' '));
  try {
    const m = await makeViewer(ladder(100), { options: { maxTipSpacing: '30px' }, size: [500, 400] });
    m.env.flush();
    m.viewer.setViewport({ x0: 0, x1: 1, y0: 10, y1: 12 });
    assert.ok(rowPx(m) > 100, 'no cap');
    m.viewer.setViewport({ x0: 0, x1: 1, y0: 10, y1: 11.9 });
    assert.equal(warns.length, 1);
  } finally {
    console.warn = orig;
  }
});

test('labels need rows scaled with the theme labelSize', async () => {
  const labels = (m) =>
    m
      .ctx()
      .calls('fillText')
      .filter((e) => /^[a-d]$/.test(e[1])).length;
  const small = await makeViewer('((a:1,b:1):1,(c:1,d:1):1);', { theme: { labelSize: 13 }, size: [400, 200] });
  small.env.flush();
  assert.equal(labels(small), 4, 'rows of about 35 px carry labels at 13 px');
  const big = await makeViewer('((a:1,b:1):1,(c:1,d:1):1);', { theme: { labelSize: 60 }, size: [400, 200] });
  big.env.flush();
  assert.equal(labels(big), 0, 'the same rows are too narrow for 60 px labels (the threshold is 11 * 60 / 13 = 50.8 px)');
});

test('radial, 200,000 tips in polytomies of 16, small pane: zoomed in as far as allowed, the tips of a polytomy are drawn one by one (#76)', async () => {
  // 12,500 genera of 16 species under one root. In a 96 px pane the fit scale is 20 px per unit radius, so RADIAL_MAX_ZOOM times the
  // fit left the tips about 12 px apart: closer than minCladePx 14, so every genus stayed a slice however far you zoomed in
  const genera = Array.from({ length: 12500 }, (_, g) => `(${Array.from({ length: 16 }, (_, s) => `g${g}s${s}`).join(',')})`);
  const m = await makeViewer(`(${genera.join(',')});`, { options: { layout: 'radial', minCladePx: 14 }, size: [96, 96] });
  m.env.flush();
  const rank = 16 * 7000 + 5;
  m.viewer.focusTip(m.viewer.getTree().tipNode[rank]);
  m.env.flush();
  m.viewer.zoomBy(64, 64, 48, 48);
  m.env.flush();
  const v = m.viewer;
  const pitch = v.T.k * v.T.da;
  assert.ok(pitch >= 14, `tips ${pitch.toFixed(1)} px apart at the deepest zoom`);
  const node = v.getTree().tipNode[rank];
  const kinds = [];
  for (let e = 0; e < v.list.count; e++) if (v.list.node[e] === node) kinds.push(v.list.kind[e]);
  assert.deepEqual(kinds, [1], 'the focused tip is drawn as a tip (K_TIP)');
});

test('radial, tips at 30% of the radius: zoom goes on until they are maxTipSpacing apart, and focusTip gives them label room', async () => {
  // 20,000 tips in clades of 10, every other clade on short branches (tips at 0.3). The outer ring reaches maxTipSpacing (24 px) when
  // the inner tips are only 7.2 px apart, under the 8 px of the dense label threshold, so a ceiling at the outer ring kept them unlabelled
  const clades = Array.from({ length: 2000 }, (_, c) => {
    const len = c % 2 ? 0.2 : 0.9;
    return `(${Array.from({ length: 10 }, (_, s) => `c${c}s${s}:${len}`).join(',')}):0.1`;
  });
  const m = await makeViewer(`(${clades.join(',')});`, { options: { layout: 'radial', labelDensity: 'dense' }, size: [400, 400] });
  m.env.flush();
  const v = m.viewer;
  const rank = 10 * 1001 + 4; // clade 1001: inner
  const name = v.getTree().tipLabels[rank];
  assert.match(name, /^c1001s/);
  v.focusTip(name);
  m.env.flush();
  const inner = 0.3 * v.T.k * v.T.da;
  assert.ok(inner >= 23.9, `focusTip: inner tips ${inner.toFixed(1)} px apart`);
  const drawn = m
    .ctx()
    .calls('fillText')
    .some((e) => e[1] === name);
  assert.ok(drawn, 'the focused inner tip is labelled');
  for (let i = 0; i < 4; i++) v.zoomBy(8, 8, 200, 200);
  m.env.flush();
  const deepest = 0.3 * v.T.k * v.T.da;
  assert.ok(Math.abs(deepest - 24) < 0.1, `the deepest zoom leaves the inner tips maxTipSpacing apart (${deepest.toFixed(2)} px)`);
});

test('radial, the zoom limit follows the window (#120): deep near the centre, at the outer ring where it is; a pan keeps the scale', async () => {
  // 20,000 tips at the outer ring and one outgroup tip on a very short branch: the outgroup must not lift the limit at the outer ring
  const clades = Array.from({ length: 2000 }, (_, c) => `(${Array.from({ length: 10 }, (_, s) => `c${c}s${s}:0.9`).join(',')}):0.1`);
  const m = await makeViewer(`(out:0.001,${clades.join(',')});`, { options: { layout: 'radial' }, size: [400, 400] });
  m.env.flush();
  const v = m.viewer;
  const k = () => v.T.k;
  const pitch = () => v.T.k * v.T.da; // at the outer ring
  // at the outer ring: as deep as allowed leaves tips maxTipSpacing (24 px) apart at the window's inner edge, a hair inside the ring
  v.focusTip(v.getTree().tipNode[10000]);
  m.env.flush();
  for (let i = 0; i < 6; i++) v.zoomBy(8, 8, 200, 200);
  m.env.flush();
  assert.ok(pitch() >= 24 && pitch() < 24.5, `outer ring: tips ${pitch().toFixed(2)} px apart at the deepest zoom`);
  const outerMax = k();
  // near the centre: much deeper
  v.setViewport({ x0: -0.01, x1: 0.01, y0: -0.01, y1: 0.01 });
  for (let i = 0; i < 6; i++) v.zoomBy(8, 8, 200, 200);
  m.env.flush();
  const centreMax = k();
  assert.ok(centreMax > 10 * outerMax, `centre ${centreMax.toFixed(0)} vs outer ring ${outerMax.toFixed(0)} px per unit radius`);
  // a pan out to the outer ring keeps that scale; zooming in there does nothing, zooming out works
  const vp = v.getViewport();
  const w = vp.x1 - vp.x0,
    h = vp.y1 - vp.y0;
  v.setViewport({ x0: 0.95, x1: 0.95 + w, y0: 0, y1: h });
  m.env.flush();
  assert.ok(Math.abs(k() / centreMax - 1) < 1e-9, 'the pan kept the scale');
  const at = v.getViewport();
  v.zoomBy(2, 2, 200, 200);
  assert.deepEqual(v.getViewport(), at, 'zooming in past the limit there changes nothing');
  v.zoomBy(0.5, 0.5, 200, 200);
  m.env.flush();
  assert.ok(Math.abs(k() / centreMax - 0.5) < 1e-9, 'zooming out does');
});

test('rectangular, minCladePx above maxTipSpacing: the zoom limit gives tips at least minCladePx so a polytomy can be resolved (#95)', async () => {
  const m = await makeViewer(ladder(100), { options: { minCladePx: 30, maxTipSpacing: 24 }, size: [500, 400] });
  m.env.flush();
  m.viewer.setViewport({ x0: 0, x1: 1, y0: 10, y1: 12 });
  assert.ok(Math.abs(rowPx(m) - 30) < 1e-9, `limit is minCladePx (${rowPx(m)})`);
  m.viewer.setOptions({ minCladePx: 10 });
  m.viewer.setViewport({ x0: 0, x1: 1, y0: 10, y1: 12 });
  assert.ok(Math.abs(rowPx(m) - 24) < 1e-9, `limit is maxTipSpacing again (${rowPx(m)})`);
});

test('radial, minCladePx above maxTipSpacing: the zoom limit leaves tips at least minCladePx apart (#95)', async () => {
  const star = `(${Array.from({ length: 20000 }, (_, i) => `t${i}:1`).join(',')});`;
  const m = await makeViewer(star, { options: { layout: 'radial', minCladePx: 30, maxTipSpacing: 24 }, size: [400, 400] });
  m.env.flush();
  const v = m.viewer;
  for (let i = 0; i < 12; i++) v.zoomBy(8, 8, 200, 200);
  m.env.flush();
  const pitch = v.T.k * v.T.da;
  assert.ok(pitch >= 29.9, `tips ${pitch.toFixed(2)} px apart at the deepest zoom`);
});
