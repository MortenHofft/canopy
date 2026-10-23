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
