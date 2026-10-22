// Unit tests of the dim mode of setHighlighted (`highlightStyle` 'dim' / 'both', theme `dimOpacity`), read from the draw calls the
// recording context saw: the alpha each label, stroke and fill was painted with.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';

const { makeViewer, destroyAll } = await import('./viewer-harness.mjs');
const { FALLBACK_THEME } = await import('../src/types.ts');
const { THEME_CSS_VARS } = await import('../src/theme.ts');

afterEach(destroyAll);

const DIM = 0.3;
const TWO = '((a,b)x,(c,d)y)r;'; // preorder: 0 r, 1 x, 2 a, 3 b, 4 y, 5 c, 6 d

/** The globalAlpha in force at each call named `name`, with its first argument. */
function alphas(ctx, name) {
  let alpha = 1;
  const out = [];
  for (const e of ctx.log) {
    if (e[0] === 'globalAlpha=') alpha = e[1];
    else if (e[0] === name) out.push({ alpha, arg: e[1] });
  }
  return out;
}
const labelAlpha = (ctx) => Object.fromEntries(alphas(ctx, 'fillText').map((x) => [x.arg, x.alpha]));

async function viewerWith(style, tips, tree = TWO, extra = {}) {
  const m = await makeViewer(tree, { options: { highlightStyle: style, ...extra.options }, theme: { dimOpacity: DIM }, ...extra.init });
  m.viewer.setHighlighted(tips);
  m.env.flush();
  return m;
}

test('dimOpacity is a theme token with a CSS variable', () => {
  assert.ok(FALLBACK_THEME.dimOpacity > 0 && FALLBACK_THEME.dimOpacity < 1);
  assert.equal(THEME_CSS_VARS.dimOpacity, '--phylo-dim-opacity');
});

test('band (the default) draws no dimmed primitives', async () => {
  const { viewer, env, ctx } = await viewerWith('band', ['a']);
  assert.equal(viewer.opts.highlightStyle, 'band');
  env.flush();
  assert.ok(alphas(ctx(), 'fillText').every((x) => x.alpha === 1));
  assert.ok(!ctx().log.some((e) => e[0] === 'globalAlpha=' && e[1] === DIM));
});

test('dim: labels outside the highlighted set are drawn at dimOpacity, matches at full strength, and no band is drawn', async () => {
  const dim = await viewerWith('dim', ['a']);
  assert.deepEqual(labelAlpha(dim.ctx()), { a: 1, b: DIM, c: DIM, d: DIM });
  const band = await viewerWith('band', ['a']);
  const rects = (m) => m.ctx().calls('fillRect').length;
  assert.equal(rects(band) - rects(dim), 1, 'the band behind the matching row is not drawn');
});

test('both: bands and dimming together', async () => {
  const both = await viewerWith('both', ['a']);
  assert.deepEqual(labelAlpha(both.ctx()), { a: 1, b: DIM, c: DIM, d: DIM });
  const band = await viewerWith('band', ['a']);
  assert.equal(both.ctx().calls('fillRect').length, band.ctx().calls('fillRect').length);
});

test('dim: branches of a clade with no highlighted tip are stroked at dimOpacity, the rest at full strength', async () => {
  const { ctx } = await viewerWith('dim', ['a']);
  const strokes = alphas(ctx(), 'stroke').map((x) => x.alpha);
  assert.ok(strokes.includes(1), 'the path to the match');
  assert.ok(strokes.includes(DIM), 'the other clade');
});

test('dim state per row: a clade with a highlighted tip is not dimmed, one with none is', async () => {
  const { viewer } = await viewerWith('dim', ['a']);
  const dim = viewer.dimOf;
  assert.ok(dim instanceof Uint8Array);
  assert.deepEqual([...dim], [0, 0, 0, 1, 1, 1, 1], 'r and x hold a, a itself is lit; b, y, c, d are dim');
  viewer.setHighlighted(['a', 'c']);
  assert.deepEqual([...viewer.dimOf], [0, 0, 0, 1, 0, 0, 1]);
  viewer.setHighlighted([]);
  assert.equal(viewer.dimOf, null, 'no highlights, no dimming');
});

test('dim: nothing is dimmed without highlights, and unknown ids highlight nothing', async () => {
  for (const tips of [[], ['nope']]) {
    const { ctx } = await viewerWith('dim', tips);
    assert.ok(alphas(ctx(), 'fillText').every((x) => x.alpha === 1));
  }
});

test('setOptions switches the style and redraws', async () => {
  const { viewer, env, ctx } = await viewerWith('band', ['a']);
  ctx().reset();
  viewer.setOptions({ highlightStyle: 'dim' });
  env.flush();
  assert.equal(labelAlpha(ctx()).b, DIM);
  ctx().reset();
  viewer.setOptions({ highlightStyle: 'band' });
  env.flush();
  assert.equal(labelAlpha(ctx()).b, 1);
});

test('dim: a summary holding a highlighted tip keeps full strength, the others are dimmed', async () => {
  // 8 clades of 40 tips in 120 px: every clade is collapsed to a triangle
  const clade = (c) => '(' + Array.from({ length: 40 }, (_, i) => `t${c}_${i}`).join(',') + `)c${c}`;
  const tree = '(' + Array.from({ length: 8 }, (_, c) => clade(c)).join(',') + ')root;';
  const { viewer, ctx } = await viewerWith('dim', ['t3_7'], tree, { init: { size: [400, 120] } });
  assert.ok(viewer.getStats().summaries > 0, 'the clades are summarised');
  const fills = alphas(ctx(), 'fill').map((x) => x.alpha);
  const so = FALLBACK_THEME.summaryOpacity;
  assert.ok(fills.includes(so), 'the clade with the match');
  assert.ok(fills.includes(so * DIM), 'the others');
});

test('dim: radial layout dims the same rows', async () => {
  const { ctx } = await viewerWith('dim', ['a'], TWO, { options: { layout: 'radial' }, init: { size: [400, 400] } });
  const strokes = alphas(ctx(), 'stroke').map((x) => x.alpha);
  assert.ok(strokes.includes(1) && strokes.includes(DIM));
});
