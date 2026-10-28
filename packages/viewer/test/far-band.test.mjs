// The radial band of a slice or run whose radius is far off (beyond RADIAL_FAR_ARC_R): drawn over the window's angles only, with arcs, so
// its outer edge follows the tips in view instead of a chord across the whole run (#77); a window across the angle seam (proj.wrap) gets
// one piece per end.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const core = path.join(root, 'packages/viewer/src');
const { parseNewick } = await import(path.join(root, 'packages/io/src/newick.ts'));
const { computeLayout, ensureTrig } = await import(path.join(core, 'layout.ts'));
const { InMemorySource } = await import(path.join(core, 'source.ts'));
const { makeTransform } = await import(path.join(core, 'geom.ts'));
const { projectionFor } = await import(path.join(core, 'projection.ts'));
const { fanSummaryShape } = await import(path.join(core, 'draw.ts'));
const { RADIAL_FAR_ARC_R } = await import(path.join(core, 'constants.ts'));
const { recordingContext } = await import('./viewer-harness.mjs');

// one polytomy of 2,000 tips (a slice) under the root, on the whole circle from 3 o'clock (the layout's default fan)
// tips 0.001 beyond it, so the band's inner and outer radius are both far off
const tree = new InMemorySource(parseNewick('((' + Array.from({ length: 2000 }, (_, i) => `t${i}:0.001`).join(',') + '):1);')).snapshot();
const L = computeLayout(tree, true);
ensureTrig(L);
const P = 1; // the polytomy
const W = 1200,
  H = 900;
const area = { ax: 0, ay: 0, aw: W, ah: H, clipL: 0, clipT: 0, clipR: W, clipB: H };

/** The band's path calls at a window of W x H px centred on the rim at angle `ang`, k px per unit radius. */
function bandAt(ang, k) {
  const c = { x: Math.cos(ang), y: Math.sin(ang) };
  const view = { x0: c.x - W / 2 / k, x1: c.x + W / 2 / k, y0: c.y - H / 2 / k, y1: c.y + H / 2 / k };
  const proj = projectionFor(tree, L, makeTransform('radial', W, H, view, area, L.rows, L.fan));
  const ctx = recordingContext({});
  proj.summaryExtent(P, -1, 0);
  fanSummaryShape(ctx, proj, P, true);
  return { proj, log: ctx.log };
}
const near = (log) => log.filter((e) => e[0] === 'moveTo' || e[0] === 'lineTo').every((e) => Math.hypot(e[1] - W / 2, e[2] - H / 2) < 5000);

test('a far band is drawn over the visible angles with arcs, not a chord over all its angles', () => {
  const k = 2.5e4; // far, yet the visible part of the rim (over 1000 px) is curved enough to be an arc
  assert.ok(k > RADIAL_FAR_ARC_R);
  const { proj, log } = bandAt(1, k);
  assert.equal(proj.wrap, false);
  const arcs = log.filter((e) => e[0] === 'arc');
  assert.ok(arcs.length >= 1, 'the outer edge is an arc');
  for (const a of arcs) {
    const lo = Math.min(a[4], a[5]),
      hi = Math.max(a[4], a[5]);
    assert.ok(lo >= proj.lo - 1e-12 && hi <= proj.hi + 1e-12, `arc ${lo}..${hi} inside the window's angles ${proj.lo}..${proj.hi}`);
  }
  assert.ok(near(log), 'every corner is near the window: no chord across the band');
});

test('a far band in a window across the angle seam is two pieces, one at each end', () => {
  const { proj, log } = bandAt(0, 2.5e4);
  assert.equal(proj.wrap, true, 'the window straddles angle 0');
  const outer = log.filter((e) => e[0] === 'arc' && e[6] !== true);
  assert.equal(outer.length, 2, 'one outer arc per end');
  assert.ok(outer.some((a) => a[4] >= proj.lo - 1e-12) && outer.some((a) => a[5] <= proj.hi + 1e-12));
  assert.ok(near(log), 'every corner is near the window: no chord across the band');
});

// The same far off for a fan (a collapsed clade drawn from its node, #94): its outer edge was a chord between its two corners, sagging
// inside the tips in view, so the fill stopped short of them. Now it is an arc over the visible angles, with the edges towards the apex kept.
/** The fan's path calls of the polytomy, as `bandAt`. */
function fanAt(ang, k) {
  const c = { x: Math.cos(ang), y: Math.sin(ang) };
  const view = { x0: c.x - W / 2 / k, x1: c.x + W / 2 / k, y0: c.y - H / 2 / k, y1: c.y + H / 2 / k };
  const proj = projectionFor(tree, L, makeTransform('radial', W, H, view, area, L.rows, L.fan));
  const ctx = recordingContext({});
  proj.summaryExtent(P, -1, 0);
  const a0 = proj.t0,
    a1 = proj.t1;
  fanSummaryShape(ctx, proj, P, false);
  return { proj, log: ctx.log, a0, a1 };
}

test('a far fan has an arc over the visible angles as its outer edge, and keeps its edges towards the apex', () => {
  const k = 2.5e4;
  const { proj, log, a0, a1 } = fanAt(1, k);
  assert.equal(proj.wrap, false);
  const arcs = log.filter((e) => e[0] === 'arc');
  assert.equal(arcs.length, 1, 'the outer edge is one arc');
  const [, , , r, s, e] = arcs[0];
  assert.equal(r, Math.max(proj.d0 + 2, proj.d1), 'the arc is at the tips');
  assert.ok(Math.abs(s - proj.lo) < 1e-12 && Math.abs(e - proj.hi) < 1e-12, `arc ${s}..${e} is the window's angles ${proj.lo}..${proj.hi}`);
  // apex, the corner at a0, the arc, the corner at a1, closed back to the apex
  const { cx, cy } = proj.T;
  const ang = (p) => Math.atan2(p[2] - cy, p[1] - cx);
  assert.equal(log[0][0], 'moveTo');
  assert.equal(log[1][0], 'lineTo');
  assert.ok(Math.abs(ang(log[1]) - (a0 > Math.PI ? a0 - 2 * Math.PI : a0)) < 1e-9, 'the first edge goes to the corner at a0');
  const last = log[log.length - 2];
  assert.equal(last[0], 'lineTo');
  assert.ok(Math.abs(ang(last) - (a1 > Math.PI ? a1 - 2 * Math.PI : a1)) < 1e-9, 'the last edge comes from the corner at a1');
  assert.equal(log[log.length - 1][0], 'closePath');
});

test('a far fan in a window across the angle seam has one outer arc per end, in increasing angle', () => {
  const { proj, log } = fanAt(0, 2.5e4);
  assert.equal(proj.wrap, true);
  const arcs = log.filter((e) => e[0] === 'arc');
  assert.equal(arcs.length, 2, 'one arc per end');
  assert.ok(arcs[0][5] <= proj.hi + 1e-12, 'first the piece 0..hi');
  assert.ok(arcs[1][4] >= proj.lo - 1e-12, 'then the piece lo..2pi');
});
