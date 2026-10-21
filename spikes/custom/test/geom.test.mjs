// Unit tests of src/core/geom.ts: the screen transform of both layouts, the annular sector bounding box (against a brute-force sample of the
// sector boundary, across quadrant crossings and the wrap at 2 pi) and the tolerance of viewportEquals.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const { makeTransform, sectorBBox, viewportEquals } = await import(path.join(root, 'spikes/custom/src/core/geom.ts'));

const HALF = Math.PI / 2;
const TAU = 2 * Math.PI;

/** The exact bounding box of the sector, by sampling its boundary: both arcs and both edges, and always the angles of the two edges and
 *  of every axis crossing in between (where the extremes of an arc lie). */
function brute(cx, cy, r0, r1, a0, a1) {
  const angles = [a0, a1];
  for (let q = Math.ceil(a0 / HALF); q * HALF <= a1; q++) angles.push(q * HALF);
  const N = 2000;
  for (let s = 0; s <= N; s++) angles.push(a0 + ((a1 - a0) * s) / N);
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  const add = (r, a) => {
    const x = r * Math.cos(a),
      y = r * Math.sin(a);
    x0 = Math.min(x0, x);
    x1 = Math.max(x1, x);
    y0 = Math.min(y0, y);
    y1 = Math.max(y1, y);
  };
  for (const a of angles) {
    add(r0, a);
    add(r1, a);
  }
  for (let s = 0; s <= 50; s++) {
    const r = r0 + ((r1 - r0) * s) / 50;
    add(r, a0);
    add(r, a1);
  }
  return [cx + x0, cy + y0, cx + x1, cy + y1];
}

function check(cx, cy, r0, r1, a0, a1, label) {
  const out = new Float64Array(4);
  sectorBBox(cx, cy, r0, r1, a0, a1, out);
  const want = brute(cx, cy, r0, r1, a0, a1);
  for (let k = 0; k < 4; k++) assert.ok(Math.abs(out[k] - want[k]) < 1e-9, `${label}: component ${k} is ${out[k]}, brute force ${want[k]}`);
}

test('sectorBBox: sectors inside one quadrant, and crossing each of the axes (0, 90, 180, 270 degrees)', () => {
  check(0, 0, 10, 50, 0.1, 0.5, 'quadrant 1');
  check(0, 0, 10, 50, HALF + 0.2, HALF + 0.9, 'quadrant 2');
  check(0, 0, 10, 50, Math.PI + 0.2, Math.PI + 0.9, 'quadrant 3');
  check(0, 0, 10, 50, 1.5 * Math.PI + 0.2, 1.5 * Math.PI + 0.9, 'quadrant 4');
  check(0, 0, 10, 50, 0, 0.4, 'starts on 0');
  check(0, 0, 10, 50, HALF - 0.3, HALF + 0.3, 'crosses 90');
  check(0, 0, 10, 50, Math.PI - 0.3, Math.PI + 0.3, 'crosses 180');
  check(0, 0, 10, 50, 1.5 * Math.PI - 0.3, 1.5 * Math.PI + 0.3, 'crosses 270');
  check(0, 0, 10, 50, TAU - 0.4, TAU, 'ends exactly at 2 pi (the wrap): the 0 direction is reached');
  check(0, 0, 10, 50, 1.2, 4.9, 'crosses 90, 180 and 270');
  check(0, 0, 10, 50, 0, TAU, 'the full circle');
  check(0, 0, 10, 50, HALF, HALF, 'degenerate sector on an axis');
});

test('sectorBBox: the centre is added, the inner radius matters only when no axis is crossed, r0 = 0 is a pie slice', () => {
  check(120, -35, 0, 80, 0.3, 2.2, 'pie slice around an off-origin centre');
  check(-40, 300, 30, 31, 3.0, 3.3, 'thin ring piece');
  const out = new Float64Array(4);
  sectorBBox(100, 200, 10, 50, 0.1, 0.5, out);
  assert.ok(out[0] > 100 + 8 && out[1] > 200, 'a small sector in quadrant 1 stays right of and below the centre');
  sectorBBox(100, 200, 10, 50, -0.2, 0.2, out);
  assert.ok(Math.abs(out[2] - 150) < 1e-9, 'a sector across the 0 direction (negative start) reaches x = cx + r1');
});

test('sectorBBox: random sectors agree with the brute force', () => {
  let s = 12345;
  const rnd = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
  for (let n = 0; n < 200; n++) {
    const a0 = rnd() * TAU;
    const a1 = Math.min(TAU, a0 + rnd() * 3);
    const r0 = rnd() * 40;
    check(rnd() * 100, rnd() * 100, r0, r0 + rnd() * 60, a0, a1, `random sector ${n}`);
  }
});

test('viewportEquals: relative tolerance (1e-9 of the larger of 1 and the values), per coordinate, custom eps', () => {
  const a = { x0: 0, x1: 1, y0: 0, y1: 100 };
  assert.equal(viewportEquals(a, { ...a }), true);
  assert.equal(viewportEquals(a, { ...a, x1: 1 + 1e-10 }), true, 'within 1e-9 near 1');
  assert.equal(viewportEquals(a, { ...a, x1: 1 + 1e-8 }), false, 'beyond it');
  assert.equal(viewportEquals(a, { ...a, x0: 5e-10 }), true, 'near 0 the tolerance is absolute (1e-9)');
  assert.equal(viewportEquals(a, { ...a, x0: 5e-9 }), false);
  for (const k of ['x0', 'x1', 'y0', 'y1']) assert.equal(viewportEquals(a, { ...a, [k]: a[k] + 1 }), false, `${k} differs`);
  const big = { x0: 1e6, x1: 2e6, y0: 0, y1: 1 };
  assert.equal(viewportEquals(big, { ...big, x0: 1e6 + 5e-4 }), true, 'scaled with the magnitude: 1e-9 * 1e6 = 1e-3');
  assert.equal(viewportEquals(big, { ...big, x0: 1e6 + 5e-3 }), false);
  assert.equal(viewportEquals(a, { ...a, y1: 100.5 }, 0.01), true, 'custom eps');
  assert.equal(viewportEquals(a, { ...a, y1: 102 }, 0.01), false);
  assert.equal(viewportEquals(a, { ...a, y1: 100 + 1e-7 }, 0), false, 'eps 0 is exact');
});

const area = { ax: 10, ay: 20, aw: 400, ah: 200, clipL: 10, clipT: 20, clipR: 410, clipB: 220 };

test('makeTransform, rectangular: separate x and y scales, the origin maps the window corner to the area corner', () => {
  const v = { x0: 0.25, x1: 0.75, y0: 10, y1: 30 };
  const T = makeTransform('rectangular', 500, 300, v, area, 40);
  assert.equal(T.kind, 'rectangular');
  assert.equal(T.kx, 400 / 0.5);
  assert.equal(T.ky, 200 / 20);
  assert.equal(T.ox + v.x0 * T.kx, area.ax, 'window left edge -> area left');
  assert.equal(T.ox + v.x1 * T.kx, area.ax + area.aw, 'window right edge -> area right');
  assert.equal(T.oy + v.y0 * T.ky, area.ay);
  assert.equal(T.oy + v.y1 * T.ky, area.ay + area.ah);
  assert.equal(T.da, TAU / 40);
  assert.equal(T.k, T.kx);
  assert.deepEqual([T.W, T.H], [500, 300]);
  assert.deepEqual([T.clipL, T.clipT, T.clipR, T.clipB], [10, 20, 410, 220]);
  assert.equal(T.area, area);
});

test('makeTransform, radial: one scale (px per world unit), the root (0, 0) lands at (cx, cy)', () => {
  const v = { x0: -1, x1: 1, y0: -0.5, y1: 0.5 };
  const T = makeTransform('radial', 500, 300, v, area, 8);
  assert.equal(T.kind, 'radial');
  assert.equal(T.k, 400 / 2, 'the scale comes from the x window');
  assert.equal(T.cx, area.ax + 1 * T.k, 'world x = 0 is one unit right of the window left edge');
  assert.equal(T.cy, area.ay - v.y0 * T.k, 'world y = 0 is on the same scale along y (cy uses kx, not ky)');
  assert.equal(T.ky, 200 / 1, 'ky is still the area height over the y window');
  assert.equal(T.da, TAU / 8);
  const pan = makeTransform('radial', 500, 300, { x0: 0, x1: 2, y0: 3, y1: 4 }, area, 8);
  assert.equal(pan.cx, area.ax, 'the window left edge is at world 0');
  assert.equal(pan.cy, area.ay - 3 * pan.k);
});

test('makeTransform: da never divides by zero tips', () => {
  const T = makeTransform('radial', 10, 10, { x0: -1, x1: 1, y0: -1, y1: 1 }, area, 0);
  assert.equal(T.da, TAU);
});
