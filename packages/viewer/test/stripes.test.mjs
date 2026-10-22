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
    path = [],
    id = 0,
    lastW = -1,
    lastA = -1,
    prevCount = 0;
  for (const e of ctx.log) {
    if (e[0] === 'strokeStyle=') style = e[1];
    else if (e[0] === 'globalAlpha=') alpha = e[1];
    else if (e[0] === 'lineWidth=') width = e[1];
    else if (e[0] === 'beginPath') path = [];
    else if (e[0] === 'moveTo') path.push([e[1], e[2]]);
    else if (e[0] === 'lineTo' && path.length) {
      path.push([e[1], e[2]]);
    } else if (e[0] === 'stroke' && style === colour) {
      // a summary's stripes are stroked in chunks of 256 with one width and alpha: a stroke after a full chunk continues its group
      if (!(prevCount === 256 && width === lastW && alpha === lastA)) id++;
      lastW = width;
      lastA = alpha;
      prevCount = path.length / 2;
      for (let k = 0; k + 1 < path.length; k += 2)
        out.push({ x0: path[k][0], y0: path[k][1], x1: path[k + 1][0], y1: path[k + 1][1], alpha, width, id });
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
  }
  const gap = viewer.theme.summaryStripeGap;
  const ys = [...new Set(s.map((x) => x.y0))].sort((a, b) => a - b);
  // the stripes of one clade are evenly spaced at least `gap` apart; across clades the same holds (their bands do not overlap)
  for (let k = 1; k < ys.length; k++) assert.ok(ys[k] - ys[k - 1] >= gap - 1e-6, 'gap ' + (ys[k] - ys[k - 1]));
  assert.ok(s.length <= 300 / gap + viewer.getStats().summaries, 'bounded by the plot height over the gap');
});

/** Group the stripes by stroke (one summary each). */
const groups = (s) => [...Map.groupBy(s, (x) => x.id).values()];
/** The computed coverage of a rectangular group: line width over the distance between neighbouring stripes, times the alpha. */
function rectDarkness(g) {
  const ys = g.map((x) => x.y0).sort((a, b) => a - b);
  const pitch = (ys[ys.length - 1] - ys[0]) / (ys.length - 1);
  return (g[0].alpha * g[0].width) / pitch;
}

test('stripes are as dark as the solid fill: alpha times coverage (line width over spacing) equals summaryOpacity, dimmed ones summaryOpacity * dimOpacity', async () => {
  for (const gap of [3, 4.5, 6, 10]) {
    const m = await make('rectangular', { highlightStyle: 'dim', minCladePx: 40 }, TREE, { theme: { summaryStripeGap: gap, dimOpacity: DIM } });
    m.viewer.setHighlighted(['t5']);
    m.env.flush();
    const so = m.viewer.theme.summaryOpacity;
    const gs = groups(stripes(m.ctx())).filter((g) => g.length > 2);
    assert.ok(gs.length > 1, 'gap ' + gap);
    const seen = new Set();
    for (const g of gs) {
      const d = rectDarkness(g);
      const t = [so, so * DIM].find((t) => Math.abs(d - t) < 0.02 * t + 1e-9);
      assert.ok(t !== undefined, `gap ${gap}: darkness ${d} is neither ${so} nor ${so * DIM}`);
      seen.add(t);
    }
    assert.equal(seen.size, 2, 'lit and dimmed summaries');
  }
});

test('radial: stripes are about as dark as the solid fill (spacing measured at the middle of the stripes)', async () => {
  const m = await make('radial', { minCladePx: 40 });
  const { cx, cy } = m.viewer.proj.T;
  const so = m.viewer.theme.summaryOpacity;
  const gs = groups(stripes(m.ctx())).filter((g) => g.length > 3);
  assert.ok(gs.length > 1);
  for (const g of gs) {
    const mids = g.map((x) => {
      const mx = (x.x0 + x.x1) / 2 - cx,
        my = (x.y0 + x.y1) / 2 - cy;
      return { a: Math.atan2(my, mx), r: Math.hypot(mx, my) };
    });
    const as = mids.map((q) => q.a).sort((p, q) => p - q);
    const rMean = mids.reduce((t, q) => t + q.r, 0) / mids.length;
    const pitch = ((as[as.length - 1] - as[0]) / (as.length - 1)) * rMean;
    const d = (g[0].alpha * g[0].width) / pitch;
    assert.ok(Math.abs(d - so) < 0.15 * so, `darkness ${d} against ${so}`);
  }
});

test('stripeLineWidth / stripeLineAlpha: the width is alpha times the pitch, at least 1 px, and the alpha makes up for the minimum', async () => {
  const { stripeLineWidth, stripeLineAlpha } = await import('../src/draw.ts');
  for (const [a, pitch] of [
    [0.6, 3],
    [0.6, 20],
    [0.15, 3],
    [1, 1],
    [0.25, 25],
  ]) {
    const w = stripeLineWidth(a, pitch),
      al = stripeLineAlpha(a, pitch);
    assert.ok(w >= 1 && al > 0 && al <= 1);
    assert.ok(Math.abs((w * al) / pitch - a) < 1e-12, `${a} at ${pitch}`);
  }
  assert.equal(stripeLineWidth(0.6, 20), 12);
  assert.equal(stripeLineAlpha(0.6, 20), 1);
});

test('rectangular: a larger gap gives fewer stripes, and the line is at least 1 px wide', async () => {
  const a = await make('rectangular', {}, TREE, { theme: { summaryStripeGap: 3 } });
  const na = stripes(a.ctx()).length;
  const b = await make('rectangular', {}, TREE, { theme: { summaryStripeGap: 8 } });
  const sb = stripes(b.ctx());
  assert.ok(sb.length > 0 && sb.length < na);
  assert.ok(
    sb.every((x) => x.width >= 1),
    'at least a pixel wide',
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

test('dimming: the stripes of a summary without a highlighted tip are as dark as a solid summaryOpacity * dimOpacity, the others as summaryOpacity', async () => {
  const m = await makeViewer(TREE, {
    options: { minCladePx: 40, summaryStyle: 'striped', highlightStyle: 'dim' },
    theme: { summaryStripeColour: STRIPE, dimOpacity: DIM },
    size: [500, 300],
  });
  m.viewer.setHighlighted(['t5']);
  m.env.flush();
  const so = m.viewer.theme.summaryOpacity;
  const darks = new Set(
    groups(stripes(m.ctx()))
      .filter((g) => g.length > 2)
      .map((g) => rectDarkness(g).toFixed(6)),
  );
  assert.deepEqual([...darks].sort(), [(so * DIM).toFixed(6), so.toFixed(6)].sort());
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

const poly = (n, p) => '(' + Array.from({ length: n }, (_, k) => p + k).join(',') + ')';
const BANDS = `(${poly(400, 'p')}P,${poly(400, 'q')}Q)r;`; // two polytomies of tips: slices

test('rectangular: a triangle summary starts each stripe on its sloping side, a polytomy band at its left edge; all end at the outer edge', async () => {
  const tri = groups(stripes((await make('rectangular', { minCladePx: 40 })).ctx())).filter((g) => g.length > 3);
  assert.ok(tri.length > 3);
  for (const g of tri) {
    assert.equal(new Set(g.map((x) => x.x1)).size, 1, 'one outer edge');
    const xs = g.map((x) => x.x0);
    assert.ok(Math.max(...xs) - Math.min(...xs) > 1, 'the start follows the triangle side');
    assert.ok(Math.min(...xs) >= g[0].x1 - 400 && Math.max(...xs) <= g[0].x1, 'inside the triangle');
  }
  const band = groups(stripes((await make('rectangular', {}, BANDS)).ctx()));
  assert.ok(band.length >= 2 && band.every((g) => g.length > 5));
  for (const g of band) assert.equal(new Set(g.map((x) => x.x0)).size, 1, 'a band starts at one x');
});

test('radial: a fan starts each ray on its side (the start radius varies), a polytomy ring segment at one radius', async () => {
  const { cx, cy } = (await make('radial')).viewer.proj.T;
  const r = (x) => Math.hypot(x.x0 - cx, x.y0 - cy);
  const fans = groups(stripes((await make('radial', { minCladePx: 40 })).ctx())).filter((g) => g.length > 3);
  assert.ok(fans.length > 3);
  for (const g of fans) {
    const rs = g.map(r);
    assert.ok(Math.max(...rs) - Math.min(...rs) > 1, 'start radii vary');
    assert.ok(Math.min(...rs) < Math.hypot(g[0].x1 - cx, g[0].y1 - cy), 'and lie inside the fan');
  }
  const rings = groups(stripes((await make('radial', {}, BANDS)).ctx()));
  assert.ok(rings.length >= 2 && rings.every((g) => g.length > 5));
  for (const g of rings) {
    const rs = g.map(r);
    assert.ok(Math.max(...rs) - Math.min(...rs) < 1e-3, 'one start radius');
  }
});

test('a striped summary has no solid fill under its stripes', async () => {
  const m = await make('rectangular', { minCladePx: 40 });
  assert.ok(stripes(m.ctx()).length > 0);
  assert.ok(!fillAlphas(m.ctx()).includes(m.viewer.theme.summaryOpacity), 'no fill at the summary opacity');
});

test('rectangular, zoomed: only the stripes of the visible rows are drawn', async () => {
  const m = await make('rectangular', { minCladePx: 400 });
  m.viewer.setViewport({ x0: 0, x1: 1, y0: 300, y1: 310 });
  m.env.flush();
  const s = stripes(m.ctx());
  assert.ok(s.length > 0, 'summaries taller than the screen are striped');
  const gap = m.viewer.theme.summaryStripeGap;
  assert.ok(
    s.every((x) => x.y0 > -20 && x.y0 < 320),
    'inside the clip window',
  );
  assert.ok(s.length <= (330 / gap) * (m.viewer.getStats().summaries + 1), 'bounded by the window, not the clade');
});

test('radial, zoomed: at most 256 rays per fan, drawn over the visible angles only, else solid', async () => {
  const m = await make('radial', { minCladePx: 600 });
  let drawn = 0;
  for (const vp of [
    { x0: 0.2, x1: 0.4, y0: -0.1, y1: 0.1 },
    { x0: 0.5, x1: 0.52, y0: 0.2, y1: 0.22 },
  ]) {
    m.viewer.setViewport(vp);
    m.env.flush();
    const gs = groups(stripes(m.ctx()));
    for (const g of gs) assert.ok(g.length <= 256, 'rays per fan ' + g.length);
    // every ray is at an angle the window can see (proj.lo..hi, its complement when it wraps; the whole circle when the root is inside)
    const p = m.viewer.proj;
    const inWindow = (x) => {
      let a = Math.atan2(x.y1 - p.T.cy, x.x1 - p.T.cx);
      if (a < 0) a += 2 * Math.PI;
      return p.all || (p.wrap ? a <= p.hi + 1e-6 || a >= p.lo - 1e-6 : a >= p.lo - 1e-6 && a <= p.hi + 1e-6);
    };
    for (const x of gs.flat()) assert.ok(inWindow(x), 'a ray outside the visible angles');
    drawn += gs.length;
    m.ctx().reset();
  }
  assert.ok(drawn > 0, 'some fan is striped in the zoomed views');
});

test('summaryStripeGap below 1 is taken as 1: no stripe per tip, no infinite alpha', async () => {
  const m = await make('rectangular', {}, TREE, { theme: { summaryStripeGap: 0 } });
  const s = stripes(m.ctx());
  assert.ok(s.length > 0);
  assert.ok(s.every((x) => Number.isFinite(x.alpha) && x.alpha <= 1 && Number.isFinite(x.width)));
  assert.ok(s.length <= 300 + m.viewer.getStats().summaries, 'at most one per px');
});

test('the overview strip stays solid even where it has room for stripes (a polytomy band hundreds of tips tall)', async () => {
  const { OverviewControl } = await import('../src/controls/index.ts');
  const m = await makeViewer(BANDS, {
    controls: [new OverviewControl()],
    options: { summaryStyle: 'striped' },
    theme: { summaryStripeColour: STRIPE },
    size: [500, 300],
  });
  m.env.flush();
  assert.ok(stripes(m.ctx()).length > 0, 'the main canvas stripes the bands');
  const canvases = [];
  const walk = (el) => {
    for (const c of el.children ?? []) {
      if (c.ctx) canvases.push(c);
      walk(c);
    }
  };
  walk(m.viewer.element);
  const strips = canvases.filter((c) => c !== m.canvas() && c !== m.topCanvas());
  assert.ok(
    strips.some((c) => fillAlphas(c.ctx).includes(m.viewer.theme.summaryOpacity)),
    'the strip fills its bands solid',
  );
  for (const c of strips) assert.equal(stripes(c.ctx).length, 0);
});

test('one stripe per hidden tip when the rows are wider than the gap (not one per gap)', async () => {
  const m = await make('rectangular', { minCladePx: 100 }, balanced(3), { theme: { summaryStripeGap: 6 } }); // 8 tips, 37 px rows: the cherries are 75 px summaries
  const gs = groups(stripes(m.ctx()));
  assert.ok(gs.length >= 2);
  for (const g of gs) assert.equal(g.length, 2, 'a cherry has two hidden tips, so two stripes');
});

const TWO_POLY = `(${poly(800, 'p')}P,${poly(800, 'q')}Q)r;`; // two bands of 800 tips: one fan each at fit
const twoPoly = () =>
  makeViewer(TWO_POLY, {
    options: { layout: 'radial', summaryStyle: 'striped' },
    theme: { summaryStripeColour: STRIPE },
    size: [900, 900],
  });
const solidFills = (m) => fillAlphas(m.ctx()).filter((a) => a === m.viewer.theme.summaryOpacity).length;
/** The angle (0..2pi) of a ray's outer end seen from the root of the frame. */
const rayAngle = (m, x) => {
  const { cx, cy } = m.viewer.proj.T;
  const a = Math.atan2(x.y1 - cy, x.x1 - cx);
  return a < 0 ? a + 2 * Math.PI : a;
};

test('radial: a fan with more than 256 rays in view draws every 2nd, 4th, ... ray of its grid (at most 256, evenly spaced)', async () => {
  const m = await twoPoly();
  m.env.flush();
  const gs = groups(stripes(m.ctx()));
  assert.equal(gs.length, 2);
  for (const g of gs) {
    assert.ok(g.length <= 256 && g.length > 128, 'rays per fan ' + g.length);
    const a = g.map((x) => rayAngle(m, x)).sort((p, q) => p - q);
    const step = a[1] - a[0];
    for (let k = 2; k < a.length; k++) assert.ok(Math.abs(a[k] - a[k - 1] - step) < 1e-6, 'even spacing');
  }
});

test('radial: stripes more than eight gaps apart (a few hidden tips over a wide ring segment) are not drawn: the summary stays solid', async () => {
  const sparse = `(${poly(10, 'p')}P,${poly(10, 'q')}Q)r;`;
  const m = await makeViewer(sparse, {
    options: { layout: 'radial', summaryStyle: 'striped', minCladePx: 300 },
    theme: { summaryStripeColour: STRIPE },
    size: [500, 500],
  });
  m.env.flush();
  assert.ok(m.viewer.getStats().summaries >= 2, 'the polytomies are summarised');
  assert.equal(stripes(m.ctx()).length, 0);
  assert.ok(solidFills(m) >= 1, 'filled solid instead');
  m.ctx().reset();
  m.viewer.setTheme({ summaryStripeColour: STRIPE, summaryStripeGap: 30 }); // the same fan with a gap that makes ten rays fit
  m.env.flush();
  assert.ok(stripes(m.ctx()).length >= 10, 'striped when the pitch is within eight gaps');
});

test('radial, window through angle 0: the rays of both visible intervals are drawn, as many as the grid puts there', async () => {
  const m = await twoPoly();
  m.viewer.setViewport({ x0: 0.3, x1: 1.5, y0: -0.6, y1: 0.6 });
  m.env.flush();
  const p = m.viewer.proj;
  assert.ok(p.wrap && !p.all, 'the window wraps');
  const gs = groups(stripes(m.ctx()));
  assert.equal(gs.length, 2);
  const [lowFan, highFan] = gs; // P covers the angles 0..pi, Q pi..2pi
  const a1 = lowFan.map((x) => rayAngle(m, x)).sort((u, v) => u - v);
  const a2 = highFan.map((x) => rayAngle(m, x)).sort((u, v) => u - v);
  assert.ok(a1.length > 20 && a1.every((a) => a <= p.hi + 1e-6), 'P: rays at angles up to hi');
  assert.ok(a2.length > 20 && a2.every((a) => a >= p.lo - 1e-6), 'Q: rays at angles from lo');
  for (const [a, from, to] of [
    [a1, 0, p.hi],
    [a2, p.lo, 2 * Math.PI],
  ]) {
    const step = (a[a.length - 1] - a[0]) / (a.length - 1);
    const expected = (to - from) / step;
    assert.ok(Math.abs(a.length - expected) <= 2, `${a.length} rays, the visible angle holds ${expected.toFixed(1)}`);
  }
});

const FOUR_K = `(${poly(4000, 'p')}P,${poly(4000, 'q')}Q)r;`;
const fourK = () =>
  makeViewer(FOUR_K, { options: { layout: 'radial', summaryStyle: 'striped' }, theme: { summaryStripeColour: STRIPE }, size: [900, 900] });

test('radial, window not through angle 0: only rays at visible angles are drawn', async () => {
  const m = await fourK();
  m.viewer.setViewport({ x0: -0.3, x1: 0.3, y0: 0.5, y1: 1.1 });
  m.env.flush();
  const p = m.viewer.proj;
  assert.ok(!p.wrap && !p.all);
  const rays = groups(stripes(m.ctx())).flat();
  assert.ok(rays.length > 50);
  for (const x of rays) {
    const a = rayAngle(m, x);
    assert.ok(a >= p.lo - 1e-6 && a <= p.hi + 1e-6, `angle ${a} outside ${p.lo}..${p.hi}`);
  }
});

for (const [name, vp] of [
  ['one ray per grid step', { x0: -0.3, x1: 0.3, y0: 0.5, y1: 1.1 }],
  ['every other ray of the grid', { x0: -0.6, x1: 0.6, y0: 0.3, y1: 1.5 }],
]) {
  test(`radial: panning a partly visible fan moves its rays, it does not re-space them (${name})`, async () => {
    const m = await fourK();
    const frame = (dx, dy) => {
      m.ctx().reset();
      m.viewer.setViewport({ x0: vp.x0 + dx, x1: vp.x1 + dx, y0: vp.y0 + dy, y1: vp.y1 + dy });
      m.env.flush();
      return groups(stripes(m.ctx())).map((g) => g.map((x) => rayAngle(m, x)));
    };
    const spacing = (a) => Math.min(...a.slice(1).map((v, k) => v - a[k]));
    const before = frame(0, 0);
    assert.ok(before.length >= 1);
    let shared = 0;
    for (const [dx, dy] of [
      [0.0031, 0.002],
      [0.0057, 0.004],
      [0.01, 0.007],
      [0.0137, 0.001],
    ]) {
      const after = frame(dx, dy); // a small pan
      assert.equal(after.length, before.length);
      assert.ok(Math.abs(spacing(after[0]) - spacing(before[0])) < 1e-6, 'same spacing after the pan');
      for (let g = 0; g < before.length; g++) {
        const lo = Math.min(...after[g]),
          hi = Math.max(...after[g]);
        for (const a of before[g]) {
          if (a <= lo + 1e-9 || a >= hi - 1e-9) continue; // inside the second frame's angles
          shared++;
          assert.ok(
            after[g].some((b) => Math.abs(a - b) < 1e-6),
            `ray at ${a} is not in the frame panned by ${dx}`,
          );
        }
      }
    }
    assert.ok(shared > 100, 'rays compared: ' + shared);
  });
}

test('rectangular, zoomed into a summary much taller than the screen: only the stripes of the visible rows are drawn', async () => {
  const m = await make('rectangular', { minCladePx: 4000 }, balanced(11)); // clades of 1024 tips are summaries; 100 rows fill the screen
  m.viewer.setViewport({ x0: 0, x1: 1, y0: 300, y1: 400 });
  m.ctx().reset();
  m.env.flush();
  const s = stripes(m.ctx());
  const gap = m.viewer.theme.summaryStripeGap;
  assert.ok(s.length > 50, 'striped: ' + s.length);
  assert.ok(s.length <= 330 / gap + 4, 'only the visible rows: ' + s.length);
});

test('rectangular: a collapsed clade of three tips in a row zoomed to 200 px stays solid, one in a row of 60 px is striped', async () => {
  const m = await makeViewer('((a0,a1,a2)X,(b0,b1)Y)r;', {
    options: { summaryStyle: 'striped', stripeCollapsed: true },
    theme: { summaryStripeColour: STRIPE },
    size: [500, 300],
  });
  m.viewer.setCollapsed([1]);
  m.viewer.setViewport({ x0: 0, x1: 1, y0: 0, y1: 1.5 });
  m.env.flush();
  assert.equal(stripes(m.ctx()).length, 0, 'three stripes 66 px apart would be bands');
  assert.ok(solidFills(m) >= 1);
  m.ctx().reset();
  m.viewer.setViewport({ x0: 0, x1: 1, y0: 0, y1: 5 });
  m.env.flush();
  assert.equal(groups(stripes(m.ctx())).length >= 1, true, 'striped at 60 px per row (20 px stripes)');
});

test('radial: one ray per hidden tip when the tips are wider apart than the gap', async () => {
  const m = await make('radial', { minCladePx: 400 }, balanced(3), { theme: { summaryStripeGap: 24 } });
  const gs = groups(stripes(m.ctx()));
  assert.ok(gs.length >= 2);
  for (const g of gs) assert.equal(g.length, 4, 'a clade of four tips: four rays');
});
