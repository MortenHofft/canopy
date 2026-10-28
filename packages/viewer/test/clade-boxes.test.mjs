// Unit tests of the boxes behind coloured clades (option `cladeStyle`, theme `cladeBackgroundOpacity` and `cladeBackgroundPadding`, #43),
// read from the draw calls of the main canvas: the fill colour and alpha in force at each fillRect / fill, and their order against the
// branch strokes.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';

const { makeViewer, destroyAll } = await import('./viewer-harness.mjs');
const { FALLBACK_THEME, DEFAULT_OPTIONS } = await import('../src/types.ts');
const { THEME_CSS_VARS } = await import('../src/theme.ts');

afterEach(destroyAll);

const OPACITY = 0.3;
const PAD = 5;
const RED = '#ff0000';
const BLUE = '#0000ff';
const TWO = '((a,b)x,(c,d)y)r;'; // preorder: 0 r, 1 x, 2 a, 3 b, 4 y, 5 c, 6 d

/** Every call of the log with the fill colour, alpha and stroke colour in force at it. */
function calls(ctx) {
  let fill = '#000000',
    stroke = '#000000',
    alpha = 1;
  const out = [];
  ctx.log.forEach((e, at) => {
    if (e[0] === 'fillStyle=') fill = e[1];
    else if (e[0] === 'strokeStyle=') stroke = e[1];
    else if (e[0] === 'globalAlpha=') alpha = e[1];
    else if (!e[0].endsWith('=')) out.push({ name: e[0], args: e.slice(1), fill, stroke, alpha, at });
  });
  return out;
}

/** The boxes drawn: fills (rectangles, or paths in the radial layout) at the box opacity (or a multiple of it). */
const boxes = (ctx, name = 'fillRect', alpha = OPACITY) => calls(ctx).filter((c) => c.name === name && Math.abs(c.alpha - alpha) < 1e-9);

async function viewerWith(style, clades, extra = {}) {
  const m = await makeViewer(extra.tree ?? TWO, {
    options: { cladeStyle: style, ...extra.options },
    theme: { cladeBackgroundOpacity: OPACITY, cladeBackgroundPadding: PAD, ...extra.theme },
    size: extra.size,
  });
  m.viewer.setClades(clades);
  m.env.flush();
  return m;
}

test('cladeStyle defaults to branches; the tokens have CSS variables', () => {
  assert.equal(DEFAULT_OPTIONS.cladeStyle, 'branches');
  assert.ok(FALLBACK_THEME.cladeBackgroundOpacity > 0 && FALLBACK_THEME.cladeBackgroundOpacity < 1);
  assert.ok(FALLBACK_THEME.cladeBackgroundPadding >= 0);
  assert.equal(THEME_CSS_VARS.cladeBackgroundOpacity, '--phylo-clade-background-opacity');
  assert.equal(THEME_CSS_VARS.cladeBackgroundPadding, '--phylo-clade-background-padding');
});

test('background: one rectangle per coloured clade in its colour at cladeBackgroundOpacity, behind the branches, which stay plain', async () => {
  const { viewer, ctx } = await viewerWith('background', [
    { node: 1, colour: RED },
    { node: 4, colour: BLUE },
  ]);
  const b = boxes(ctx());
  assert.deepEqual(
    b.map((c) => c.fill),
    [RED, BLUE],
  );
  const firstStroke = calls(ctx()).find((c) => c.name === 'stroke');
  assert.ok(firstStroke && b.every((c) => c.at < firstStroke.at), 'the boxes come before the first branch stroke');
  assert.ok(!calls(ctx()).some((c) => c.name === 'stroke' && (c.stroke === RED || c.stroke === BLUE)), 'no branch in a clade colour');
  // the box of x: from PAD left of its node, over its two rows (a and b), to the right of its labels
  const [x0, y0, w, h] = b[0].args;
  const node = viewer.nodePosition(1),
    a = viewer.nodePosition(2),
    bb = viewer.nodePosition(3);
  assert.ok(Math.abs(x0 - (node.x - PAD)) < 1e-6, `left edge ${x0} is ${PAD} px left of the node at ${node.x}`);
  const row = bb.y - a.y;
  assert.ok(Math.abs(y0 - (a.y - row / 2)) < 1e-6 && Math.abs(y0 + h - (bb.y + row / 2)) < 1e-6, 'half a row above a and below b');
  assert.ok(x0 + w > a.x + 20, 'reaches past the tips, over the labels');
});

test('nested clades: the outer box first, the inner one over it, whatever the order of the entries', async () => {
  const { ctx } = await viewerWith('background', [
    { node: 2, colour: BLUE },
    { node: 1, colour: RED },
  ]);
  const b = boxes(ctx());
  assert.deepEqual(
    b.map((c) => c.fill),
    [RED, BLUE],
  );
  const [ox, oy, ow, oh] = b[0].args,
    [ix, iy, iw, ih] = b[1].args;
  assert.ok(ix > ox && iy >= oy && iy + ih <= oy + oh + 1e-9 && ix + iw <= ox + ow + 1e-9, 'the inner box lies inside the outer one');
});

test('the same node twice: one box, in the later colour', async () => {
  const { ctx } = await viewerWith('background', [
    { node: 1, colour: RED },
    { node: 1, colour: BLUE },
  ]);
  assert.deepEqual(
    boxes(ctx()).map((c) => c.fill),
    [BLUE],
  );
});

test('branches (the default) draws no boxes; both draws boxes and coloured branches', async () => {
  const clades = [{ node: 1, colour: RED }];
  const br = await viewerWith('branches', clades);
  assert.equal(boxes(br.ctx()).length, 0);
  assert.ok(calls(br.ctx()).some((c) => c.name === 'stroke' && c.stroke === RED));
  const both = await viewerWith('both', clades);
  assert.deepEqual(
    boxes(both.ctx()).map((c) => c.fill),
    [RED],
  );
  assert.ok(calls(both.ctx()).some((c) => c.name === 'stroke' && c.stroke === RED));
});

test('setOptions switches the style on the next frame', async () => {
  const { viewer, env, ctx } = await viewerWith('branches', [{ node: 4, colour: RED }]);
  ctx().reset();
  viewer.setOptions({ cladeStyle: 'background' });
  env.flush();
  assert.equal(boxes(ctx()).length, 1);
  assert.ok(!calls(ctx()).some((c) => c.name === 'stroke' && c.stroke === RED));
  ctx().reset();
  viewer.setOptions({ cladeStyle: 'branches' });
  env.flush();
  assert.equal(boxes(ctx()).length, 0);
});

test('radial: a ring sector over the clade, filled before the branches', async () => {
  const { ctx } = await viewerWith('background', [{ node: 1, colour: RED }], { options: { layout: 'radial' } });
  assert.equal(boxes(ctx()).length, 0, 'no rectangle');
  const fills = boxes(ctx(), 'fill');
  assert.deepEqual(
    fills.map((c) => c.fill),
    [RED],
  );
  const all = calls(ctx());
  const begin = all.findLastIndex((c) => c.at < fills[0].at && c.name === 'beginPath');
  assert.ok(
    all.slice(begin, all.indexOf(fills[0])).some((c) => c.name === 'arc'),
    'the sector has an arc edge',
  );
  const firstStroke = all.find((c) => c.name === 'stroke');
  assert.ok(fills[0].at < firstStroke.at);
});

/** A balanced tree of 2^depth tips named t0, t1, ... */
function balanced(depth) {
  let n = 0;
  const walk = (d) => (d === 0 ? 't' + n++ : '(' + walk(d - 1) + ',' + walk(d - 1) + ')');
  return walk(depth) + ';';
}

test('a clade outside the view gets no box', async () => {
  // 64 tips; node 1 is the clade of the first 32, node 64 (preorder) the root of the last 32
  const m = await viewerWith(
    'background',
    [
      { node: 1, colour: RED },
      { node: 64, colour: BLUE },
    ],
    { tree: balanced(6), size: [400, 600] },
  );
  assert.deepEqual(
    boxes(m.ctx()).map((c) => c.fill),
    [RED, BLUE],
  );
  m.viewer.setViewport({ x0: 0, x1: 1, y0: 0, y1: 20 });
  m.ctx().reset();
  m.env.flush();
  assert.ok(m.viewer.getViewport().y1 <= 32, 'the view shows only rows of the first clade');
  assert.deepEqual(
    boxes(m.ctx()).map((c) => c.fill),
    [RED],
  );
});

test('dimming: the box of a clade with no highlighted tip is drawn at dimOpacity', async () => {
  const DIM = 0.5;
  const { viewer, env, ctx } = await viewerWith(
    'background',
    [
      { node: 1, colour: RED },
      { node: 4, colour: BLUE },
    ],
    { options: { highlightStyle: 'dim' }, theme: { dimOpacity: DIM } },
  );
  viewer.setHighlighted(['a']);
  ctx().reset();
  env.flush();
  assert.deepEqual(
    boxes(ctx()).map((c) => c.fill),
    [RED],
  );
  assert.deepEqual(
    boxes(ctx(), 'fillRect', OPACITY * DIM).map((c) => c.fill),
    [BLUE],
  );
});

test('alignLabels: a box reaches past the aligned label column, not only past its own tips', async () => {
  const tree = '((a:1,b:1)x:1,(c:3,d:3)y:1)r;'; // x's tips end well left of y's
  const right = async (alignLabels) => {
    const { ctx } = await viewerWith('background', [{ node: 1, colour: RED }], { tree, options: { alignLabels } });
    const [x, , w] = boxes(ctx())[0].args;
    return x + w;
  };
  const own = await right(false),
    aligned = await right(true);
  assert.ok(aligned > own + 50, `with aligned labels the box ends at ${aligned}, past ${own}`);
});

test("a coloured clade inside a collapsed clade keeps a box, over the collapsed clade's row", async () => {
  const { viewer, env, ctx } = await viewerWith('background', [{ node: 2, colour: RED }]);
  viewer.setCollapsed([1]);
  ctx().reset();
  env.flush();
  const b = boxes(ctx());
  assert.equal(b.length, 1);
  const [, y, , h] = b[0].args;
  const row = viewer.nodePosition(1).y;
  assert.ok(y < row && y + h > row, 'the box covers the row of the collapsed clade');
});

test('with columns shown, boxes stop at the right edge of the tree, before the columns', async () => {
  const { viewer, env, ctx } = await viewerWith('background', [{ node: 1, colour: RED }]);
  viewer.setColumns([{ id: 't', kind: 'text', header: 'T', width: 80, values: { a: '1', b: '2' } }]);
  ctx().reset();
  env.flush();
  const [x, , w] = boxes(ctx())[0].args;
  const cell = viewer.columnCell('t', 'a');
  assert.ok(cell && x + w <= cell.x, `the box ends at ${x + w}, the column starts at ${cell?.x}`);
});

test('setCollapsed after the first frame: nested boxes that now share the collapsed row are all drawn, outer first', async () => {
  // 64 tips; node 1 holds the first 32 tips, its children node 2 (tips 0..16) and node 33 (tips 16..32). Collapsed, all three have row 0,
  // so the boxes of 2 and 33, siblings before, now nest; a view starting inside that row finds them through the chain of 33
  const m = await viewerWith(
    'background',
    [
      { node: 1, colour: RED },
      { node: 2, colour: BLUE },
      { node: 33, colour: '#00ff00' },
    ],
    { tree: balanced(6), size: [400, 600] },
  );
  assert.equal(boxes(m.ctx()).length, 3);
  m.viewer.setCollapsed([1]);
  m.env.flush();
  m.viewer.setViewport({ x0: 0, x1: 1, y0: 0.5, y1: 20 });
  m.ctx().reset();
  m.env.flush();
  assert.ok(m.viewer.getViewport().y0 > 0 && m.viewer.getViewport().y0 < 1, 'the view starts inside the collapsed row');
  assert.deepEqual(
    boxes(m.ctx()).map((c) => c.fill),
    [RED, BLUE, '#00ff00'],
  );
});
