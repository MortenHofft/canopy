// Unit tests of the radial scale rings (#45, option `radialRings`): circles about the root behind the tree at the scale bar's step, so
// the corner bar is one band wide; zooming in by the step's factor subdivides them and zooming out merges them; on a dated tree they are
// anchored at the tips (age 0), otherwise at the root; 'stripes' shades every other band; 'none' (the default) draws nothing. Rings are
// told apart from the rest of the frame by distinctive theme opacities: the path built after the tree's clip up to the first
// `globalAlpha` write of ringOpacity or ringStripeOpacity.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { makeViewer, destroyAll } from './viewer-harness.mjs';
import { DEFAULT_OPTIONS } from '../src/types.ts';

afterEach(destroyAll);

const RO = 0.37,
  RSO = 0.29;
const THEME = { ringOpacity: RO, ringStripeOpacity: RSO, ringWidth: 0.9 };
const PHYLO = '((a:1,b:3):2,(c:4,(d:1,e:2):1.5):1)r;'; // root-to-tip 3 .. 5: not dated
const DATED = '((a:2,b:2):3,(c:4,(d:1,e:1):3):1)r;'; // every tip at 5: ultrametric, the axis reads as time before the tips
const make = (nwk, radialRings, options = {}) =>
  makeViewer(nwk, { size: [400, 300], theme: THEME, options: { layout: 'radial', radialRings, maxTipSpacing: Infinity, ...options } });

/** Draw one frame and return its log. */
function frame(m) {
  const c = m.ctx();
  c.reset();
  m.viewer.invalidate();
  m.viewer.renderNow();
  return c.log;
}

/** The rings of a frame: { arcs: [[cx, cy, r, a0, a1, ccw]], alpha, op } or null when none was drawn. */
function ringsOf(log) {
  const from = log.findIndex((e) => e[0] === 'clip');
  const arcs = [];
  for (let i = from + 1; i < log.length; i++) {
    const [k, ...a] = log[i];
    if (k === 'arc') arcs.push(a);
    else if (k === 'globalAlpha=' && (a[0] === RO || a[0] === RSO))
      return { arcs, alpha: a[0], op: log.slice(i).find((e) => e[0] === 'stroke' || e[0] === 'fill')[0] };
    else if (k === 'stroke' || k === 'fill') arcs.length = 0; // something else's path
  }
  return null;
}

/** The scale bar of a frame: its length in px and its label. */
function scaleBar(log) {
  const at = log.findLastIndex((e) => e[0] === 'lineWidth=' && e[1] === 1.5);
  const moves = log.slice(at).filter((e) => e[0] === 'moveTo');
  const label = log.slice(at).find((e) => e[0] === 'fillText');
  return { w: moves[2][1] - moves[1][1], step: Number(label[1]) };
}

const isMultiple = (x, w) => Math.abs(x / w - Math.round(x / w)) < 1e-6;
const dist = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);

test("the option defaults to 'none', and 'none' draws no ring", async () => {
  assert.equal(DEFAULT_OPTIONS.radialRings, 'none');
  const m = await make(PHYLO, 'none');
  m.env.flush();
  const log = frame(m);
  assert.equal(ringsOf(log), null);
  assert.ok(!log.some((e) => e[0] === 'globalAlpha=' && (e[1] === RO || e[1] === RSO)), 'no ring opacity is ever set');
});

test('the rectangular layout draws no ring, whatever the option', async () => {
  const m = await make(PHYLO, 'stripes', { layout: 'rectangular' });
  m.env.flush();
  assert.equal(ringsOf(frame(m)), null);
});

test('with the axis (scale bar) off, no ring either', async () => {
  const m = await make(PHYLO, 'stripes', { axis: false });
  m.env.flush();
  assert.equal(ringsOf(frame(m)), null);
});

test('a cladogram (no scale bar) draws no ring', async () => {
  const m = await make(PHYLO, 'lines', { branchLengths: false });
  m.env.flush();
  assert.equal(ringsOf(frame(m)), null);
});

test("'lines': circles about the root at multiples of the scale bar's length, out to the farthest tip", async () => {
  const m = await make(PHYLO, 'lines');
  m.env.flush();
  const log = frame(m);
  const rings = ringsOf(log);
  assert.ok(rings && rings.alpha === RO && rings.op === 'stroke', 'stroked at ringOpacity');
  const bar = scaleBar(log);
  const root = m.viewer.nodePosition(0);
  const t = m.viewer.getTree();
  const k = Math.max(...Array.from({ length: t.tipCount }, (_, i) => dist(m.viewer.nodePosition(t.tipNode[i]), root)));
  assert.ok(rings.arcs.length >= 2, `${rings.arcs.length} rings`);
  for (const [cx, cy, r, a0, a1] of rings.arcs) {
    assert.ok(Math.abs(cx - root.x) < 1e-9 && Math.abs(cy - root.y) < 1e-9, 'centred on the root');
    assert.ok(isMultiple(r, bar.w), `radius ${r} is a multiple of the bar ${bar.w}`);
    assert.ok(r > 0 && r <= k + 1e-9, 'inside the tree');
    assert.ok(Math.abs(a1 - a0 - 2 * Math.PI) < 1e-9, 'the root is in view: whole circles');
  }
  assert.equal(rings.arcs.length, Math.floor(k / bar.w + 1e-9), 'every ring out to the farthest tip');
  assert.ok(
    log.some((e) => e[0] === 'lineWidth=' && e[1] === 0.9),
    'at ringWidth',
  );
});

test('zooming in by the step factor doubles the rings over the same distances, zooming out halves them', async () => {
  const m = await make(PHYLO, 'lines');
  m.env.flush();
  const values = () => {
    const log = frame(m);
    const bar = scaleBar(log);
    const ppu = bar.w / bar.step;
    return { bar, ppu, d: ringsOf(log).arcs.map((a) => a[2] / ppu) }; // distances from the root, tree units
  };
  const fit = values();
  const mant = fit.bar.step / Math.pow(10, Math.floor(Math.log10(fit.bar.step)));
  assert.ok(Math.abs(mant - 2) < 1e-9 || Math.abs(mant - 1) < 1e-9, 'the test tree starts at a step of 1 or 2 x 10^n');
  // zoom about the root so the bar's raw length (90 px in tree units) lands just above half the step: the step halves
  const raw = 90 / fit.ppu;
  const f = raw / (fit.bar.step * 0.6);
  const root = m.viewer.nodePosition(0);
  m.viewer.zoomBy(f, f, root.x, root.y);
  const zoomed = values();
  assert.ok(Math.abs(zoomed.bar.step - fit.bar.step / 2) < 1e-12, `the step halves: ${fit.bar.step} -> ${zoomed.bar.step}`);
  // the largest multiple of the old step seen in both frames
  const upTo = Math.floor(Math.min(Math.max(...fit.d), Math.max(...zoomed.d)) / fit.bar.step + 1e-9) * fit.bar.step;
  const n = (v) => v.d.filter((x) => x <= upTo + 1e-9).length;
  assert.ok(n(fit) >= 1, 'a common range');
  assert.equal(n(zoomed), 2 * n(fit), `${n(fit)} rings up to ${upTo} become ${n(zoomed)}`);
  for (const x of fit.d.filter((x) => x <= upTo + 1e-9))
    assert.ok(
      zoomed.d.some((y) => Math.abs(x - y) < 1e-9),
      `the ring at ${x} stays`,
    );
  m.viewer.zoomBy(1 / f, 1 / f, root.x, root.y);
  const back = values();
  assert.equal(back.bar.step, fit.bar.step, 'zooming out merges them again');
  assert.equal(n(back), n(fit));
});

test('a dated tree: the rings are anchored at the tips (age 0), every ring an age that is a multiple of the step', async () => {
  const m = await make(DATED, 'lines');
  m.env.flush();
  const log = frame(m);
  const rings = ringsOf(log);
  const bar = scaleBar(log);
  const root = m.viewer.nodePosition(0);
  const k = dist(m.viewer.nodePosition(m.viewer.getTree().tipNode[0]), root);
  const radii = rings.arcs.map((a) => a[2]);
  assert.ok(
    radii.some((r) => Math.abs(r - k) < 1e-6),
    'a ring through the tips',
  );
  for (const r of radii) assert.ok(isMultiple(k - r, bar.w) && r > 0, `age ${(k - r) / bar.w} steps`);
  assert.ok(!radii.every((r) => isMultiple(r, bar.w)), 'not counted from the root (5 is no multiple of the step)');
  // a tree that is not dated counts from the root instead: no ring through its farthest tip unless that happens to be a multiple
  const p = await make(PHYLO, 'lines');
  p.env.flush();
  const pl = frame(p);
  for (const a of ringsOf(pl).arcs) assert.ok(isMultiple(a[2], scaleBar(pl).w));
});

test("'stripes': every other band between the rings is filled at ringStripeOpacity, one step wide, the band at the tips clear", async () => {
  const m = await make(DATED, 'stripes');
  m.env.flush();
  const log = frame(m);
  const rings = ringsOf(log);
  assert.ok(rings && rings.alpha === RSO && rings.op === 'fill', 'filled at ringStripeOpacity');
  const bar = scaleBar(log);
  const root = m.viewer.nodePosition(0);
  const k = dist(m.viewer.nodePosition(m.viewer.getTree().tipNode[0]), root);
  assert.ok(rings.arcs.length >= 2 && rings.arcs.length % 2 === 0, 'an outer and an inner arc per band');
  for (let i = 0; i < rings.arcs.length; i += 2) {
    const outer = rings.arcs[i],
      inner = rings.arcs[i + 1];
    assert.ok(!outer[5] && inner[5] === true, 'the outer arc clockwise, the inner one back: an annulus');
    const j = Math.round((k - outer[2]) / bar.w);
    assert.ok(isMultiple(k - outer[2], bar.w) && j % 2 === 1, `band ${j}: an odd one, so the band at the tips stays clear`);
    assert.ok(Math.abs(outer[2] - inner[2] - bar.w) < 1e-6 || inner[2] === 0, 'one step wide (or ending at the root)');
  }
});

test('zoomed in off the root: only the rings crossing the viewport, and only over the angles it covers', async () => {
  const m = await make(PHYLO, 'lines');
  m.env.flush();
  const t = m.viewer.getTree();
  const tip = m.viewer.nodePosition(t.tipNode[2]);
  m.viewer.zoomBy(8, 8, tip.x, tip.y);
  const log = frame(m);
  const rings = ringsOf(log);
  assert.equal(m.viewer.nodePosition(0), null, 'the root is out of view');
  const root = { x: rings.arcs[0][0], y: rings.arcs[0][1] }; // the rings' centre (the root, see above)
  const bar = scaleBar(log);
  const { width: W, height: H } = m.viewer.size;
  const far = Math.max(...[0, W].flatMap((x) => [0, H].map((y) => Math.hypot(x - root.x, y - root.y))));
  const near = Math.hypot(Math.max(0, -root.x, root.x - W), Math.max(0, -root.y, root.y - H));
  assert.ok(near > 0, 'the root is out of view');
  assert.ok(rings.arcs.length >= 1 && rings.arcs.length <= Math.ceil((far - near) / bar.w) + 2, `${rings.arcs.length} rings`);
  for (const [, , r, a0, a1] of rings.arcs) {
    assert.ok(r >= near - 20 && r <= far + 20, 'each crosses the viewport (with the cull pad)');
    assert.ok(a1 - a0 < Math.PI, 'an arc, not a circle');
  }
});

test('labels: the distance of each ring along the middle of the opening, none without an opening', async () => {
  const m = await make(PHYLO, 'lines', { radialOpening: 0.25 });
  m.env.flush();
  const log = frame(m);
  const bar = scaleBar(log);
  const root = m.viewer.nodePosition(0);
  const at = log.findIndex((e) => e[0] === 'globalAlpha=' && e[1] === RO);
  const end = log.findIndex((e, i) => i > at && e[0] === 'restore');
  const texts = log.slice(at, end).filter((e) => e[0] === 'fillText');
  assert.ok(texts.length >= 1, 'labelled');
  const out = m.viewer.getTheme().axisFontSize / 2 + 2; // just outside its ring: half the text's height below it, and 2 px
  for (const [, text, x, y] of texts) {
    // the opening is at the bottom (radialRotation 90): straight below the root
    assert.ok(Math.abs(x - root.x) < 1e-6 && y > root.y, 'on the ray through the middle of the opening');
    const r = y - root.y - out;
    assert.ok(isMultiple(r, bar.w), 'just outside a ring, clear of its line');
    assert.ok(Math.abs(Number(text) - (r / bar.w) * bar.step) < 1e-9, 'its distance from the root');
  }
  const full = await make(PHYLO, 'lines', { radialOpening: 0 });
  full.env.flush();
  const fl = frame(full);
  const a = fl.findIndex((e) => e[0] === 'globalAlpha=' && e[1] === RO);
  assert.ok(
    !fl
      .slice(
        a,
        fl.findIndex((e, i) => i > a && e[0] === 'restore'),
      )
      .some((e) => e[0] === 'fillText'),
    'a full circle: no labels',
  );
});
