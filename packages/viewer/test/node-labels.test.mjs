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
    else if (e[0] === 'fillText' && e[1] !== '' && !TIPS.test(e[1])) out.push({ text: e[1], x: e[2], y: e[3], fill, alpha, align, tf });
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

// ---------------------------------------------------------------------------------------------------------------- more

const { parseNewick } = await import('@gbif-phylo/io');
const path = await import('node:path');
const { fileURLToPath } = await import('node:url');
const { partialSnapshot } = await import(path.join(path.dirname(fileURLToPath(import.meta.url)), 'partial-snapshot.mjs'));
const { InMemorySource } = await import('../src/source.ts');

/** A balanced binary tree with 2^depth tips, every branch of length 1 and (internal) support 90. */
function balanced(depth) {
  let n = 0;
  const go = (d) => (d === 0 ? `t${n++}:1` : `(${go(d - 1)},${go(d - 1)})90:1`);
  return `${go(depth)};`;
}
const lastValue = (ctx, prop) => ctx.log.filter((e) => e[0] === prop + '=').at(-1)?.[1];

test("'support' reads tree.support when the snapshot has it, the label otherwise", async () => {
  const t = parseNewick(TREE);
  t.support[1] = 0.77; // the label says 95
  const m = await make({ nodeLabels: 'support' }, { tree: t });
  assert.deepEqual(texts(m.ctx()).sort(), ['0.5', '0.77']);
  const u = parseNewick('((a:1,b:1)x:2,(c:1,d:1)y:3)r;');
  u.support[1] = 0.6;
  const n = await make({ nodeLabels: 'support' }, { tree: u });
  assert.deepEqual(texts(n.ctx()), ['0.6'], 'a NaN in the array is no label, whatever the label says');
});

test('NaN, infinite and missing values give no label', async () => {
  const m = await make({ nodeLabels: 'length' }, { tree: '((a:1,b:1)95,(c:1,d:1)0.5:3)r;' });
  assert.deepEqual(texts(m.ctx()), ['3'], 'x has no length');
  const n = await make({ nodeLabels: (node) => (node === 1 ? NaN : node === 4 ? Infinity : 'ok') });
  assert.deepEqual(texts(n.ctx()), []);
  const s = await make({ nodeLabels: 'support' }, { tree: '((a:1,b:1)Name:1,(c:1,d:1)0.5:3)r;' });
  assert.deepEqual(texts(s.ctx()), ['0.5'], 'a name is no support');
});

test('the node marker is cleared: the gap grows with nodeMarkerSize', async () => {
  const gapOf = async (theme) => {
    const m = await make({ nodeLabels: 'support' }, { theme });
    const l = nodeTexts(m.ctx()).find((x) => x.text === '95');
    return m.viewer.nodePosition(1).x - l.x;
  };
  assert.equal(await gapOf({ nodeMarkerSize: 4 }), 3);
  assert.equal(await gapOf({ nodeMarkerSize: 12 }), 7);
});

/** The room (px of the horizontal segment) of node 1 of TREE, set by the width of the viewport. */
async function withRoom(options, room) {
  const m = await make(options, { tree: '((a:30,b:30)95:1,(c:30,d:30)0.5:1)r;' });
  for (let k = 0; k < 4; k++) {
    const vp = m.viewer.getViewport();
    const now = m.viewer.nodePosition(1).x - m.viewer.nodePosition(0).x;
    m.viewer.setViewport({ ...vp, x1: vp.x0 + ((vp.x1 - vp.x0) * now) / room });
    m.viewer.renderNow();
  }
  m.ctx().reset();
  m.viewer.invalidate();
  m.env.flush();
  const got = m.viewer.nodePosition(1).x - m.viewer.nodePosition(0).x;
  assert.ok(Math.abs(got - room) < 0.5, `room ${got}`);
  return m;
}

test('the text must fit its branch with the padding: support needs width + gap + pad, length width + 2 pad (6 px per character)', async () => {
  // '95': 12 px wide. Support: 12 + 3 + 3 = 18; length '2': 6 + 6 = 12
  assert.ok(
    texts((await withRoom({ nodeLabels: 'support' }, 15)).ctx()).every((t) => t !== '95'),
    'room 15 < 18',
  );
  assert.ok(texts((await withRoom({ nodeLabels: 'support' }, 21)).ctx()).includes('95'), 'room 21 >= 18');
  assert.ok(!texts((await withRoom({ nodeLabels: 'length' }, 10.5)).ctx()).includes('1'), 'room 10.5 < 12');
  assert.ok(texts((await withRoom({ nodeLabels: 'length' }, 13.5)).ctx()).includes('1'), 'room 13.5 >= 12');
});

test('a node just past the right edge (the cut keeps it, 8 px of padding): no support, it would float; a length on the visible part of its branch', async () => {
  const view = async (mode) => {
    const m = await make({ nodeLabels: mode });
    const T = m.viewer.proj.T;
    // node 1 is at x = 1/2 of the tree's width; put it 4 px past the clip edge
    m.viewer.setViewport({ x0: 0, x1: (T.kx * 0.5) / (T.clipR + 4 - T.ox), y0: 0, y1: 4 });
    m.viewer.renderNow();
    m.ctx().reset();
    m.viewer.invalidate();
    m.env.flush();
    const p = { x: 0, y: 0 };
    m.viewer.proj.nodeXY(1, p);
    assert.ok(Math.abs(p.x - (m.viewer.proj.T.clipR + 4)) < 0.5, `node at ${p.x}, edge ${m.viewer.proj.T.clipR}`);
    return m;
  };
  const s = await view('support');
  assert.ok(!texts(s.ctx()).includes('95'));
  const l = await view('length');
  const e = nodeTexts(l.ctx()).find((x) => x.text === '2');
  assert.ok(e && e.x < l.viewer.proj.T.clipR, 'length is centred on the part of the branch in view');
});

test('the size follows the row height: dense rows of 9 px give 8 px text, not nodeLabelSize', async () => {
  const tips = Array.from({ length: 20 }, (_, i) => `t${i}:1`);
  const tree = `(${Array.from({ length: 10 }, (_, i) => `(${tips[2 * i]},${tips[2 * i + 1]})90:1`).join(',')})r;`;
  const m = await make({ nodeLabels: 'support', labelDensity: 'dense' }, { tree });
  assert.ok(m.viewer.proj.tipPitch < 12.8);
  const fonts = m
    .ctx()
    .log.filter((e) => e[0] === 'font=')
    .map((e) => e[1]);
  assert.ok(texts(m.ctx()).length === 10 && fonts.some((f) => /^8px /.test(f)) && !fonts.some((f) => /^10px /.test(f)), fonts.join('|'));
});

const R = { layout: 'radial', radialMaxNodes: Infinity, drawBudget: 100000 };

test('radial: a length is centred on the middle of its branch; a support value ends gap px before the node, on the root side', async () => {
  const m = await make({ nodeLabels: 'length', layout: 'radial' }, { init: { size: [500, 500] } });
  const root = m.viewer.nodePosition(0);
  for (const [node, text] of [
    [1, '2'],
    [4, '3'],
  ]) {
    const p = m.viewer.nodePosition(node);
    const l = nodeTexts(m.ctx()).find((x) => x.text === text);
    assert.ok(Math.abs(l.tf[4] - (p.x + root.x) / 2) < 1e-6 && Math.abs(l.tf[5] - (p.y + root.y) / 2) < 1e-6, `${text} sits at the middle`);
    assert.equal(l.x, 0);
    assert.equal(l.y, -2, 'above the branch line');
  }
  const s = await make({ nodeLabels: 'support', layout: 'radial' }, { init: { size: [500, 500] } });
  for (const [node, text] of [
    [1, '95'],
    [4, '0.5'],
  ]) {
    const p = s.viewer.nodePosition(node);
    const l = nodeTexts(s.ctx()).find((x) => x.text === text);
    assert.ok(Math.abs(l.tf[4] - p.x) < 1e-6 && Math.abs(l.tf[5] - p.y) < 1e-6, 'anchored at the node');
    const left = l.align === 'left'; // turned round: the text starts at the node and runs toward the root
    assert.equal(l.x, left ? 3 : -3);
    assert.equal(l.align, p.x < s.viewer.nodePosition(0).x ? 'left' : 'right');
  }
});

test('radial: text on the left half is turned to read upright, on both halves, for support and length', async () => {
  for (const mode of ['support', 'length']) {
    const m = await make({ nodeLabels: mode, layout: 'radial' }, { tree: balanced(3), init: { size: [800, 800] } });
    const t = nodeTexts(m.ctx());
    const root = m.viewer.nodePosition(0);
    assert.ok(t.length >= 6, `${t.length} labels`);
    const dxs = t.map((l) => (mode === 'length' ? l.tf[4] : l.tf[4]) - root.x);
    assert.ok(dxs.some((d) => d < -5) && dxs.some((d) => d > 5), 'nodes on both halves');
    for (const l of t) assert.ok(l.tf[0] >= -1e-9, 'upright');
    if (mode === 'length') {
      // every label sits at the middle of the branch of one internal node, not only the ones on the vertical axis
      const tr = m.viewer.getTree();
      const mids = [];
      for (let i = 1; i < tr.nodeCount; i++) {
        if (tr.firstChild[i] < 0) continue;
        // the branch runs along the node's own ray, from the parent's radius to the node's
        const p = m.viewer.nodePosition(i),
          q = m.viewer.nodePosition(tr.parent[i]);
        const rp = Math.hypot(p.x - root.x, p.y - root.y),
          rq = Math.hypot(q.x - root.x, q.y - root.y);
        const k = (rp + rq) / 2 / rp;
        mids.push([root.x + (p.x - root.x) * k, root.y + (p.y - root.y) * k]);
      }
      assert.equal(t.length, mids.length);
      for (const [x, y] of mids)
        assert.ok(
          t.some((l) => Math.abs(l.tf[4] - x) < 1e-6 && Math.abs(l.tf[5] - y) < 1e-6),
          `a label at ${x},${y}`,
        );
    }
  }
});

test('radial: a node whose label would be off the canvas is skipped', async () => {
  const m = await make({ nodeLabels: 'length', ...R }, { tree: balanced(5), init: { size: [600, 600] } });
  m.ctx().reset();
  m.viewer.setViewport({ x0: 0, x1: 1.2, y0: 0, y1: 1.2 });
  m.env.flush();
  const t = nodeTexts(m.ctx());
  assert.ok(t.length > 0);
  for (const l of t) assert.ok(l.tf[4] > -20 && l.tf[5] > -20 && l.tf[4] < 620 && l.tf[5] < 620, `origin ${l.tf[4]},${l.tf[5]}`);
  const all = await make({ nodeLabels: 'length', ...R }, { tree: balanced(5), init: { size: [600, 600] } });
  assert.ok(nodeTexts(all.ctx()).length > t.length, 'with the whole tree in view there are more');
});

test('radial: at most 300 labels, whatever the draw list holds; textAlign and alpha are reset', async () => {
  const m = await make({ nodeLabels: 'length', ...R }, { tree: balanced(10), init: { size: [3000, 3000] } });
  assert.equal(nodeTexts(m.ctx()).length, 300);
  assert.equal(lastValue(m.ctx(), 'textAlign'), 'left');
  assert.equal(lastValue(m.ctx(), 'globalAlpha'), 1);
});

test('rectangular: at most 600 labels', async () => {
  const m = await make({ nodeLabels: 'length', lod: false }, { tree: balanced(11), init: { size: [800, 40000] } });
  assert.equal(nodeTexts(m.ctx()).length, 600);
});

test('a function gets the full-tree id of a partial snapshot, never a stub, and its row is toLocal(id)', async () => {
  const OFFSET = 1000;
  const full = new InMemorySource(parseNewick('((a:1,b:1)x:2,((c:1,d:1)y:1,e:1)z:1,f:1)r;')).snapshot();
  const { snap } = partialSnapshot(full, [4], OFFSET); // z (preorder 4) is not loaded
  const source = {
    nodeCount: full.nodeCount,
    tipCount: full.tipCount,
    hasLengths: true,
    version: 0,
    subscribe: () => () => {},
    snapshot: () => snap,
    ensureClade: async () => {},
    tipLabels: async () => [],
    destroy() {},
  };
  const seen = [];
  const m = await make({ nodeLabels: (node, tree) => (seen.push([node, tree.toLocal(node)]), `n${node}`) }, { tree: source });
  const ids = seen.map((s) => s[0]);
  assert.ok(ids.length > 0 && ids.every((id) => id >= OFFSET), `ids ${ids}`);
  assert.ok(!ids.includes(OFFSET + 4), 'the stub is a summary: no label');
  assert.ok(ids.includes(OFFSET + 1), 'x is labelled');
  assert.ok(seen.every(([id, row]) => row >= 0 && snap.globalId[row] === id));
  assert.ok(texts(m.ctx()).includes(`n${OFFSET + 1}`));
  // 'support' on a partial snapshot: no labels in the rows, so none
  const s = await make({ nodeLabels: 'support' }, { tree: source });
  assert.deepEqual(texts(s.ctx()), []);
});

test('the root has no branch: no label, even with a support value and a length of its own', async () => {
  const tree = '((a:1,b:1)95:2,(c:1,d:1)0.5:3)77:5;';
  for (const layout of ['rectangular', 'radial']) {
    const s = await make({ nodeLabels: 'support', layout }, { tree, init: { size: [500, 500] } });
    assert.deepEqual(texts(s.ctx()).sort(), ['0.5', '95'], layout);
    const l = await make({ nodeLabels: 'length', layout }, { tree, init: { size: [500, 500] } });
    assert.deepEqual(texts(l.ctx()).sort(), ['2', '3'], layout);
  }
});
