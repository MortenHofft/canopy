// The opening of the radial layout (issue #41): options radialOpening and radialRotation, and the one fan helper (layout.ts: radialFan,
// fanAngle, fanTheta, fanRow) the trig cache, the projection, the cut, hit-testing, the fit, the keyboard and the view-keeping go through.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const core = path.join(root, 'packages/viewer/src');
const { parseNewick } = await import(path.join(root, 'packages/io/src/newick.ts'));
const { computeLayout, ensureTrig, radialFan, fanAngle, fanRow, fanTheta, FULL_FAN, setLayoutFan } = await import(path.join(core, 'layout.ts'));
const { makeTransform } = await import(path.join(core, 'geom.ts'));
const { projectionFor } = await import(path.join(core, 'projection.ts'));
const { DEFAULT_OPTIONS } = await import(path.join(core, 'types.ts'));
const { defaultActiveNode } = await import(path.join(core, 'keyboard.ts'));
const { makeViewer, destroyAll } = await import('./viewer-harness.mjs');

afterEach(destroyAll);

const TAU = 2 * Math.PI;
const tips = (n) => '(' + Array.from({ length: n }, (_, k) => `t${k}:1`).join(',') + ')r;';
const NWK = '((((a:1,b:1):1,(c:1,d:1):1):1,((e:1,f:1):1,(g:1,h:1):1):1):1,((i:1,j:1):1,(k:1,l:1):1):1)r;';
const close = (a, b, eps = 1e-12) => Math.abs(a - b) <= eps;

test('the options default to 5% open with the opening at the bottom', () => {
  assert.equal(DEFAULT_OPTIONS.radialOpening, 0.05);
  assert.equal(DEFAULT_OPTIONS.radialRotation, 90);
  const f = radialFan(0.05, 90);
  assert.ok(close(f.span, 0.95 * TAU));
  assert.ok(close(f.start, Math.PI / 2 + 0.05 * Math.PI), 'the rows start half an opening clockwise of the bottom');
});

test('default fan: the first and the last tip sit symmetrically either side of the opening at the bottom', () => {
  const t = parseNewick(NWK);
  const L = computeLayout(t, true);
  ensureTrig(L, radialFan(DEFAULT_OPTIONS.radialOpening, DEFAULT_OPTIONS.radialRotation));
  const first = t.tipNode[0],
    last = t.tipNode[t.tipCount - 1];
  // canvas angles: y grows downwards, so the bottom is +y; clockwise from just left of the bottom over the top to just right of it
  assert.ok(L.SIN[first] > 0.9 && L.SIN[last] > 0.9, 'both ends are near the bottom');
  assert.ok(L.COS[first] < 0 && L.COS[last] > 0, 'the first tip is left of the opening, the last right of it');
  assert.ok(close(L.COS[first], -L.COS[last]), 'mirror images in x');
  assert.ok(close(L.SIN[first], L.SIN[last]), 'at the same height');
  // the angle between them, through the opening: the opening plus half a row on each side
  const da = (0.95 * TAU) / t.tipCount;
  const gap = Math.acos(L.COS[first] * L.COS[last] + L.SIN[first] * L.SIN[last]);
  assert.ok(close(gap, 0.05 * TAU + da, 1e-9), `gap ${gap}`);
  const top = t.tipNode[t.tipCount / 2 - 1]; // the tips are centred on the top: the middle of the order is at 12 o'clock
  assert.ok(L.SIN[top] < -0.95, 'the middle of the tip order is at the top');
});

test("radialOpening 0 and radialRotation 0 are exactly the angles of the whole circle from 3 o'clock (as before the options)", () => {
  assert.deepEqual(radialFan(0, 0), FULL_FAN);
  const t = parseNewick(NWK);
  const L = computeLayout(t, true);
  ensureTrig(L, radialFan(0, 0));
  const da = TAU / L.rows; // the old formula: angle = ROW * 2pi / rows
  for (let i = 0; i < t.nodeCount; i++) {
    assert.equal(L.COS[i], Math.cos(L.ROW[i] * da));
    assert.equal(L.SIN[i], Math.sin(L.ROW[i] * da));
  }
  for (let k = 0; k <= L.rows; k++) assert.equal(L.BC[k], Math.cos(k * da));
  const area = { ax: 0, ay: 0, aw: 300, ah: 200, clipL: 0, clipT: 0, clipR: 300, clipB: 200 };
  const T = makeTransform('radial', 300, 200, { x0: 0.5, x1: 1.5, y0: -0.6, y1: 0.4 }, area, L.rows, radialFan(0, 0));
  assert.equal(T.da, TAU / L.rows);
  const p = projectionFor(t, L, T);
  for (let i = 0; i < t.nodeCount; i++) assert.equal(p.tip(i), L.ROW[i] * da);
  assert.ok(p.wrap && p.lo > Math.PI && p.hi < Math.PI, "a window across 3 o'clock wraps through angle 0, as before");
  assert.equal(fanTheta(FULL_FAN, -0.5), -0.5 + TAU, 'directions are 0..2pi');
});

test('a changed fan rebuilds the trig cache; the same fan keeps it', () => {
  const t = parseNewick(NWK);
  const L = computeLayout(t, true);
  ensureTrig(L);
  const c = L.COS;
  setLayoutFan(L, radialFan(0, 0));
  assert.equal(L.COS, c, 'same fan by value: nothing is rebuilt');
  ensureTrig(L, radialFan(0.5, 90));
  assert.notEqual(L.COS, c);
  assert.ok(close(L.fan.span, Math.PI));
});

test('fanRow: directions in the opening fall before the first row or after the last, split at the middle of the opening', () => {
  const f = radialFan(0.5, 90); // a half circle, open at the bottom: rows from 9 o'clock over the top to 3 o'clock
  assert.ok(close(f.start, Math.PI));
  assert.ok(close(fanRow(f, 10, Math.PI), 0));
  assert.ok(close(fanRow(f, 10, -Math.PI / 2), 5), 'the top is the middle row');
  assert.ok(close(fanRow(f, 10, 0), 10));
  assert.ok(fanRow(f, 10, Math.PI / 2 + 0.1) < 0, 'just left of the bottom: before the first row');
  assert.ok(fanRow(f, 10, Math.PI / 2 - 0.1) > 10, 'just right of the bottom: after the last row');
  assert.ok(close(fanAngle(f, 10, 0), Math.PI) && close(fanAngle(f, 10, 10), TAU));
  // the keyboard's start node from the centre of the view: the nearer end of the fan when the centre is in the opening
  const t = parseNewick(tips(10));
  const L = computeLayout(t, true);
  setLayoutFan(L, f);
  const v = (x, y) => ({ x0: x - 0.1, x1: x + 0.1, y0: y - 0.1, y1: y + 0.1 });
  assert.equal(defaultActiveNode(t, 'radial', v(-0.1, 0.5), L), t.tipNode[0]);
  assert.equal(defaultActiveNode(t, 'radial', v(0.1, 0.5), L), t.tipNode[9]);
  assert.equal(defaultActiveNode(t, 'radial', v(0, -0.5), L), t.tipNode[5]);
});

for (const [name, opening] of [
  ['default opening', 0.05],
  ['half circle', 0.5],
])
  test(`hit-testing (${name}): the tips on both sides of the opening are hit, also from inside the opening`, async () => {
    const m = await makeViewer(tips(40), { options: { layout: 'radial', radialOpening: opening }, size: [500, 500] });
    m.env.flush();
    const v = m.viewer;
    const t = v.tree;
    const p = { x: 0, y: 0 };
    for (const [rank, toward] of [
      [0, -1],
      [t.tipCount - 1, 1],
    ]) {
      const node = t.tipNode[rank];
      v.proj.nodeXY(node, p);
      assert.deepEqual(v.hitTest(p.x, p.y), { node, kind: 'tip' }, `tip ${rank} on its point`);
      // 4 px along the circle toward the opening (into it): still that tip, not the one on the other side
      const r = Math.hypot(p.x - v.T.cx, p.y - v.T.cy);
      const a = Math.atan2(p.y - v.T.cy, p.x - v.T.cx) - (toward * 4) / r;
      const h = v.hitTest(v.T.cx + r * Math.cos(a), v.T.cy + r * Math.sin(a));
      assert.deepEqual(h, { node, kind: 'tip' }, `tip ${rank} from inside the opening`);
    }
    // the root's connector arc stops at the opening: a point on its circle in the middle of the opening hits no arc
    const rr = v.proj.depth(0);
    if (rr > 6) {
      const mid = Math.PI / 2;
      const h = v.hitTest(v.T.cx + rr * Math.cos(mid), v.T.cy + rr * Math.sin(mid));
      assert.ok(!h || h.kind !== 'branch' || h.node !== 0, 'no connector across the opening');
    }
  });

test('the fit frames a half circle by what it covers: about twice the scale of the full circle in a 2:1 container', async () => {
  const W = 1000,
    H = 500;
  const full = await makeViewer(tips(30), { options: { layout: 'radial', radialOpening: 0 }, size: [W, H] });
  full.env.flush();
  const kFull = full.viewer.T.k;
  const half = await makeViewer(tips(30), { options: { layout: 'radial', radialOpening: 0.5 }, size: [W, H] });
  half.env.flush();
  const v = half.viewer;
  const k = v.T.k;
  assert.ok(k > 1.9 * kFull, `half circle k ${k} against full ${kFull}`);
  // the arch fills the height: its top near the top edge and the root's line near the bottom edge (the label margins), centred in x
  assert.ok(v.T.cy > H * 0.85, 'the root is near the bottom');
  assert.ok(close(v.T.cx, W / 2, 1e-6), 'centred in x');
  const p = { x: 0, y: 0 };
  let top = Infinity;
  for (let r = 0; r < v.tree.tipCount; r++) {
    v.proj.nodeXY(v.tree.tipNode[r], p);
    assert.ok(p.x >= 0 && p.x <= W && p.y >= 0 && p.y <= H, `tip ${r} in view`);
    top = Math.min(top, p.y);
  }
  assert.ok(top < H * 0.15, 'the top of the arch is near the top');
  // the full circle with the default opening is fitted as before (the opening at the bottom only lifts the bounding box by a little)
  const dflt = await makeViewer(tips(30), { options: { layout: 'radial' }, size: [W, H] });
  dflt.env.flush();
  assert.ok(close(dflt.viewer.T.k, kFull, kFull * 0.02));
});

test('setOptions: a new opening refits a fitted radial view and spreads the rows over the new fan', async () => {
  const m = await makeViewer(tips(30), { options: { layout: 'radial' }, size: [800, 400] });
  m.env.flush();
  const v = m.viewer;
  const k0 = v.T.k;
  assert.ok(close(v.T.da, (0.95 * TAU) / 30));
  v.setOptions({ radialOpening: 0.5 });
  m.env.flush();
  assert.ok(close(v.T.da, Math.PI / 30));
  assert.ok(v.T.k > 1.5 * k0, 'refitted');
  v.setOptions({ radialRotation: 0 }); // the opening at 3 o'clock: the half circle is open to the right
  m.env.flush();
  const p = { x: 0, y: 0 };
  for (let r = 0; r < 30; r++) {
    v.proj.nodeXY(v.tree.tipNode[r], p);
    assert.ok(p.x <= v.T.cx + 1e-6, 'every tip on the left half');
  }
});

test('tip labels turn round on the left half of the screen, wherever the rotation puts a tip', async () => {
  /** The text alignment each tip label was drawn with (tip labels are t0, t1, ...). */
  const tipAligns = (ctx) => {
    let align = 'start';
    const out = [];
    for (const e of ctx.log) {
      if (e[0] === 'textAlign=') align = e[1];
      else if (e[0] === 'fillText' && /^t\d+$/.test(e[1])) out.push(align);
    }
    return out;
  };
  for (const [rotation, want] of [
    [0, 'right'], // the opening at 3 o'clock: every tip on the left half, every label turned round (right-aligned at the tip)
    [180, 'left'], // the opening at 9 o'clock: every tip on the right half
  ]) {
    const m = await makeViewer(tips(12), { options: { layout: 'radial', radialRotation: rotation, radialOpening: 0.5 }, size: [500, 500] });
    m.env.flush();
    const a = tipAligns(m.ctx());
    assert.equal(a.length, 12, 'every tip label is drawn');
    assert.ok(
      a.every((x) => x === want),
      `rotation ${rotation}: ${a.join(' ')}`,
    );
  }
});
