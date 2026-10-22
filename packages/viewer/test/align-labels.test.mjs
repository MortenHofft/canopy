// Unit tests of aligned tip labels (`alignLabels`): the label x, the leader lines, dimming, hit areas and DOM anchors, read from the
// draw calls of the recording context.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';

const { makeViewer, destroyAll } = await import('./viewer-harness.mjs');
const { FALLBACK_THEME } = await import('../src/types.ts');
const { THEME_CSS_VARS } = await import('../src/theme.ts');

afterEach(destroyAll);

const PHYLO = '((a:1,b:4)x:1,(c:2,d:6)y:1)r;'; // tips end at x = 2, 5, 3, 7 (of 7)
const CLADO = '((a,b)x,(c,d)y)r;';
const DIM = 0.3;

/** The text positions of the fillText calls: label -> x. */
function labelXs(ctx) {
  return Object.fromEntries(
    ctx
      .calls('fillText')
      .filter((e) => /^[a-d]$/.test(e[1]))
      .map((e) => [e[1], e[2]]),
  );
}
/** The leader lines: the moveTo / lineTo pairs drawn while the dash was set (between setLineDash([..]) and setLineDash([])). */
function leaders(ctx) {
  const out = [];
  let dashed = false;
  let alpha = 1;
  let from = null;
  for (const e of ctx.log) {
    if (e[0] === 'setLineDash') dashed = e[1].length > 0;
    else if (e[0] === 'globalAlpha=') alpha = e[1];
    else if (dashed && e[0] === 'moveTo') from = e;
    else if (dashed && e[0] === 'lineTo' && from) {
      out.push({ x0: from[1], x1: e[1], y: from[2], alpha });
      from = null;
    }
  }
  return out;
}
async function make(newick, options = {}, extra = {}) {
  const m = await makeViewer(newick, { options: { alignLabels: true, ...options }, theme: { dimOpacity: DIM }, size: [500, 200], ...extra });
  m.env.flush();
  return m;
}

test('leader tokens are theme fields with CSS variables', () => {
  assert.equal(FALLBACK_THEME.leaderDash, '1 3');
  assert.equal(FALLBACK_THEME.leaderColour, '');
  assert.equal(THEME_CSS_VARS.leaderColour, '--phylo-leader-colour');
  assert.equal(THEME_CSS_VARS.leaderDash, '--phylo-leader-dash');
  assert.equal(THEME_CSS_VARS.leaderWidth, '--phylo-leader-width');
  assert.equal(THEME_CSS_VARS.leaderOpacity, '--phylo-leader-opacity');
});

test('off by default: labels follow their tips and no dashed line is drawn', async () => {
  const m = await make(PHYLO, { alignLabels: false });
  assert.equal(m.viewer.opts.alignLabels, false);
  const xs = Object.values(labelXs(m.ctx()));
  assert.equal(new Set(xs).size, 4, 'ragged edge');
  assert.equal(leaders(m.ctx()).length, 0);
});

test('phylogram: every drawn label starts at one x, right of the farthest tip, and each tip that ends earlier has a leader that stops before it', async () => {
  const m = await make(PHYLO);
  const ctx = m.ctx();
  const xs = labelXs(ctx);
  assert.deepEqual(Object.keys(xs).sort(), ['a', 'b', 'c', 'd']);
  const x = xs.a;
  assert.ok(Object.values(xs).every((v) => v === x));
  const far = m.viewer.proj.T.ox + m.viewer.proj.T.kx; // the farthest tip
  assert.equal(x, far + 8);
  const ls = leaders(ctx);
  assert.equal(ls.length, 4, 'one per tip, also the farthest (its dot is not the column)');
  for (const l of ls) assert.ok(l.x1 < x && l.x1 >= far, 'ends before the label, right of the farthest tip');
  assert.equal(ls.filter((l) => l.x0 < far - 1).length, 3, 'a, b and c start short of the column');
  assert.ok(ls.every((l) => l.alpha === FALLBACK_THEME.leaderOpacity));
  assert.ok(ctx.calls('setLineDash').some((e) => e[1].join(' ') === '1 3'));
  assert.deepEqual(ctx.calls('setLineDash').at(-1)[1], [], 'the dash is reset');
});

test('cladogram, radial and a tree without lengths: no-op', async () => {
  for (const [nw, opts] of [
    [PHYLO, { branchLengths: false }],
    [CLADO, {}],
    [PHYLO, { layout: 'radial' }],
  ]) {
    const off = await make(nw, { ...opts, alignLabels: false });
    const on = await make(nw, opts);
    assert.equal(leaders(on.ctx()).length, 0);
    assert.deepEqual(labelXs(on.ctx()), labelXs(off.ctx()));
  }
});

test('no leader where no label is drawn (rows under the density limit)', async () => {
  const m = await make(PHYLO, { labelDensity: 'sparse' }, { size: [500, 40] }); // 4 rows in ~16 px: under 16 px each
  assert.equal(m.viewer.labels.count, 0);
  assert.equal(leaders(m.ctx()).length, 0);
});

test('hit-testing a label returns its tip; the DOM anchors sit at the label x', async () => {
  const m = await make(PHYLO);
  const L = m.viewer.labels;
  assert.equal(L.count, 4);
  for (let k = 0; k < L.count; k++) {
    const h = m.viewer.hitTest(L.x[k] + L.w[k] / 2, L.y[k]);
    assert.deepEqual(h && { node: h.node, kind: h.kind }, { node: m.viewer.tree.tipNode[L.rank[k]], kind: 'tip' });
  }
  const anchors = [];
  const walk = (n) => {
    if (n.dataset?.tipId) anchors.push(n);
    for (const c of n.children ?? []) walk(c);
  };
  walk(m.viewer.root);
  assert.equal(anchors.length, 4);
  const tx = anchors.map((a) => /translate\(([-\d.]+)px/.exec(a.style.transform)[1]);
  assert.equal(new Set(tx).size, 1);
  assert.equal(Number(tx[0]), L.x[0]);
});

test('dim: the leader of a tip outside the highlighted set is drawn at leaderOpacity * dimOpacity', async () => {
  const m = await make(PHYLO, { highlightStyle: 'dim' });
  m.viewer.setHighlighted(['a']);
  m.ctx().reset();
  m.env.flush();
  const ls = leaders(m.ctx());
  assert.equal(ls.length, 4);
  const o = FALLBACK_THEME.leaderOpacity;
  const full = ls.filter((l) => l.alpha === o);
  const dim = ls.filter((l) => Math.abs(l.alpha - o * DIM) < 1e-12);
  assert.equal(full.length, 1, 'tip a');
  assert.equal(dim.length, 3, 'b, c and d');
});

test('band: the highlight band still covers the aligned label', async () => {
  const m = await make(PHYLO, { highlightStyle: 'band' });
  m.viewer.setHighlighted(['b']);
  m.env.flush();
  const ctx = m.ctx();
  const L = m.viewer.labels;
  const k = [...Array(L.count).keys()].find((i) => m.viewer.tree.tipLabels[L.rank[i]] === 'b');
  const band = ctx.calls('fillRect').find((e) => e[3] > 0 && e[1] === 0 && e[2] + e[4] / 2 > L.y[k] - 1 && e[2] < L.y[k] && e[3] > L.x[k] + L.w[k]);
  assert.ok(band, 'a band from the left edge past the end of the label');
});

test('the tokens colour, dash and size the leaders', async () => {
  const m = await make(PHYLO, {}, { theme: { leaderColour: '#ff0000', leaderDash: '4,2', leaderWidth: 2, leaderOpacity: 0.5 } });
  const ctx = m.ctx();
  assert.ok(ctx.calls('setLineDash').some((e) => e[1].join(' ') === '4 2'));
  assert.ok(ctx.log.some((e) => e[0] === 'strokeStyle=' && e[1] === '#ff0000'));
  assert.ok(ctx.log.some((e) => e[0] === 'lineWidth=' && e[1] === 2));
  assert.ok(leaders(ctx).every((l) => l.alpha === 0.5));
});

test('labelReserve and the clade window account for the column', async () => {
  const LONG = '((aaaaaaaa:1,b:4)x:1,(c:2,d:6)y:1)r;'; // under 8 characters the reserve sits at its floor
  const m = await make(LONG);
  const off = await make(LONG, { alignLabels: false });
  assert.ok(m.viewer.vs.labelReserve() > off.viewer.vs.labelReserve());
  const v = m.viewer.vs.cladeViewport(m.viewer.tree.firstChild[0]);
  const w = off.viewer.vs.cladeViewport(off.viewer.tree.firstChild[0]);
  assert.ok(v.x1 - v.x0 > w.x1 - w.x0, 'the window reaches the label column');
});

test('collapsed clades get their label at the aligned x, clear of the triangle, with a leader from its base', async () => {
  const m = await make(PHYLO);
  m.viewer.setCollapsed([m.viewer.tree.tipNode[0], m.viewer.tree.tipNode[3]]); // the tips a and d: d is at the farthest x
  m.ctx().reset();
  m.env.flush();
  const xs = labelXs(m.ctx());
  assert.equal(new Set(Object.values(xs)).size, 1);
  const T = m.viewer.proj.T;
  assert.ok(xs.d >= T.ox + T.kx + 14 + 8, 'past the triangle of the farthest tip');
  assert.equal(leaders(m.ctx()).length, 4);
});
