// Unit tests of node labels (`nodeLabels`, `formatNodeLabel`, theme `nodeLabelSize` / `supportColour` / `lengthColour`), read from the
// draw calls of the recording context: which texts were painted, where, in which colour and alpha.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';

const { makeViewer, destroyAll } = await import('./viewer-harness.mjs');
const { FALLBACK_THEME, DEFAULT_OPTIONS } = await import('../src/types.ts');
const { THEME_CSS_VARS } = await import('../src/theme.ts');
const { internalSupport, defaultFormatNodeLabel } = await import('../src/node-label.ts');

afterEach(destroyAll);

// preorder: 0 r, 1 x, 2 a, 3 b, 4 y, 5 c, 6 d. Support in the labels, lengths 2 on the internal branches.
const TREE = '((a:1,b:1)95:2,(c:1,d:1)0.5:3)r;';
const TIPS = /^(?:[a-d]|t\d+)$/;

/** [text, ...] of the fillText calls that are not tip labels, with the state in force: x, y, fill, alpha, align, and the transform. */
function nodeTexts(ctx) {
  const out = [];
  let fill = '',
    alpha = 1,
    align = 'start',
    tf = null;
  for (const e of ctx.log) {
    if (e[0] === 'fillStyle=') fill = e[1];
    else if (e[0] === 'globalAlpha=') alpha = e[1];
    else if (e[0] === 'textAlign=') align = e[1];
    else if (e[0] === 'setTransform') tf = e.slice(1);
    else if (e[0] === 'fillText' && !TIPS.test(e[1]) && ctx.log.indexOf(e) > 0) out.push({ text: e[1], x: e[2], y: e[3], fill, alpha, align, tf });
  }
  return out;
}
const texts = (ctx) => nodeTexts(ctx).map((t) => t.text);
async function make(options = {}, extra = {}) {
  const m = await makeViewer(extra.tree ?? TREE, {
    options: { axis: false, ...options },
    theme: { dimOpacity: 0.3, ...extra.theme },
    size: [500, 200],
    ...extra.init,
  });
  m.env.flush();
  return m;
}

test('tokens and options', () => {
  assert.equal(DEFAULT_OPTIONS.nodeLabels, 'none');
  assert.equal(typeof DEFAULT_OPTIONS.formatNodeLabel, 'function');
  assert.equal(FALLBACK_THEME.supportColour, '');
  assert.equal(FALLBACK_THEME.lengthColour, '');
  assert.ok(FALLBACK_THEME.nodeLabelSize > 0);
  assert.equal(THEME_CSS_VARS.nodeLabelSize, '--phylo-node-label-size');
  assert.equal(THEME_CSS_VARS.supportColour, '--phylo-support-colour');
  assert.equal(THEME_CSS_VARS.lengthColour, '--phylo-length-colour');
});

test('internalSupport reads the numeric prefix; the default format', () => {
  assert.equal(internalSupport('95'), 95);
  assert.equal(internalSupport('0.95'), 0.95);
  assert.equal(internalSupport('98.0:c__Nitrososphaeria'), 98);
  assert.ok(Number.isNaN(internalSupport('')));
  assert.ok(Number.isNaN(internalSupport('Canidae_ott770319')));
  assert.equal(defaultFormatNodeLabel(0.9512, 'support'), '0.95');
  assert.equal(defaultFormatNodeLabel(100, 'support'), '100');
  assert.equal(defaultFormatNodeLabel(100, 'length'), '100', 'not 1: trailing zeros of an integer stay');
  assert.equal(defaultFormatNodeLabel(0.123456, 'length'), '0.123');
});

test("'none' (the default) draws no node text", async () => {
  const m = await make();
  assert.deepEqual(texts(m.ctx()), []);
});

test("'support': a number per drawn internal node, right-aligned just left of the node, above its branch; none for the root or tips", async () => {
  const m = await make({ nodeLabels: 'support' });
  const t = nodeTexts(m.ctx());
  assert.deepEqual(t.map((x) => x.text).sort(), ['0.5', '95']);
  for (const [node, text] of [
    [1, '95'],
    [4, '0.5'],
  ]) {
    const p = m.viewer.nodePosition(node);
    const l = t.find((x) => x.text === text);
    assert.equal(l.align, 'right');
    assert.ok(l.x < p.x && l.x >= p.x - 4, 'ends at the node');
    assert.ok(l.y < p.y, 'above the branch line');
    assert.equal(l.alpha, 1);
    assert.equal(l.fill, FALLBACK_THEME.muted, "'' = muted");
  }
});

test("'length': centred on the horizontal segment of the branch; formatNodeLabel formats", async () => {
  const m = await make({ nodeLabels: 'length' });
  const t = nodeTexts(m.ctx());
  assert.deepEqual(t.map((x) => x.text).sort(), ['2', '3']);
  const x = t.find((l) => l.text === '2');
  const p = m.viewer.nodePosition(1),
    q = m.viewer.nodePosition(0);
  assert.equal(x.align, 'center');
  assert.ok(Math.abs(x.x - (p.x + q.x) / 2) < 1e-6);
  const f = await make({ nodeLabels: 'length', formatNodeLabel: (v, k) => `${k}:${v}` });
  assert.deepEqual(texts(f.ctx()).sort(), ['length:2', 'length:3']);
  const g = await make({ nodeLabels: 'support', formatNodeLabel: (v, k) => (k === 'support' && v <= 1 ? String(Math.round(v * 100)) : String(v)) });
  assert.deepEqual(texts(g.ctx()).sort(), ['50', '95']);
});

test('colours and size come from the theme', async () => {
  const m = await make({ nodeLabels: 'support' }, { theme: { supportColour: '#112233', lengthColour: '#445566', nodeLabelSize: 9 } });
  assert.ok(nodeTexts(m.ctx()).every((l) => l.fill === '#112233'));
  assert.ok(
    m.ctx().log.some((e) => e[0] === 'font=' && /^9px /.test(e[1])),
    'nodeLabelSize',
  );
  const n = await make({ nodeLabels: 'length' }, { theme: { supportColour: '#112233', lengthColour: '#445566' } });
  assert.ok(nodeTexts(n.ctx()).every((l) => l.fill === '#445566'));
});

test('a function: gets the full-tree id and the snapshot; a string, a number (formatted) or null', async () => {
  const seen = [];
  const m = await make({
    nodeLabels: (node, tree) => {
      seen.push([node, tree.labels[tree.toLocal(node)]]);
      return node === 1 ? 'Alpha' : node === 4 ? 0.987 : null;
    },
  });
  assert.deepEqual(texts(m.ctx()).sort(), ['0.99', 'Alpha']);
  assert.deepEqual(seen.sort(), [
    [1, '95'],
    [4, '0.5'],
  ]);
  assert.ok(
    nodeTexts(m.ctx()).every((l) => l.fill === FALLBACK_THEME.muted),
    'drawn as support',
  );
});

test('none inside a summary: collapsed clades get no label, expanded ones do', async () => {
  // x (2 tips, 1 row) and y (2 tips) collapse into triangles when minCladePx is above their size; the root stays
  const big = await make({ nodeLabels: 'support' });
  assert.equal(texts(big.ctx()).length, 2);
  const m = await make({ nodeLabels: 'support', minCladePx: 400 });
  const S = m.viewer.getStats();
  assert.ok(S.summaries > 0, 'there are summaries');
  assert.deepEqual(texts(m.ctx()), []);
});

test('a collapsed tip gets no label, its extended length is not shown', async () => {
  // tip a stands for a collapsed clade, its branch lengthened to the clade's height (as collapseClades { extend } does)
  const m = await make({ nodeLabels: 'length' }, { tree: '((a:7.5,b:1)95:2,(c:1,d:1)0.5:3)r;' });
  assert.ok(!texts(m.ctx()).includes('7.5'), 'a tip never gets a length label');
  m.viewer.setCollapsed([2]);
  m.env.flush();
  m.ctx().reset();
  m.viewer.setOptions({ nodeLabels: 'support' });
  m.viewer.setOptions({ nodeLabels: 'length' });
  m.env.flush();
  const t = texts(m.ctx());
  assert.deepEqual(t.sort(), ['2', '3'], 'the internal branches only');
});

test('none below the density threshold; the density option moves it', async () => {
  const tips = Array.from({ length: 20 }, (_, i) => `t${i}:1`);
  const pairs = [];
  for (let i = 0; i < 20; i += 2) pairs.push(`(${tips[i]},${tips[i + 1]})${90 + (i % 7)}:1`);
  const tree = `(${pairs.join(',')})r;`;
  const get = async (density) => {
    const m = await make({ nodeLabels: 'support', labelDensity: density }, { tree });
    return { n: texts(m.ctx()).length, pitch: m.viewer.proj.tipPitch };
  };
  const normal = await get('normal');
  assert.ok(normal.pitch < 11 && normal.pitch >= 8, `pitch ${normal.pitch}`);
  assert.equal(normal.n, 0, 'rows closer than the normal threshold');
  assert.equal((await get('sparse')).n, 0);
  assert.equal((await get('dense')).n, 10, 'dense: 8 px');
});

test('no room on the branch: a short segment or a long text gets no label', async () => {
  const m = await make({ nodeLabels: 'support' }, { tree: '((a:5,b:5)95:0.001,(c:5,d:5)0.5:3)r;' });
  assert.deepEqual(texts(m.ctx()), ['0.5'], 'x sits on a branch of a fraction of a px');
  const n = await make({ nodeLabels: () => 'a very long name that cannot fit anywhere near its node' });
  assert.deepEqual(texts(n.ctx()), []);
});

test('highlightStyle dim: a clade with no highlighted tip is drawn at dimOpacity, the rest at full strength', async () => {
  const m = await make({ nodeLabels: 'support', highlightStyle: 'dim' });
  m.viewer.setHighlighted(['a']);
  m.env.flush();
  const t = nodeTexts(m.ctx());
  const a = (text) => t.filter((l) => l.text === text).at(-1).alpha;
  assert.equal(a('95'), 1, 'x holds the highlighted tip');
  assert.equal(a('0.5'), 0.3, 'y holds none');
});

test('only drawn nodes: scrolled out of view, the label is not drawn', async () => {
  const m = await make({ nodeLabels: 'support' });
  m.ctx().reset();
  m.viewer.setViewport({ x0: 0, x1: 1, y0: 0, y1: 2 });
  m.env.flush();
  const t = texts(m.ctx());
  assert.ok(t.includes('95') && !t.includes('0.5'));
});

test('radial: along the branch, rotated like tip labels, and the transform is reset', async () => {
  const m = await make({ nodeLabels: 'length', layout: 'radial' }, { init: { size: [500, 500] } });
  const ctx = m.ctx();
  const t = nodeTexts(ctx);
  assert.deepEqual(t.map((x) => x.text).sort(), ['2', '3']);
  for (const l of t) {
    assert.equal(l.align, 'center');
    assert.ok(l.tf && l.tf.length === 6);
    const [a, b, c, d] = l.tf;
    assert.ok(Math.abs(a * d - b * c - 1) < 1e-6, 'a rotation (scale 1)');
    assert.ok(a >= -1e-9, 'never read upside down');
  }
  const last = ctx.calls('setTransform').at(-1);
  assert.deepEqual(last.slice(1), [1, 0, 0, 1, 0, 0], 'reset');
  const s = await make({ nodeLabels: 'support', layout: 'radial' }, { init: { size: [500, 500] } });
  assert.deepEqual(texts(s.ctx()).sort(), ['0.5', '95']);
});

test('radial: none when the node has no arc to speak of', async () => {
  const tips = Array.from({ length: 400 }, (_, i) => `t${i}:1`);
  const pairs = [];
  for (let i = 0; i < 400; i += 2) pairs.push(`(${tips[i]},${tips[i + 1]})90:1`);
  const m = await make({ nodeLabels: 'support', layout: 'radial' }, { tree: `(${pairs.join(',')})r;`, init: { size: [300, 300] } });
  assert.deepEqual(texts(m.ctx()), []);
});

test('a change of the option redraws', async () => {
  const m = await make();
  assert.deepEqual(texts(m.ctx()), []);
  m.ctx().reset();
  m.viewer.setOptions({ nodeLabels: 'support' });
  m.env.flush();
  assert.equal(texts(m.ctx()).length, 2);
});
