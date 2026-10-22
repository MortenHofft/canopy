// Unit tests of the hover ring animation (#47): with `hoverAnimation` the hover ring grows from radius and opacity 0 to its full size over
// the theme's `hoverRingDuration`, one overlay frame per step, and no frame is asked for once it has settled; the main canvas is not redrawn
// meanwhile. Reduced motion, `hoverAnimation: false` and a duration of 0 draw the full ring in the first frame. Moving to another node fades
// the old ring out while the new one grows; the pointer leaving drops it. The keyboard cursor's ring grows the same way. The harness's
// requestAnimationFrame is a queue with a clock of 16 ms per frame.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { makeViewer, destroyAll } from './viewer-harness.mjs';

afterEach(destroyAll);

function balanced(depth) {
  let n = 0;
  const go = (d) => (d === 0 ? `t${n++}:1` : `(${go(d - 1)},${go(d - 1)}):1`);
  return go(depth) + ';';
}
const NWK = balanced(4);
const make = (init = {}) => makeViewer(NWK, { size: [600, 400], ...init, options: { hoverPath: false, ...init.options } });

/** The rings (full-circle arcs) stroked in the last drawn top frame: { x, y, r, width, alpha }. */
function rings(top) {
  const log = top.log;
  let start = 0;
  for (let i = 0; i < log.length; i++) if (log[i][0] === 'clearRect') start = i;
  const out = [];
  let width = 1,
    alpha = 1,
    arc = null;
  for (let i = start; i < log.length; i++) {
    const [k, ...a] = log[i];
    if (k === 'lineWidth=') width = a[0];
    else if (k === 'globalAlpha=') alpha = a[0];
    else if (k === 'beginPath') arc = null;
    else if (k === 'arc' && Math.abs(a[4] - a[3]) > 6.28) arc = a;
    else if (k === 'stroke' && arc) out.push({ x: arc[0], y: arc[1], r: arc[2], width, alpha });
  }
  return out;
}
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

/** Run frames one by one until none is queued, collecting the rings of each top frame drawn. */
function frames(env, top, max = 40) {
  const out = [];
  for (let n = 0; env.pendingFrames() > 0 && n < max; n++) {
    const before = top().log.length;
    env.frame();
    if (top().log.length !== before) out.push(rings(top()));
  }
  return out;
}

const tipAt = (viewer, label) => viewer.nodePosition(viewer.tipNode(label));

test('defaults: hoverAnimation on, hoverRingRadius 6, hoverRingWidth 2, hoverRingDuration 150 ms', async () => {
  const { viewer } = await make();
  assert.equal(viewer.options.hoverAnimation, true);
  const th = viewer.getTheme();
  assert.equal(th.hoverRingRadius, 6);
  assert.equal(th.hoverRingWidth, 2);
  assert.equal(th.hoverRingDuration, 150);
});

test('the ring grows over the frames, eased out, and stops at full size; then no frame is asked for and the tree is not redrawn', async () => {
  const { viewer, env, top, ctx } = await make();
  env.flush();
  const framesBefore = viewer.stats.frames;
  const mainBefore = ctx().log.length;
  const p = tipAt(viewer, 't5');
  viewer.inputHost().hover(p);
  const fs = frames(env, top);
  assert.ok(fs.length >= 8 && fs.length <= 11, `about 150 ms of 16 ms frames (${fs.length})`);
  for (const f of fs) assert.equal(f.length, 1, 'one ring per frame');
  const r = fs.map((f) => f[0].r);
  const a = fs.map((f) => f[0].alpha);
  assert.ok(r[0] > 0 && r[0] < 2, `it starts small (${r[0]})`);
  for (let i = 1; i < r.length; i++) {
    assert.ok(r[i] > r[i - 1], `the radius grows (${r.join(', ')})`);
    assert.ok(a[i] >= a[i - 1], 'and the opacity with it');
  }
  // ease-out: the first steps are the largest
  assert.ok(r[1] - r[0] > r.at(-1) - r.at(-2), 'eased out');
  const last = fs.at(-1)[0];
  assert.equal(last.r, 6, 'full size at the end');
  assert.equal(last.alpha, 1);
  assert.equal(last.width, 2);
  assert.ok(near(last.x, p.x) && near(last.y, p.y), 'on the hovered tip');
  assert.equal(env.pendingFrames(), 0, 'no frame asked for once settled');
  assert.equal(viewer.stats.frames, framesBefore, 'the tree was not drawn again');
  assert.equal(ctx().log.length, mainBefore, 'nothing was drawn on the main canvas');
});

test('with reduced motion the full ring is drawn in the first frame', async () => {
  const { viewer, env, top } = await make();
  env.flush();
  env.setReducedMotion(true);
  viewer.inputHost().hover(tipAt(viewer, 't5'));
  const fs = frames(env, top);
  assert.equal(fs.length, 1, 'one frame');
  assert.equal(fs[0].length, 1);
  assert.equal(fs[0][0].r, 6);
  assert.equal(fs[0][0].alpha, 1);
  assert.equal(env.pendingFrames(), 0);
});

test('hoverAnimation: false draws the ring at once, as before; setOptions turns it back on', async () => {
  const { viewer, env, top } = await make({ options: { hoverAnimation: false } });
  env.flush();
  const host = viewer.inputHost();
  host.hover(tipAt(viewer, 't5'));
  let fs = frames(env, top);
  assert.equal(fs.length, 1);
  assert.deepEqual(
    fs[0].map((g) => [g.r, g.alpha, g.width]),
    [[6, 1, 2]],
  );
  // moving to another tip: no fade-out of the old ring either
  host.hover(tipAt(viewer, 't9'));
  fs = frames(env, top);
  assert.equal(fs.length, 1);
  assert.equal(fs[0].length, 1, 'only the new ring');
  viewer.setOptions({ hoverAnimation: true });
  host.hover(tipAt(viewer, 't2'));
  fs = frames(env, top);
  assert.ok(fs.length > 3 && fs[0].at(-1).r < 6, 'animated again');
});

test('a duration of 0 does not animate; the tokens and their CSS properties set the ring', async () => {
  const { viewer, env, top } = await make({ cssVars: { '--phylo-hover-ring-duration': '0', '--phylo-hover-ring-radius': '8px' } });
  env.flush();
  assert.equal(viewer.getTheme().hoverRingDuration, 0);
  assert.equal(viewer.getTheme().hoverRingRadius, 8);
  const host = viewer.inputHost();
  host.hover(tipAt(viewer, 't5'));
  let fs = frames(env, top);
  assert.equal(fs.length, 1);
  assert.equal(fs[0][0].r, 8);
  viewer.setTheme({ hoverRingRadius: 5, hoverRingWidth: 3, hoverRingDuration: 300 });
  host.hover(tipAt(viewer, 't9'));
  fs = frames(env, top);
  assert.ok(fs.length >= 16, `300 ms takes about twice the frames (${fs.length})`);
  const last = fs.at(-1).at(-1);
  assert.equal(last.r, 5);
  assert.equal(last.width, 3);
});

test('moving to another node: the old ring fades out at its size while the new one grows; the pointer leaving drops the ring', async () => {
  const { viewer, env, top } = await make();
  env.flush();
  const host = viewer.inputHost();
  const a = tipAt(viewer, 't5'),
    b = tipAt(viewer, 't6');
  host.hover(a);
  frames(env, top);
  host.hover(b);
  const fs = frames(env, top);
  const at = (f, p) => f.find((g) => near(g.x, p.x) && near(g.y, p.y));
  assert.ok(fs.length >= 8);
  for (let i = 0; i < fs.length - 1; i++) {
    const old = at(fs[i], a);
    assert.ok(old, `frame ${i}: the old ring is still there`);
    assert.equal(old.r, 6, 'at full size');
    if (i > 0) assert.ok(old.alpha < at(fs[i - 1], a).alpha, 'fading');
    assert.ok(at(fs[i], b), 'with the new one');
  }
  const end = fs.at(-1);
  assert.equal(end.length, 1, 'the old ring is gone at the end');
  assert.equal(at(end, b).r, 6);
  assert.equal(env.pendingFrames(), 0);
  // the pointer leaves the tree: the ring goes at once
  host.hover(null);
  const left = frames(env, top);
  assert.equal(left.length, 1);
  assert.equal(left[0].length, 0, 'no ring');
  assert.equal(env.pendingFrames(), 0);
});

test('leaving a ring halfway fades it from where it got; a collapsed clade grows to 1.5 times the radius', async () => {
  const { viewer, env, top } = await make();
  env.flush();
  const host = viewer.inputHost();
  host.hover(tipAt(viewer, 't5'));
  env.frame();
  env.frame();
  const mid = rings(top())[0];
  assert.ok(mid.r < 6 && mid.alpha < 1);
  host.hover({ x: 1, y: 1 }); // empty space: nothing hovered
  env.frame();
  const fading = rings(top());
  assert.equal(fading.length, 1);
  // it stays at the size it reached (radius 6 × its eased level, which is under 1) and fades from that level
  assert.ok(fading[0].r < 6 && fading[0].alpha < fading[0].r / 6, 'no jump to full size or opacity');
  env.flush();
  assert.equal(rings(top()).length, 0);

  const clade = viewer.tipNode('t8') - 2;
  viewer.setCollapsed([clade]);
  env.flush();
  const q = viewer.nodePosition(clade);
  host.hover({ x: q.x + 4, y: q.y });
  env.flush();
  assert.equal(rings(top())[0].r, 9);
});

test("the keyboard cursor's ring grows when the cursor moves, to its full size", async () => {
  const { viewer, env, top } = await make();
  env.flush();
  const host = viewer.inputHost();
  host.setActive(viewer.tipNode('t3'));
  const fs = frames(env, top).filter((f) => f.length);
  assert.ok(fs.length >= 8, `grows over the frames (${fs.length})`);
  const r = fs.map((f) => f[0].r);
  for (let i = 1; i < r.length; i++) assert.ok(r[i] > r[i - 1]);
  assert.equal(r.at(-1), 10);
  assert.equal(fs.at(-1)[0].width, 2.5);
  assert.equal(env.pendingFrames(), 0);
  env.setReducedMotion(true);
  host.setActive(viewer.tipNode('t4'));
  assert.equal(rings(top())[0].r, 10, 'reduced motion: at once, without waiting for a frame');
});
