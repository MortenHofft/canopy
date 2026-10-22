// Unit tests of the hover path (#40): hovering a node draws its path to the root on the top canvas (one branch and one connector piece per
// ancestor edge, in the `hoverPathColour` / `hoverPathWidth` tokens), in both layouts; `hoverPath: false` leaves only the ring; with nothing
// hovered the keyboard cursor's path is drawn; and on a deep caterpillar the drawing stays bounded by what is on screen.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { makeViewer, destroyAll } from './viewer-harness.mjs';

afterEach(destroyAll);

function balanced(depth) {
  let n = 0;
  const go = (d) => (d === 0 ? `t${n++}:1` : `(${go(d - 1)},${go(d - 1)}):1`);
  return go(depth) + ';';
}
const DEPTH = 5;
const NWK = balanced(DEPTH);
const make = (init = {}) => makeViewer(NWK, { size: [600, 400], ...init });

/** The paths stroked in the last drawn top frame: { stroke, width, moves, lines, arcs } with the points of each call. */
function strokes(top) {
  const log = top.log;
  let start = 0;
  for (let i = 0; i < log.length; i++) if (log[i][0] === 'clearRect') start = i;
  const out = [];
  let stroke = '',
    width = 1,
    cur = { moves: [], lines: [], arcs: [] };
  for (let i = start; i < log.length; i++) {
    const [k, ...a] = log[i];
    if (k === 'strokeStyle=') stroke = a[0];
    else if (k === 'lineWidth=') width = a[0];
    else if (k === 'beginPath') cur = { moves: [], lines: [], arcs: [] };
    else if (k === 'moveTo') cur.moves.push(a);
    else if (k === 'lineTo') cur.lines.push(a);
    else if (k === 'arc') cur.arcs.push(a);
    else if (k === 'stroke') out.push({ stroke, width, ...cur });
  }
  return out;
}
/** The stroked paths drawn with lines or arcs other than a ring (rings are one full-circle arc each). */
const paths = (top) => strokes(top).filter((s) => s.lines.length > 0 || s.arcs.some((a) => Math.abs(a[4] - a[3]) < 6.28));
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

/** Hover the tip with this label and draw. */
function hoverTip(viewer, env, label) {
  const n = viewer.tipNode(label);
  const p = viewer.nodePosition(n);
  viewer.inputHost().hover(p);
  env.flush();
  return { n, p };
}

test('rectangular: hovering a tip draws its path to the root, a branch and a connector per ancestor edge, in the highlight colour', async () => {
  const { viewer, env, top } = await make();
  env.flush();
  const th = viewer.getTheme();
  assert.equal(th.hoverPathColour, '');
  assert.equal(th.hoverPathWidth, 2);
  const { p } = hoverTip(viewer, env, 't5');
  const ps = paths(top());
  assert.equal(ps.length, 1, 'one path');
  const s = ps[0];
  assert.equal(s.stroke, th.highlight, "'' is the highlight colour");
  assert.equal(s.width, th.hoverPathWidth);
  assert.equal(s.lines.length, 2 * DEPTH, 'a branch and a connector for each of the 5 edges up to the root');
  assert.equal(s.arcs.length, 0);
  assert.ok(near(s.moves[0][0], p.x) && near(s.moves[0][1], p.y), 'it starts at the tip');
  const root = viewer.nodePosition(0);
  const end = s.lines.at(-1);
  assert.ok(near(end[0], root.x) && near(end[1], root.y), 'and ends at the root');
  // axis-aligned: branches horizontal, connectors vertical
  let at = s.moves[0];
  for (const [k, l] of s.lines.entries()) {
    assert.ok(k % 2 === 0 ? near(l[1], at[1]) : near(l[0], at[0]), `segment ${k} is ${k % 2 ? 'vertical' : 'horizontal'}`);
    at = l;
  }
  // it is drawn under the rings: the hover ring comes after it
  const log = top().log;
  const pathAt = log.findLastIndex((e) => e[0] === 'lineTo');
  const ringAt = log.findLastIndex((e) => e[0] === 'arc' && near(e[1], p.x) && near(e[2], p.y));
  assert.ok(ringAt > pathAt, 'the ring is drawn over the path');
});

test('radial: the path is a radial segment and a connector (an arc at the parent radius where it is curved) per ancestor edge', async () => {
  const { viewer, env, top } = await make({ options: { layout: 'radial' } });
  env.flush();
  const { p } = hoverTip(viewer, env, 't9');
  const ps = paths(top());
  assert.equal(ps.length, 1);
  const s = ps[0];
  assert.equal(s.stroke, viewer.getTheme().highlight);
  assert.equal(s.lines.length + s.arcs.length, 2 * DEPTH, 'one radial segment and one connector per edge');
  assert.ok(s.arcs.length >= 2, 'the connectors near the root are arcs');
  assert.ok(near(s.moves[0][0], p.x) && near(s.moves[0][1], p.y), 'it starts at the tip');
  const root = viewer.nodePosition(0);
  for (const a of s.arcs) assert.ok(near(a[0], root.x) && near(a[1], root.y), 'arcs are centred on the root');
});

test('hoverPath: false draws only the ring; setOptions turns it back on', async () => {
  const { viewer, env, top } = await make({ options: { hoverPath: false } });
  env.flush();
  const { p } = hoverTip(viewer, env, 't5');
  assert.equal(paths(top()).length, 0, 'no path');
  assert.ok(
    strokes(top()).some((s) => s.arcs.some((a) => near(a[0], p.x) && near(a[1], p.y))),
    'the hover ring is drawn',
  );
  viewer.setOptions({ hoverPath: true });
  env.flush();
  assert.equal(paths(top()).length, 1);
});

test('the tokens: a theme change of hoverPathColour / hoverPathWidth changes the drawn path; CSS properties; width 0 draws none', async () => {
  const { viewer, env, top } = await make({ cssVars: { '--phylo-hover-path-colour': '#123456', '--phylo-hover-path-width': '3px' } });
  env.flush();
  hoverTip(viewer, env, 't2');
  let s = paths(top())[0];
  assert.equal(s.stroke, '#123456');
  assert.equal(s.width, 3);
  viewer.setTheme({ hoverPathColour: '#ff0000', hoverPathWidth: 4 });
  env.flush();
  s = paths(top())[0];
  assert.equal(s.stroke, '#ff0000');
  assert.equal(s.width, 4);
  viewer.setTheme({ hoverPathWidth: 0 });
  env.flush();
  assert.equal(paths(top()).length, 0, 'a width of 0 draws no path');
});

test('the keyboard cursor shows its path when nothing is hovered; a hover shows the hovered path instead', async () => {
  const { viewer, env, top } = await make();
  env.flush();
  const host = viewer.inputHost();
  const a = viewer.tipNode('t3');
  host.setActive(a);
  env.flush();
  let ps = paths(top());
  assert.equal(ps.length, 1, "the cursor's path");
  const pa = viewer.nodePosition(a);
  assert.ok(near(ps[0].moves[0][0], pa.x) && near(ps[0].moves[0][1], pa.y));
  const { p } = hoverTip(viewer, env, 't20');
  ps = paths(top());
  assert.equal(ps.length, 1, 'one path at a time');
  assert.ok(near(ps[0].moves[0][0], p.x) && near(ps[0].moves[0][1], p.y), 'the hovered one');
  host.hover(null);
  env.flush();
  ps = paths(top());
  assert.ok(near(ps[0].moves[0][0], pa.x) && near(ps[0].moves[0][1], pa.y), 'back to the cursor when the pointer leaves');
});

test('a collapsed clade (summary) starts its path at its node', async () => {
  const { viewer, env, top } = await make();
  env.flush();
  const clade = viewer.tipNode('t8') - 2; // preorder: the parent of t8's parent (a clade of t8..t11)
  viewer.setCollapsed([clade]);
  env.flush();
  const q = viewer.nodePosition(clade);
  viewer.inputHost().hover({ x: q.x + 4, y: q.y });
  env.flush();
  const s = paths(top())[0];
  assert.ok(s, 'a path');
  assert.ok(near(s.moves[0][0], q.x) && near(s.moves[0][1], q.y), 'from the clade node');
  assert.equal(s.lines.length, 2 * (DEPTH - 2));
});

/** A caterpillar: (t0,(t1,(t2,...(tn-2,tn-1)))) with unit lengths, n tips, n-1 levels. */
function caterpillar(n) {
  let s = `t${n - 1}:1`;
  for (let k = n - 2; k >= 0; k--) s = `(t${k}:1,${s}):1`;
  return s + ';';
}

for (const layout of ['rectangular', 'radial'])
  test(`${layout}: on a 100k-tip caterpillar the path of the deepest tip makes a bounded number of canvas calls`, async () => {
    const N = 100_000;
    const { viewer, env, top } = await makeViewer(caterpillar(N), { size: [800, 600], options: { layout } });
    env.flush();
    const n = viewer.tipNode(`t${N - 1}`);
    const host = viewer.inputHost();
    host.setActive(n); // the deepest tip: 99,999 edges up to the root
    env.flush();
    const s = paths(top())[0];
    assert.ok(s, 'a path');
    const calls = s.moves.length + s.lines.length + s.arcs.length;
    assert.ok(calls < 4000, `${calls} canvas calls for ${N - 1} edges`);
  });
