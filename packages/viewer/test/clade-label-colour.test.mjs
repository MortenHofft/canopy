// Unit tests of the option `colourLabels`: whether the tip labels (and the labels of collapsed clades) take the colour of their coloured
// clade. Off by default: the text keeps the foreground colour and only the branches, markers and summaries are coloured. Read from the
// draw calls of the main canvas: the fill colour in force at each fillText.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';

const { makeViewer, destroyAll } = await import('./viewer-harness.mjs');
const { FALLBACK_THEME, DEFAULT_OPTIONS } = await import('../src/types.ts');

afterEach(destroyAll);

const RED = '#ff0000';
const TWO = '((a,b)x,(c,d)y)r;'; // preorder: 0 r, 1 x, 2 a, 3 b, 4 y, 5 c, 6 d

/** The text drawn with the fill colour in force at each fillText, by text. */
function labelFills(ctx) {
  let fill = '#000000';
  const out = {};
  for (const e of ctx.log) {
    if (e[0] === 'fillStyle=') fill = e[1];
    else if (e[0] === 'fillText') out[e[1]] = fill;
  }
  return out;
}
const strokes = (ctx) => {
  let stroke = '#000000';
  const out = new Set();
  for (const e of ctx.log) {
    if (e[0] === 'strokeStyle=') stroke = e[1];
    else if (e[0] === 'stroke') out.add(stroke);
  }
  return out;
};

async function viewerWith(options = {}, clades = [{ node: 1, colour: RED }]) {
  const m = await makeViewer(TWO, { options });
  m.viewer.setClades(clades);
  m.env.flush();
  return m;
}

test('colourLabels is off by default', () => {
  assert.equal(DEFAULT_OPTIONS.colourLabels, false);
});

test('off: the labels of a coloured clade keep the foreground colour, its branches are coloured', async () => {
  const { ctx } = await viewerWith();
  const fills = labelFills(ctx());
  assert.deepEqual(Object.keys(fills).sort(), ['a', 'b', 'c', 'd']);
  for (const t of ['a', 'b', 'c', 'd']) assert.equal(fills[t], FALLBACK_THEME.foreground, `label ${t}`);
  assert.ok(strokes(ctx()).has(RED), 'the branches are red');
});

test('on: the labels of the coloured clade take its colour, the others keep the foreground', async () => {
  const { ctx } = await viewerWith({ colourLabels: true });
  const fills = labelFills(ctx());
  assert.equal(fills.a, RED);
  assert.equal(fills.b, RED);
  assert.equal(fills.c, FALLBACK_THEME.foreground);
  assert.ok(strokes(ctx()).has(RED));
});

test('setOptions switches it on the next frame, both ways', async () => {
  const { viewer, env, ctx } = await viewerWith();
  ctx().reset();
  viewer.setOptions({ colourLabels: true });
  env.flush();
  assert.equal(labelFills(ctx()).a, RED);
  ctx().reset();
  viewer.setOptions({ colourLabels: false });
  env.flush();
  assert.equal(labelFills(ctx()).a, FALLBACK_THEME.foreground);
  assert.ok(strokes(ctx()).has(RED), 'the branches stay coloured');
});

test('the highlight colour wins over the clade colour', async () => {
  const { viewer, env, ctx } = await viewerWith({ colourLabels: true });
  ctx().reset();
  viewer.setHighlighted(['a']);
  env.flush();
  assert.equal(labelFills(ctx()).a, FALLBACK_THEME.highlight);
  assert.equal(labelFills(ctx()).b, RED);
});

test('with cladeStyle background the labels are plain whatever the option says', async () => {
  const { ctx } = await viewerWith({ colourLabels: true, cladeStyle: 'background' });
  assert.equal(labelFills(ctx()).a, FALLBACK_THEME.foreground);
});

test('the label of a collapsed clade follows the option too', async () => {
  for (const [on, expected] of [
    [false, FALLBACK_THEME.foreground],
    [true, RED],
  ]) {
    const { viewer, env, ctx } = await viewerWith({ colourLabels: on });
    ctx().reset();
    viewer.setCollapsed([1]);
    env.flush();
    const fills = labelFills(ctx());
    const text = Object.keys(fills).find((t) => t.includes('2 tips'));
    assert.ok(text, `a label of the collapsed clade (${Object.keys(fills)})`);
    assert.equal(fills[text], expected, `colourLabels ${on}`);
  }
});
