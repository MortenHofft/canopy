// Unit tests of drawCladeBoxes (#43) on a projection built by hand and a recording context: the work is bounded by the view (boxes off
// screen are not visited, sub-pixel boxes are merged), the boxes around the view are found, and the radial culling, the far-radius path
// and the fan options give the right sectors.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const core = path.join(root, 'packages/viewer/src');
const { parseNewick } = await import(path.join(root, 'packages/io/src/newick.ts'));
const { computeLayout, radialFan, setLayoutFan } = await import(path.join(core, 'layout.ts'));
const { makeTransform } = await import(path.join(core, 'geom.ts'));
const { projectionFor } = await import(path.join(core, 'projection.ts'));
const { drawCladeBoxes } = await import(path.join(core, 'draw.ts'));
const { FALLBACK_THEME } = await import(path.join(core, 'types.ts'));
const { RADIAL_FAR_ARC_R } = await import(path.join(core, 'constants.ts'));
const { recordingContext } = await import('./viewer-harness.mjs');

const COLOURS = ['', '#ff0000', '#00ff00', '#0000ff', '#ffff00', '#00ffff'];
const W = 400,
  H = 400;
const AREA = { ax: 10, ay: 0, aw: 300, ah: 400, clipL: 0, clipT: 0, clipR: 390, clipB: 400 };

/** A balanced tree of 2^depth tips. */
function balanced(depth) {
  let n = 0;
  const walk = (d) => (d === 0 ? 't' + n++ : '(' + walk(d - 1) + ',' + walk(d - 1) + ')');
  return parseNewick(walk(depth) + ';');
}

/** Boxes on `nodes` (preorder) with colour classes `cls`. */
const boxesOf = (nodes, cls) => ({ rows: Int32Array.from(nodes), cls: Uint8Array.from(cls), up: new Int32Array(nodes.length), upFor: null });
const tipsOf = (tree) => [...Array(tree.nodeCount).keys()].filter((i) => tree.firstChild[i] < 0);

/** Draw the boxes of `tree` in the window `view`; returns the log and the number of summaryExtent calls. */
function draw(tree, boxes, view, { kind = 'rectangular', fan = null, L = computeLayout(tree, false, null), setup } = {}) {
  if (fan) setLayoutFan(L, fan);
  const T = makeTransform(kind, W, H, view, kind === 'radial' ? { ...AREA, ax: 0, aw: W, clipR: W } : AREA, L.rows, L.fan);
  const proj = projectionFor(tree, L, T);
  setup?.(proj);
  let extents = 0;
  const se = proj.summaryExtent.bind(proj);
  proj.summaryExtent = (...a) => (extents++, se(...a));
  const ctx = recordingContext({});
  const S = { proj, theme: FALLBACK_THEME, colours: COLOURS, cladeBoxes: boxes, labelReach: 50, hlPrefix: null, alignLabels: false, labelRoom: 0 };
  drawCladeBoxes(ctx, S);
  return { ctx, extents, proj, L };
}

/** The fills (fillRect, or fill of a path) with the colour in force. */
function fills(ctx) {
  let fill = '';
  const out = [];
  for (const e of ctx.log) {
    if (e[0] === 'fillStyle=') fill = e[1];
    else if (e[0] === 'fillRect' || e[0] === 'fill') out.push({ fill, args: e.slice(1) });
  }
  return out;
}

test('4096 sub-pixel tip boxes of one colour: about one fill per pixel across the tips, covering them all', () => {
  const tree = balanced(12);
  const tips = tipsOf(tree);
  const { ctx } = draw(
    tree,
    boxesOf(
      tips,
      tips.map(() => 1),
    ),
    { x0: 0, x1: 1, y0: 0, y1: 4096 },
  );
  const f = fills(ctx);
  assert.ok(f.length <= H + 1, `${f.length} fills for 4096 boxes in ${H} px`);
  const top = Math.min(...f.map((x) => x.args[1])),
    bottom = Math.max(...f.map((x) => x.args[1] + x.args[3]));
  assert.ok(Math.abs(top) < 1e-6 && Math.abs(bottom - H) < 1e-6, `the merged boxes cover every row (${top}..${bottom})`);
});

/** A seeded random number generator (mulberry32), so the random cases are the same on every run. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('4096 sub-pixel tip boxes in mixed colours: about one fill per pixel, and every row still covered', () => {
  const tree = balanced(12);
  const tips = tipsOf(tree);
  const random = rng(43);
  const patterns = {
    'one colour': () => 1,
    '3 alternating': (k) => 1 + (k % 3),
    'runs of 4 in 5 colours': (k) => 1 + (Math.floor(k / 4) % 5),
    'random, 5 colours': () => 1 + Math.floor(random() * 5),
  };
  for (const [name, colourOf] of Object.entries(patterns)) {
    const { ctx } = draw(
      tree,
      boxesOf(
        tips,
        tips.map((_, k) => colourOf(k)),
      ),
      { x0: 0, x1: 1, y0: 0, y1: 4096 },
    );
    const f = fills(ctx);
    assert.ok(f.length <= 1.25 * H, `${name}: ${f.length} fills`);
    // the fills follow each other down the rows without gaps or overlaps
    let y = 0;
    for (const { args } of f) {
      assert.ok(Math.abs(args[1] - y) < 1e-6, `${name}: a fill starts at ${args[1]}, where the one before ended (${y})`);
      y = args[1] + args[3];
    }
    assert.ok(Math.abs(y - H) < 1e-6, `${name}: the fills cover the ${H} px (${y})`);
  }
});

test('zoomed in: the boxes off screen are not visited', () => {
  const tree = balanced(12);
  const tips = tipsOf(tree);
  const { ctx, extents } = draw(
    tree,
    boxesOf(
      tips,
      tips.map(() => 1),
    ),
    { x0: 0, x1: 1, y0: 2000, y1: 2040 },
  );
  assert.ok(extents <= 42, `${extents} boxes visited of 4096`);
  assert.equal(fills(ctx).length, 40, 'one fill per tip row in view (10 px each)');
});

test('a box that starts above the view and reaches into it is drawn, outer boxes before inner ones', () => {
  const tree = balanced(6); // 64 tips; node 1 holds the first 32, node 2 the first 16, node 33 the first tip of the second 8
  const L = computeLayout(tree, false, null);
  const n8 = [...Array(tree.nodeCount).keys()].find((i) => L.rowStart[i] === 8 && L.rowEnd[i] === 16);
  const { ctx } = draw(tree, boxesOf([1, 2, n8], [1, 2, 3]), { x0: 0, x1: 1, y0: 10, y1: 14 }, { L });
  assert.deepEqual(
    fills(ctx).map((x) => x.fill),
    ['#ff0000', '#00ff00', '#0000ff'],
  );
  const { ctx: below } = draw(tree, boxesOf([1, 2, n8], [1, 2, 3]), { x0: 0, x1: 1, y0: 20, y1: 24 }, { L });
  assert.deepEqual(
    fills(below).map((x) => x.fill),
    ['#ff0000'],
    'below the inner ones only the outer box is in view',
  );
});

test('boxes stop at the right edge of the tree (columns start beyond it)', () => {
  const tree = balanced(3);
  const { ctx } = draw(tree, boxesOf([1], [1]), { x0: 0, x1: 1, y0: 0, y1: 8 });
  const [x, , w] = fills(ctx)[0].args;
  assert.ok(x + w <= AREA.clipR + 1e-9);
});

test('radial: one sector per box, angles from the fan; a box outside the visible angles or radii is skipped', () => {
  const tree = balanced(4); // 16 tips; node 1 the first 8 (rows 0..8), node 16 the second 8
  const fan = radialFan(0.25, 30);
  const L = computeLayout(tree, false, null);
  setLayoutFan(L, fan);
  const k = 150;
  const whole = { x0: -W / 2 / k, x1: W / 2 / k, y0: -H / 2 / k, y1: H / 2 / k }; // the root in the middle: every angle
  const { ctx } = draw(tree, boxesOf([0, 1], [1, 2]), whole, { kind: 'radial', L });
  const f = fills(ctx);
  assert.deepEqual(
    f.map((x) => x.fill),
    ['#ff0000', '#00ff00'],
  );
  const arcs = ctx.calls('arc');
  const da = fan.span / L.rows;
  assert.ok(
    arcs.some((a) => Math.abs(a[4] - fan.start) < 1e-9 && Math.abs(a[5] - (fan.start + 8 * da)) < 1e-9),
    'the first half sector spans its rows on the fan',
  );
  assert.ok(
    arcs.some((a) => Math.abs(a[5] - a[4] - fan.span) < 1e-9),
    'the root box goes over the whole fan',
  );
  // a window that sees only the first rows' angles (just right of the root, below its horizontal for a fan starting there)
  const L2 = computeLayout(tree, false, null);
  setLayoutFan(L2, radialFan(0, 0));
  const near = draw(tree, boxesOf([1, 16], [1, 2]), { x0: 0.2, x1: 1.2, y0: 0.05, y1: 1.05 }, { kind: 'radial', L: L2 });
  assert.deepEqual(
    fills(near.ctx).map((x) => x.fill),
    ['#ff0000'],
    'the box of the other half is outside the visible angles',
  );
  // far out beyond the boxes' outer radius: nothing
  const far = draw(tree, boxesOf([1, 16], [1, 2]), { x0: 20, x1: 21, y0: 20, y1: 21 }, { kind: 'radial', L: L2 });
  assert.equal(fills(far.ctx).length, 0);
});

test('radial, wrapped window: a box over both ends is drawn once, boxes at either end are drawn, one in the middle is not', () => {
  const tree = balanced(4);
  const L = computeLayout(tree, false, null);
  setLayoutFan(L, radialFan(0, 0));
  const k = 150;
  const view = { x0: -W / 2 / k, x1: W / 2 / k, y0: -H / 2 / k, y1: H / 2 / k };
  const da = (2 * Math.PI) / 16;
  const first = [...Array(tree.nodeCount).keys()].find((i) => L.rowStart[i] === 0 && L.rowEnd[i] === 2);
  const middle = [...Array(tree.nodeCount).keys()].find((i) => L.rowStart[i] === 8 && L.rowEnd[i] === 10);
  const last = [...Array(tree.nodeCount).keys()].find((i) => L.rowStart[i] === 14 && L.rowEnd[i] === 16);
  // the window sees the angles up to 3 rows and from 13 rows on (across angle 0)
  const setup = (proj) => {
    proj.all = false;
    proj.wrap = true;
    proj.hi = 3 * da;
    proj.lo = 13 * da;
  };
  const { ctx } = draw(tree, boxesOf([0, first, middle, last], [1, 2, 3, 2]), view, { kind: 'radial', L, setup });
  assert.deepEqual(
    fills(ctx).map((x) => x.fill),
    ['#ff0000', '#00ff00', '#00ff00'],
  );
});

test('radial, far radius: the sector is drawn over the visible angles only', () => {
  const tree = balanced(4);
  const L = computeLayout(tree, false, null);
  setLayoutFan(L, radialFan(0, 0));
  // zoomed in so that the tips are far beyond RADIAL_FAR_ARC_R (k = 400,000 px per unit), looking at the ring of the tips near angle 0.01
  const view = { x0: 1 - 0.5 / 1000, x1: 1 + 0.5 / 1000, y0: 0.01, y1: 0.01 + 1 / 1000 };
  const { ctx, proj } = draw(tree, boxesOf([0], [1]), view, { kind: 'radial', L });
  assert.ok(proj.rMin > RADIAL_FAR_ARC_R && !proj.all && !proj.wrap);
  assert.equal(fills(ctx).length, 1);
  const { cx, cy } = proj.T;
  const pts = [...ctx.calls('moveTo'), ...ctx.calls('lineTo')];
  assert.ok(pts.length >= 3);
  for (const [, x, y] of pts) {
    if (Math.hypot(x - cx, y - cy) < 1) continue; // the root box's inner edge is the centre
    const a = Math.atan2(y - cy, x - cx);
    assert.ok(a >= proj.lo - 1e-6 && a <= proj.hi + 1e-6, `corner at ${a} within the visible angles ${proj.lo}..${proj.hi}`);
  }
});
