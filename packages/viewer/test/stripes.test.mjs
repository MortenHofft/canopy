// Unit tests of the striped summary fill (`summaryStyle: 'striped'`, theme `summaryStripeColour` / `summaryStripeGap`), read from the
// calls the recording context saw: the stripes are stroked segments in the stripe colour; the solid fill is fill() at summaryOpacity.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';

const { makeViewer, destroyAll } = await import('./viewer-harness.mjs');
const { FALLBACK_THEME, DEFAULT_OPTIONS } = await import('../src/types.ts');
const { THEME_CSS_VARS } = await import('../src/theme.ts');

afterEach(destroyAll);

const STRIPE = '#ff0000';
const DIM = 0.3;

/** A balanced binary tree with 2^depth tips named t0, t1, ... */
function balanced(depth) {
  let id = 0;
  const build = (d) => (d === 0 ? 't' + id++ : '(' + build(d - 1) + ',' + build(d - 1) + ')');
  return build(depth) + ';';
}
const TREE = balanced(11); // 2048 tips

/** Stripes in the log: each stroked segment (moveTo + lineTo) in colour `colour`, with the globalAlpha it was stroked at. */
function stripes(ctx, colour = STRIPE) {
  const out = [];
  let style = null,
    alpha = 1,
    width = 1,
    path = [];
  for (const e of ctx.log) {
    if (e[0] === 'strokeStyle=') style = e[1];
    else if (e[0] === 'globalAlpha=') alpha = e[1];
    else if (e[0] === 'lineWidth=') width = e[1];
    else if (e[0] === 'beginPath') path = [];
    else if (e[0] === 'moveTo') path.push([e[1], e[2]]);
    else if (e[0] === 'lineTo' && path.length) {
      path.push([e[1], e[2]]);
    } else if (e[0] === 'stroke' && style === colour) {
      for (let k = 0; k + 1 < path.length; k += 2) out.push({ x0: path[k][0], y0: path[k][1], x1: path[k + 1][0], y1: path[k + 1][1], alpha, width });
    }
  }
  return out;
}
const fillAlphas = (ctx) => {
  let alpha = 1;
  const out = [];
  for (const e of ctx.log) {
    if (e[0] === 'globalAlpha=') alpha = e[1];
    else if (e[0] === 'fill') out.push(alpha);
  }
  return out;
};

async function make(layout, options = {}, tree = TREE, extra = {}) {
  const m = await makeViewer(tree, {
    options: { layout, minCladePx: 20, summaryStyle: 'striped', ...options },
    theme: { summaryStripeColour: STRIPE, ...extra.theme },
    size: layout === 'radial' ? [500, 500] : [500, 300],
  });
  m.env.flush();
  return m;
}

test('summaryStyle is an option (library default solid), stripe colour and gap are theme tokens with CSS variables', () => {
  assert.equal(DEFAULT_OPTIONS.summaryStyle, 'solid');
  assert.equal(DEFAULT_OPTIONS.stripeCollapsed, false);
  assert.equal(FALLBACK_THEME.summaryStripeColour, '');
  assert.ok(FALLBACK_THEME.summaryStripeGap >= 1);
  assert.equal(THEME_CSS_VARS.summaryStripeColour, '--phylo-summary-stripe-colour');
  assert.equal(THEME_CSS_VARS.summaryStripeGap, '--phylo-summary-stripe-gap');
});

for (const layout of ['rectangular', 'radial']) {
  test(`${layout}: solid draws no stripes and fills the summaries; setOptions switches to stripes and back`, async () => {
    const { viewer, env, ctx } = await make(layout, { summaryStyle: 'solid' });
    assert.ok(viewer.getStats().summaries > 0, 'summaries are drawn');
    assert.equal(stripes(ctx()).length, 0);
    const solidFills = fillAlphas(ctx()).filter((a) => a === FALLBACK_THEME.summaryOpacity).length;
    assert.ok(solidFills > 0, 'solid fill');
    ctx().reset();
    viewer.setOptions({ summaryStyle: 'striped' });
    env.flush();
    assert.ok(stripes(ctx()).length > 0, 'striped');
    ctx().reset();
    viewer.setOptions({ summaryStyle: 'solid' });
    env.flush();
    assert.equal(stripes(ctx()).length, 0);
    assert.equal(fillAlphas(ctx()).filter((a) => a === FALLBACK_THEME.summaryOpacity).length, solidFills, 'the same fills as before');
  });
}

test('rectangular: the stripes are horizontal, run rightwards, at least the gap apart, and their count is bounded by the height over the gap', async () => {
  const { viewer, ctx } = await make('rectangular');
  const s = stripes(ctx());
  assert.ok(s.length > 0);
  for (const x of s) {
    assert.equal(x.y0, x.y1, 'horizontal: the direction of the tip branches');
    assert.ok(x.x1 > x.x0);
    assert.equal(x.alpha, viewer.theme.summaryOpacity);
  }
  const gap = viewer.theme.summaryStripeGap;
  const ys = [...new Set(s.map((x) => x.y0))].sort((a, b) => a - b);
  // the stripes of one clade are evenly spaced at least `gap` apart; across clades the same holds (their bands do not overlap)
  for (let k = 1; k < ys.length; k++) assert.ok(ys[k] - ys[k - 1] >= gap - 1e-6, 'gap ' + (ys[k] - ys[k - 1]));
  assert.ok(s.length <= 300 / gap + viewer.getStats().summaries, 'bounded by the plot height over the gap');
});

test('rectangular: a larger gap gives fewer stripes, and the line is at least 1 px wide', async () => {
  const a = await make('rectangular', {}, TREE, { theme: { summaryStripeGap: 3 } });
  const na = stripes(a.ctx()).length;
  const b = await make('rectangular', {}, TREE, { theme: { summaryStripeGap: 8 } });
  const sb = stripes(b.ctx());
  assert.ok(sb.length > 0 && sb.length < na);
  assert.ok(
    sb.every((x) => x.width >= 4 && x.width <= 8),
    'about half the gap',
  );
});

test('radial: the stripes lie on rays from the root (their line passes through the centre), pointing outwards', async () => {
  const { viewer, ctx } = await make('radial');
  const s = stripes(ctx());
  assert.ok(s.length > 0);
  const { cx, cy } = viewer.proj.T;
  for (const x of s) {
    const dx = x.x1 - x.x0,
      dy = x.y1 - x.y0;
    const len = Math.hypot(dx, dy);
    const cross = Math.abs(dx * (x.y0 - cy) - dy * (x.x0 - cx)) / len; // distance of the centre from the stripe's line
    assert.ok(cross < 1e-6 * Math.max(1, Math.hypot(x.x0 - cx, x.y0 - cy)) + 1e-6, 'on a ray: ' + cross);
    assert.ok(Math.hypot(x.x1 - cx, x.y1 - cy) > Math.hypot(x.x0 - cx, x.y0 - cy), 'outwards');
  }
});

test('radial: a fan gets at most 256 stripes, and the total is bounded by the circle over the gap plus one per fan', async () => {
  const { viewer, ctx } = await make('radial');
  const s = stripes(ctx());
  const circ = 2 * Math.PI * Math.min(viewer.proj.T.cx, viewer.proj.T.cy);
  assert.ok(s.length <= circ / viewer.theme.summaryStripeGap + viewer.getStats().summaries, 'count ' + s.length);
});

test('summaries too small for two stripes stay solid', async () => {
  const { viewer, ctx } = await make('rectangular', { minCladePx: 3 });
  assert.ok(viewer.getStats().summaries > 0);
  assert.equal(stripes(ctx()).length, 0, 'every summary is under two gaps tall');
  assert.ok(fillAlphas(ctx()).includes(FALLBACK_THEME.summaryOpacity));
});

test('the stripe colour defaults to the summary colour', async () => {
  const m = await makeViewer(TREE, { options: { minCladePx: 20, summaryStyle: 'striped' }, theme: { summary: '#00ff00' }, size: [500, 300] });
  m.env.flush();
  assert.equal(m.viewer.theme.summaryStripeColour, '');
  assert.ok(stripes(m.ctx(), '#00ff00').length > 0);
});

test('a clade colour is kept by its stripes', async () => {
  const m = await makeViewer(TREE, {
    options: { minCladePx: 20, summaryStyle: 'striped' },
    theme: { summaryStripeColour: STRIPE },
    size: [500, 300],
  });
  m.viewer.setClades([{ node: 1, colour: '#0000ff' }]);
  m.env.flush();
  assert.ok(stripes(m.ctx(), '#0000ff').length > 0, 'the coloured clade is striped in its colour');
  assert.ok(stripes(m.ctx(), STRIPE).length > 0, 'the rest in the stripe colour');
});

test('dimming: the stripes of a summary without a highlighted tip are stroked at summaryOpacity * dimOpacity', async () => {
  const m = await makeViewer(TREE, {
    options: { minCladePx: 20, summaryStyle: 'striped', highlightStyle: 'dim' },
    theme: { summaryStripeColour: STRIPE, dimOpacity: DIM },
    size: [500, 300],
  });
  m.viewer.setHighlighted(['t5']);
  m.env.flush();
  const so = m.viewer.theme.summaryOpacity;
  const alphas = new Set(stripes(m.ctx()).map((x) => x.alpha));
  assert.ok(alphas.has(so), 'the summary holding the match');
  assert.ok(alphas.has(so * DIM), 'the others');
  assert.equal(alphas.size, 2);
});

for (const layout of ['rectangular', 'radial']) {
  test(`${layout}: clades the app collapsed stay solid unless stripeCollapsed`, async () => {
    const tree =
      '((' + Array.from({ length: 60 }, (_, k) => 'a' + k).join(',') + ')X,(' + Array.from({ length: 60 }, (_, k) => 'b' + k).join(',') + ')Y)r;';
    const m = await makeViewer(tree, { options: { layout, summaryStyle: 'striped' }, theme: { summaryStripeColour: STRIPE }, size: [500, 500] });
    m.viewer.setCollapsed([1]);
    m.env.flush();
    assert.equal(stripes(m.ctx()).length, 0, 'collapsed clade X is solid; Y is expanded');
    assert.ok(fillAlphas(m.ctx()).includes(m.viewer.theme.summaryOpacity));
    m.ctx().reset();
    m.viewer.setOptions({ stripeCollapsed: true });
    m.env.flush();
    assert.ok(stripes(m.ctx()).length > 0, 'striped on request');
  });
}

test('the overview strip stays solid', async () => {
  const { OverviewControl } = await import('../src/controls/index.ts');
  const m = await makeViewer(TREE, {
    controls: [new OverviewControl()],
    options: { minCladePx: 20, summaryStyle: 'striped' },
    theme: { summaryStripeColour: STRIPE },
    size: [500, 300],
  });
  m.env.flush();
  const canvases = [];
  const walk = (el) => {
    for (const c of el.children ?? []) {
      if (c.ctx) canvases.push(c);
      walk(c);
    }
  };
  walk(m.viewer.element);
  const strips = canvases.filter((c) => c !== m.canvas() && c !== m.topCanvas());
  assert.ok(strips.length > 0, 'the overview canvas exists');
  for (const c of strips) assert.equal(stripes(c.ctx).length, 0);
  assert.ok(
    strips.some((c) => fillAlphas(c.ctx).length > 0),
    'and draws its summaries filled',
  );
});
